"""Dev helper: show owner + recent chat + today's day row."""
import asyncio
import os
import sys

import asyncpg

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import config  # noqa: E402


async def main():
    c = await asyncpg.connect(config.DATABASE_URL)
    owner = await c.fetchval("SELECT value FROM settings WHERE key='owner_chat_id'")
    print("owner_chat_id:", owner)
    for m in reversed(await c.fetch("SELECT role, content FROM chat_messages ORDER BY id DESC LIMIT 6")):
        print(f"  {m['role']}: {m['content'][:90]}")
    day = await c.fetchrow("SELECT date, status FROM days ORDER BY date DESC LIMIT 1")
    print("latest day:", dict(day) if day else None)
    await c.close()


asyncio.run(main())
