"""F1 verification: review engine against Neon (seeds + cleans its own test rows)."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import db  # noqa: E402
from app.services import review  # noqa: E402


async def main():
    await db.init_pool()
    day = await db.fetchval(
        "INSERT INTO days (date) VALUES (CURRENT_DATE - 2) "
        "ON CONFLICT (date) DO UPDATE SET status=days.status RETURNING id")
    dom = await db.fetchval("SELECT id FROM domains WHERE slug='tech'")
    for i in (18, 19):
        await db.execute(
            """INSERT INTO blocks (day_id, domain_id, title, start_at, end_at, status)
               VALUES ($1,$2,'TEST tech read',
                       (CURRENT_DATE - 2 + ($3||':00')::time)::timestamptz,
                       (CURRENT_DATE - 2 + ($3||':30')::time)::timestamptz,'skipped')""",
            day, dom, str(i))
    data = await review.week_data("weekly")
    print("floors:", len(data["floors"]), "| proposals:", len(data["proposals"]),
          "| ignored:", data["nudges"]["total_ignored"],
          "| reality domains:", len(data["reality"]["domains"]))
    if data["proposals"]:
        pid = data["proposals"][0]["id"]
        print("decide:", await review.decide_proposal(pid, True))
        rule = await db.fetchval(
            "SELECT rule_text FROM rules WHERE source='pattern_approved' ORDER BY id DESC LIMIT 1")
        print("rule created:", rule)
    await db.execute("DELETE FROM blocks WHERE title='TEST tech read'")
    summary = await review.bot_summary()
    print("summary sample:", summary[:220].replace("\n", " / "))


asyncio.run(main())
