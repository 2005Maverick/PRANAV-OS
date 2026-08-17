"""Planner: draft tomorrow, render briefs, replan today.

LLM composes; deterministic code validates, applies, and renders. If the LLM
is down, a minimal skeleton plan is produced from floors so the loop survives.
"""
import datetime as dt
import json
from .. import db, llm, config


# ---------------------------------------------------------------- helpers
def _today() -> dt.date:
    return dt.datetime.now(config.TZ).date()


async def _ensure_day(date: dt.date) -> int:
    row = await db.fetchrow("SELECT id FROM days WHERE date=$1", date)
    if row:
        day_id = row["id"]
    else:
        wake = await db.get_setting("usual_wake") or config.DEFAULT_WAKE
        day_id = await db.fetchval(
            "INSERT INTO days (date, wake_target) VALUES ($1,$2) RETURNING id",
            date, dt.time.fromisoformat(wake),
        )
    await _materialize_recurring(day_id, date)
    return day_id


async def _materialize_recurring(day_id: int, date: dt.date):
    """Weekly fixed constraints (classes) become this day's fixed blocks, once."""
    recs = await db.fetch(
        "SELECT * FROM recurring_blocks WHERE active AND dow=$1", date.weekday())
    for r in recs:
        exists = await db.fetchval(
            "SELECT COUNT(*) FROM blocks WHERE day_id=$1 AND is_fixed AND title=$2", day_id, r["title"])
        if exists:
            continue
        await db.execute(
            """INSERT INTO blocks (day_id, domain_id, title, start_at, end_at, kind, is_fixed)
               VALUES ($1,$2,$3,$4,$5,'fixed',TRUE)""",
            day_id, r["domain_id"], r["title"],
            dt.datetime.combine(date, r["start_t"], tzinfo=config.TZ),
            dt.datetime.combine(date, r["end_t"], tzinfo=config.TZ))


async def _domains() -> list:
    return await db.fetch("SELECT id, slug, name, floor_type, floor_target, floor_window_days, floor_minutes FROM domains WHERE active")


async def floor_status() -> list[dict]:
    """Rolling-window floor health per domain."""
    out = []
    for d in await _domains():
        if d["floor_type"] in ("none", None):
            continue
        window_start = _today() - dt.timedelta(days=(d["floor_window_days"] or 7) - 1)
        done = await db.fetchval(
            """SELECT COUNT(*) FROM blocks b JOIN days dy ON dy.id=b.day_id
               WHERE b.domain_id=$1 AND b.status='done' AND dy.date >= $2""",
            d["id"], window_start,
        )
        out.append({"slug": d["slug"], "name": d["name"], "done": done,
                    "target": d["floor_target"], "ok": done >= (d["floor_target"] or 0)})
    return out


# ---------------------------------------------------------------- drafting
async def draft_day(date: dt.date) -> str:
    """Compose a draft plan for `date`; returns human summary text."""
    day_id = await _ensure_day(date)
    await db.execute("DELETE FROM blocks WHERE day_id=$1 AND is_fixed=FALSE AND status='planned'", day_id)

    fixed = await db.fetch(
        "SELECT title, start_at, end_at FROM blocks WHERE day_id=$1 AND is_fixed=TRUE", day_id)
    floors = await floor_status()
    commitments = await db.fetch(
        "SELECT title, due_date FROM commitments WHERE status='open' AND (due_date IS NULL OR due_date <= $1::date + 14)",
        date)
    closeouts = await db.fetch(
        """SELECT b.title, c.next_step FROM closeouts c JOIN blocks b ON b.id=c.block_id
           ORDER BY c.created_at DESC LIMIT 6""")
    rules = await db.fetch("SELECT rule_text FROM rules WHERE active")

    prompt = {
        "date": str(date),
        "energy_peaks": await db.get_setting("energy_peaks"),
        "fixed_blocks": [{"title": f["title"], "start": f["start_at"].astimezone(config.TZ).strftime("%H:%M"),
                          "end": f["end_at"].astimezone(config.TZ).strftime("%H:%M")} for f in fixed],
        "floors_rolling": floors,
        "open_commitments": [{"t": c["title"], "due": str(c["due_date"])} for c in commitments],
        "recent_closeouts": [{"block": c["title"], "next": c["next_step"]} for c in closeouts],
        "standing_rules": [r["rule_text"] for r in rules],
    }
    plan = await llm.json_call(
        "Compose tomorrow's block plan for Pranav.\n"
        "RULES: schedule at most 70% of waking hours (leave real gaps as buffer); "
        "protect floors that are behind; one project per block; every block gets the "
        "smallest concrete next_action (2-minute entry, from recent_closeouts where possible); "
        "respect fixed blocks and standing rules; blocks 40–120 min.\n"
        f"CONTEXT: {json.dumps(prompt, default=str)}\n"
        'JSON: {"blocks":[{"title":"...","domain":"slug","start":"HH:MM","end":"HH:MM",'
        '"next_action":"..."}], "note":"one-line energy/shape note"}'
    )

    if not plan or "blocks" not in plan:
        # deterministic fallback: floors behind -> one block each, evening spread
        plan = {"blocks": [], "note": "skeleton plan (brain offline) — floors only"}
        hour = 18
        for f in [f for f in floors if not f["ok"]][:3]:
            plan["blocks"].append({"title": f["name"], "domain": f["slug"],
                                   "start": f"{hour:02d}:00", "end": f"{hour + 1:02d}:00",
                                   "next_action": "open it and do the first small thing"})
            hour += 2

    inserted = 0
    for b in plan["blocks"]:
        try:
            start = dt.datetime.combine(date, dt.time.fromisoformat(b["start"]), tzinfo=config.TZ)
            end = dt.datetime.combine(date, dt.time.fromisoformat(b["end"]), tzinfo=config.TZ)
            dom_id = await db.fetchval("SELECT id FROM domains WHERE slug=$1", b.get("domain"))
            await db.execute(
                """INSERT INTO blocks (day_id, domain_id, title, next_action, start_at, end_at)
                   VALUES ($1,$2,$3,$4,$5,$6)""",
                day_id, dom_id, b["title"][:120], b.get("next_action"), start, end)
            inserted += 1
        except Exception:
            continue

    await db.execute("UPDATE days SET status='draft', energy_note=$2 WHERE id=$1",
                     day_id, plan.get("note"))
    return await render_day(date, header=f"Draft for {date.strftime('%A %d %b')} — {inserted} blocks")


async def render_day(date: dt.date, header: str | None = None) -> str:
    day = await db.fetchrow("SELECT * FROM days WHERE date=$1", date)
    if not day:
        return "No plan for that day yet."
    blocks = await db.fetch(
        """SELECT b.*, d.name AS domain_name FROM blocks b
           LEFT JOIN domains d ON d.id=b.domain_id
           WHERE b.day_id=$1 ORDER BY b.start_at""", day["id"])
    lines = [header or date.strftime("%A %d %b")]
    if day["energy_note"]:
        lines.append(f"({day['energy_note']})")
    for b in blocks:
        t = f"{b['start_at'].astimezone(config.TZ):%H:%M}–{b['end_at'].astimezone(config.TZ):%H:%M}"
        mark = {"done": "✓", "skipped": "✗", "sacrificed": "→", "started": "▶"}.get(b["status"], "·")
        fixed = " [fixed]" if b["is_fixed"] else ""
        lines.append(f"{mark} {t}  {b['title']}{fixed}")
        if b["next_action"] and b["status"] == "planned":
            lines.append(f"      ↳ {b['next_action']}")
    lines.append(f"\nStatus: {day['status']}")
    return "\n".join(lines)


# ---------------------------------------------------------------- replan
async def replan(trigger: str) -> str:
    """One-sentence trigger -> redraw the rest of today. Names sacrifices."""
    date = _today()
    day = await db.fetchrow("SELECT * FROM days WHERE date=$1", date)
    if not day:
        return "No plan today to replan. Say `plan today` first."
    now = dt.datetime.now(config.TZ)
    remaining = await db.fetch(
        """SELECT b.id, b.title, b.next_action, b.is_fixed, b.start_at, b.end_at, d.slug AS domain
           FROM blocks b LEFT JOIN domains d ON d.id=b.domain_id
           WHERE b.day_id=$1 AND b.end_at > $2 AND b.status IN ('planned','started')
           ORDER BY b.start_at""", day["id"], now)
    floors = await floor_status()

    result = await llm.json_call(
        f"Pranav's day changed: \"{trigger}\" (now = {now:%H:%M}).\n"
        "Redraw the REMAINING blocks of today. Fixed blocks cannot move. Defend floors "
        "that are behind before sacrificing their blocks. If something must go, move it "
        "to tomorrow and say so. Keep >=25% of remaining time unscheduled.\n"
        f"REMAINING: {json.dumps([{'id': r['id'], 'title': r['title'], 'fixed': r['is_fixed'], 'domain': r['domain'], 'start': r['start_at'].astimezone(config.TZ).strftime('%H:%M'), 'end': r['end_at'].astimezone(config.TZ).strftime('%H:%M')} for r in remaining])}\n"
        f"FLOORS: {json.dumps(floors)}\n"
        'JSON: {"keep":[{"id":1,"start":"HH:MM","end":"HH:MM"}],'
        '"sacrifice":[{"id":2,"move_to":"tomorrow HH:MM or drop","why":"..."}],'
        '"add":[{"title":"...","domain":"slug","start":"HH:MM","end":"HH:MM","next_action":"..."}],'
        '"summary":"2-line human summary naming every sacrifice"}'
    )
    if not result:
        return "Brain offline — tell me the specific moves (`move trading to 20:00`, `drop tech today`) and I'll apply them."

    moved, sacrificed, added = 0, 0, 0
    for k in result.get("keep", []):
        try:
            start = dt.datetime.combine(date, dt.time.fromisoformat(k["start"]), tzinfo=config.TZ)
            end = dt.datetime.combine(date, dt.time.fromisoformat(k["end"]), tzinfo=config.TZ)
            await db.execute("UPDATE blocks SET start_at=$2, end_at=$3 WHERE id=$1 AND is_fixed=FALSE",
                             k["id"], start, end)
            moved += 1
        except Exception:
            continue
    for s in result.get("sacrifice", []):
        await db.execute(
            "UPDATE blocks SET status='sacrificed', sacrificed_to=$2 WHERE id=$1",
            s["id"], s.get("move_to", "dropped"))
        sacrificed += 1
    for a in result.get("add", []):
        try:
            start = dt.datetime.combine(date, dt.time.fromisoformat(a["start"]), tzinfo=config.TZ)
            end = dt.datetime.combine(date, dt.time.fromisoformat(a["end"]), tzinfo=config.TZ)
            dom_id = await db.fetchval("SELECT id FROM domains WHERE slug=$1", a.get("domain"))
            await db.execute(
                "INSERT INTO blocks (day_id, domain_id, title, next_action, start_at, end_at) VALUES ($1,$2,$3,$4,$5,$6)",
                day["id"], dom_id, a["title"][:120], a.get("next_action"), start, end)
            added += 1
        except Exception:
            continue

    await db.execute(
        "INSERT INTO replans (day_id, trigger, diff, accepted) VALUES ($1,$2,$3,TRUE)",
        day["id"], trigger, json.dumps(result, default=str))
    summary = result.get("summary", f"Replanned: {moved} moved, {sacrificed} sacrificed, {added} added.")
    return f"{summary}\n\n{await render_day(date, header='Today, redrawn')}"


# ---------------------------------------------------------------- briefs
async def morning_brief() -> str:
    date = _today()
    day = await db.fetchrow("SELECT * FROM days WHERE date=$1", date)
    if not day:
        await draft_day(date)
        day = await db.fetchrow("SELECT * FROM days WHERE date=$1", date)
    floors = await floor_status()
    behind = [f["name"] for f in floors if not f["ok"]]
    txt = await render_day(date, header=f"Morning brief — {date.strftime('%A %d %b')}")
    if behind:
        txt += f"\n\nFloors behind: {', '.join(behind)}"
    txt += "\n\nReply `confirm` to arm the day, or tell me what to change."
    return txt


async def evening_close() -> str:
    date = _today()
    day = await db.fetchrow("SELECT * FROM days WHERE date=$1", date)
    parts = []
    if day:
        rows = await db.fetch(
            "SELECT status, COUNT(*) c FROM blocks WHERE day_id=$1 GROUP BY status", day["id"])
        counts = {r["status"]: r["c"] for r in rows}
        parts.append(
            f"Day close — done {counts.get('done', 0)}, skipped {counts.get('skipped', 0)}, "
            f"sacrificed {counts.get('sacrificed', 0)}.")
        await db.execute("UPDATE days SET status='closed', closed_at=now() WHERE id=$1", day["id"])
    tomorrow = date + dt.timedelta(days=1)
    parts.append(await draft_day(tomorrow))
    parts.append("Confirm in the morning. Sleep well — tell me `sleeping` when you actually do.")
    return "\n\n".join(parts)
