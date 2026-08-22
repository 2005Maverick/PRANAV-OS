"""Weekly/monthly review engine — computes the Sunday room's data.

Everything here is read+derive; mutations (approve proposal, idea actions,
complete review) are small targeted writes. Bot /review shares this service.
"""
import datetime as dt
import json

from .. import config, db, llm
from . import planner


def _today() -> dt.date:
    return dt.datetime.now(config.TZ).date()


async def _period(kind: str = "weekly") -> tuple[dt.date, dt.date]:
    end = _today()
    start = end - dt.timedelta(days=29 if kind == "monthly" else 6)
    return start, end


async def plan_vs_reality(start: dt.date, end: dt.date) -> dict:
    rows = await db.fetch(
        """SELECT d2.slug AS domain, d2.name, d2.color, b.status,
                  COUNT(*) AS n,
                  SUM(EXTRACT(EPOCH FROM (b.end_at - b.start_at)))/3600 AS hours
           FROM blocks b
           JOIN days dy ON dy.id=b.day_id
           LEFT JOIN domains d2 ON d2.id=b.domain_id
           WHERE dy.date BETWEEN $1 AND $2
           GROUP BY 1,2,3,4""", start, end)
    by_domain: dict = {}
    for r in rows:
        k = r["domain"] or "other"
        d = by_domain.setdefault(k, {
            "domain": k, "name": r["name"] or "Other", "color": r["color"] or "#3E433C",
            "planned_h": 0.0, "done_h": 0.0, "done": 0, "skipped": 0, "sacrificed": 0})
        h = float(r["hours"] or 0)
        d["planned_h"] += h
        if r["status"] == "done":
            d["done_h"] += h
            d["done"] += r["n"]
        elif r["status"] == "skipped":
            d["skipped"] += r["n"]
        elif r["status"] == "sacrificed":
            d["sacrificed"] += r["n"]
    return {"domains": sorted(by_domain.values(), key=lambda x: -x["planned_h"])}


async def ignored_nudges(start: dt.date, end: dt.date) -> dict:
    rows = await db.fetch(
        """SELECT kind, COUNT(*) AS total,
                  COUNT(*) FILTER (WHERE response IS NULL) AS ignored
           FROM nudges WHERE sent_at::date BETWEEN $1 AND $2
             AND kind IN ('block_start','escalation1','escalation2','checkin','reward_checkin')
           GROUP BY kind ORDER BY ignored DESC""", start, end)
    return {"kinds": [dict(r) for r in rows],
            "total_ignored": sum(r["ignored"] for r in rows)}


async def generate_proposals() -> int:
    """Deterministic pattern mining -> pending proposals (deduped)."""
    start, end = await _period("weekly")
    created = 0
    # pattern: same domain skipped/sacrificed >=2x in the window, by time-band
    rows = await db.fetch(
        """SELECT d2.name AS domain, d2.slug,
                  CASE WHEN EXTRACT(HOUR FROM b.start_at AT TIME ZONE 'Asia/Kolkata') < 12 THEN 'morning'
                       WHEN EXTRACT(HOUR FROM b.start_at AT TIME ZONE 'Asia/Kolkata') < 18 THEN 'afternoon'
                       ELSE 'late' END AS band,
                  COUNT(*) AS n
           FROM blocks b JOIN days dy ON dy.id=b.day_id
           LEFT JOIN domains d2 ON d2.id=b.domain_id
           WHERE dy.date BETWEEN $1 AND $2 AND b.status IN ('skipped','sacrificed')
             AND d2.slug IS NOT NULL
           GROUP BY 1,2,3 HAVING COUNT(*) >= 2""", start, end)
    for r in rows:
        obs = f"{r['domain']} died {r['n']}x in the {r['band']} this window"
        dup = await db.fetchval(
            "SELECT COUNT(*) FROM pattern_proposals WHERE observation=$1 AND created_at > now() - interval '14 days'", obs)
        if dup:
            continue
        prop = f"Stop scheduling {r['domain']} in the {r['band']}; move it to a different band"
        await db.execute(
            "INSERT INTO pattern_proposals (observation, proposal) VALUES ($1,$2)", obs, prop)
        created += 1
    return created


async def week_data(kind: str = "weekly") -> dict:
    start, end = await _period(kind)
    await generate_proposals()
    floors = await planner.floor_status()
    pvr = await plan_vs_reality(start, end)
    nudges = await ignored_nudges(start, end)
    proposals = [dict(r) for r in await db.fetch(
        "SELECT id, observation, proposal FROM pattern_proposals WHERE status='pending' ORDER BY id DESC LIMIT 8")]
    ideas = [dict(r) for r in await db.fetch(
        "SELECT id, title, body, created_at::date::text AS created FROM library_items "
        "WHERE section='idea' AND (idea_status='raw' OR idea_status IS NULL) ORDER BY id DESC LIMIT 12")]
    sleep_rows = await db.fetch(
        "SELECT date::text, hours, debt_after FROM sleep_logs WHERE date BETWEEN $1 AND $2 ORDER BY date", start, end)
    masters = await db.get_setting("masters_date")
    out = {
        "kind": kind, "start": str(start), "end": str(end),
        "floors": floors, "reality": pvr, "nudges": nudges,
        "proposals": proposals, "ideas": ideas,
        "sleep": [dict(r) for r in sleep_rows],
        "masters_days": (dt.date.fromisoformat(masters) - _today()).days if masters else None,
    }
    if kind == "monthly":
        fin = await db.fetch(
            """SELECT category, SUM(amount) AS total FROM money_txns
               WHERE kind='expense' AND txn_date BETWEEN $1 AND $2
               GROUP BY category ORDER BY total DESC""", start, end)
        out["finance"] = [dict(r) for r in fin]
    return out


async def decide_proposal(pid: int, approve: bool) -> str:
    row = await db.fetchrow("SELECT * FROM pattern_proposals WHERE id=$1 AND status='pending'", pid)
    if not row:
        return "Proposal not found or already decided."
    await db.execute(
        "UPDATE pattern_proposals SET status=$2, decided_at=now() WHERE id=$1",
        pid, "approved" if approve else "rejected")
    if approve:
        await db.execute(
            "INSERT INTO rules (kind, rule_text, source) VALUES ('learned',$1,'pattern_approved')",
            row["proposal"])
        return f"Approved — now a standing rule: {row['proposal']}"
    return "Rejected — I won't raise this one again for a while."


async def idea_action(item_id: int, action: str) -> str:
    status = {"keep": "reviewed", "kill": "killed", "schedule": "scheduled"}.get(action)
    if not status:
        return "Unknown action."
    await db.execute(
        "UPDATE library_items SET idea_status=$2 WHERE id=$1 AND section='idea'", item_id, status)
    if action == "schedule":
        title = await db.fetchval("SELECT title FROM library_items WHERE id=$1", item_id)
        await db.execute(
            "INSERT INTO commitments (title, status) VALUES ($1,'open')", f"Idea: {title}")
    return f"Idea {status}."


async def complete(kind: str, notes: str | None) -> None:
    start, end = await _period(kind)
    data = await week_data(kind)
    await db.execute(
        """INSERT INTO reviews (kind, period_start, period_end, scorecard, notes, completed)
           VALUES ($1,$2,$3,$4,$5,TRUE)""",
        kind, start, end, json.dumps({"floors": data["floors"], "nudges": data["nudges"]}), notes)


async def bot_summary() -> str:
    """Conversational twin for /review — deep-model narrative over the data."""
    data = await week_data("weekly")
    text = await llm.chat(
        [{"role": "user", "content":
          "Write my weekly review as my chief of staff. Be terse and honest, "
          "max 14 lines. Sections: floors verdict; what plan-vs-reality says; "
          "the one pattern that matters; nudges I ignored (call it out plainly); "
          "next week's single most important fix. Use the numbers.\n"
          f"DATA: {json.dumps(data, default=str)[:6000]}"}],
        model=config.LLM_MODEL_DEEP, max_tokens=2500)
    if not text:
        f = data["floors"]
        behind = [x["name"] for x in f if not x["ok"]]
        text = (f"Week {data['start']}→{data['end']}\n"
                f"Floors behind: {', '.join(behind) or 'none'}\n"
                f"Ignored nudges: {data['nudges']['total_ignored']}\n"
                f"Pending proposals: {len(data['proposals'])} — see cockpit Review.")
    return text
