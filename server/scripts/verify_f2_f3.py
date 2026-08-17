"""F2/F3 verification: finance parse, lists CRUD, reminder, firing engines (idempotent)."""
import asyncio
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import config, db  # noqa: E402
from app.services import lists_fin  # noqa: E402

SENT = []


async def send(text, kind="nudge", block_id=None):
    SENT.append((kind, text[:80]))
    await db.execute("INSERT INTO nudges (kind, message) VALUES ($1,$2)", kind, text)


async def main():
    await db.init_pool()
    print("finance:", await lists_fin.try_finance("spent 450 on dinner TESTFIN"))
    row = await db.fetchrow("SELECT amount, category FROM finance_entries WHERE note LIKE '%TESTFIN%'")
    print("db row:", dict(row) if row else None)
    print("sub:", await lists_fin.try_finance("subscription TESTSUB 649 monthly"))

    print("newlist:", await lists_fin.try_lists("new list testpack"))
    print("add:", await lists_fin.try_lists("add TESTITEM charger to testpack list"))
    print("show:", (await lists_fin.try_lists("show testpack list")).replace("\n", " | "))

    print("reminder:", await lists_fin.try_reminder("remind me about TESTDEADLINE thing by 24 Aug"))

    # deadline firing: due in 7 days -> lead hit today
    await db.execute(
        "INSERT INTO commitments (title, due_date) VALUES ('TESTDL fire', CURRENT_DATE + 7)")
    await lists_fin.fire_deadlines(send)
    await lists_fin.fire_deadlines(send)  # idempotency
    dl = [s for s in SENT if s[0] == "deadline" and "TESTDL" in s[1]]
    print("deadline fires (want 1):", len(dl), dl[:1])

    # list firing: set testpack to today's weekday
    dow = dt.datetime.now(config.TZ).strftime("%A").lower()
    await db.execute("UPDATE lists SET fire_kind='weekly_day', fire_param=$1 WHERE name='testpack'", dow)
    await lists_fin.fire_lists(send)
    await lists_fin.fire_lists(send)  # idempotency
    lf = [s for s in SENT if s[0] == "list_fire" and "testpack" in s[1]]
    print("list fires (want 1):", len(lf), lf[:1])

    # cleanup all test rows
    await db.execute("DELETE FROM finance_entries WHERE note LIKE '%TESTFIN%'")
    await db.execute("DELETE FROM subscriptions WHERE name='TESTSUB'")
    await db.execute("DELETE FROM list_items WHERE list_id IN (SELECT id FROM lists WHERE name='testpack')")
    await db.execute("DELETE FROM lists WHERE name='testpack'")
    await db.execute("DELETE FROM commitments WHERE title LIKE 'TESTDL%' OR title LIKE '%TESTDEADLINE%'")
    await db.execute("DELETE FROM nudges WHERE message LIKE '%TESTDL%' OR message LIKE '%testpack%'")
    print("cleanup done")


asyncio.run(main())
