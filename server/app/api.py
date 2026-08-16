"""Cockpit API — read endpoints the web app consumes."""
import datetime as dt

from fastapi import APIRouter

from . import config, db
from .services import planner

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
                      b.is_fixed, d.slug AS domain, d.color
               FROM blocks b LEFT JOIN domains d ON d.id=b.domain_id
               WHERE b.day_id=$1 ORDER BY b.start_at""", day["id"])
        blocks = [{
            "id": r["id"], "title": r["title"], "next_action": r["next_action"],
            "start": r["start_at"].astimezone(config.TZ).strftime("%H:%M"),
            "end": r["end_at"].astimezone(config.TZ).strftime("%H:%M"),
            "status": r["status"], "fixed": r["is_fixed"],
            "domain": r["domain"], "color": r["color"] or "#4A4E57",
        } for r in rows]
    return {
        "date": str(date),
        "now": _now().strftime("%H:%M"),
        "status": day["status"] if day else None,
        "energy_note": day["energy_note"] if day else None,
        "blocks": blocks,
    }


@router.get("/rail")
async def rail():
    now = _now()
    # NEXT: first fixed commitment still ahead today
    nxt = await db.fetchrow(
        """SELECT b.title, b.start_at FROM blocks b JOIN days dy ON dy.id=b.day_id
           WHERE dy.date=$1 AND b.is_fixed AND b.start_at > $2
           ORDER BY b.start_at LIMIT 1""", now.date(), now)
    # TONIGHT: sleep ledger
    sleep = await db.fetchrow(
        "SELECT hours, debt_after FROM sleep_logs ORDER BY date DESC LIMIT 1")
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
        "sleep": ({"hours": float(sleep["hours"]) if sleep["hours"] else None,
                   "debt": float(sleep["debt_after"]) if sleep["debt_after"] is not None else None}
                  if sleep else None),
        "floors": floors,
        "masters_days": masters_days,
        "protocol": (dict(proto) if proto else None),
    }
