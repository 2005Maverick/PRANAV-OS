"""Arcs — long-horizon goals that come in four shapes, on one spine.

A Goal (arc) has a `type`:
  project  — ordered timed steps; progress = time done / time planned
  umbrella — holds sub-goals (child arcs) + steps; progress rolls up
  target   — a number climbing to a goal by a date; progress = amount / target
  ongoing  — no finish line; measured by rhythm, not percent

Steps come in kinds: 'do' (timed task, extendable), 'keep' (recurring, no done),
'checkpoint' (a gate, maybe waiting-on-someone, no time). Sub-goals are child arcs
(parent_id), not steps. Target goals are fed by contributions.
"""
import datetime as dt

from .. import db, config

STEP_KINDS = ("do", "keep", "checkpoint")
ARC_TYPES = ("project", "umbrella", "target", "ongoing")


async def ensure_schema() -> None:
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS arcs (
            id            BIGSERIAL PRIMARY KEY,
            title         TEXT NOT NULL DEFAULT 'Untitled goal',
            type          TEXT NOT NULL DEFAULT 'project',
            domain        TEXT,
            parent_id     BIGINT REFERENCES arcs(id) ON DELETE CASCADE,
            deadline      DATE,
            target_amount NUMERIC,
            target_unit   TEXT DEFAULT '₹',
            note          TEXT,
            status        TEXT NOT NULL DEFAULT 'active',
            sort          INT NOT NULL DEFAULT 0,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """)
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS arc_steps (
            id            BIGSERIAL PRIMARY KEY,
            arc_id        BIGINT NOT NULL REFERENCES arcs(id) ON DELETE CASCADE,
            kind          TEXT NOT NULL DEFAULT 'do',
            title         TEXT NOT NULL DEFAULT '',
            est_minutes   INT NOT NULL DEFAULT 0,
            spent_minutes INT NOT NULL DEFAULT 0,
            done          BOOLEAN NOT NULL DEFAULT FALSE,
            done_at       TIMESTAMPTZ,
            waiting_on    TEXT,
            cadence       TEXT,
            last_done     DATE,
            sort          INT NOT NULL DEFAULT 0,
            created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """)
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS arc_contribs (
            id         BIGSERIAL PRIMARY KEY,
            arc_id     BIGINT NOT NULL REFERENCES arcs(id) ON DELETE CASCADE,
            amount     NUMERIC NOT NULL DEFAULT 0,
            note       TEXT,
            on_date    DATE NOT NULL DEFAULT CURRENT_DATE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """)
    await db.execute("CREATE INDEX IF NOT EXISTS arcs_parent_idx ON arcs (parent_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS arc_steps_arc_idx ON arc_steps (arc_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS arc_contribs_arc_idx ON arc_contribs (arc_id)")


def _today() -> dt.date:
    return dt.datetime.now(config.TZ).date()


# ---------- progress ----------

def _project_progress(steps: list[dict]) -> float | None:
    do = [s for s in steps if s["kind"] == "do"]
    if not do:
        return None
    total = sum(max(s["est_minutes"], 1) for s in do)
    done = sum(max(s["est_minutes"], 1) for s in do if s["done"])
    return round(done / total * 100) if total else 0


def _target_state(arc: dict, contrib_sum: float) -> dict:
    tgt = float(arc["target_amount"] or 0)
    pct = round(min(contrib_sum / tgt, 1) * 100) if tgt else 0
    out = {"amount": contrib_sum, "target": tgt, "unit": arc["target_unit"] or "",
           "pct": pct, "on_pace": None, "need_per_week": None, "at_per_week": None}
    if arc["deadline"] and tgt:
        start = arc["created_at"].date() if hasattr(arc["created_at"], "date") else _today()
        end = arc["deadline"]
        today = _today()
        total_weeks = max((end - start).days / 7, 0.5)
        elapsed_weeks = max((today - start).days / 7, 0.14)
        remaining = max(tgt - contrib_sum, 0)
        weeks_left = max((end - today).days / 7, 0.14)
        out["need_per_week"] = round(remaining / weeks_left)
        out["at_per_week"] = round(contrib_sum / elapsed_weeks)
        out["on_pace"] = out["at_per_week"] >= (tgt / total_weeks) * 0.95
    return out


def _keep_state(steps: list[dict]) -> dict:
    keeps = [s for s in steps if s["kind"] == "keep"]
    today = _today()
    fresh = 0
    for s in keeps:
        if not s["last_done"]:
            continue
        gap = (today - s["last_done"]).days
        limit = 1 if (s["cadence"] or "").startswith("dai") else 7
        if gap <= limit:
            fresh += 1
    return {"total": len(keeps), "on_rhythm": fresh}


# ---------- reads ----------

def _step_row(r) -> dict:
    return {
        "id": r["id"], "kind": r["kind"], "title": r["title"],
        "est_minutes": r["est_minutes"], "spent_minutes": r["spent_minutes"],
        "done": r["done"], "waiting_on": r["waiting_on"],
        "cadence": r["cadence"],
        "last_done": str(r["last_done"]) if r["last_done"] else None,
        "sort": r["sort"],
    }


async def _steps(arc_id: int) -> list[dict]:
    rows = await db.fetch(
        "SELECT * FROM arc_steps WHERE arc_id=$1 ORDER BY sort, id", arc_id)
    return [_step_row(r) for r in rows]


async def _contrib_sum(arc_id: int) -> float:
    v = await db.fetchval("SELECT COALESCE(SUM(amount),0) FROM arc_contribs WHERE arc_id=$1", arc_id)
    return float(v or 0)


async def _arc_node(r, depth: int = 0) -> dict:
    """One arc with its steps, children (recursive), and computed progress."""
    arc = dict(r)
    steps = await _steps(arc["id"])
    child_rows = await db.fetch(
        "SELECT * FROM arcs WHERE parent_id=$1 AND status!='archived' ORDER BY sort, id", arc["id"])
    children = [await _arc_node(cr, depth + 1) for cr in child_rows]

    node = {
        "id": arc["id"], "title": arc["title"], "type": arc["type"],
        "domain": arc["domain"], "deadline": str(arc["deadline"]) if arc["deadline"] else None,
        "note": arc["note"], "status": arc["status"],
        "steps": steps, "children": children,
        "days_left": (arc["deadline"] - _today()).days if arc["deadline"] else None,
    }

    if arc["type"] == "target":
        node["target"] = _target_state(arc, await _contrib_sum(arc["id"]))
        node["progress"] = node["target"]["pct"]
    elif arc["type"] == "ongoing":
        node["rhythm"] = _keep_state(steps)
        node["progress"] = None
    elif arc["type"] == "umbrella":
        parts = [c["progress"] for c in children if c["progress"] is not None]
        own = _project_progress(steps)
        if own is not None:
            parts.append(own)
        done_gates = [s for s in steps if s["kind"] == "checkpoint"]
        if done_gates:
            parts.append(round(sum(1 for s in done_gates if s["done"]) / len(done_gates) * 100))
        node["progress"] = round(sum(parts) / len(parts)) if parts else 0
    else:  # project
        node["progress"] = _project_progress(steps) or 0

    node["rhythm"] = node.get("rhythm") or _keep_state(steps)
    return node


async def tree() -> dict:
    rows = await db.fetch(
        "SELECT * FROM arcs WHERE parent_id IS NULL AND status!='archived' ORDER BY sort, id")
    arcs = [await _arc_node(r) for r in rows]
    return {"arcs": arcs, "today": str(_today())}


async def get_arc(arc_id: int) -> dict | None:
    r = await db.fetchrow("SELECT * FROM arcs WHERE id=$1", arc_id)
    if not r:
        return None
    node = await _arc_node(r)
    if r["parent_id"]:
        p = await db.fetchrow("SELECT id, title FROM arcs WHERE id=$1", r["parent_id"])
        node["parent"] = {"id": p["id"], "title": p["title"]} if p else None
    if node["type"] == "target":
        cs = await db.fetch(
            "SELECT id, amount, note, on_date::text FROM arc_contribs WHERE arc_id=$1 ORDER BY on_date DESC, id DESC LIMIT 40",
            arc_id)
        node["contribs"] = [{"id": c["id"], "amount": float(c["amount"]),
                             "note": c["note"], "on_date": c["on_date"]} for c in cs]
    return node


# ---------- writes ----------

async def create_arc(title: str, type_: str = "project", domain: str | None = None,
                     parent_id: int | None = None, deadline: str | None = None,
                     target_amount: float | None = None, target_unit: str | None = None,
                     note: str | None = None) -> int:
    if type_ not in ARC_TYPES:
        type_ = "project"
    dl = dt.date.fromisoformat(deadline) if deadline else None
    return await db.fetchval(
        """INSERT INTO arcs (title, type, domain, parent_id, deadline, target_amount, target_unit, note)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id""",
        (title or "Untitled goal").strip()[:200], type_, domain, parent_id, dl,
        target_amount, target_unit, note)


async def update_arc(arc_id: int, **fields) -> bool:
    allowed = {"title", "type", "domain", "deadline", "target_amount",
               "target_unit", "note", "status"}
    sets, args = [], []
    for k, v in fields.items():
        if k not in allowed or v is None:
            continue
        if k == "deadline":
            v = dt.date.fromisoformat(v) if v else None
        args.append(v)
        sets.append(f"{k}=${len(args)}")
    if not sets:
        return False
    args.append(arc_id)
    await db.execute(
        f"UPDATE arcs SET {', '.join(sets)}, updated_at=now() WHERE id=${len(args)}", *args)
    return True


async def delete_arc(arc_id: int) -> bool:
    res = await db.execute("DELETE FROM arcs WHERE id=$1", arc_id)
    return res.endswith("1")


async def add_step(arc_id: int, kind: str, title: str, est_minutes: int = 0,
                   waiting_on: str | None = None, cadence: str | None = None) -> int:
    if kind not in STEP_KINDS:
        kind = "do"
    nxt = await db.fetchval(
        "SELECT COALESCE(MAX(sort),-1)+1 FROM arc_steps WHERE arc_id=$1", arc_id)
    return await db.fetchval(
        """INSERT INTO arc_steps (arc_id, kind, title, est_minutes, waiting_on, cadence, sort)
           VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id""",
        arc_id, kind, (title or "").strip()[:200], max(est_minutes, 0), waiting_on, cadence, nxt)


async def update_step(step_id: int, **fields) -> bool:
    allowed = {"title", "est_minutes", "spent_minutes", "done", "waiting_on",
               "cadence", "last_done"}
    sets, args = [], []
    for k, v in fields.items():
        if k not in allowed or v is None:
            continue
        if k == "last_done":
            v = dt.date.fromisoformat(v) if v else None
        args.append(v)
        sets.append(f"{k}=${len(args)}")
        if k == "done":
            sets.append("done_at = " + ("now()" if v else "NULL"))
    if not sets:
        return False
    args.append(step_id)
    await db.execute(f"UPDATE arc_steps SET {', '.join(sets)} WHERE id=${len(args)}", *args)
    return True


async def log_time(step_id: int, minutes: int, mark_done: bool = False) -> bool:
    await db.execute(
        "UPDATE arc_steps SET spent_minutes = spent_minutes + $2 WHERE id=$1", step_id, max(minutes, 0))
    if mark_done:
        await db.execute("UPDATE arc_steps SET done=TRUE, done_at=now() WHERE id=$1", step_id)
    return True


async def tick_keep(step_id: int) -> bool:
    await db.execute("UPDATE arc_steps SET last_done=$2 WHERE id=$1", step_id, _today())
    return True


async def delete_step(step_id: int) -> bool:
    res = await db.execute("DELETE FROM arc_steps WHERE id=$1", step_id)
    return res.endswith("1")


async def add_contrib(arc_id: int, amount: float, note: str | None = None,
                      on_date: str | None = None) -> int:
    d = dt.date.fromisoformat(on_date) if on_date else _today()
    return await db.fetchval(
        "INSERT INTO arc_contribs (arc_id, amount, note, on_date) VALUES ($1,$2,$3,$4) RETURNING id",
        arc_id, amount, note, d)
