"""F12 verification: vault setup, add, unlock, wrong password, access log, bot pointers."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import db  # noqa: E402
from app.services import vault_svc  # noqa: E402


async def main():
    await db.init_pool()
    # isolate: stash existing vault settings (should be none)
    prev_salt = await db.get_setting("vault_salt")
    if prev_salt:
        print("vault already configured — aborting to protect real data")
        return

    print("setup:", await vault_svc.setup("test-password-123"))
    print("setup again (want refuse):", await vault_svc.setup("other"))
    print("add secret:", await vault_svc.add("test-password-123", "TESTV wifi", None, "hostel@2026"))
    print("add pointer:", await vault_svc.add("test-password-123", "TESTV staging", "Bitwarden → staging", None))
    print("add wrong pw (want refuse):", await vault_svc.add("wrong", "x", None, "y"))

    good = await vault_svc.unlock("test-password-123")
    print("unlock:", [(e["label"], e["kind"], e["secret"]) for e in good])
    bad = await vault_svc.unlock("wrong-password")
    print("wrong unlock (want None):", bad)

    logs = await db.fetchval(
        "SELECT COUNT(*) FROM vault_access_log l JOIN vault_entries e ON e.id=l.entry_id WHERE e.label LIKE 'TESTV%'")
    print("access log rows:", logs)

    print("bot pointers:", (await vault_svc.pointers("TESTV")).replace("\n", " | "))

    # cleanup: remove test entries + password (fresh for Pranav's real setup)
    await db.execute("DELETE FROM vault_access_log WHERE entry_id IN (SELECT id FROM vault_entries WHERE label LIKE 'TESTV%')")
    await db.execute("DELETE FROM vault_entries WHERE label LIKE 'TESTV%'")
    await db.execute("DELETE FROM settings WHERE key IN ('vault_salt','vault_verifier')")
    print("cleanup done (vault reset for real setup)")


asyncio.run(main())
