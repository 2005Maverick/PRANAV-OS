"""Cockpit API — read endpoints + quick capture. Every route requires the
cockpit key (X-API-Key == TICK_KEY env): single-user system, single shared
secret with the cron tick."""
import datetime as dt
import os

from fastapi import APIRouter, Depends, Header, HTTPException
from pydantic import BaseModel

from . import config, db
from .services import capture as capture_svc
from .services import planner
from .services import sleep as sleep_svc


async def require_key(x_api_key: str = Header(default="")):
    expected = os.environ.get("TICK_KEY", "")
    if not expected or x_api_key != expected:
        raise HTTPException(status_code=401, detail="cockpit key required")

router = APIRouter(prefix="/api", dependencies=[Depends(require_key)])


def _now() -> dt.datetime:
    return dt.datetime.now(config.TZ)


@router.get("/today")
async def today():
    date = _now().date()
    day = await db.fetchrow("SELECT * FROM days WHERE date=$1", date)
    blocks = []
    if day:
        rows = await db.fetch(
            """SELECT b.id, b.title, b.next_action, b.start_at, b.end_at, b.status,
                      b.is_fixed, d.slug AS domain, d.color,
                      COALESCE(b.playlist_url, d.playlist_url) AS playlist_url
               FROM blocks b LEFT JOIN domains d ON d.id=b.domain_id
               WHERE b.day_id=$1 ORDER BY b.start_at""", day["id"])
        blocks = [{
            "id": r["id"], "title": r["title"], "next_action": r["next_action"],
            "start": r["start_at"].astimezone(config.TZ).strftime("%H:%M"),
            "end": r["end_at"].astimezone(config.TZ).strftime("%H:%M"),
            "status": r["status"], "fixed": r["is_fixed"],
            "domain": r["domain"], "color": r["color"] or "#4A4E57",
            "playlist_url": r["playlist_url"],
        } for r in rows]
    return {
        "date": str(date),
        "now": _now().strftime("%H:%M"),
        "status": day["status"] if day else None,
        "energy_note": day["energy_note"] if day else None,
        "blocks": blocks,
    }


from .services import review as review_svc  # noqa: E402


@router.get("/review/{kind}")
async def review_data(kind: str):
    if kind not in ("week", "weekly", "month", "monthly"):
        kind = "weekly"
    return await review_svc.week_data("monthly" if kind.startswith("month") else "weekly")


class ProposalIn(BaseModel):
    id: int
    approve: bool


@router.post("/review/proposal")
async def review_proposal(body: ProposalIn):
    return {"reply": await review_svc.decide_proposal(body.id, body.approve)}


class IdeaIn(BaseModel):
    id: int
    action: str


@router.post("/review/idea")
async def review_idea(body: IdeaIn):
    return {"reply": await review_svc.idea_action(body.id, body.action)}


class CompleteIn(BaseModel):
    kind: str = "weekly"
    notes: str | None = None


@router.post("/review/complete")
async def review_complete(body: CompleteIn):
    await review_svc.complete(body.kind, body.notes)
    return {"ok": True}


@router.post("/day/confirm")
async def day_confirm():
    date = _now().date()
    await db.execute(
        "UPDATE days SET status='confirmed', confirmed_at=now() WHERE date=$1 AND status='draft'", date)
    from .services import sleep as _slp
    await _slp.on_wake()
    day = await db.fetchrow("SELECT status FROM days WHERE date=$1", date)
    return {"ok": True, "status": day["status"] if day else None}


@router.post("/plan/tomorrow")
async def plan_tomorrow():
    date = _now().date() + dt.timedelta(days=1)
    text = await planner.draft_day(date)
    return {"reply": text}


from . import llm  # noqa: E402
from .services import vault_svc  # noqa: E402


@router.get("/talk")
async def talk_get():
    msgs = await db.fetch(
        "SELECT role, content, created_at::text FROM chat_messages WHERE surface='talk' ORDER BY id DESC LIMIT 40")
    decisions = await db.fetch(
        "SELECT id, topic, decision, created_at::date::text AS created FROM decisions ORDER BY id DESC LIMIT 20")
    return {"messages": [dict(m) for m in reversed(msgs)],
            "decisions": [dict(d) for d in decisions]}


class TalkIn(BaseModel):
    message: str


@router.post("/talk")
async def talk_post(body: TalkIn):
    text = body.message.strip()
    if not text:
        return {"reply": ""}
    await db.execute(
        "INSERT INTO chat_messages (surface, role, content) VALUES ('talk','user',$1)", text[:4000])
    if text.lower().startswith("decide:"):
        decision = text[7:].strip()
        parsed = await llm.json_call(
            f'Split into topic (<=6 words) and the decision itself: "{decision}". '
            'JSON: {"topic":"...","decision":"..."}', model=config.LLM_MODEL_LITE)
        topic = (parsed or {}).get("topic", decision[:60])
        body_txt = (parsed or {}).get("decision", decision)
        await db.execute(
            "INSERT INTO decisions (topic, decision) VALUES ($1,$2)", topic[:120], body_txt)
        reply = f"Decision logged — “{topic}”. It's citable forever."
    else:
        recent = await db.fetch(
            "SELECT role, content FROM chat_messages WHERE surface IN ('talk','bot') ORDER BY id DESC LIMIT 20")
        msgs = [{"role": r["role"] if r["role"] in ("user", "assistant") else "user",
                 "content": r["content"]} for r in reversed(recent)]
        decs = await db.fetch("SELECT topic, decision FROM decisions ORDER BY id DESC LIMIT 10")
        dec_txt = "\n".join(f"- {d['topic']}: {d['decision']}" for d in decs)
        reply = await llm.chat(
            msgs,
            system=llm.SYSTEM_PERSONA + "\n\nThis is the cockpit Talk room — long-form thinking. "
            f"Past decisions on record:\n{dec_txt}\n"
            "Push back with his own history. If he lands on a decision, suggest `decide: ...` to log it.")
        if reply is None:
            reply = "Brain unavailable right now — try again in a minute."
    await db.execute(
        "INSERT INTO chat_messages (surface, role, content) VALUES ('talk','assistant',$1)", reply[:4000])
    return {"reply": reply}


SETTING_KEYS = {"checkin_minutes", "nudge_tone", "checkin_start", "checkin_end",
                "reading_day", "reading_hour", "usual_sleep", "usual_wake",
                "masters_date", "sleep_target_hours"}


@router.get("/rules")
async def rules_get():
    rules = await db.fetch(
        "SELECT id, kind, rule_text, source, approved_at::date::text AS approved FROM rules WHERE active ORDER BY id DESC")
    floors = await db.fetch(
        "SELECT slug, name, floor_type, floor_target, floor_minutes FROM domains WHERE active ORDER BY sort_order")
    settings = {}
    for k in sorted(SETTING_KEYS):
        settings[k] = await db.get_setting(k)
    proposals = await db.fetch(
        "SELECT id, observation, proposal FROM pattern_proposals WHERE status='pending' ORDER BY id DESC")
    return {"rules": [dict(r) for r in rules], "floors": [dict(f) for f in floors],
            "settings": settings, "proposals": [dict(p) for p in proposals]}


class RuleIn(BaseModel):
    text: str


@router.post("/rules/rule")
async def rules_add(body: RuleIn):
    await db.execute(
        "INSERT INTO rules (kind, rule_text, source) VALUES ('preference',$1,'explicit')", body.text[:300])
    return {"ok": True}


class RuleOffIn(BaseModel):
    id: int


@router.post("/rules/rule-off")
async def rules_off(body: RuleOffIn):
    await db.execute("UPDATE rules SET active=FALSE WHERE id=$1", body.id)
    return {"ok": True}


class FloorIn(BaseModel):
    slug: str
    target: int | None = None
    minutes: int | None = None


@router.post("/rules/floor")
async def rules_floor(body: FloorIn):
    await db.execute(
        "UPDATE domains SET floor_target=COALESCE($2,floor_target), floor_minutes=COALESCE($3,floor_minutes) WHERE slug=$1",
        body.slug, body.target, body.minutes)
    return {"ok": True}


class SettingIn(BaseModel):
    key: str
    value: str


@router.post("/rules/setting")
async def rules_setting(body: SettingIn):
    if body.key not in SETTING_KEYS:
        return {"ok": False, "error": "unknown setting"}
    await db.set_setting(body.key, body.value)
    return {"ok": True}


class MoveIn(BaseModel):
    block_id: int
    start: str  # HH:MM
    force: bool = False


@router.post("/move")
async def move_block(body: MoveIn):
    blk = await db.fetchrow(
        "SELECT b.*, dy.date FROM blocks b JOIN days dy ON dy.id=b.day_id WHERE b.id=$1", body.block_id)
    if not blk:
        return {"ok": False, "error": "block not found"}
    if blk["is_fixed"]:
        return {"ok": False, "error": "fixed blocks don't move — replan around them"}
    dur = blk["end_at"] - blk["start_at"]
    new_start = dt.datetime.combine(blk["date"], dt.time.fromisoformat(body.start), tzinfo=config.TZ)
    new_end = new_start + dur
    clash = await db.fetchrow(
        """SELECT title FROM blocks
           WHERE day_id=$1 AND id != $2 AND is_fixed
             AND start_at < $4 AND end_at > $3 LIMIT 1""",
        blk["day_id"], blk["id"], new_start, new_end)
    if clash and not body.force:
        return {"ok": False, "conflict": clash["title"]}
    soft = await db.fetchrow(
        """SELECT title FROM blocks
           WHERE day_id=$1 AND id != $2 AND NOT is_fixed AND status IN ('planned','started')
             AND start_at < $4 AND end_at > $3 LIMIT 1""",
        blk["day_id"], blk["id"], new_start, new_end)
    await db.execute(
        "UPDATE blocks SET start_at=$2, end_at=$3 WHERE id=$1", blk["id"], new_start, new_end)
    return {"ok": True, "overlaps": soft["title"] if soft else None}


@router.get("/week-ghost")
async def week_ghost():
    """Next week's fixed skeleton (classes etc.) — the ghost draft."""
    today_d = _now().date()
    next_mon = today_d + dt.timedelta(days=7 - today_d.weekday())
    out = []
    for i in range(7):
        date = next_mon + dt.timedelta(days=i)
        recs = await db.fetch(
            "SELECT title, start_t::text, end_t::text FROM recurring_blocks WHERE active AND dow=$1 ORDER BY start_t",
            date.weekday())
        out.append({"name": date.strftime("%a"), "date": date.strftime("%d"),
                    "fixed": [dict(r) for r in recs]})
    return {"days": out}


@router.get("/vault/status")
async def vault_status():
    n = await db.fetchval("SELECT COUNT(*) FROM vault_entries")
    return {"has_password": await vault_svc.has_password(), "entries": n}


class VaultSetupIn(BaseModel):
    password: str


@router.post("/vault/setup")
async def vault_setup(body: VaultSetupIn):
    return {"reply": await vault_svc.setup(body.password)}


class VaultAddIn(BaseModel):
    password: str
    label: str
    pointer: str | None = None
    secret: str | None = None


@router.post("/vault/add")
async def vault_add(body: VaultAddIn):
    return {"reply": await vault_svc.add(body.password, body.label, body.pointer, body.secret)}


class VaultUnlockIn(BaseModel):
    password: str


@router.post("/vault/unlock")
async def vault_unlock(body: VaultUnlockIn):
    entries = await vault_svc.unlock(body.password)
    if entries is None:
        return {"ok": False, "entries": None}
    return {"ok": True, "entries": entries}


@router.get("/arcs")
async def arcs():
    today_d = _now().date()
    masters_date = await db.get_setting("masters_date")
    goals = await db.fetch(
        """SELECT g.title, g.due_date::text, g.status, d.slug AS domain
           FROM goals g LEFT JOIN domains d ON d.id=g.domain_id
           WHERE g.status='active' ORDER BY g.due_date NULLS LAST LIMIT 30""")

    def _cutoff(days: int) -> dt.date:
        return today_d - dt.timedelta(days=days)

    async def _dom_hours(slug: str, days: int) -> float:
        v = await db.fetchval(
            """SELECT COALESCE(SUM(EXTRACT(EPOCH FROM (b.end_at - b.start_at)))/3600, 0)
               FROM blocks b JOIN days dy ON dy.id=b.day_id
               JOIN domains d ON d.id=b.domain_id
               WHERE d.slug=$1 AND b.status='done' AND dy.date > $2""",
            slug, _cutoff(days))
        return round(float(v), 1)

    async def _dom_count(slug: str, days: int) -> int:
        return await db.fetchval(
            """SELECT COUNT(*) FROM blocks b JOIN days dy ON dy.id=b.day_id
               JOIN domains d ON d.id=b.domain_id
               WHERE d.slug=$1 AND b.status='done' AND dy.date > $2""",
            slug, _cutoff(days))

    spark = await db.fetch(
        """SELECT dy.date::text, COUNT(*) AS n
           FROM blocks b JOIN days dy ON dy.id=b.day_id
           JOIN domains d ON d.id=b.domain_id
           WHERE d.slug='startup' AND b.status='done' AND dy.date > $1
           GROUP BY dy.date ORDER BY dy.date""", _cutoff(14))
    return {
        "masters": {
            "days": (dt.date.fromisoformat(masters_date) - today_d).days if masters_date else None,
            "goals": [dict(g) for g in goals if g["domain"] == "research"],
            "pipeline": [dict(c) for c in await db.fetch(
                "SELECT title, due_date::text FROM commitments WHERE status='open' AND due_date IS NOT NULL ORDER BY due_date LIMIT 8")],
        },
        "paper": {"hours_30d": await _dom_hours("research", 30), "hours_7d": await _dom_hours("research", 7)},
        "startup": {"ships_30d": await _dom_count("startup", 30), "ships_7d": await _dom_count("startup", 7),
                    "spark": [dict(s) for s in spark]},
        "trading": {"sessions_total": await _dom_count("trading", 3650), "sessions_7d": await _dom_count("trading", 7),
                    "hours_30d": await _dom_hours("trading", 30)},
    }


@router.get("/sleep")
async def sleep_page():
    logs = await db.fetch(
        "SELECT date::text, hours, debt_after FROM sleep_logs ORDER BY date DESC LIMIT 30")
    topo = await db.fetch(
        """SELECT hour,
                  COUNT(*) FILTER (WHERE kind='deep_done') AS deep,
                  COUNT(*) FILTER (WHERE kind='shallow_done') AS shallow,
                  COUNT(*) FILTER (WHERE kind='deep_failed') AS failed
           FROM energy_observations GROUP BY hour ORDER BY hour""")
    steps = await db.fetch(
        "SELECT id, sort, text, essential FROM protocol_steps WHERE active ORDER BY sort")
    runs = await db.fetch(
        "SELECT date::text, completed FROM protocol_runs ORDER BY date DESC LIMIT 30")
    corr = await db.fetchrow(
        """WITH day_deep AS (
             SELECT dy.date,
                    COALESCE(SUM(EXTRACT(EPOCH FROM (b.end_at-b.start_at)))/3600,0) AS h
             FROM days dy LEFT JOIN blocks b ON b.day_id=dy.id AND b.status='done'
                  AND b.end_at-b.start_at >= interval '60 minutes'
             GROUP BY dy.date)
           SELECT AVG(dd.h) FILTER (WHERE pr.completed) AS with_protocol,
                  AVG(dd.h) FILTER (WHERE pr.completed IS NOT TRUE) AS without_protocol
           FROM day_deep dd LEFT JOIN protocol_runs pr ON pr.date=dd.date""")
    return {
        "logs": [{**dict(r), "hours": float(r["hours"]) if r["hours"] else None,
                  "debt_after": float(r["debt_after"]) if r["debt_after"] is not None else None} for r in logs],
        "topology": [dict(r) for r in topo],
        "protocol": [dict(r) for r in steps],
        "runs": [dict(r) for r in runs],
        "correlation": {
            "with": round(float(corr["with_protocol"]), 1) if corr and corr["with_protocol"] is not None else None,
            "without": round(float(corr["without_protocol"]), 1) if corr and corr["without_protocol"] is not None else None,
        },
        "usual": {"sleep": await db.get_setting("usual_sleep"), "wake": await db.get_setting("usual_wake")},
    }


class ProtocolIn(BaseModel):
    steps: list[str]


@router.post("/sleep/protocol")
async def sleep_protocol(body: ProtocolIn):
    await db.execute("UPDATE protocol_steps SET active=FALSE WHERE active")
    for i, s in enumerate(body.steps):
        if s.strip():
            await db.execute(
                "INSERT INTO protocol_steps (sort, text, essential) VALUES ($1,$2,$3)",
                i, s.strip()[:120], i < 2)
    return {"ok": True}


class SleepLogIn(BaseModel):
    hours: float
    date: str | None = None


@router.post("/sleep/log")
async def sleep_log(body: SleepLogIn):
    d = dt.date.fromisoformat(body.date) if body.date else None
    return await sleep_svc.log_night(body.hours, d)


class ProtocolRunIn(BaseModel):
    done: int
    total: int


@router.post("/sleep/run")
async def sleep_run(body: ProtocolRunIn):
    return await sleep_svc.record_protocol_run(body.done, body.total)


@router.get("/library")
async def library(section: str | None = None, q: str | None = None):
    where, args = ["1=1"], []
    if section:
        args.append(section)
        where.append(f"section=${len(args)}")
    if q:
        args.append(f"%{q}%")
        where.append(f"(title ILIKE ${len(args)} OR body ILIKE ${len(args)} OR url ILIKE ${len(args)})")
    rows = await db.fetch(
        f"""SELECT id, section, title, body, url, tags, est_minutes, idea_status,
                   resurface_at, surfaced_ct, created_at::date::text AS created
            FROM library_items WHERE {' AND '.join(where)}
            ORDER BY id DESC LIMIT 100""", *args)
    counts = await db.fetch(
        "SELECT section, COUNT(*) AS n FROM library_items GROUP BY section")
    return {
        "items": [{**dict(r), "resurface_at": str(r["resurface_at"]) if r["resurface_at"] else None}
                  for r in rows],
        "counts": {r["section"]: r["n"] for r in counts},
    }


class ResurfaceIn(BaseModel):
    id: int
    days: int = 1


@router.post("/library/resurface")
async def library_resurface(body: ResurfaceIn):
    await db.execute(
        "UPDATE library_items SET resurface_at = now() + ($2 || ' days')::interval WHERE id=$1",
        body.id, str(body.days))
    return {"ok": True}


# ---------- Library vault (full markdown notes with [[wikilinks]]) ----------
from .services import notes_svc  # noqa: E402


@router.get("/library/notes")
async def library_notes(q: str | None = None):
    return await notes_svc.list_notes(q)


@router.get("/library/graph")
async def library_graph():
    return await notes_svc.graph()


@router.get("/library/note/{note_id}")
async def library_note(note_id: int):
    note = await notes_svc.get_note(note_id)
    if not note:
        raise HTTPException(status_code=404, detail="note not found")
    return note


class NoteCreateIn(BaseModel):
    title: str = "Untitled"
    body_md: str = ""
    tags: list[str] = []


@router.post("/library/note")
async def library_note_create(body: NoteCreateIn):
    note_id = await notes_svc.create_note(body.title, body.body_md, body.tags)
    return {"id": note_id}


class NoteUpdateIn(BaseModel):
    title: str | None = None
    body_md: str | None = None
    tags: list[str] | None = None


@router.put("/library/note/{note_id}")
async def library_note_update(note_id: int, body: NoteUpdateIn):
    ok = await notes_svc.update_note(note_id, body.title, body.body_md, body.tags)
    if not ok:
        raise HTTPException(status_code=404, detail="note not found")
    return {"ok": True}


@router.delete("/library/note/{note_id}")
async def library_note_delete(note_id: int):
    ok = await notes_svc.delete_note(note_id)
    return {"ok": ok}


class PinIn(BaseModel):
    pinned: bool


@router.post("/library/note/{note_id}/pin")
async def library_note_pin(note_id: int, body: PinIn):
    ok = await notes_svc.set_pinned(note_id, body.pinned)
    return {"ok": ok}


@router.post("/library/daily")
async def library_daily():
    note_id = await notes_svc.daily_note(_now().date())
    return {"id": note_id}


# ---------- Arcs (long-horizon goals: project / umbrella / target / ongoing) ----------
from .services import arcs_svc  # noqa: E402


@router.get("/arcs/tree")
async def arcs_tree():
    return await arcs_svc.tree()


@router.get("/arcs/node/{arc_id}")
async def arcs_node(arc_id: int):
    node = await arcs_svc.get_arc(arc_id)
    if not node:
        raise HTTPException(status_code=404, detail="arc not found")
    return node


class ArcCreateIn(BaseModel):
    title: str = "Untitled goal"
    type: str = "project"
    domain: str | None = None
    parent_id: int | None = None
    deadline: str | None = None
    target_amount: float | None = None
    target_unit: str | None = None
    note: str | None = None


@router.post("/arcs")
async def arcs_create(body: ArcCreateIn):
    arc_id = await arcs_svc.create_arc(
        body.title, body.type, body.domain, body.parent_id, body.deadline,
        body.target_amount, body.target_unit, body.note)
    return {"id": arc_id}


class ArcUpdateIn(BaseModel):
    title: str | None = None
    type: str | None = None
    domain: str | None = None
    deadline: str | None = None
    target_amount: float | None = None
    target_unit: str | None = None
    note: str | None = None
    status: str | None = None


@router.put("/arcs/{arc_id}")
async def arcs_update(arc_id: int, body: ArcUpdateIn):
    ok = await arcs_svc.update_arc(arc_id, **body.model_dump(exclude_none=True))
    return {"ok": ok}


@router.delete("/arcs/{arc_id}")
async def arcs_delete(arc_id: int):
    return {"ok": await arcs_svc.delete_arc(arc_id)}


class StepCreateIn(BaseModel):
    kind: str = "do"
    title: str = ""
    est_minutes: int = 0
    waiting_on: str | None = None
    cadence: str | None = None


@router.post("/arcs/{arc_id}/step")
async def arcs_add_step(arc_id: int, body: StepCreateIn):
    sid = await arcs_svc.add_step(arc_id, body.kind, body.title, body.est_minutes,
                                  body.waiting_on, body.cadence)
    return {"id": sid}


class StepUpdateIn(BaseModel):
    title: str | None = None
    est_minutes: int | None = None
    spent_minutes: int | None = None
    done: bool | None = None
    waiting_on: str | None = None
    cadence: str | None = None
    last_done: str | None = None


@router.put("/arcs/step/{step_id}")
async def arcs_update_step(step_id: int, body: StepUpdateIn):
    return {"ok": await arcs_svc.update_step(step_id, **body.model_dump(exclude_none=True))}


class LogIn(BaseModel):
    minutes: int
    mark_done: bool = False


@router.post("/arcs/step/{step_id}/log")
async def arcs_log_time(step_id: int, body: LogIn):
    return {"ok": await arcs_svc.log_time(step_id, body.minutes, body.mark_done)}


@router.post("/arcs/step/{step_id}/tick")
async def arcs_tick_keep(step_id: int):
    return {"ok": await arcs_svc.tick_keep(step_id)}


@router.delete("/arcs/step/{step_id}")
async def arcs_delete_step(step_id: int):
    return {"ok": await arcs_svc.delete_step(step_id)}


class ContribIn(BaseModel):
    amount: float
    note: str | None = None
    on_date: str | None = None


@router.post("/arcs/{arc_id}/contrib")
async def arcs_add_contrib(arc_id: int, body: ContribIn):
    cid = await arcs_svc.add_contrib(arc_id, body.amount, body.note, body.on_date)
    return {"id": cid}


# ---------- Decks (a library of saved cards: prompt / note / link / image) ----------
from fastapi import File, Form, Response, UploadFile  # noqa: E402
from .services import decks_svc  # noqa: E402


@router.get("/decks")
async def decks_list():
    return {"decks": await decks_svc.list_decks()}


class DeckIn(BaseModel):
    name: str = "Untitled deck"
    domain: str | None = None


@router.post("/decks")
async def decks_create(body: DeckIn):
    return {"id": await decks_svc.create_deck(body.name, body.domain)}


@router.put("/decks/{deck_id}")
async def decks_rename(deck_id: int, body: DeckIn):
    return {"ok": await decks_svc.rename_deck(deck_id, body.name, body.domain)}


@router.delete("/decks/{deck_id}")
async def decks_delete(deck_id: int):
    return {"ok": await decks_svc.delete_deck(deck_id)}


@router.get("/decks/cards")
async def decks_cards(deck_id: int | None = None, q: str | None = None):
    return {"cards": await decks_svc.list_cards(deck_id, q)}


@router.get("/decks/card/{card_id}")
async def decks_card(card_id: int):
    card = await decks_svc.get_card(card_id)
    if not card:
        raise HTTPException(status_code=404, detail="card not found")
    return card


class CardIn(BaseModel):
    kind: str = "note"
    title: str = ""
    body: str = ""
    url: str | None = None
    tags: list[str] = []


@router.post("/decks/{deck_id}/card")
async def decks_add_card(deck_id: int, body: CardIn):
    return {"id": await decks_svc.create_card(deck_id, body.kind, body.title, body.body, body.url, body.tags)}


@router.post("/decks/{deck_id}/card/upload")
async def decks_upload(deck_id: int, file: UploadFile = File(...), title: str = Form("")):
    data = await file.read()
    if len(data) > 6_000_000:
        raise HTTPException(status_code=413, detail="image too large (6MB max)")
    cid = await decks_svc.create_image_card(
        deck_id, title or (file.filename or "image"), file.content_type or "image/*", data)
    return {"id": cid}


class CardUpdateIn(BaseModel):
    deck_id: int | None = None
    title: str | None = None
    body: str | None = None
    url: str | None = None
    tags: list[str] | None = None


@router.put("/decks/card/{card_id}")
async def decks_update_card(card_id: int, body: CardUpdateIn):
    return {"ok": await decks_svc.update_card(card_id, **body.model_dump(exclude_none=True))}


@router.delete("/decks/card/{card_id}")
async def decks_delete_card(card_id: int):
    return {"ok": await decks_svc.delete_card(card_id)}


@router.get("/decks/card/{card_id}/image")
async def decks_card_image(card_id: int):
    got = await decks_svc.card_image(card_id)
    if not got:
        raise HTTPException(status_code=404, detail="no image")
    mime, data = got
    return Response(content=data, media_type=mime)


@router.get("/lists")
async def lists_get():
    rows = await db.fetch("SELECT id, name, fire_kind, fire_param, fire_rule FROM lists ORDER BY id")
    out = []
    for r in rows:
        items = await db.fetch(
            "SELECT id, text, checked FROM list_items WHERE list_id=$1 ORDER BY sort, id", r["id"])
        out.append({**dict(r), "items": [dict(i) for i in items]})
    return {"lists": out}


class ListItemIn(BaseModel):
    id: int
    checked: bool


@router.post("/lists/check")
async def lists_check(body: ListItemIn):
    await db.execute("UPDATE list_items SET checked=$2 WHERE id=$1", body.id, body.checked)
    return {"ok": True}


class ListFireIn(BaseModel):
    id: int
    fire_kind: str
    fire_param: str | None = None


@router.post("/lists/fire-rule")
async def lists_fire_rule(body: ListFireIn):
    await db.execute(
        "UPDATE lists SET fire_kind=$2, fire_param=$3 WHERE id=$1",
        body.id, body.fire_kind, body.fire_param)
    return {"ok": True}


@router.get("/finance")
async def finance_get():
    entries = await db.fetch(
        "SELECT id, amount, category, note, spent_on::text FROM finance_entries ORDER BY id DESC LIMIT 60")
    months = await db.fetch(
        """SELECT to_char(date_trunc('month', spent_on), 'YYYY-MM') AS month,
                  category, SUM(amount) AS total
           FROM finance_entries WHERE spent_on > CURRENT_DATE - 180
           GROUP BY 1, 2 ORDER BY 1 DESC, total DESC""")
    subs = await db.fetch(
        "SELECT id, name, amount, period, renews_on::text, active FROM subscriptions WHERE active ORDER BY id")
    deadlines = await db.fetch(
        """SELECT id, title, due_date::text FROM commitments
           WHERE status='open' AND due_date IS NOT NULL ORDER BY due_date LIMIT 20""")
    return {
        "entries": [dict(r) for r in entries],
        "months": [dict(r) for r in months],
        "subscriptions": [dict(r) for r in subs],
        "deadlines": [dict(r) for r in deadlines],
    }


class CaptureIn(BaseModel):
    text: str


@router.post("/capture")
async def quick_capture(body: CaptureIn):
    """Cockpit quick-capture bar → same funnel as the bot."""
    text = body.text.strip()
    if not text:
        return {"reply": "Empty."}
    reply = await capture_svc.capture_text(text)
    return {"reply": reply}


async def _day_blocks(day_id: int) -> list[dict]:
    rows = await db.fetch(
        """SELECT b.id, b.title, b.next_action, b.start_at, b.end_at, b.status,
                  b.is_fixed, d.slug AS domain, d.color
           FROM blocks b LEFT JOIN domains d ON d.id=b.domain_id
           WHERE b.day_id=$1 ORDER BY b.start_at""", day_id)
    return [{
        "id": r["id"], "title": r["title"], "next_action": r["next_action"],
        "start": r["start_at"].astimezone(config.TZ).strftime("%H:%M"),
        "end": r["end_at"].astimezone(config.TZ).strftime("%H:%M"),
        "status": r["status"], "fixed": r["is_fixed"],
        "domain": r["domain"], "color": r["color"] or "#565C66",
    } for r in rows]


@router.get("/week")
async def week():
    today_d = _now().date()
    monday = today_d - dt.timedelta(days=today_d.weekday())
    days = []
    for i in range(7):
        date = monday + dt.timedelta(days=i)
        day = await db.fetchrow("SELECT id, status FROM days WHERE date=$1", date)
        days.append({
            "name": date.strftime("%a"),
            "date": date.strftime("%d"),
            "iso": str(date),
            "today": date == today_d,
            "status": day["status"] if day else "—",
            "blocks": await _day_blocks(day["id"]) if day else [],
        })
    return {"days": days}


@router.get("/wall")
async def wall(limit: int = 90):
    rows = await db.fetch(
        "SELECT id, date, status FROM days WHERE date < $1 ORDER BY date DESC LIMIT $2",
        _now().date(), limit)
    tiles = []
    for r in reversed(rows):
        proto = await db.fetchrow(
            "SELECT completed FROM protocol_runs WHERE date=$1", r["date"])
        tiles.append({
            "date": str(r["date"]),
            "label": r["date"].strftime("%d"),
            "month": r["date"].strftime("%b") if r["date"].day <= 7 else None,
            "protocol": bool(proto and proto["completed"]),
            "blocks": await _day_blocks(r["id"]),
        })
    return {"tiles": tiles}


@router.get("/rail")
async def rail():
    now = _now()
    # NEXT: first fixed commitment still ahead today
    nxt = await db.fetchrow(
        """SELECT b.title, b.start_at FROM blocks b JOIN days dy ON dy.id=b.day_id
           WHERE dy.date=$1 AND b.is_fixed AND b.start_at > $2
           ORDER BY b.start_at LIMIT 1""", now.date(), now)
    # TONIGHT: sleep ledger (real engine numbers)
    sleep = await sleep_svc.status()
    # FLOORS: rolling status, at-risk first
    floors = await planner.floor_status()
    floors.sort(key=lambda f: (f["ok"], -(f["target"] - f["done"])))
    # ARCS: masters countdown from settings (set during onboarding)
    masters_date = await db.get_setting("masters_date")
    masters_days = None
    if masters_date:
        masters_days = (dt.date.fromisoformat(masters_date) - now.date()).days
    # PROTOCOL chip
    proto = await db.fetchrow(
        "SELECT steps_done, steps_total, completed FROM protocol_runs WHERE date=$1", now.date())
    return {
        "next_fixed": ({"title": nxt["title"],
                        "at": nxt["start_at"].astimezone(config.TZ).strftime("%H:%M")} if nxt else None),
        "sleep": sleep,
        "floors": floors,
        "masters_days": masters_days,
        "protocol": (dict(proto) if proto else None),
    }
