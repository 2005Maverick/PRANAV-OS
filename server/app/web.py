"""FastAPI wrapper — production (Render) entry.

Routes:
  POST /webhook/{secret}  Telegram updates in (webhook mode)
  GET  /tick?key=...      external cron heartbeat: pings, briefs, evening close
  GET  /                  health (also the keep-alive target)
"""
import asyncio
import contextlib
import logging
import os

from fastapi import FastAPI, Request, Response
from telegram import Update
from telegram.ext import Application

from . import config, db, scheduler
from .bot import handlers

log = logging.getLogger("web")

WEBHOOK_SECRET = os.environ.get("WEBHOOK_SECRET", "")
TICK_KEY = os.environ.get("TICK_KEY", "")
WEBHOOK_URL = os.environ.get("WEBHOOK_URL", "")  # e.g. https://pranav-os.onrender.com

# prod (webhook mode) must never run on guessable secrets
if WEBHOOK_URL and (len(WEBHOOK_SECRET) < 8 or len(TICK_KEY) < 8):
    raise RuntimeError("WEBHOOK_SECRET and TICK_KEY must be set to strong values in production")

ptb: Application | None = None


@contextlib.asynccontextmanager
async def lifespan(app: FastAPI):
    global ptb
    await db.init_pool()
    from .services import notes_svc, arcs_svc, decks_svc, money_svc
    await notes_svc.ensure_schema()
    await arcs_svc.ensure_schema()
    await decks_svc.ensure_schema()
    await money_svc.ensure_schema()
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

from fastapi.middleware.cors import CORSMiddleware  # noqa: E402
from .api import router as api_router  # noqa: E402

app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["GET", "POST"], allow_headers=["*"])
app.include_router(api_router)


@app.get("/")
async def health():
    return {"ok": True, "service": "pranav-os"}


_bg_tasks: set = set()


@app.post("/webhook/{secret:path}")
async def webhook(secret: str, request: Request):
    if secret != WEBHOOK_SECRET:
        return Response(status_code=403)
    data = await request.json()
    # Ack Telegram immediately, process off the request path so a slow handler
    # (e.g. an LLM call on a cold free-tier dyno) can't get cancelled mid-write.
    task = asyncio.create_task(ptb.process_update(Update.de_json(data, ptb.bot)))
    _bg_tasks.add(task)
    task.add_done_callback(_bg_tasks.discard)
    return {"ok": True}


@app.get("/tick")
async def tick(key: str = ""):
    """One heartbeat: block pings + brief + evening close. Idempotent, and one
    failing engine never kills the others."""
    if key != TICK_KEY:
        return Response(status_code=403)
    errors = []
    for name, fn in (("blocks", scheduler.tick_blocks),
                     ("brief", scheduler.morning_brief_tick),
                     ("close", scheduler.maybe_evening_close)):
        try:
            await fn(ptb)
        except Exception as e:
            log.exception("tick engine %s failed", name)
            errors.append(f"{name}: {type(e).__name__}")
    return {"ok": not errors, "errors": errors or None}
