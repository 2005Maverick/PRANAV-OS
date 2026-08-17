"""Resurfacing: saved things come back instead of dying in storage.

- Explicit resurface_at on any item -> surfaced by the tick when due.
- Reading slot (default Saturday 10:00 IST): queue of unread reading items
  is served once per slot day.
"""
import datetime as dt

from .. import config, db


def _now():
    return dt.datetime.now(config.TZ)


async def surface_due(send) -> int:
    rows = await db.fetch(
        """SELECT id, section, title, url FROM library_items
           WHERE resurface_at IS NOT NULL AND resurface_at <= now() LIMIT 5""")
    for r in rows:
        link = f"\n{r['url']}" if r["url"] else ""
        await send(f"You asked me to bring this back — {r['section']}: {r['title']}{link}",
                   kind="resurface")
        await db.execute(
            "UPDATE library_items SET resurface_at=NULL, surfaced_ct=surfaced_ct+1 WHERE id=$1",
            r["id"])
    return len(rows)


async def reading_slot(send) -> None:
    n = _now()
    day = (await db.get_setting("reading_day") or "saturday").lower()
    hour = int(await db.get_setting("reading_hour") or 10)
    if n.strftime("%A").lower() != day or n.hour < hour:
        return
    tag = f"[readslot {n.date()}]"
    already = await db.fetchval(
        "SELECT COUNT(*) FROM nudges WHERE kind='reading_slot' AND message LIKE '%'||$1||'%'", tag)
    if already:
        return
    items = await db.fetch(
        """SELECT id, title, url, est_minutes FROM library_items
           WHERE section='reading' AND surfaced_ct=0 ORDER BY id DESC LIMIT 5""")
    if not items:
        return
    total = sum(i["est_minutes"] or 8 for i in items)
    lines = [f"Reading slot — {len(items)} saved, ~{total} min:"]
    for i in items:
        lines.append(f"• {i['title']}" + (f"\n  {i['url']}" if i["url"] else ""))
        await db.execute("UPDATE library_items SET surfaced_ct=surfaced_ct+1 WHERE id=$1", i["id"])
    lines.append(tag)
    await send("\n".join(lines), kind="reading_slot")


async def review_ready(send) -> None:
    """Sunday 17:30: nudge toward the weekly review."""
    n = _now()
    if n.strftime("%A").lower() != "sunday" or n.hour < 17:
        return
    tag = f"[revready {n.date()}]"
    already = await db.fetchval(
        "SELECT COUNT(*) FROM nudges WHERE kind='review_ready' AND message LIKE '%'||$1||'%'", tag)
    if already:
        return
    await send("It's Sunday. The week is ready to be looked at — open the cockpit Review tab, "
               f"or say /review for the short version. {tag}", kind="review_ready")
