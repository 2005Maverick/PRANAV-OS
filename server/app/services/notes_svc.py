"""The Library vault — full markdown notes with [[wikilinks]].

Storage is portable markdown (``body_md``). Links live as plain ``[[Title]]``
inside the text; we mirror them into ``note_links`` on every save so backlinks,
"related", and the graph are cheap reads. Link targets are resolved by *title*
at read time, so renaming a note never rots the links pointing at it.
"""
import re

from .. import db

_LINK_RE = re.compile(r"\[\[([^\[\]\n]{1,120})\]\]")


async def ensure_schema() -> None:
    """Idempotent — safe to call on every boot (Neon has no migration runner)."""
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS notes (
            id         BIGSERIAL PRIMARY KEY,
            title      TEXT NOT NULL DEFAULT 'Untitled',
            body_md    TEXT NOT NULL DEFAULT '',
            tags       TEXT[] NOT NULL DEFAULT '{}',
            pinned     BOOLEAN NOT NULL DEFAULT FALSE,
            is_daily   BOOLEAN NOT NULL DEFAULT FALSE,
            daily_date DATE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            search     tsvector GENERATED ALWAYS AS (
                to_tsvector('english',
                    coalesce(title, '') || ' ' || coalesce(body_md, ''))
            ) STORED
        )
        """)
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS note_links (
            source_id    BIGINT NOT NULL REFERENCES notes(id) ON DELETE CASCADE,
            target_title TEXT NOT NULL
        )
        """)
    await db.execute("CREATE INDEX IF NOT EXISTS notes_search_idx ON notes USING GIN (search)")
    await db.execute("CREATE INDEX IF NOT EXISTS notes_updated_idx ON notes (updated_at DESC)")
    await db.execute("CREATE INDEX IF NOT EXISTS note_links_src_idx ON note_links (source_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS note_links_tgt_idx ON note_links (lower(target_title))")


# ---------- helpers ----------

def _excerpt(body_md: str, n: int = 140) -> str:
    """A one-line plain-text preview: strip the loudest markdown, collapse space."""
    text = _LINK_RE.sub(r"\1", body_md or "")
    text = re.sub(r"[#>*_`~\-]+", " ", text)
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", " ", text)
    text = re.sub(r"\s+", " ", text).strip()
    return text[:n]


def _parse_links(body_md: str) -> list[str]:
    seen, out = set(), []
    for m in _LINK_RE.finditer(body_md or ""):
        title = m.group(1).strip()
        key = title.lower()
        if title and key not in seen:
            seen.add(key)
            out.append(title)
    return out


async def _sync_links(note_id: int, body_md: str) -> None:
    await db.execute("DELETE FROM note_links WHERE source_id=$1", note_id)
    for title in _parse_links(body_md):
        await db.execute(
            "INSERT INTO note_links (source_id, target_title) VALUES ($1, $2)", note_id, title)


def _row_to_list_item(r) -> dict:
    tags = list(r["tags"] or [])
    return {
        "id": r["id"],
        "title": r["title"],
        "excerpt": _excerpt(r["body_md"]),
        "tags": tags,
        "tag": tags[0] if tags else None,
        "pinned": r["pinned"],
        "is_daily": r["is_daily"],
        "updated": r["updated_at"].isoformat(),
    }


# ---------- reads ----------

async def list_notes(q: str | None = None) -> dict:
    if q:
        rows = await db.fetch(
            """SELECT id, title, body_md, tags, pinned, is_daily, updated_at
               FROM notes
               WHERE search @@ websearch_to_tsquery('english', $1)
                  OR title ILIKE '%' || $1 || '%'
               ORDER BY pinned DESC, updated_at DESC LIMIT 200""", q)
    else:
        rows = await db.fetch(
            """SELECT id, title, body_md, tags, pinned, is_daily, updated_at
               FROM notes ORDER BY pinned DESC, updated_at DESC LIMIT 200""")
    return {
        "notes": [_row_to_list_item(r) for r in rows],
        "count": await db.fetchval("SELECT COUNT(*) FROM notes"),
    }


async def get_note(note_id: int) -> dict | None:
    r = await db.fetchrow(
        """SELECT id, title, body_md, tags, pinned, is_daily, daily_date,
                  created_at, updated_at
           FROM notes WHERE id=$1""", note_id)
    if not r:
        return None
    tags = list(r["tags"] or [])
    # mentioned in: notes that link to THIS note's title
    mentioned = await db.fetch(
        """SELECT DISTINCT src.id, src.title, src.tags
           FROM note_links l JOIN notes src ON src.id=l.source_id
           WHERE lower(l.target_title)=lower($1) AND src.id <> $2
           ORDER BY src.title LIMIT 20""", r["title"], note_id)
    # related: shares at least one tag, not already a backlink
    back_ids = {m["id"] for m in mentioned}
    related = []
    if tags:
        rel_rows = await db.fetch(
            """SELECT id, title, tags FROM notes
               WHERE id <> $1 AND tags && $2::text[]
               ORDER BY updated_at DESC LIMIT 12""", note_id, tags)
        for rr in rel_rows:
            if rr["id"] not in back_ids:
                rtags = list(rr["tags"] or [])
                related.append({"id": rr["id"], "title": rr["title"],
                                "tag": rtags[0] if rtags else None})
    return {
        "id": r["id"], "title": r["title"], "body_md": r["body_md"],
        "tags": tags, "pinned": r["pinned"], "is_daily": r["is_daily"],
        "daily_date": str(r["daily_date"]) if r["daily_date"] else None,
        "created": r["created_at"].isoformat(),
        "updated": r["updated_at"].isoformat(),
        "mentioned_in": [{"id": m["id"], "title": m["title"],
                          "where": (list(m["tags"] or []) or [None])[0]} for m in mentioned],
        "related": related[:6],
    }


async def graph() -> dict:
    nodes = await db.fetch("SELECT id, title, tags FROM notes ORDER BY id")
    edges = await db.fetch(
        """SELECT DISTINCT l.source_id AS source, tgt.id AS target
           FROM note_links l JOIN notes tgt ON lower(tgt.title)=lower(l.target_title)
           WHERE tgt.id <> l.source_id""")
    return {
        "nodes": [{"id": n["id"], "title": n["title"],
                   "tag": (list(n["tags"] or []) or [None])[0]} for n in nodes],
        "edges": [{"source": e["source"], "target": e["target"]} for e in edges],
    }


# ---------- writes ----------

async def create_note(title: str, body_md: str = "", tags: list[str] | None = None,
                      is_daily: bool = False, daily_date=None) -> int:
    title = (title or "Untitled").strip()[:200] or "Untitled"
    note_id = await db.fetchval(
        """INSERT INTO notes (title, body_md, tags, is_daily, daily_date)
           VALUES ($1, $2, $3, $4, $5) RETURNING id""",
        title, body_md or "", tags or [], is_daily, daily_date)
    await _sync_links(note_id, body_md or "")
    return note_id


async def update_note(note_id: int, title: str | None = None,
                      body_md: str | None = None, tags: list[str] | None = None) -> bool:
    existing = await db.fetchrow("SELECT id FROM notes WHERE id=$1", note_id)
    if not existing:
        return False
    await db.execute(
        """UPDATE notes SET
             title   = COALESCE($2, title),
             body_md = COALESCE($3, body_md),
             tags    = COALESCE($4, tags),
             updated_at = now()
           WHERE id=$1""",
        note_id,
        title.strip()[:200] if title is not None else None,
        body_md if body_md is not None else None,
        tags if tags is not None else None)
    if body_md is not None:
        await _sync_links(note_id, body_md)
    return True


async def set_pinned(note_id: int, pinned: bool) -> bool:
    res = await db.execute("UPDATE notes SET pinned=$2 WHERE id=$1", note_id, pinned)
    return res.endswith("1")


async def delete_note(note_id: int) -> bool:
    res = await db.execute("DELETE FROM notes WHERE id=$1", note_id)
    return res.endswith("1")


async def daily_note(date) -> int:
    """Get (or create) today's daily note, so capture always has a home."""
    r = await db.fetchrow("SELECT id FROM notes WHERE is_daily AND daily_date=$1", date)
    if r:
        return r["id"]
    title = date.strftime("Daily · %d %b %Y")
    return await create_note(title, "", ["daily"], is_daily=True, daily_date=date)
