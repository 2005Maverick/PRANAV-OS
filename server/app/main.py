"""Pranav OS server entry — bot + scheduler in one process."""
import asyncio
import logging

from telegram.ext import Application

from . import config, db, scheduler
from .bot import handlers

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(name)s %(levelname)s %(message)s")
logging.getLogger("httpx").setLevel(logging.WARNING)
log = logging.getLogger("main")


async def post_init(app: Application):
    await db.init_pool()
    from .services import notes_svc
    await notes_svc.ensure_schema()
    scheduler.start(app)
    log.info("Pranav OS up. Waiting for /start to claim ownership." )


def run():
    app = Application.builder().token(config.TELEGRAM_BOT_TOKEN).post_init(post_init).build()
    handlers.register(app)
    app.run_polling(drop_pending_updates=True)


if __name__ == "__main__":
    run()
