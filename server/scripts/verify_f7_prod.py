"""F7 verification against PRODUCTION: simulated inline-button callback through
the live webhook; asserts the DB state change. (Sends one visible test message
to the owner chat — labeled as a system test.)"""
import asyncio
import os
import sys
import time

import httpx

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import db  # noqa: E402

BASE = "https://pranav-os.onrender.com"
TICK_KEY = "9d4b1f8a63e07c25"
HOOK = "a7f3e9c1b52d48d6"
OWNER = 1693407101


async def main():
    await db.init_pool()
    # wait until prod is up (fresh deploy may be rolling)
    async with httpx.AsyncClient(timeout=30) as c:
        for i in range(20):
            try:
                r = await c.get(f"{BASE}/tick", params={"key": TICK_KEY})
                if r.status_code == 200:
                    break
            except Exception:
                pass
            time.sleep(10)
        else:
            print("prod never came up")
            return

        day = await db.fetchval(
            "INSERT INTO days (date) VALUES (CURRENT_DATE) "
            "ON CONFLICT (date) DO UPDATE SET status=days.status RETURNING id")
        bid = await db.fetchval(
            """INSERT INTO blocks (day_id, title, start_at, end_at, status)
               VALUES ($1,'SYSTEM TEST block — ignore', now(), now() + interval '30 minutes','planned')
               RETURNING id""", day)
        print("test block:", bid)

        update = {
            "update_id": 999999901,
            "callback_query": {
                "id": "999999901",
                "from": {"id": OWNER, "is_bot": False, "first_name": "Pranav"},
                "chat_instance": "test",
                "data": f"blk:started:{bid}",
                "message": {
                    "message_id": 1,
                    "date": int(time.time()),
                    "chat": {"id": OWNER, "type": "private"},
                    "text": "SYSTEM TEST",
                },
            },
        }
        r = await c.post(f"{BASE}/webhook/{HOOK}", json=update)
        print("webhook status:", r.status_code, r.text[:80])
        await asyncio.sleep(2)
        st = await db.fetchval("SELECT status FROM blocks WHERE id=$1", bid)
        print("block status after callback:", st)
        nud = await db.fetchval(
            "SELECT COUNT(*) FROM nudges WHERE block_id=$1 AND response='started'", bid)
        print("nudge response recorded (0 ok - no ping existed):", nud)

        await db.execute("DELETE FROM blocks WHERE id=$1", bid)
        print("cleanup done; PASS =", st == "started")


asyncio.run(main())
