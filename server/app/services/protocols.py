"""Behavioral protocols: wake gate, interval check-ins, reward pre-commit,
skip escalation. All tick-driven and idempotent."""
import datetime as dt
import re

from .. import config, db

EP_MIN = 45  # one episode ≈ 45 min


def now():
    return dt.datetime.now(config.TZ)


# ------------------------------------------------------------- wake gate
async def protocol_active() -> bool:
    return bool(await db.fetchval("SELECT COUNT(*) FROM protocol_steps WHERE active"))


async def gate_brief(send) -> bool:
    """If a wake protocol exists and today's run is incomplete, drive it and
    hold the brief. Returns True when the brief must wait."""
    if not await protocol_active():
        return False
    date = now().date()
    run = await db.fetchrow("SELECT * FROM protocol_runs WHERE date=$1", date)
    total = await db.fetchval("SELECT COUNT(*) FROM protocol_steps WHERE active")
    if run is None:
        await db.execute(
            "INSERT INTO protocol_runs (date, steps_total) VALUES ($1,$2)", date, total)
        step = await db.fetchrow(
            "SELECT text FROM protocol_steps WHERE active ORDER BY sort LIMIT 1")
        await send(f"Wake protocol — step 1/{total}: {step['text']}\nReply `done` to advance. The brief unlocks after.")
        return True
    if run["completed"]:
        return False
    return True  # mid-protocol: brief waits, advancement happens via `done`


async def protocol_advance(send) -> str | None:
    """Handle a `done` during an incomplete protocol. Returns reply or None
    if no protocol is pending."""
    date = now().date()
    run = await db.fetchrow("SELECT * FROM protocol_runs WHERE date=$1", date)
    if not run or run["completed"]:
        return None
    done = run["steps_done"] + 1
    if done >= run["steps_total"]:
        await db.execute(
            "UPDATE protocol_runs SET steps_done=$2, completed=TRUE, completed_at=now() WHERE date=$1",
            date, done)
        return "__PROTOCOL_COMPLETE__"
    await db.execute("UPDATE protocol_runs SET steps_done=$2 WHERE date=$1", date, done)
    step = await db.fetchrow(
        "SELECT text FROM protocol_steps WHERE active ORDER BY sort OFFSET $1 LIMIT 1", done)
    total = run["steps_total"]
    return f"Step {done + 1}/{total}: {step['text']}"


# ------------------------------------------------------------- check-ins
async def maybe_checkin(send):
    """During loose, awake time: ask what he's doing every N minutes."""
    n = now()
    interval = int(await db.get_setting("checkin_minutes") or 45)
    start_s = await db.get_setting("checkin_start") or "10:00"
    end_s = await db.get_setting("checkin_end") or "23:00"
    if not (dt.time.fromisoformat(start_s) <= n.time() <= dt.time.fromisoformat(end_s)):
        return
    day = await db.fetchrow("SELECT id, status FROM days WHERE date=$1", n.date())
    if not day or day["status"] != "confirmed":
        return
    in_block = await db.fetchval(
        """SELECT COUNT(*) FROM blocks WHERE day_id=$1 AND status IN ('started','planned')
           AND start_at <= $2 AND end_at > $2""", day["id"], n)
    if in_block:
        return
    # quiet if anything happened recently (his message or any nudge)
    last_nudge = await db.fetchval("SELECT MAX(sent_at) FROM nudges")
    last_msg = await db.fetchval(
        "SELECT MAX(created_at) FROM chat_messages WHERE surface='bot'")
    latest = max([t for t in (last_nudge, last_msg) if t], default=None)
    if latest and (n - latest.astimezone(config.TZ)).total_seconds() < interval * 60:
        return
    await send("What are you doing right now? One word is enough.", kind="checkin")


# ------------------------------------------------------------- rewards
REWARD_RE = re.compile(r"^(netflix|watching|eating|yt|youtube|scrolling time)\b", re.I)
COMMIT_RE = re.compile(r"(\d+)\s*(ep|episode|episodes|min|minutes|m|h|hour|hours)?", re.I)


async def reward_start(text: str) -> str:
    kind = "netflix" if "netflix" in text.lower() else "reward"
    await db.set_setting("pending_reward", kind)
    return "How much? Commit now while it's easy — e.g. `2 ep` or `40 min`."


async def reward_commit(text: str) -> str | None:
    pending = await db.get_setting("pending_reward")
    if not pending:
        return None
    m = COMMIT_RE.search(text)
    if not m:
        return "Give me a number: `2 ep` or `40 min`."
    qty = int(m.group(1))
    unit = (m.group(2) or "ep").lower()
    minutes = qty * 60 if unit.startswith("h") else qty * EP_MIN if unit.startswith("e") else qty
    await db.execute(
        "INSERT INTO reward_sessions (kind, committed, committed_min) VALUES ($1,$2,$3)",
        pending, text.strip()[:60], minutes)
    await db.set_setting("pending_reward", "")
    until = (now() + dt.timedelta(minutes=minutes)).strftime("%H:%M")
    return f"Locked: {qty} {unit} ≈ until {until}. It's in the plan now, not stolen time. Enjoy it properly — I'll check in."


async def maybe_reward_checkin(send):
    n = now()
    rows = await db.fetch(
        """SELECT id, committed, committed_min, started_at FROM reward_sessions
           WHERE checkin_at IS NULL AND started_at + (committed_min || ' minutes')::interval <= $1""", n)
    for r in rows:
        await db.execute("UPDATE reward_sessions SET checkin_at=$2 WHERE id=$1", r["id"], n)
        nxt = await db.fetchrow(
            """SELECT b.title, b.start_at FROM blocks b JOIN days d ON d.id=b.day_id
               WHERE d.date=$1 AND b.start_at > $2 AND b.status='planned'
               ORDER BY b.start_at LIMIT 1""", n.date(), n)
        cost = f" Next up: {nxt['title']} at {nxt['start_at'].astimezone(config.TZ):%H:%M}." if nxt else ""
        await send(
            f"That's your committed {r['committed']}.{cost}\n"
            "Reply `done` to close it — or name what one more costs you.", kind="reward_checkin")


async def reward_close() -> str | None:
    open_s = await db.fetchrow(
        "SELECT id FROM reward_sessions WHERE checkin_at IS NOT NULL AND outcome IS NULL ORDER BY id DESC LIMIT 1")
    if not open_s:
        return None
    await db.execute("UPDATE reward_sessions SET outcome='stopped' WHERE id=$1", open_s["id"])
    return "Closed. That's the whole game — deciding at commit time, not at minute 90."


# ------------------------------------------------------------- escalation
async def maybe_escalate(send):
    """Pinged blocks with no response: gentle at 10 min, firm at 25."""
    n = now()
    rows = await db.fetch(
        """SELECT nu.id AS nid, nu.sent_at, b.id AS bid, b.title, d2.name AS domain_name
           FROM nudges nu JOIN blocks b ON b.id=nu.block_id
           LEFT JOIN domains d2 ON d2.id=b.domain_id
           WHERE nu.kind='block_start' AND nu.response IS NULL AND b.status='planned'
             AND b.end_at > $1""", n)
    for r in rows:
        age = (n - r["sent_at"].astimezone(config.TZ)).total_seconds() / 60
        esc1 = await db.fetchval(
            "SELECT COUNT(*) FROM nudges WHERE block_id=$1 AND kind='escalation1'", r["bid"])
        esc2 = await db.fetchval(
            "SELECT COUNT(*) FROM nudges WHERE block_id=$1 AND kind='escalation2'", r["bid"])
        why = f" You protected this for {r['domain_name']}." if r["domain_name"] else ""
        if age >= 25 and not esc2:
            await send(
                f"{r['title']} is still waiting.{why} One sentence: `skip <why>` or `replan: <what changed>` — silence isn't one of the options.",
                kind="escalation2", block_id=r["bid"])
        elif age >= 10 and not esc1:
            await send(
                f"Still in for {r['title']}?{why} `started` when you're in — or tell me what's in the way.",
                kind="escalation1", block_id=r["bid"])
