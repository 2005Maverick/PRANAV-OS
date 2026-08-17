import asyncio, sys
sys.path.insert(0, ".")
from app import db
async def m():
    await db.init_pool()
    await db.execute("DELETE FROM rules WHERE rule_text LIKE '%Tech Learning in the afternoon%'")
    await db.execute("DELETE FROM pattern_proposals WHERE observation LIKE '%Tech Learning died%'")
    await db.execute("DELETE FROM days WHERE date = CURRENT_DATE - 2 AND id NOT IN (SELECT DISTINCT day_id FROM blocks WHERE day_id IS NOT NULL)")
    print("test data cleaned")
asyncio.run(m())
