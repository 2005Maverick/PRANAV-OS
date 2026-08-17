import asyncio, sys
sys.path.insert(0, ".")
from app import db
from app.services import review
async def m():
    await db.init_pool()
    day = await db.fetchval("SELECT id FROM days WHERE date = CURRENT_DATE - 2")
    dom = await db.fetchval("SELECT id FROM domains WHERE slug='tech'")
    for i in ("08", "09"):
        await db.execute("""INSERT INTO blocks (day_id, domain_id, title, start_at, end_at, status)
            VALUES ($1,$2,'TEST tech read',(CURRENT_DATE - 2 + ($3||':00')::time)::timestamptz,(CURRENT_DATE - 2 + ($3||':30')::time)::timestamptz,'skipped')""", day, dom, i)
    n = await review.generate_proposals()
    print("proposals created:", n)
    props = await db.fetch("SELECT id, observation, proposal, status FROM pattern_proposals WHERE status='pending'")
    print("pending:", [dict(r) for r in props])
    if props:
        print("approve:", await review.decide_proposal(props[0]["id"], True))
        rule = await db.fetchval("SELECT rule_text FROM rules WHERE source='pattern_approved' ORDER BY id DESC LIMIT 1")
        print("RULE:", rule)
    await db.execute("DELETE FROM blocks WHERE title='TEST tech read'")
asyncio.run(m())
