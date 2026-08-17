"""F15 verification: move with fixed-conflict flag, force, clean move, ghost week."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import db  # noqa: E402
from app.api import MoveIn, move_block, week_ghost  # noqa: E402


async def main():
    await db.init_pool()
    day = await db.fetchval(
        "INSERT INTO days (date) VALUES (CURRENT_DATE) "
        "ON CONFLICT (date) DO UPDATE SET status=days.status RETURNING id")
    fixed = await db.fetchval(
        """INSERT INTO blocks (day_id, title, start_at, end_at, is_fixed, kind)
           VALUES ($1,'TESTMV class',
                   (CURRENT_DATE + time '11:00') AT TIME ZONE 'Asia/Kolkata',
                   (CURRENT_DATE + time '13:00') AT TIME ZONE 'Asia/Kolkata', TRUE, 'fixed')
           RETURNING id""", day)
    blk = await db.fetchval(
        """INSERT INTO blocks (day_id, title, start_at, end_at)
           VALUES ($1,'TESTMV trading',
                   (CURRENT_DATE + time '19:00') AT TIME ZONE 'Asia/Kolkata',
                   (CURRENT_DATE + time '20:00') AT TIME ZONE 'Asia/Kolkata')
           RETURNING id""", day)
    print("conflict move:", await move_block(MoveIn(block_id=blk, start="11:30")))
    print("forced move:", await move_block(MoveIn(block_id=blk, start="11:30", force=True)))
    print("clean move:", await move_block(MoveIn(block_id=blk, start="15:00")))
    st = await db.fetchrow("SELECT start_at FROM blocks WHERE id=$1", blk)
    print("final start (UTC):", str(st["start_at"]))
    print("move fixed refused:", await move_block(MoveIn(block_id=fixed, start="09:00")))
    g = await week_ghost()
    print("ghost days:", len(g["days"]), "first:", g["days"][0]["name"])
    await db.execute("DELETE FROM blocks WHERE title LIKE 'TESTMV%'")
    print("cleanup done")


asyncio.run(main())
