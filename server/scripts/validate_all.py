"""End-to-end router validation.

Drives the REAL bot router (handlers.on_text + command handlers) with mock
Telegram objects against the REAL Neon DB, snapshots every table before/after
each input, and reports: did it route, what did it reply, and did it write to
the DB. Cleans up after itself (id-watermark deletes for append tables +
snapshot/restore for singleton settings/days/domains/sleep_logs).

Run:  ./.venv/Scripts/python.exe scripts/validate_all.py
"""
import asyncio
import datetime as dt
import os
import sys
import types
from pathlib import Path

try:
    sys.stdout.reconfigure(encoding="utf-8")
    sys.stderr.reconfigure(encoding="utf-8")
except Exception:
    pass

# ---- load .env ----
ENV = Path(__file__).resolve().parents[1] / ".env"
for line in ENV.read_text(encoding="utf-8").splitlines():
    if "=" in line and not line.strip().startswith("#"):
        k, _, v = line.partition("=")
        os.environ.setdefault(k.strip(), v.strip())

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app import config, db  # noqa: E402
from app.bot import handlers  # noqa: E402

OWNER = 1693407101  # real owner_chat_id already in settings

ALL_TABLES = [
    "arc_contribs", "arc_steps", "arcs", "blocks", "chat_messages", "closeouts",
    "commitments", "days", "decisions", "domains", "energy_observations",
    "finance_entries", "goals", "inbox_items", "library_items", "list_items",
    "lists", "meetings", "note_links", "notes", "nudges", "pattern_proposals",
    "protocol_runs", "protocol_steps", "recurring_blocks", "replans", "reviews",
    "reward_sessions", "rules", "settings", "sleep_logs", "subscriptions",
    "vault_access_log", "vault_entries",
]
# append-only tables with a serial id -> watermark cleanup
APPEND = [
    "chat_messages", "finance_entries", "subscriptions", "commitments", "notes",
    "library_items", "lists", "list_items", "meetings", "reward_sessions",
    "replans", "nudges", "note_links", "inbox_items", "protocol_runs",
    "protocol_steps", "closeouts", "reviews", "pattern_proposals", "decisions",
    "blocks", "arcs", "arc_steps", "arc_contribs", "goals", "energy_observations",
]


# ---------- mock Telegram ----------
class MockMessage:
    def __init__(self, text):
        self.text = text
        self.caption = None
        self.voice = self.video = self.video_note = self.photo = self.document = None
        self.replies = []

    async def reply_text(self, t, **kw):
        self.replies.append(t)


class MockUpdate:
    def __init__(self, text):
        self.message = MockMessage(text)
        self.effective_chat = types.SimpleNamespace(id=OWNER)
        self.effective_user = types.SimpleNamespace(id=OWNER, first_name="Pranav")


class MockBot:
    async def send_message(self, *a, **k): pass
    async def get_file(self, *a, **k): raise RuntimeError("no file in test")


def mock_ctx(args=None):
    return types.SimpleNamespace(bot=MockBot(), args=args or [])


async def counts():
    out = {}
    for t in ALL_TABLES:
        try:
            out[t] = await db.fetchval(f"SELECT count(*) FROM {t}")
        except Exception:
            out[t] = None
    return out


async def max_ids():
    out = {}
    for t in APPEND:
        try:
            out[t] = await db.fetchval(f"SELECT COALESCE(MAX(id),0) FROM {t}")
        except Exception:
            out[t] = None
    return out


# ---------- test battery ----------
# (label, kind, text)  kind: "text" -> on_text ; else a cmd_* handler name
TESTS = [
    ("cmd /help", "cmd_help", "/help"),
    ("cmd /today", "cmd_today", "/today"),
    ("cmd /score", "cmd_score", "/score"),
    ("cmd /start (already armed)", "cmd_start", "/start"),
    ("spend  -> finance_entries", "text", "spent 137 on TESTSPEND coffee"),
    ("subscription -> subscriptions", "text", "subscription TESTSUB 199 monthly"),
    ("new list -> lists", "text", "new list TESTLIST"),
    ("add to list -> list_items", "text", "add TESTITEM to the TESTLIST list"),
    ("remind -> commitments", "text", "remind me to TESTREMIND by 30 Sep"),
    ("note: -> notes/library", "text", "note: TESTNOTE this is a validation body"),
    ("url capture -> library/inbox", "text", "https://example.com/TESTLINK reference"),
    ("sleeping -> sleep_logs", "text", "sleeping"),
    ("started (no nudge)", "text", "started"),
    ("skip (no block)", "text", "skip TESTREASON none"),
    ("done (no protocol)", "text", "done"),
    ("meeting: -> meetings", "text", "meeting: TESTMTG standup sync"),
    ("meeting over -> end", "text", "meeting over"),
    ("reward netflix -> reward_sessions", "text", "netflix"),
    ("reward commit '2 ep'", "text", "2 ep"),
    ("playlist for gym", "text", "playlist for gym: https://test/TESTPL"),
    ("vault query (read-only)", "text", "vault TESTVQ"),
    ("confirm -> days.status", "text", "confirm"),
    ("replan: -> replans", "text", "replan: TESTREPLAN meeting ran long"),
    ("fallback chat (LLM)", "text", "what should I focus on right now?"),
]


async def run_one(label, kind, text):
    before_c = await counts()
    upd = MockUpdate(text)
    ctx = mock_ctx()
    err = None
    try:
        if kind == "text":
            await asyncio.wait_for(handlers.on_text(upd, ctx), timeout=60)
        else:
            fn = getattr(handlers, kind)
            await asyncio.wait_for(fn(upd, ctx), timeout=60)
    except Exception as e:
        err = f"{type(e).__name__}: {e}"
    after_c = await counts()
    reply = " | ".join(upd.message.replies)[:200].replace("\n", " ")
    deltas = {t: after_c[t] - before_c[t]
              for t in ALL_TABLES
              if before_c[t] is not None and after_c[t] is not None and after_c[t] != before_c[t]}
    mem = deltas.pop("chat_messages", 0)
    return {"label": label, "reply": reply, "deltas": deltas, "mem": mem, "err": err}


async def main():
    await db.init_pool()
    # ---- snapshots for restore ----
    wm = await max_ids()
    today = dt.datetime.now(config.TZ).date()
    tomorrow = today + dt.timedelta(days=1)
    settings_before = {r["key"]: r["value"] for r in await db.fetch("SELECT key,value FROM settings")}
    day_status_before = await db.fetchval("SELECT status FROM days WHERE date=$1", today)
    gym_playlist_before = await db.fetchval(
        "SELECT playlist_url FROM domains WHERE slug='gym' OR lower(name) LIKE '%gym%'")
    sleep_dates_before = {r["date"] for r in await db.fetch("SELECT date FROM sleep_logs")}

    print("LLM gateway:", "configured" if os.environ.get("LITELLM_API_KEY") else "MISSING")
    print(f"owner_chat_id={settings_before.get('owner_chat_id')}  today={today}\n")

    results = []
    for label, kind, text in TESTS:
        r = await run_one(label, kind, text)
        results.append(r)
        chg = ", ".join(f"{t}:{d:+d}" for t, d in r["deltas"].items()) or "-"
        flag = "ERR" if r["err"] else ("WROTE" if r["deltas"] else "noop")
        print(f"[{flag:5}] {label:34} db[{chg}]")
        if r["err"]:
            print(f"          !! {r['err']}")
        print(f"          -> {r['reply'] or '(no reply)'}")

    # ---------------- cleanup ----------------
    print("\n-- cleanup --")
    cleaned = 0
    for t in APPEND:
        if wm.get(t) is None:
            continue
        try:
            res = await db.execute(f"DELETE FROM {t} WHERE id > $1", wm[t])
            n = int(res.split()[-1]) if res.startswith("DELETE") else 0
            cleaned += n
        except Exception as e:
            print(f"   cleanup {t}: {type(e).__name__}")
    # restore settings: delete new keys, restore changed values
    now_settings = {r["key"]: r["value"] for r in await db.fetch("SELECT key,value FROM settings")}
    for k, v in now_settings.items():
        if k not in settings_before:
            await db.execute("DELETE FROM settings WHERE key=$1", k)
        elif settings_before[k] != v:
            await db.execute("UPDATE settings SET value=$2 WHERE key=$1", k, settings_before[k])
    # restore day status
    if day_status_before is not None:
        await db.execute("UPDATE days SET status=$2 WHERE date=$1", today, day_status_before)
    # restore gym playlist
    await db.execute(
        "UPDATE domains SET playlist_url=$1 WHERE slug='gym' OR lower(name) LIKE '%gym%'", gym_playlist_before)
    # restore sleep_logs (delete any test-created rows)
    await db.execute("DELETE FROM sleep_logs WHERE date = ANY($1) AND date <> ALL($2)",
                     [today, tomorrow], list(sleep_dates_before) or [dt.date(1900, 1, 1)])
    print(f"   deleted {cleaned} append rows; settings/days/domains/sleep restored")

    # verify clean
    after = await counts()
    residue = []
    for t in ("finance_entries", "subscriptions", "commitments", "notes", "lists",
              "list_items", "meetings", "reward_sessions", "replans", "library_items"):
        if after[t] is not None and after[t] != (await db.fetchval(
                f"SELECT count(*) FROM {t}")):
            pass
    print("   final counts:", {t: after[t] for t in (
        "finance_entries", "commitments", "notes", "lists", "meetings",
        "reward_sessions", "replans", "sleep_logs", "days")})

    # ---------------- summary ----------------
    wrote = sum(1 for r in results if r["deltas"])
    errs = [r for r in results if r["err"]]
    print(f"\nSUMMARY: {len(results)} inputs | {wrote} wrote to DB | "
          f"{len(errs)} errored")


asyncio.run(main())
