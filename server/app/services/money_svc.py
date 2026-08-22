"""Money — a real ledger. Accounts + double-sided transactions, budgets with
status, recurring bills + a cash-flow forecast, and savings goals that read
straight from the Arcs 'target' goals (one source of truth, not two).
"""
import datetime as dt

from .. import config, db

TXN_KINDS = ("income", "expense", "transfer")


def _today() -> dt.date:
    return dt.datetime.now(config.TZ).date()


def _month(d: dt.date) -> str:
    return d.strftime("%Y-%m")


async def ensure_schema() -> None:
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS money_accounts (
            id              BIGSERIAL PRIMARY KEY,
            name            TEXT NOT NULL DEFAULT 'Account',
            type            TEXT NOT NULL DEFAULT 'bank',
            opening_balance NUMERIC NOT NULL DEFAULT 0,
            sort            INT NOT NULL DEFAULT 0,
            created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """)
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS money_txns (
            id                  BIGSERIAL PRIMARY KEY,
            account_id          BIGINT NOT NULL REFERENCES money_accounts(id) ON DELETE CASCADE,
            kind                TEXT NOT NULL DEFAULT 'expense',
            amount              NUMERIC NOT NULL DEFAULT 0,
            category            TEXT,
            payee               TEXT,
            note                TEXT,
            txn_date            DATE NOT NULL DEFAULT CURRENT_DATE,
            transfer_account_id BIGINT REFERENCES money_accounts(id) ON DELETE SET NULL,
            created_at          TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """)
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS money_budgets (
            id       BIGSERIAL PRIMARY KEY,
            category TEXT NOT NULL,
            month    TEXT NOT NULL,
            amount   NUMERIC NOT NULL DEFAULT 0,
            UNIQUE (category, month)
        )
        """)
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS money_recurring (
            id           BIGSERIAL PRIMARY KEY,
            name         TEXT NOT NULL DEFAULT 'Bill',
            kind         TEXT NOT NULL DEFAULT 'expense',
            amount       NUMERIC NOT NULL DEFAULT 0,
            category     TEXT,
            account_id   BIGINT REFERENCES money_accounts(id) ON DELETE SET NULL,
            cadence      TEXT NOT NULL DEFAULT 'monthly',
            day_of_month INT,
            next_due     DATE,
            active       BOOLEAN NOT NULL DEFAULT TRUE
        )
        """)
    await db.execute("CREATE INDEX IF NOT EXISTS money_txns_acct_idx ON money_txns (account_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS money_txns_date_idx ON money_txns (txn_date DESC)")


# ---------- balances ----------

async def _account_balances() -> dict[int, float]:
    """opening + income − expense + transfers-in − transfers-out, per account."""
    rows = await db.fetch("SELECT id, opening_balance FROM money_accounts")
    bal = {r["id"]: float(r["opening_balance"]) for r in rows}
    txns = await db.fetch(
        "SELECT account_id, kind, amount, transfer_account_id FROM money_txns")
    for t in txns:
        amt = float(t["amount"])
        acc = t["account_id"]
        if t["kind"] == "income":
            bal[acc] = bal.get(acc, 0) + amt
        elif t["kind"] == "expense":
            bal[acc] = bal.get(acc, 0) - amt
        elif t["kind"] == "transfer":
            bal[acc] = bal.get(acc, 0) - amt
            if t["transfer_account_id"] in bal:
                bal[t["transfer_account_id"]] += amt
    return bal


async def accounts() -> list[dict]:
    rows = await db.fetch("SELECT id, name, type, opening_balance, sort FROM money_accounts ORDER BY sort, id")
    bal = await _account_balances()
    return [{"id": r["id"], "name": r["name"], "type": r["type"],
             "opening": float(r["opening_balance"]), "balance": round(bal.get(r["id"], 0), 2)}
            for r in rows]


# ---------- transactions ----------

def _txn_row(r) -> dict:
    return {
        "id": r["id"], "account_id": r["account_id"], "kind": r["kind"],
        "amount": float(r["amount"]), "category": r["category"], "payee": r["payee"],
        "note": r["note"], "date": str(r["txn_date"]),
        "transfer_account_id": r["transfer_account_id"],
    }


async def txns(account_id: int | None = None, month: str | None = None,
               q: str | None = None, limit: int = 200) -> list[dict]:
    where, args = [], []
    if account_id:
        args.append(account_id)
        where.append(f"account_id=${len(args)}")
    if month:
        args.append(month)
        where.append(f"to_char(txn_date,'YYYY-MM')=${len(args)}")
    if q:
        args.append(f"%{q}%")
        where.append(f"(payee ILIKE ${len(args)} OR category ILIKE ${len(args)} OR note ILIKE ${len(args)})")
    args.append(limit)
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    rows = await db.fetch(
        f"""SELECT id, account_id, kind, amount, category, payee, note, txn_date, transfer_account_id
            FROM money_txns{clause} ORDER BY txn_date DESC, id DESC LIMIT ${len(args)}""", *args)
    return [_txn_row(r) for r in rows]


async def default_account_id() -> int:
    """The account bot-captured spends land in. Resolution order: the
    `money_default_account` setting (if it still points at a real account) →
    the first account by sort → else auto-create a Cash wallet. Guarantees a
    valid account_id so terminal captures never fail the NOT NULL / FK."""
    await ensure_schema()
    pref = await db.get_setting("money_default_account")
    if pref:
        try:
            exists = await db.fetchval("SELECT id FROM money_accounts WHERE id=$1", int(pref))
        except (ValueError, TypeError):
            exists = None
        if exists:
            return int(exists)
    first = await db.fetchval("SELECT id FROM money_accounts ORDER BY sort, id LIMIT 1")
    if first:
        return int(first)
    return await add_account("Cash", "cash", 0)


async def add_txn(account_id: int, kind: str, amount: float, category: str | None = None,
                  payee: str | None = None, note: str | None = None, date: str | None = None,
                  transfer_account_id: int | None = None) -> int:
    if kind not in TXN_KINDS:
        kind = "expense"
    d = dt.date.fromisoformat(date) if date else _today()
    return await db.fetchval(
        """INSERT INTO money_txns (account_id, kind, amount, category, payee, note, txn_date, transfer_account_id)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id""",
        account_id, kind, abs(amount), category, payee, note, d, transfer_account_id)


async def update_txn(txn_id: int, **fields) -> bool:
    allowed = {"account_id", "kind", "amount", "category", "payee", "note", "transfer_account_id"}
    sets, args = [], []
    for k, v in fields.items():
        if k not in allowed or v is None:
            continue
        if k == "amount":
            v = abs(float(v))
        args.append(v)
        sets.append(f"{k}=${len(args)}")
    if "date" in fields and fields["date"]:
        args.append(dt.date.fromisoformat(fields["date"]))
        sets.append(f"txn_date=${len(args)}")
    if not sets:
        return False
    args.append(txn_id)
    await db.execute(f"UPDATE money_txns SET {', '.join(sets)} WHERE id=${len(args)}", *args)
    return True


async def delete_txn(txn_id: int) -> bool:
    res = await db.execute("DELETE FROM money_txns WHERE id=$1", txn_id)
    return res.endswith("1")


async def add_account(name: str, type_: str = "bank", opening: float = 0) -> int:
    nxt = await db.fetchval("SELECT COALESCE(MAX(sort),-1)+1 FROM money_accounts")
    return await db.fetchval(
        "INSERT INTO money_accounts (name, type, opening_balance, sort) VALUES ($1,$2,$3,$4) RETURNING id",
        (name or "Account").strip()[:80], type_, opening, nxt)


async def update_account(account_id: int, name: str | None = None, type_: str | None = None,
                         opening: float | None = None) -> bool:
    await db.execute(
        """UPDATE money_accounts SET name=COALESCE($2,name), type=COALESCE($3,type),
               opening_balance=COALESCE($4,opening_balance) WHERE id=$1""",
        account_id, name, type_, opening)
    return True


async def delete_account(account_id: int) -> bool:
    res = await db.execute("DELETE FROM money_accounts WHERE id=$1", account_id)
    return res.endswith("1")


# ---------- budgets ----------

async def budget_status(month: str | None = None) -> list[dict]:
    month = month or _month(_today())
    budgets = await db.fetch("SELECT category, amount FROM money_budgets WHERE month=$1 ORDER BY category", month)
    out = []
    for b in budgets:
        spent = await db.fetchval(
            """SELECT COALESCE(SUM(amount),0) FROM money_txns
               WHERE kind='expense' AND category=$1 AND to_char(txn_date,'YYYY-MM')=$2""",
            b["category"], month)
        spent = float(spent)
        amt = float(b["amount"])
        out.append({"category": b["category"], "budget": amt, "spent": round(spent, 2),
                    "left": round(amt - spent, 2), "over": spent > amt,
                    "pct": round(min(spent / amt, 1) * 100) if amt else 0})
    return out


async def set_budget(category: str, month: str, amount: float) -> bool:
    await db.execute(
        """INSERT INTO money_budgets (category, month, amount) VALUES ($1,$2,$3)
           ON CONFLICT (category, month) DO UPDATE SET amount=EXCLUDED.amount""",
        category.strip()[:80], month, amount)
    return True


async def delete_budget(category: str, month: str) -> bool:
    res = await db.execute("DELETE FROM money_budgets WHERE category=$1 AND month=$2", category, month)
    return res.endswith("1")


# ---------- recurring + forecast ----------

def _recur_row(r) -> dict:
    return {"id": r["id"], "name": r["name"], "kind": r["kind"], "amount": float(r["amount"]),
            "category": r["category"], "account_id": r["account_id"], "cadence": r["cadence"],
            "day_of_month": r["day_of_month"],
            "next_due": str(r["next_due"]) if r["next_due"] else None, "active": r["active"]}


async def recurring() -> list[dict]:
    rows = await db.fetch("SELECT * FROM money_recurring WHERE active ORDER BY next_due NULLS LAST, id")
    return [_recur_row(r) for r in rows]


async def add_recurring(name: str, kind: str, amount: float, cadence: str = "monthly",
                        category: str | None = None, account_id: int | None = None,
                        day_of_month: int | None = None, next_due: str | None = None) -> int:
    nd = dt.date.fromisoformat(next_due) if next_due else None
    if nd is None and day_of_month:
        t = _today()
        try:
            nd = t.replace(day=day_of_month)
            if nd < t:
                nd = (nd.replace(day=1) + dt.timedelta(days=32)).replace(day=day_of_month)
        except ValueError:
            nd = None
    return await db.fetchval(
        """INSERT INTO money_recurring (name, kind, amount, category, account_id, cadence, day_of_month, next_due)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id""",
        (name or "Bill").strip()[:120], kind if kind in ("income", "expense") else "expense",
        amount, category, account_id, cadence, day_of_month, nd)


async def delete_recurring(rec_id: int) -> bool:
    res = await db.execute("DELETE FROM money_recurring WHERE id=$1", rec_id)
    return res.endswith("1")


async def post_recurring(rec_id: int) -> int | None:
    """Materialise a due recurring bill into a real transaction and roll next_due forward."""
    r = await db.fetchrow("SELECT * FROM money_recurring WHERE id=$1", rec_id)
    if not r or not r["account_id"]:
        return None
    tid = await add_txn(r["account_id"], r["kind"], float(r["amount"]), r["category"],
                        r["name"], "recurring", str(r["next_due"] or _today()))
    base = r["next_due"] or _today()
    nxt = (base.replace(day=1) + dt.timedelta(days=32)).replace(
        day=min(r["day_of_month"] or base.day, 28)) if r["cadence"] == "monthly" \
        else base + dt.timedelta(days=7)
    await db.execute("UPDATE money_recurring SET next_due=$2 WHERE id=$1", rec_id, nxt)
    return tid


async def forecast(days: int = 30) -> dict:
    """Upcoming bills within the window + projected net balance."""
    horizon = _today() + dt.timedelta(days=days)
    recs = await db.fetch(
        "SELECT * FROM money_recurring WHERE active AND next_due IS NOT NULL AND next_due <= $1 ORDER BY next_due",
        horizon)
    upcoming = [{**_recur_row(r), "in_days": (r["next_due"] - _today()).days} for r in recs]
    bal = await _account_balances()
    net = round(sum(bal.values()), 2)
    delta = sum((float(r["amount"]) if r["kind"] == "income" else -float(r["amount"])) for r in recs)
    return {"net_now": net, "projected": round(net + delta, 2),
            "window_days": days, "upcoming": upcoming}


# ---------- goals (read from Arcs targets) ----------

async def goals() -> list[dict]:
    rows = await db.fetch(
        """SELECT a.id, a.title, a.target_amount, a.target_unit, a.deadline::text,
                  COALESCE((SELECT SUM(amount) FROM arc_contribs c WHERE c.arc_id=a.id),0) AS saved
           FROM arcs a WHERE a.type='target' AND a.status='active' ORDER BY a.deadline NULLS LAST""")
    out = []
    for r in rows:
        tgt = float(r["target_amount"] or 0)
        saved = float(r["saved"])
        out.append({"id": r["id"], "title": r["title"], "target": tgt,
                    "unit": r["target_unit"] or "", "saved": saved,
                    "deadline": r["deadline"],
                    "pct": round(min(saved / tgt, 1) * 100) if tgt else 0})
    return out


# ---------- the dashboard ----------

async def dashboard() -> dict:
    accs = await accounts()
    month = _month(_today())
    spent = await db.fetchval(
        "SELECT COALESCE(SUM(amount),0) FROM money_txns WHERE kind='expense' AND to_char(txn_date,'YYYY-MM')=$1", month)
    earned = await db.fetchval(
        "SELECT COALESCE(SUM(amount),0) FROM money_txns WHERE kind='income' AND to_char(txn_date,'YYYY-MM')=$1", month)
    return {
        "accounts": accs,
        "net_worth": round(sum(a["balance"] for a in accs), 2),
        "month": month,
        "spent_month": round(float(spent), 2),
        "earned_month": round(float(earned), 2),
        "recent": await txns(limit=12),
        "budgets": await budget_status(month),
        "forecast": await forecast(30),
        "goals": await goals(),
    }
