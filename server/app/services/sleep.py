"""Sleep engine — the math behind the ledger.

`sleeping` (bot) logs slept_at. Wake is detected when the protocol completes
or the day is confirmed. Debt = rolling 7-day sum of (target - actual),
clamped to [-6h, +3h]. Tonight's close target moves earlier when debt is deep.
"""
import datetime as dt

from .. import config, db

DEFAULT_TARGET_H = 7.5


def _now() -> dt.datetime:
    return dt.datetime.now(config.TZ)


async def _target_hours() -> float:
    v = await db.get_setting("sleep_target_hours")
    return float(v) if v else DEFAULT_TARGET_H


async def on_wake() -> dict | None:
    """Idempotent: first call of the morning computes hours + rolling debt."""
    date = _now().date()
    row = await db.fetchrow("SELECT * FROM sleep_logs WHERE date=$1", date)
    if not row or row["slept_at"] is None or row["woke_at"] is not None:
        return None
    woke = _now()
    hours = round((woke - row["slept_at"].astimezone(config.TZ)).total_seconds() / 3600, 2)
    if not (0 < hours < 16):
        hours = None
    target = await _target_hours()
    week = await db.fetch(
        "SELECT hours FROM sleep_logs WHERE date >= $1 AND date < $2 AND hours IS NOT NULL",
        date - dt.timedelta(days=6), date)
    debt = sum(target - float(r["hours"]) for r in week)
    if hours:
        debt += target - hours
    debt = max(min(round(-debt, 2), 3.0), -6.0)  # negative = owed sleep
    await db.execute(
        "UPDATE sleep_logs SET woke_at=$2, hours=$3, debt_after=$4 WHERE date=$1",
        date, woke, hours, debt)
    # tonight's close target: usual sleep, pulled earlier when debt is deep
    usual_sleep = await db.get_setting("usual_sleep") or "00:30"
    close = dt.datetime.combine(date, dt.time.fromisoformat(usual_sleep))
    if debt <= -3.0:
        close -= dt.timedelta(minutes=60)
    elif debt <= -1.5:
        close -= dt.timedelta(minutes=30)
    await db.execute(
        "UPDATE days SET close_target=$2 WHERE date=$1", date, close.time())
    note = None
    if hours and hours < 6:
        note = f"{hours:.1f}h last night — I've reserved a 20-min nap slot idea for the afternoon and close moves to {close:%H:%M}."
    return {"hours": hours, "debt": debt, "close": close.strftime("%H:%M"), "note": note}


async def log_night(hours: float, date: dt.date | None = None) -> dict:
    """Manual entry from the cockpit — upsert the night and recompute rolling debt."""
    date = date or _now().date()
    target = await _target_hours()
    exists = await db.fetchrow("SELECT 1 FROM sleep_logs WHERE date=$1", date)
    if exists:
        await db.execute("UPDATE sleep_logs SET hours=$2 WHERE date=$1", date, hours)
    else:
        await db.execute("INSERT INTO sleep_logs (date, hours) VALUES ($1,$2)", date, hours)
    week = await db.fetch(
        "SELECT hours FROM sleep_logs WHERE date >= $1 AND date <= $2 AND hours IS NOT NULL",
        date - dt.timedelta(days=6), date)
    debt = sum(target - float(r["hours"]) for r in week)
    debt = max(min(round(-debt, 2), 3.0), -6.0)  # negative = owed sleep
    await db.execute("UPDATE sleep_logs SET debt_after=$2 WHERE date=$1", date, debt)
    return {"hours": hours, "debt": debt}


async def record_protocol_run(done: int, total: int) -> dict:
    """Tonight's wind-down tally from the cockpit checklist."""
    date = _now().date()
    completed = total > 0 and done >= total
    exists = await db.fetchrow("SELECT 1 FROM protocol_runs WHERE date=$1", date)
    if exists:
        await db.execute(
            "UPDATE protocol_runs SET steps_done=$2, steps_total=$3, completed=$4 WHERE date=$1",
            date, done, total, completed)
    else:
        await db.execute(
            "INSERT INTO protocol_runs (date, steps_done, steps_total, completed) VALUES ($1,$2,$3,$4)",
            date, done, total, completed)
    return {"completed": completed, "done": done, "total": total}


async def status() -> dict | None:
    """Live numbers for the rail."""
    row = await db.fetchrow(
        "SELECT hours, debt_after FROM sleep_logs WHERE hours IS NOT NULL ORDER BY date DESC LIMIT 1")
    if not row:
        return None
    date = _now().date()
    day = await db.fetchrow("SELECT close_target FROM days WHERE date=$1", date)
    return {
        "hours": float(row["hours"]) if row["hours"] is not None else None,
        "debt": float(row["debt_after"]) if row["debt_after"] is not None else None,
        "close": day["close_target"].strftime("%H:%M") if day and day["close_target"] else None,
    }
