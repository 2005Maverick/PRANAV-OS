import asyncio, os, sys
sys.path.insert(0, ".")
from app import db
async def m():
    await db.init_pool()
    day = await db.fetchval("INSERT INTO days (date) VALUES (CURRENT_DATE - 2) ON CONFLICT (date) DO UPDATE SET status=days.status RETURNING id")
    dom = await db.fetchval("SELECT id FROM domains WHERE slug='tech'")
    for i in (18, 19):
        await db.execute("""INSERT INTO blocks (day_id, domain_id, title, start_at, end_at, status)
            VALUES ($1,$2,'TEST tech read',(CURRENT_DATE - 2 + ($3||':00')::time)::timestamptz,(CURRENT_DATE - 2 + ($3||':30')::time)::timestamptz,'skipped')""", day, dom, str(i))
    q1 = await db.fetchval("SELECT COUNT(*) FROM blocks b JOIN days dy ON dy.id=b.day_id WHERE b.title='TEST tech read'")
    q2 = await db.fetchval("SELECT COUNT(*) FROM blocks b JOIN days dy ON dy.id=b.day_id WHERE b.title='TEST tech read' AND dy.date BETWEEN CURRENT_DATE - 6 AND CURRENT_DATE")
    q3 = await db.fetch("SELECT d2.slug, COUNT(*) FROM blocks b JOIN days dy ON dy.id=b.day_id LEFT JOIN domains d2 ON d2.id=b.domain_id WHERE b.title='TEST tech read' GROUP BY 1")
    print("join:", q1, "| window:", q2, "| by slug:", [dict(r) for r in q3])
    days = await db.fetch("SELECT id, date FROM days WHERE date >= CURRENT_DATE - 7 ORDER BY date")
    print("days rows:", [(r["id"], str(r["date"])) for r in days])
    blk = await db.fetch("SELECT day_id FROM blocks WHERE title='TEST tech read'")
    print("block day_ids:", [r["day_id"] for r in blk])
    await db.execute("DELETE FROM blocks WHERE title='TEST tech read'")
asyncio.run(m())
