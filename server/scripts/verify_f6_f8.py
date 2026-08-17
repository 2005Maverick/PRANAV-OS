"""F6/F8 verification: tile render from real blocks; playlist column + COALESCE."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import db  # noqa: E402
from app.services import tile  # noqa: E402


async def main():
    await db.init_pool()
    # migration: playlist_url on domains
    await db.execute("ALTER TABLE domains ADD COLUMN IF NOT EXISTS playlist_url TEXT")
    print("migration ok")

    # seed a fake closed day yesterday
    day = await db.fetchval(
        "INSERT INTO days (date) VALUES (CURRENT_DATE - 1) "
        "ON CONFLICT (date) DO UPDATE SET status=days.status RETURNING id")
    dom_t = await db.fetchval("SELECT id FROM domains WHERE slug='trading'")
    dom_r = await db.fetchval("SELECT id FROM domains WHERE slug='research'")
    for h, d, ttl, st in (("09", dom_r, "TESTTILE paper", "done"),
                          ("14", dom_t, "TESTTILE trading", "done"),
                          ("19", dom_t, "TESTTILE evening", "skipped")):
        await db.execute(
            """INSERT INTO blocks (day_id, domain_id, title, start_at, end_at, status)
               VALUES ($1,$2,$3,(CURRENT_DATE - 1 + ($4||':00')::time)::timestamptz,
                       (CURRENT_DATE - 1 + ($4||':45')::time)::timestamptz,$5)""",
            day, d, ttl, h, st)
    import datetime as dt
    png = await tile.render_day(dt.date.today() - dt.timedelta(days=1))
    out = os.path.join(os.path.dirname(__file__), "..", "..", "evidence", "tile-sample.png")
    if png:
        open(out, "wb").write(png)
        print("tile bytes:", len(png), "->", "evidence/tile-sample.png")
    else:
        print("tile render FAILED")

    # playlist COALESCE
    await db.execute("UPDATE domains SET playlist_url='https://open.spotify.com/TESTPL' WHERE slug='trading'")
    row = await db.fetchrow(
        """SELECT COALESCE(b.playlist_url, d.playlist_url) AS p FROM blocks b
           LEFT JOIN domains d ON d.id=b.domain_id WHERE b.title='TESTTILE trading'""")
    print("coalesced playlist:", row["p"])

    # cleanup
    await db.execute("DELETE FROM blocks WHERE title LIKE 'TESTTILE%'")
    await db.execute("UPDATE domains SET playlist_url=NULL WHERE slug='trading'")
    print("cleanup done")


asyncio.run(main())
