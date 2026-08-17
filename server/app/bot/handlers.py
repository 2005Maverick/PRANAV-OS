"""Telegram handlers — the phone face. Slice 1: capture, plan, brief, replan, chat."""
import datetime as dt
import logging
import re
from telegram import Update
from telegram.ext import (Application, CallbackQueryHandler, CommandHandler,
                          ContextTypes, MessageHandler, filters)

from .. import config, db, llm
from ..services import (capture, lists_fin, meetings_svc, onboarding, planner,
                        protocols, review, sleep, transcribe)

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


async def cmd_onboard(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await _owner_gate(update):
        return
    await update.message.reply_text(await onboarding.start())


async def cmd_review(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await _owner_gate(update):
        return
    await update.message.reply_text("Reading the week…")
    await update.message.reply_text(await review.bot_summary())


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


# ------------------------------------------------------------- callbacks
async def on_callback(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    q = update.callback_query
    if not q:
        return
    chat = q.message.chat if q.message else update.effective_chat
    owner = await db.get_setting("owner_chat_id")
    if owner and (chat is None or str(chat.id) != owner):
        try:
            await q.answer()
        except Exception:
            pass
        return
    if q.message is None:
        try:
            await q.answer("That button expired — say it in words instead.")
        except Exception:
            pass
        return
    data = q.data or ""
    try:
        await q.answer()
    except Exception:
        pass  # expired/stale callback ids must not kill the action
    now = dt.datetime.now(config.TZ)

    if data == "day:confirm":
        await db.execute(
            "UPDATE days SET status='confirmed', confirmed_at=now() WHERE date=$1", now.date())
        await sleep.on_wake()
        await q.edit_message_reply_markup(None)
        await q.message.reply_text("Armed. First block ping comes at its start. Go.")
    elif data == "day:adjust":
        await q.edit_message_reply_markup(None)
        await q.message.reply_text("Tell me what to change — e.g. `move trading to evening` or `replan: <what changed>`.")
    elif data.startswith("blk:"):
        _, action, bid = data.split(":")
        bid = int(bid)
        if action == "started":
            await db.execute(
                "UPDATE blocks SET status='started', started_at=$2 WHERE id=$1 AND status='planned'", bid, now)
            await db.execute(
                "UPDATE nudges SET response='started', responded_at=now() WHERE block_id=$1 AND kind='block_start' AND response IS NULL", bid)
            try:
                await q.edit_message_reply_markup(None)
            except Exception:
                pass
            await q.message.reply_text("Go. I'm quiet until the block ends.")
        elif action == "snooze":
            await db.execute(
                "UPDATE blocks SET start_at=start_at + interval '15 minutes', end_at=end_at + interval '15 minutes' WHERE id=$1 AND status='planned'", bid)
            await db.execute(
                "DELETE FROM nudges WHERE block_id=$1 AND kind='block_start'", bid)
            try:
                await q.edit_message_reply_markup(None)
            except Exception:
                pass
            await q.message.reply_text("Pushed 15 minutes. I'll ping again.")
        elif action == "skip":
            await db.execute(
                "UPDATE blocks SET status='skipped', skip_reason='skipped via button' WHERE id=$1", bid)
            await db.execute(
                "UPDATE nudges SET response='skip', responded_at=now() WHERE block_id=$1 AND response IS NULL", bid)
            try:
                await q.edit_message_reply_markup(None)
            except Exception:
                pass
            await q.message.reply_text("Skipped, on the record. It shows on Sunday.")


# ------------------------------------------------------------- free text
REPLAN_RE = re.compile(r"^replan\s*[:\-]\s*(.+)", re.I | re.S)
CAPTURE_HINT = re.compile(r"^(save|note|idea|prompt|read)\s*[:\-]", re.I)
PLAYLIST_RE = re.compile(r"^playlist\s+for\s+(\w+)\s*[:\-]\s*(\S+)", re.I)


async def on_text(update: Update, ctx: ContextTypes.DEFAULT_TYPE):
    if not await _owner_gate(update):
        return
    text = update.message.text.strip()
    await _remember("user", text)
    low = text.lower()

    async def _answer_nudge(kinds: tuple[str, ...], minutes: int = 60):
        row = await db.fetchrow(
            """SELECT id, block_id FROM nudges WHERE kind = ANY($1) AND response IS NULL
               AND sent_at > now() - ($2 || ' minutes')::interval
               ORDER BY id DESC LIMIT 1""", list(kinds), str(minutes))
        if row:
            await db.execute(
                "UPDATE nudges SET response=$2, responded_at=now() WHERE id=$1", row["id"], text[:300])
        return row

    m = REPLAN_RE.match(text)
    mtg_start = meetings_svc.MEETING_START_RE.match(text)
    if await onboarding.active():
        reply = await onboarding.handle(text)
    elif mtg_start:
        reply = await meetings_svc.start(mtg_start.group(1))
    elif meetings_svc.MEETING_END_RE.match(text):
        reply = await meetings_svc.end()
    elif await meetings_svc.active_id():
        reply = await meetings_svc.note(text)
    elif m:
        await update.message.reply_text("Redrawing…")
        reply = await planner.replan(m.group(1))
    elif low in ("done", "done.", "ok done", "did it"):
        proto = await protocols.protocol_advance(None)
        if proto == "__PROTOCOL_COMPLETE__":
            wake = await sleep.on_wake()
            brief = await planner.morning_brief()
            await db.execute(
                "UPDATE days SET brief_sent_at=now() WHERE date=$1", dt.datetime.now(config.TZ).date())
            prefix = "Protocol complete."
            if wake and wake["hours"]:
                prefix += f" Slept {wake['hours']:.1f}h — ledger {wake['debt']:+.1f}h, close tonight {wake['close']}."
            reply = prefix + "\n\n" + brief
        elif proto:
            reply = proto
        else:
            reply = await protocols.reward_close() or "Noted."
    elif low in ("started", "start", "in", "on it"):
        row = await _answer_nudge(("block_start", "escalation1", "escalation2"))
        if row and row["block_id"]:
            await db.execute(
                "UPDATE blocks SET status='started', started_at=now() WHERE id=$1 AND status='planned'",
                row["block_id"])
            reply = "Go. I'm quiet until the block ends."
        else:
            reply = "Nothing pinged recently — /today shows the plan."
    elif low.startswith("skip"):
        reason = text[4:].strip(" :–-") or "no reason given"
        row = await _answer_nudge(("block_start", "escalation1", "escalation2"))
        if row and row["block_id"]:
            await db.execute(
                "UPDATE blocks SET status='skipped', skip_reason=$2 WHERE id=$1", row["block_id"], reason[:200])
            reply = f"Skipped, on the record: “{reason}”. It shows on Sunday."
        else:
            reply = "No block waiting on you right now."
    elif protocols.REWARD_RE.match(text):
        reply = await protocols.reward_start(text)
    elif await db.get_setting("pending_reward"):
        reply = await protocols.reward_commit(text) or "Give me a number: `2 ep` or `40 min`."
    elif low in ("confirm", "confirmed", "arm", "arm the day"):
        date = dt.datetime.now(config.TZ).date()
        await db.execute("UPDATE days SET status='confirmed', confirmed_at=now() WHERE date=$1", date)
        wake = await sleep.on_wake()
        reply = "Armed. First block ping will come at its start. Go."
        if wake and wake["note"]:
            reply += "\n" + wake["note"]
    elif low in ("sleeping", "going to sleep", "sleep"):
        now = dt.datetime.now(config.TZ)
        date = now.date() if now.hour < 12 else (now + dt.timedelta(days=1)).date()
        await db.execute(
            """INSERT INTO sleep_logs (date, slept_at) VALUES ($1,$2)
               ON CONFLICT (date) DO UPDATE SET slept_at=EXCLUDED.slept_at""", date, now)
        reply = "Logged. Goodnight — I'll shape the morning around it."
    elif low == "vault reset confirm":
        await db.execute("DELETE FROM vault_access_log")
        await db.execute("DELETE FROM vault_entries")
        await db.execute("DELETE FROM settings WHERE key IN ('vault_salt','vault_verifier')")
        reply = "Vault wiped — entries and password gone. Set a new password from the cockpit."
    elif low == "vault reset":
        reply = "This deletes ALL vault entries and the password. Say `vault reset confirm` to proceed."
    elif low.startswith("vault "):
        from ..services import vault_svc
        reply = await vault_svc.pointers(text[6:].strip())
    elif (pl := PLAYLIST_RE.match(text)):
        slug, url = pl.group(1).lower(), pl.group(2)
        n = await db.execute(
            "UPDATE domains SET playlist_url=$2 WHERE slug=$1 OR lower(name) LIKE '%'||$1||'%'", slug, url)
        reply = (f"Playlist set for {slug} — every {slug} block ping carries it now."
                 if n != "UPDATE 0" else f"No domain matching “{slug}”. Domains: internship, research, trading, startup, uni, tech, gym.")
    elif (fin := await lists_fin.try_finance(text)):
        reply = fin
    elif (lst := await lists_fin.try_lists(text)):
        reply = lst
    elif (rem := await lists_fin.try_reminder(text)):
        reply = rem
    elif CAPTURE_HINT.match(text) or ("http://" in low or "https://" in low):
        reply = await capture.capture_text(text)
    elif await db.fetchval(
            """SELECT id FROM nudges WHERE kind='closeout_prompt' AND response IS NULL
               AND sent_at > now() - interval '45 minutes' ORDER BY id DESC LIMIT 1"""):
        row = await _answer_nudge(("closeout_prompt",), minutes=45)
        if row and row["block_id"]:
            await db.execute(
                "INSERT INTO closeouts (block_id, stopped_at) VALUES ($1,$2)", row["block_id"], text[:400])
        reply = "Logged. Next session starts exactly there."
    else:
        await _answer_nudge(("checkin",), minutes=30)
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
        # transcribe -> searchable text; falls back to raw file storage
        try:
            f = await ctx.bot.get_file(msg.voice.file_id)
            audio = bytes(await f.download_as_bytearray())
            txt = await transcribe.transcribe(audio, "audio/ogg")
        except Exception:
            txt = None
        if txt:
            await _remember("user", f"[voice] {txt}")
            if await meetings_svc.active_id():
                reply = await meetings_svc.note(f"(voice) {txt}")
            else:
                reply = await capture.capture_text(txt)
            reply = f"Heard: “{txt[:160]}{'…' if len(txt) > 160 else ''}”\n{reply}"
            await _remember("assistant", reply)
            await msg.reply_text(reply)
            return
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
    app.add_handler(CommandHandler("onboard", cmd_onboard))
    app.add_handler(CommandHandler("review", cmd_review))
    app.add_handler(CallbackQueryHandler(on_callback))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, on_text))
    app.add_handler(MessageHandler(
        filters.VOICE | filters.VIDEO | filters.VIDEO_NOTE | filters.PHOTO | filters.Document.ALL, on_media))
