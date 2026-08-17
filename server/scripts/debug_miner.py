"""Debug the pattern miner query directly."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import db  # noqa: E402


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
    rows = await db.fetch(
        """SELECT d2.name AS domain, d2.slug,
                  CASE WHEN EXTRACT(HOUR FROM b.start_at AT TIME ZONE 'Asia/Kolkata') < 12 THEN 'morning'
                       WHEN EXTRACT(HOUR FROM b.start_at AT TIME ZONE 'Asia/Kolkata') < 18 THEN 'afternoon'
                       ELSE 'late' END AS band,
                  COUNT(*) AS n
           FROM blocks b JOIN days dy ON dy.id=b.day_id
           LEFT JOIN domains d2 ON d2.id=b.domain_id
           WHERE dy.date BETWEEN CURRENT_DATE - 6 AND CURRENT_DATE
             AND b.status IN ('skipped','sacrificed') AND d2.slug IS NOT NULL
           GROUP BY 1,2,3 HAVING COUNT(*) >= 2""")
    print("miner rows:", [dict(r) for r in rows])
    raw = await db.fetch(
        "SELECT title, status, start_at FROM blocks WHERE title='TEST tech read'")
    print("raw test blocks:", [(r['title'], r['status'], str(r['start_at'])) for r in raw])
    props = await db.fetch("SELECT id, observation, status FROM pattern_proposals ORDER BY id DESC LIMIT 5")
    print("proposals table:", [dict(r) for r in props])
    await db.execute("DELETE FROM blocks WHERE title='TEST tech read'")


asyncio.run(main())
