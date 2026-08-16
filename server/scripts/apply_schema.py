"""One-shot: apply schema.sql to DATABASE_URL. Refuses if tables already exist."""
import asyncio
import os
import sys

import asyncpg

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import config  # noqa: E402


async def main():
    conn = await asyncpg.connect(config.DATABASE_URL)
    existing = await conn.fetchval(
        "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema='public'")
    if existing:
        print(f"REFUSING: {existing} tables already exist in this database.")
        await conn.close()
        return
    sql = open(os.path.join(os.path.dirname(__file__), "..", "schema.sql"), encoding="utf-8").read()
    await conn.execute(sql)
    tables = await conn.fetch(
        "SELECT table_name FROM information_schema.tables WHERE table_schema='public' ORDER BY 1")
    print("applied. tables:", ", ".join(t["table_name"] for t in tables))
    doms = await conn.fetch("SELECT slug FROM domains ORDER BY sort_order")
    print("domains seeded:", ", ".join(d["slug"] for d in doms))
    await conn.close()


asyncio.run(main())
