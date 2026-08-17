"""Cockpit API — read endpoints + quick capture."""
import datetime as dt

from fastapi import APIRouter
from pydantic import BaseModel

from . import config, db
from .services import capture as capture_svc
from .services import planner
from .services import sleep as sleep_svc

router = APIRouter(prefix="/api")


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


@router.post("/plan/tomorrow")
async def plan_tomorrow():
    date = _now().date() + dt.timedelta(days=1)
    text = await planner.draft_day(date)
    return {"reply": text}


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
