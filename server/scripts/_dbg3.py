import asyncio, sys
sys.path.insert(0, ".")
from app import db
async def m():
    await db.init_pool()
    day = await db.fetchval("SELECT id FROM days WHERE date = CURRENT_DATE - 2")
    dom = await db.fetchval("SELECT id FROM domains WHERE slug='tech'")
    for i in (18, 19):
        await db.execute("""INSERT INTO blocks (day_id, domain_id, title, start_at, end_at, status)
            VALUES ($1,$2,'TEST tech read',(CURRENT_DATE - 2 + ($3||':00')::time)::timestamptz,(CURRENT_DATE - 2 + ($3||':30')::time)::timestamptz,'skipped')""", day, dom, str(i))
    a = await db.fetch("""SELECT d2.name, d2.slug, COUNT(*) AS n FROM blocks b JOIN days dy ON dy.id=b.day_id
        LEFT JOIN domains d2 ON d2.id=b.domain_id
        WHERE dy.date BETWEEN CURRENT_DATE-6 AND CURRENT_DATE AND b.status IN ('skipped','sacrificed') AND d2.slug IS NOT NULL
        GROUP BY 1,2 HAVING COUNT(*) >= 2""")
    print("no-band:", [dict(r) for r in a])
    b2 = await db.fetch("""SELECT CASE WHEN EXTRACT(HOUR FROM b.start_at AT TIME ZONE 'Asia/Kolkata') < 12 THEN 'morning'
        WHEN EXTRACT(HOUR FROM b.start_at AT TIME ZONE 'Asia/Kolkata') < 18 THEN 'afternoon' ELSE 'late' END AS band, COUNT(*)
        FROM blocks b WHERE b.title='TEST tech read' GROUP BY 1""")
    print("band-only:", [dict(r) for r in b2])
    await db.execute("DELETE FROM blocks WHERE title='TEST tech read'")
asyncio.run(m())
