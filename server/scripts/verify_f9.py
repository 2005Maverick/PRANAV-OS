"""F9/F16(resurface) verification: library search + resurface engine + reading slot."""
import asyncio
import datetime as dt
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import config, db  # noqa: E402
from app.services import resurface  # noqa: E402

SENT = []


async def send(text, kind="nudge", block_id=None):
    SENT.append((kind, text[:70].replace("\n", " ")))
    await db.execute("INSERT INTO nudges (kind, message) VALUES ($1,$2)", kind, text)


async def main():
    await db.init_pool()
    # seed
    rid = await db.fetchval(
        "INSERT INTO library_items (section, title, url, est_minutes) "
        "VALUES ('reading','TESTLIB rl thread','https://x.com/t',8) RETURNING id")
    await db.execute(
        "INSERT INTO library_items (section, title, body) VALUES ('prompt','TESTLIB osint prompt','extract entities')")

    # search across sections
    rows = await db.fetch(
        "SELECT id FROM library_items WHERE title ILIKE '%TESTLIB%'")
    print("seeded:", len(rows))

    # explicit resurface due now
    await db.execute(
        "UPDATE library_items SET resurface_at = now() - interval '1 minute' WHERE id=$1", rid)
    n1 = await resurface.surface_due(send)
    n2 = await resurface.surface_due(send)  # idempotent (cleared after surfacing)
    print("surfaced first:", n1, "| second (want 0):", n2)

    # reading slot: force today's day + past hour
    now = dt.datetime.now(config.TZ)
    await db.set_setting("reading_day", now.strftime("%A").lower())
    await db.set_setting("reading_hour", str(max(now.hour - 1, 0)))
    # make the reading item eligible again
    await db.execute("UPDATE library_items SET surfaced_ct=0 WHERE id=$1", rid)
    await resurface.reading_slot(send)
    await resurface.reading_slot(send)  # idempotent per day
    slots = [s for s in SENT if s[0] == "reading_slot"]
    print("reading slot fires (want 1):", len(slots), slots[:1])

    # cleanup
    await db.execute("DELETE FROM library_items WHERE title LIKE 'TESTLIB%'")
    await db.execute("DELETE FROM nudges WHERE message LIKE '%TESTLIB%' OR kind IN ('reading_slot','resurface') AND message LIKE '%readslot%'")
    await db.execute("DELETE FROM nudges WHERE kind='reading_slot'")
    await db.set_setting("reading_day", "saturday")
    await db.set_setting("reading_hour", "10")
    print("cleanup done")


asyncio.run(main())
