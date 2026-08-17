"""Onboarding interview — /onboard walks the 7 required inputs, one at a time.
Answers are parsed by the LLM into structured writes; everything is editable
later by just telling the bot."""
import datetime as dt
import json

from .. import db, llm

QUESTIONS = [
    ("protocol",
     "1/7 · Your WAKE PROTOCOL — the exact series you do first thing, in order, "
     "comma-separated. Example: `water, freshen up, 10 pushups, 5 min sunlight, sit at desk`"),
    ("sleep",
     "2/7 · SLEEP REALITY — usual sleep time and wake time. Example: `sleep 2:00, wake 8:30`"),
    ("timetable",
     "3/7 · CLASS TIMETABLE — weekly classes as day + time + name. "
     "Example: `Tue 11-13 DBMS, Wed 9:30-11 ML, Thu 11-13 DBMS`. Say `none` if none."),
    ("masters",
     "4/7 · MASTERS CLOCK — target month & year to submit applications. Example: `Feb 2027`"),
    ("checkin",
     "5/7 · CHECK-INS — how often should I ask what you're doing in loose time (minutes), "
     "and what tone moves you: blunt / firm / light. Example: `45, blunt`"),
    ("floors",
     "6/7 · FLOORS — current: research 3×90m/wk · trading 5×60m/wk · startup 4 ship-steps/wk · "
     "tech 5×35m/wk · gym ramp daily. Adjust any (e.g. `trading 6 days, tech 30 min`) or say `ok`."),
    ("energy",
     "7/7 · ENERGY — when are you genuinely sharpest for deep work? Example: `22:00-01:00, and 11-13 decent`"),
]

DOW = {"mon": 0, "tue": 1, "wed": 2, "thu": 3, "fri": 4, "sat": 5, "sun": 6}


async def start() -> str:
    await db.set_setting("onboard_idx", "0")
    return ("Onboarding — 7 questions, ~5 minutes, everything editable later.\n\n"
            + QUESTIONS[0][1] + "\n\n(`skip` to skip a question, `stop` to exit)")


async def active() -> bool:
    v = await db.get_setting("onboard_idx")
    return v is not None and v != ""


async def handle(text: str) -> str:
    idx = int(await db.get_setting("onboard_idx") or 0)
    low = text.strip().lower()
    if low == "stop":
        await db.set_setting("onboard_idx", "")
        return "Paused. `/onboard` resumes anytime."
    if low != "skip":
        key = QUESTIONS[idx][0]
        try:
            note = await _apply(key, text)
        except Exception:
            note = "Couldn't parse that — noted raw, we'll fix it later."
            await db.execute(
                "INSERT INTO library_items (section, title, body) VALUES ('note',$1,$2)",
                f"onboarding: {key} (unparsed)", text)
    else:
        note = "Skipped."
    idx += 1
    if idx >= len(QUESTIONS):
        await db.set_setting("onboard_idx", "")
        return (f"{note}\n\nOnboarding complete. The system is now running on your life:\n"
                "• wake protocol arms tomorrow morning (brief unlocks after it)\n"
                "• classes land as fixed blocks automatically\n"
                "• the masters countdown is live on the cockpit\n"
                "Tonight's close will draft tomorrow with all of it. /today anytime.")
    return f"{note}\n\n{QUESTIONS[idx][1]}"


async def _apply(key: str, text: str) -> str:
    if key == "protocol":
        steps = [s.strip() for s in text.split(",") if s.strip()]
        if not steps:
            raise ValueError
        await db.execute("UPDATE protocol_steps SET active=FALSE WHERE active")
        for i, s in enumerate(steps):
            await db.execute(
                "INSERT INTO protocol_steps (sort, text, essential) VALUES ($1,$2,$3)",
                i, s[:120], i < 2)
        return f"Protocol locked: {len(steps)} steps. It gates tomorrow's brief."

    if key == "sleep":
        parsed = await llm.json_call(
            f'Parse sleep/wake times from: "{text}". 24h HH:MM. '
            'JSON: {"sleep":"HH:MM","wake":"HH:MM"}')
        await db.set_setting("usual_sleep", parsed["sleep"])
        await db.set_setting("usual_wake", parsed["wake"])
        return f"Sleep {parsed['sleep']} → wake {parsed['wake']} as the baseline. The ledger adapts nightly."

    if key == "timetable":
        if text.strip().lower() in ("none", "no", "nil"):
            return "No fixed classes."
        parsed = await llm.json_call(
            f'Parse a weekly class timetable from: "{text}". dow: mon..sun. 24h times. '
            'JSON: {"classes":[{"dow":"tue","start":"11:00","end":"13:00","title":"DBMS"}]}')
        uni = await db.fetchval("SELECT id FROM domains WHERE slug='uni'")
        n = 0
        for c in parsed.get("classes", []):
            d = DOW.get(str(c.get("dow", "")).lower()[:3])
            if d is None:
                continue
            await db.execute(
                "INSERT INTO recurring_blocks (dow, title, domain_id, start_t, end_t) VALUES ($1,$2,$3,$4,$5)",
                d, f"Class — {c.get('title', '?')}"[:80], uni,
                dt.time.fromisoformat(c["start"]), dt.time.fromisoformat(c["end"]))
            n += 1
        return f"{n} weekly classes registered — they'll appear as fixed blocks."

    if key == "masters":
        parsed = await llm.json_call(
            f'Parse a target month/year from: "{text}". '
            'JSON: {"date":"YYYY-MM-01"}')
        await db.set_setting("masters_date", parsed["date"])
        days = (dt.date.fromisoformat(parsed["date"]) - dt.date.today()).days
        return f"Masters clock set: {days} days. It's on the cockpit rail now."

    if key == "checkin":
        parsed = await llm.json_call(
            f'Parse check-in minutes (int) and tone (blunt|firm|light) from: "{text}". '
            'JSON: {"minutes":45,"tone":"blunt"}')
        await db.set_setting("checkin_minutes", str(parsed.get("minutes", 45)))
        await db.set_setting("nudge_tone", parsed.get("tone", "firm"))
        return f"Check-ins every {parsed.get('minutes')} min in loose time, tone: {parsed.get('tone')}."

    if key == "floors":
        if text.strip().lower() in ("ok", "okay", "fine", "yes"):
            return "Floors confirmed as-is."
        parsed = await llm.json_call(
            f'Parse floor adjustments from: "{text}". Slugs: research|trading|startup|tech|gym. '
            'JSON: {"floors":[{"slug":"trading","target":6,"minutes":60}]}')
        n = 0
        for f in parsed.get("floors", []):
            await db.execute(
                """UPDATE domains SET floor_target=COALESCE($2,floor_target),
                   floor_minutes=COALESCE($3,floor_minutes) WHERE slug=$1""",
                f.get("slug"), f.get("target"), f.get("minutes"))
            n += 1
        return f"{n} floors adjusted."

    if key == "energy":
        await db.set_setting("energy_peaks", text.strip()[:300])
        await db.execute(
            "INSERT INTO rules (kind, rule_text, source) VALUES ('preference',$1,'explicit')",
            f"Deep work scheduled in his stated peaks: {text.strip()[:200]}")
        return "Energy map stored — the planner schedules hard work inside it."

    raise ValueError(key)
