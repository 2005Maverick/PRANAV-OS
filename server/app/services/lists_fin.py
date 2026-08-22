"""Lists (with firing rules), deadline nudges, and finance parsing."""
import datetime as dt
import re

from .. import config, db, llm

SPEND_RE = re.compile(r"^(?:spent|paid)\s+(?:rs\.?\s*|₹\s*)?(\d+(?:\.\d+)?)\s*(?:rs|₹)?\s*(?:on|for)?\s*(.*)$", re.I)
LIST_ADD_RE = re.compile(r"^add\s+(.+?)\s+to\s+(?:the\s+)?(.+?)\s+list$", re.I)
LIST_NEW_RE = re.compile(r"^(?:new|create)\s+list\s+(.+)$", re.I)
LIST_SHOW_RE = re.compile(r"^(?:show|list)\s+(?:the\s+)?(.+?)\s+list$", re.I)
SUB_RE = re.compile(r"^subscription\s+(.+?)\s+(\d+(?:\.\d+)?)\s*(monthly|yearly)?", re.I)


def _now():
    return dt.datetime.now(config.TZ)


# ------------------------------------------------------------------ finance
async def try_finance(text: str) -> str | None:
    m = SPEND_RE.match(text.strip())
    if m:
        amount = float(m.group(1))
        note = (m.group(2) or "").strip() or "unspecified"
        cat = await llm.json_call(
            f'Categorize this expense into one word from: food|transport|subscriptions|shopping|health|education|fun|other. Expense: "{note}". JSON: {{"category":"..."}}',
            model=config.LLM_MODEL_LITE)
        category = (cat or {}).get("category", "other")
        if category not in ("food", "transport", "subscriptions", "shopping", "health", "education", "fun", "other"):
            category = "other"
        # Write into the SAME store the Money cockpit reads (money_txns), so a
        # spend captured from the terminal shows up on the Money sheet.
        from . import money_svc
        acct = await money_svc.default_account_id()
        await money_svc.add_txn(acct, "expense", amount, category=category, note=note[:200])
        month_total = await db.fetchval(
            "SELECT COALESCE(SUM(amount),0) FROM money_txns "
            "WHERE kind='expense' AND date_trunc('month', txn_date) = date_trunc('month', CURRENT_DATE)")
        return f"₹{amount:.0f} → {category}. This month: ₹{float(month_total):.0f}."
    m = SUB_RE.match(text.strip())
    if m:
        from . import money_svc
        name, amt = m.group(1).strip()[:80], float(m.group(2))
        period = (m.group(3) or "monthly").lower()
        acct = await money_svc.default_account_id()
        await money_svc.add_recurring(
            name, "expense", amt, cadence=period, category="subscriptions",
            account_id=acct, day_of_month=_now().day)
        return f"Subscription tracked: {name} ₹{amt:.0f}/{period}. It's on your Money forecast now."
    return None


# ------------------------------------------------------------------ lists
async def try_lists(text: str) -> str | None:
    t = text.strip()
    m = LIST_ADD_RE.match(t)
    if m:
        item, name = m.group(1).strip(), m.group(2).strip().lower()
        lid = await db.fetchval("SELECT id FROM lists WHERE lower(name)=$1", name)
        if lid is None:
            lid = await db.fetchval(
                "INSERT INTO lists (name) VALUES ($1) RETURNING id", name)
        await db.execute("INSERT INTO list_items (list_id, text) VALUES ($1,$2)", lid, item[:200])
        n = await db.fetchval("SELECT COUNT(*) FROM list_items WHERE list_id=$1 AND NOT checked", lid)
        # mirror into Decks so the list is visible on the site (list_items still
        # drives weekly list firing); best-effort.
        try:
            from . import decks_svc
            did = await decks_svc.find_or_create_deck(name.title())
            await decks_svc.create_card(did, "note", title=item[:200])
        except Exception:
            pass
        return f"Added to “{name}” — {n} item{'s' if n != 1 else ''} on it. It's a deck on the site."
    m = LIST_NEW_RE.match(t)
    if m:
        name = m.group(1).strip().lower()
        await db.execute("INSERT INTO lists (name) VALUES ($1)", name)
        try:
            from . import decks_svc
            await decks_svc.find_or_create_deck(name.title())
        except Exception:
            pass
        return f"List “{name}” created — it's a deck on the site. Add with: add <thing> to {name} list."
    m = LIST_SHOW_RE.match(t)
    if m:
        name = m.group(1).strip().lower()
        row = await db.fetchrow("SELECT id, name FROM lists WHERE lower(name) LIKE '%'||$1||'%' LIMIT 1", name)
        if not row:
            return f"No list called “{name}”."
        items = await db.fetch(
            "SELECT text, checked FROM list_items WHERE list_id=$1 ORDER BY sort, id", row["id"])
        lines = [f"{'☑' if i['checked'] else '☐'} {i['text']}" for i in items] or ["(empty)"]
        return f"“{row['name']}”:\n" + "\n".join(lines)
    return None


async def fire_lists(send) -> None:
    """Tick: weekly_day lists fire at 09:00 on their day; once per day."""
    n = _now()
    if n.hour < 9:
        return
    dow = n.strftime("%A").lower()
    rows = await db.fetch(
        "SELECT id, name FROM lists WHERE fire_kind='weekly_day' AND lower(fire_param)=$1", dow)
    for r in rows:
        tag = f"[list {r['id']} {n.date()}]"
        already = await db.fetchval(
            "SELECT COUNT(*) FROM nudges WHERE kind='list_fire' AND message LIKE '%'||$1||'%'", tag)
        if already:
            continue
        items = await db.fetch(
            "SELECT text FROM list_items WHERE list_id=$1 AND NOT checked ORDER BY sort, id", r["id"])
        if not items:
            continue
        body = "\n".join(f"☐ {i['text']}" for i in items)
        await send(f"“{r['name']}” — it's the day:\n{body}\n{tag}", kind="list_fire")


# ------------------------------------------------------------------ deadlines
async def fire_deadlines(send) -> None:
    """Tick: commitments with due dates nudge at each lead offset; idempotent."""
    n = _now()
    if n.hour < 9:
        return
    rows = await db.fetch(
        "SELECT id, title, due_date, lead_days FROM commitments WHERE status='open' AND due_date IS NOT NULL")
    for r in rows:
        days_left = (r["due_date"] - n.date()).days
        leads = sorted(set((r["lead_days"] or [28, 7, 2]) + [0]), reverse=True)
        if days_left not in leads:
            continue
        tag = f"[deadline {r['id']} d{days_left}]"
        already = await db.fetchval(
            "SELECT COUNT(*) FROM nudges WHERE kind='deadline' AND message LIKE '%'||$1||'%'", tag)
        if already:
            continue
        when = "TODAY" if days_left == 0 else f"in {days_left} day{'s' if days_left != 1 else ''}"
        await send(f"Deadline {when}: {r['title']} ({r['due_date']:%d %b}). {tag}", kind="deadline")


REMIND_RE = re.compile(r"^remind me\s+(?:about\s+|to\s+)?(.+?)\s+(?:by|on|before)\s+(.+)$", re.I)


async def try_reminder(text: str) -> str | None:
    m = REMIND_RE.match(text.strip())
    if not m:
        return None
    title, when = m.group(1).strip(), m.group(2).strip()
    parsed = await llm.json_call(
        f'Today is {_now().date().isoformat()}. Parse the date "{when}" into ISO. JSON: {{"date":"YYYY-MM-DD"}}',
        model=config.LLM_MODEL_LITE)
    try:
        due = dt.date.fromisoformat((parsed or {}).get("date", ""))
    except ValueError:
        return "Couldn't read that date — try `remind me X by 30 Sep`."
    await db.execute(
        "INSERT INTO commitments (title, due_date) VALUES ($1,$2)", title[:200], due)
    days = (due - _now().date()).days
    return f"Locked: “{title}” — {due:%d %b} ({days}d). I'll nudge at 28/7/2 days out and on the day."
