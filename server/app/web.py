"""FastAPI wrapper — production (Render) entry.

Routes:
  POST /webhook/{secret}  Telegram updates in (webhook mode)
  GET  /tick?key=...      external cron heartbeat: pings, briefs, evening close
  GET  /                  health (also the keep-alive target)
"""
import contextlib
import logging
import os

from fastapi import FastAPI, Request, Response
from telegram import Update
from telegram.ext import Application

from . import config, db, scheduler
from .bot import handlers

log = logging.getLogger("web")

WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "hook")
TICK_KEY = os.environ.get("TICK_KEY", "tick")
WEBHOOK_URL = os.environ.get("WEBHOOK_URL", "")  # e.g. https://pranav-os.onrender.com

ptb: Application | None = None


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    global ptb
    await db.init_pool()
    ptb = Application.builder().token(config.TELEGRAM_BOT_TOKEN).build()
    handlers.register(ptb)
    await ptb.initialize()
    await ptb.start()
    if WEBHOOK_URL:
        await ptb.bot.set_webhook(f"{WEBHOOK_URL}/webhook/{WEBHOOK_SECRET}",
                                  drop_pending_updates=True)
        log.info("webhook set: %s/webhook/***", WEBHOOK_URL)
    yield
    await ptb.stop()
    await ptb.shutdown()


app = FastAPI(lifespan=lifespan)


@app.get("/")
async def health():
    return {"ok": True, "service": "pranav-os"}


@app.post("/webhook/{secret}")
async def webhook(secret: str, request: Request):
    if secret != WEBHOOK_SECRET:
        return Response(status_code=403)
    data = await request.json()
    await ptb.process_update(Update.de_json(data, ptb.bot))
    return {"ok": True}


@app.get("/tick")
async def tick(key: str = ""):
    """One heartbeat: block pings + brief + evening close. Idempotent."""
    if key != TICK_KEY:
        return Response(status_code=403)
    await scheduler.tick_blocks(ptb)
    await scheduler.morning_brief_tick(ptb)
    await scheduler.maybe_evening_close(ptb)
    return {"ok": True}
