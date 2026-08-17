"""The heartbeat — jobs that make the system alive on its own.

Every minute: block-start pings, block-end close-out prompts.
Daily: morning brief (at the day's wake target), evening close (draft tomorrow).
"""
import datetime as dt
import logging
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from telegram import InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application

from . import config, db
from .services import lists_fin, planner, protocols, tile

log = logging.getLogger("scheduler")


async def _owner_chat(app: Application) -> int | None:
    v = await db.get_setting("owner_chat_id")
    return int(v) if v else None


async def _send(app: Application, text: str, kind: str, block_id: int | None = None,
                reply_markup=None):
    chat_id = await _owner_chat(app)
    if chat_id is None:
        return
    try:
        await app.bot.send_message(chat_id, text, reply_markup=reply_markup)
        await db.execute(
            "INSERT INTO nudges (block_id, kind, message) VALUES ($1,$2,$3)", block_id, kind, text)
    except Exception as e:
        log.warning("send failed: %s", e)


async def _send_photo(app: Application, photo: bytes, caption: str):
    chat_id = await _owner_chat(app)
    if chat_id is None:
        return
    try:
        await app.bot.send_photo(chat_id, photo=photo, caption=caption)
    except Exception as e:
        log.warning("send_photo failed: %s", e)


async def tick_blocks(app: Application):
    """Runs every minute. Pings block starts; prompts close-outs at ends."""
    now = dt.datetime.now(config.TZ)
    date = now.date()
    day = await db.fetchrow("SELECT id, status FROM days WHERE date=$1", date)
    if not day or day["status"] not in ("confirmed", "draft"):
        return

    starting = await db.fetch(
        """SELECT b.id, b.title, b.next_action,
                  COALESCE(b.playlist_url, d.playlist_url) AS playlist_url
           FROM blocks b LEFT JOIN domains d ON d.id=b.domain_id
           WHERE b.day_id=$1 AND b.status='planned'
             AND b.start_at <= $2 AND b.start_at > $2 - interval '2 minutes'
             AND NOT EXISTS (SELECT 1 FROM nudges n WHERE n.block_id=b.id AND n.kind='block_start')""",
        day["id"], now)
    for b in starting:
        msg = f"▶ {b['title']}"
        if b["next_action"]:
            msg += f"\nSmallest entry: {b['next_action']}"
        if b["playlist_url"]:
            msg += f"\nPlaylist: {b['playlist_url']}"
        kb = InlineKeyboardMarkup([[
            InlineKeyboardButton("▶ started", callback_data=f"blk:started:{b['id']}"),
            InlineKeyboardButton("+15 min", callback_data=f"blk:snooze:{b['id']}"),
            InlineKeyboardButton("skip", callback_data=f"blk:skip:{b['id']}"),
        ]])
        await _send(app, msg, "block_start", b["id"], reply_markup=kb)

    ending = await db.fetch(
        """SELECT b.id, b.title FROM blocks b
           WHERE b.day_id=$1 AND b.status='started'
             AND b.end_at <= $2 AND b.end_at > $2 - interval '2 minutes'""",
        day["id"], now)
    for b in ending:
        await db.execute("UPDATE blocks SET status='done', ended_at=$2 WHERE id=$1", b["id"], now)
        await _send(app,
                    f"◼ {b['title']} — block over. One line: where did you stop, what's the next step?",
                    "closeout_prompt", b["id"])

    # blocks that were never started and are now over -> skipped, honestly
    await db.execute(
        """UPDATE blocks SET status='skipped', skip_reason='never started'
           WHERE day_id=$1 AND status='planned' AND end_at <= $2""", day["id"], now)

    async def send_k(text, kind="nudge", block_id=None):
        await _send(app, text, kind, block_id)
    await protocols.maybe_escalate(send_k)
    await protocols.maybe_reward_checkin(send_k)
    await protocols.maybe_checkin(send_k)
    await lists_fin.fire_lists(send_k)
    await lists_fin.fire_deadlines(send_k)


async def morning_brief_tick(app: Application):
    """Runs every minute; fires once when wake_target arrives."""
    now = dt.datetime.now(config.TZ)
    day = await db.fetchrow("SELECT * FROM days WHERE date=$1", now.date())
    if not day or day["brief_sent_at"] is not None:
        return
    wake = day["wake_target"] or dt.time.fromisoformat(config.DEFAULT_WAKE)
    if now.time() >= wake:
        async def send_k(text, kind="protocol", block_id=None):
            await _send(app, text, kind, block_id)
        if await protocols.gate_brief(send_k):
            return  # brief unlocks when the protocol completes
        text = await planner.morning_brief()
        kb = InlineKeyboardMarkup([[
            InlineKeyboardButton("✓ confirm", callback_data="day:confirm"),
            InlineKeyboardButton("adjust", callback_data="day:adjust"),
        ]])
        await _send(app, text, "brief", reply_markup=kb)
        await db.execute("UPDATE days SET brief_sent_at=now() WHERE id=$1", day["id"])


async def evening_close_job(app: Application):
    today = dt.datetime.now(config.TZ).date()
    png = await tile.render_day(today)
    text = await planner.evening_close()
    if png:
        await _send_photo(app, png, f"{today:%a %d %b} — your day, closed.")
        await db.execute("UPDATE days SET tile_path=$2 WHERE date=$1",
                         today, f"tile-{today}.png")
    await _send(app, text, "close")


async def maybe_evening_close(app: Application):
    """Tick-driven idempotent version: fires once after EVENING_CLOSE."""
    now = dt.datetime.now(config.TZ)
    h, m = config.EVENING_CLOSE.split(":")
    if now.time() < dt.time(int(h), int(m)):
        return
    already = await db.fetchval(
        "SELECT COUNT(*) FROM nudges WHERE kind='close' AND sent_at::date = $1", now.date())
    if already:
        return
    day = await db.fetchrow("SELECT status FROM days WHERE date=$1", now.date())
    if day and day["status"] == "closed":
        return
    await evening_close_job(app)


def start(app: Application) -> AsyncIOScheduler:
    sched = AsyncIOScheduler(timezone=str(config.TZ))
    sched.add_job(tick_blocks, "interval", minutes=1, args=[app], id="tick_blocks")
    sched.add_job(morning_brief_tick, "interval", minutes=1, args=[app], id="brief_tick")
    h, m = config.EVENING_CLOSE.split(":")
    sched.add_job(evening_close_job, "cron", hour=int(h), minute=int(m), args=[app], id="evening_close")
    sched.start()
    log.info("scheduler up: tick=1m, evening close=%s", config.EVENING_CLOSE)
    return sched
