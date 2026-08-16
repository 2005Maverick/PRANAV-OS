"""Telegram handlers — the phone face. Slice 1: capture, plan, brief, replan, chat."""
import datetime as dt
import logging
import re
from telegram import Update
from telegram.ext import (Application, CommandHandler, ContextTypes, MessageHandler, filters)

from .. import config, db, llm
from ..services import capture, planner

log = logging.getLogger("bot")


async def _remember(role: str, content: str):
    await db.execute(
        "INSERT INTO chat_messages (surface, role, content) VALUES ('bot',$1,$2)", role, content[:4000])


async def _owner_gate(update: Update) -> bool:
    """Single-user system: first /start claims ownership, others are ignored."""
    owner = await db.get_setting("owner_chat_id")
    if owner is None:
        return True
    return str(update.effective_chat.id) == owner


# ------------------------------------------------------------- commands
async def cmd_start(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    owner = await db.get_setting("owner_chat_id")
    if owner is None:
        await db.set_setting("owner_chat_id", str(update.effective_chat.id))
        await update.message.reply_text(
            "Pranav OS online. This chat is now the command line of your life.\n\n"
            "Talk normally — save things, plan, replan, ask. Commands if you want them:\n"
            "/today  /plan  /replan <what changed>  /score  /help")
    elif await _owner_gate(update):
        await update.message.reply_text("Already armed. /today for the current plan.")
    # non-owners get silence


async def cmd_today(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await _owner_gate(update):
        return
    await update.message.reply_text(await planner.render_day(dt.datetime.now(config.TZ).date()))


async def cmd_plan(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await _owner_gate(update):
        return
    await update.message.reply_text("Composing…")
    date = dt.datetime.now(config.TZ).date()
    arg = " ".join(ctx.args) if ctx.args else ""
    if arg.strip().lower() in ("tomorrow", "tmrw", "tom"):
        date += dt.timedelta(days=1)
    await update.message.reply_text(await planner.draft_day(date))


async def cmd_replan(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await _owner_gate(update):
        return
    trigger = " ".join(ctx.args)
    if not trigger:
        await update.message.reply_text("Tell me what changed: /replan demo moved to 9am, 1am call tonight")
        return
    await update.message.reply_text("Redrawing…")
    await update.message.reply_text(await planner.replan(trigger))


async def cmd_score(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await _owner_gate(update):
        return
    floors = await planner.floor_status()
    lines = ["Floors (rolling window):"]
    for f in floors:
        mark = "✓" if f["ok"] else "✗"
        lines.append(f"{mark} {f['name']}: {f['done']}/{f['target']}")
    await update.message.reply_text("\n".join(lines))


async def cmd_help(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await _owner_gate(update):
        return
    await update.message.reply_text(
        "Talk normally. Things I understand without commands:\n"
        "• save/note:/idea:/prompt: <anything>, or just share a link\n"
        "• `replan: <what changed>` — redraw today\n"
        "• `confirm` — arm the morning plan\n"
        "• `sleeping` — log sleep\n"
        "• anything else — I answer with full context\n\n"
        "/today /plan [tomorrow] /replan /score")


# ------------------------------------------------------------- free text
REPLAN_RE = re.compile(r"^replan\s*[:\-]\s*(.+)", re.I | re.S)
CAPTURE_HINT = re.compile(r"^(save|note|idea|prompt|read)\s*[:\-]", re.I)


async def on_text(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await _owner_gate(update):
        return
    text = update.message.text.strip()
    await _remember("user", text)
    low = text.lower()

    m = REPLAN_RE.match(text)
    if m:
        await update.message.reply_text("Redrawing…")
        reply = await planner.replan(m.group(1))
    elif low in ("confirm", "confirmed", "arm", "arm the day"):
        date = dt.datetime.now(config.TZ).date()
        await db.execute("UPDATE days SET status='confirmed', confirmed_at=now() WHERE date=$1", date)
        reply = "Armed. First block ping will come at its start. Go."
    elif low in ("sleeping", "going to sleep", "sleep"):
        now = dt.datetime.now(config.TZ)
        date = now.date() if now.hour < 12 else (now + dt.timedelta(days=1)).date()
        await db.execute(
            """INSERT INTO sleep_logs (date, slept_at) VALUES ($1,$2)
               ON CONFLICT (date) DO UPDATE SET slept_at=EXCLUDED.slept_at""", date, now)
        reply = "Logged. Goodnight — I'll shape the morning around it."
    elif CAPTURE_HINT.match(text) or ("http://" in low or "https://" in low):
        reply = await capture.capture_text(text)
    else:
        # full-context chat: recent messages + today's plan + floors
        recent = await db.fetch(
            "SELECT role, content FROM chat_messages WHERE surface='bot' ORDER BY id DESC LIMIT 16")
        today_txt = await planner.render_day(dt.datetime.now(config.TZ).date())
        floors = await planner.floor_status()
        msgs = [{"role": r["role"] if r["role"] in ("user", "assistant") else "user", "content": r["content"]}
                for r in reversed(recent)]
        msgs.append({"role": "user", "content": text})
        reply = await llm.chat(
            msgs,
            system=llm.SYSTEM_PERSONA + f"\n\nTODAY:\n{today_txt}\n\nFLOORS: {floors}\n"
            "If he is describing a task/event/idea rather than chatting, act on it and say what you did.")
        if reply is None:
            reply = "Brain offline (gateway key missing). Captures, plans and pings still work."

    await _remember("assistant", reply)
    await update.message.reply_text(reply)


async def on_media(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await _owner_gate(update):
        return
    msg = update.message
    if msg.voice:
        kind, fid = "voice", msg.voice.file_id
    elif msg.video or msg.video_note:
        v = msg.video or msg.video_note
        kind, fid = "video", v.file_id
    elif msg.photo:
        kind, fid = "photo", msg.photo[-1].file_id
    elif msg.document:
        kind, fid = "document", msg.document.file_id
    else:
        return
    reply = await capture.capture_media(kind, fid, msg.caption)
    await _remember("user", f"[{kind} capture] {msg.caption or ''}")
    await _remember("assistant", reply)
    await msg.reply_text(reply)


def register(app: Application):
    app.add_handler(CommandHandler("start", cmd_start))
    app.add_handler(CommandHandler("today", cmd_today))
    app.add_handler(CommandHandler("plan", cmd_plan))
    app.add_handler(CommandHandler("replan", cmd_replan))
    app.add_handler(CommandHandler("score", cmd_score))
    app.add_handler(CommandHandler("help", cmd_help))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_text))
    app.add_handler(MessageHandler(
        filters.VOICE | filters.VIDEO | filters.VIDEO_NOTE | filters.PHOTO | filters.Document.ALL, on_media))
