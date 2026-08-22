"""Decks — a personal library of saved cards, grouped into user-made decks.

A deck is a named collection ("Prompts", "X links", "References"…). A card is
one saved thing with a kind: 'prompt' / 'note' (text you paste back out),
'link' (a URL), or 'image' (an uploaded picture, stored as bytes). Everything is
full-text searchable across every deck (Postgres tsvector).
"""
from .. import db

CARD_KINDS = ("prompt", "note", "link", "image")


async def ensure_schema() -> None:
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS decks (
            id         BIGSERIAL PRIMARY KEY,
            name       TEXT NOT NULL DEFAULT 'Untitled deck',
            domain     TEXT,
            sort       INT NOT NULL DEFAULT 0,
            created_at TIMESTAMPTZ NOT NULL DEFAULT now()
        )
        """)
    await db.execute(
        """
        CREATE TABLE IF NOT EXISTS deck_cards (
            id         BIGSERIAL PRIMARY KEY,
            deck_id    BIGINT NOT NULL REFERENCES decks(id) ON DELETE CASCADE,
            kind       TEXT NOT NULL DEFAULT 'note',
            title      TEXT NOT NULL DEFAULT '',
            body       TEXT NOT NULL DEFAULT '',
            url        TEXT,
            image_mime TEXT,
            image_data BYTEA,
            tags       TEXT[] NOT NULL DEFAULT '{}',
            created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
            search     tsvector GENERATED ALWAYS AS (
                to_tsvector('english',
                    coalesce(title,'') || ' ' || coalesce(body,'') || ' ' || coalesce(url,''))
            ) STORED
        )
        """)
    await db.execute("CREATE INDEX IF NOT EXISTS deck_cards_deck_idx ON deck_cards (deck_id)")
    await db.execute("CREATE INDEX IF NOT EXISTS deck_cards_search_idx ON deck_cards USING GIN (search)")
    await db.execute("CREATE INDEX IF NOT EXISTS deck_cards_updated_idx ON deck_cards (updated_at DESC)")


# ---------- decks ----------

async def list_decks() -> list[dict]:
    rows = await db.fetch(
        """SELECT d.id, d.name, d.domain,
                  (SELECT COUNT(*) FROM deck_cards c WHERE c.deck_id=d.id) AS n
           FROM decks d ORDER BY d.sort, d.id""")
    return [{"id": r["id"], "name": r["name"], "domain": r["domain"], "count": r["n"]} for r in rows]


async def find_or_create_deck(name: str, domain: str | None = None) -> int:
    """Get the deck named `name` (case-insensitive), creating it if absent.
    Lets bot captures auto-file into a stable set of decks."""
    await ensure_schema()
    did = await db.fetchval("SELECT id FROM decks WHERE lower(name)=lower($1) LIMIT 1", name)
    return did or await create_deck(name, domain)


async def create_deck(name: str, domain: str | None = None) -> int:
    nxt = await db.fetchval("SELECT COALESCE(MAX(sort),-1)+1 FROM decks")
    return await db.fetchval(
        "INSERT INTO decks (name, domain, sort) VALUES ($1,$2,$3) RETURNING id",
        (name or "Untitled deck").strip()[:120], domain, nxt)


async def rename_deck(deck_id: int, name: str, domain: str | None = None) -> bool:
    await db.execute(
        "UPDATE decks SET name=$2, domain=COALESCE($3,domain) WHERE id=$1",
        deck_id, (name or "").strip()[:120], domain)
    return True


async def delete_deck(deck_id: int) -> bool:
    res = await db.execute("DELETE FROM decks WHERE id=$1", deck_id)
    return res.endswith("1")


# ---------- cards ----------

def _card_row(r, include_body: bool = True) -> dict:
    out = {
        "id": r["id"], "deck_id": r["deck_id"], "kind": r["kind"],
        "title": r["title"], "url": r["url"],
        "tags": list(r["tags"] or []),
        "has_image": r["image_mime"] is not None,
        "updated": r["updated_at"].isoformat(),
    }
    if include_body:
        out["body"] = r["body"]
    else:
        b = r["body"] or ""
        out["excerpt"] = (b[:180] + "…") if len(b) > 180 else b
    return out


async def list_cards(deck_id: int | None, q: str | None) -> list[dict]:
    where, args = [], []
    if deck_id:
        args.append(deck_id)
        where.append(f"deck_id=${len(args)}")
    if q:
        args.append(q)
        where.append(
            f"(search @@ websearch_to_tsquery('english', ${len(args)}) "
            f"OR title ILIKE '%' || ${len(args)} || '%')")
    clause = (" WHERE " + " AND ".join(where)) if where else ""
    rows = await db.fetch(
        f"""SELECT id, deck_id, kind, title, body, url, image_mime, tags, updated_at
            FROM deck_cards{clause}
            ORDER BY updated_at DESC LIMIT 300""", *args)
    return [_card_row(r, include_body=False) for r in rows]


async def get_card(card_id: int) -> dict | None:
    r = await db.fetchrow(
        "SELECT id, deck_id, kind, title, body, url, image_mime, tags, updated_at FROM deck_cards WHERE id=$1",
        card_id)
    return _card_row(r, include_body=True) if r else None


async def create_card(deck_id: int, kind: str, title: str = "", body: str = "",
                      url: str | None = None, tags: list[str] | None = None) -> int:
    if kind not in CARD_KINDS:
        kind = "note"
    return await db.fetchval(
        """INSERT INTO deck_cards (deck_id, kind, title, body, url, tags)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id""",
        deck_id, kind, (title or "").strip()[:300], body or "", url, tags or [])


async def create_image_card(deck_id: int, title: str, mime: str, data: bytes,
                            tags: list[str] | None = None) -> int:
    return await db.fetchval(
        """INSERT INTO deck_cards (deck_id, kind, title, image_mime, image_data, tags)
           VALUES ($1,'image',$2,$3,$4,$5) RETURNING id""",
        deck_id, (title or "image").strip()[:300], mime, data, tags or [])


async def update_card(card_id: int, **fields) -> bool:
    allowed = {"deck_id", "title", "body", "url", "tags"}
    sets, args = [], []
    for k, v in fields.items():
        if k not in allowed or v is None:
            continue
        args.append(v)
        sets.append(f"{k}=${len(args)}")
    if not sets:
        return False
    args.append(card_id)
    await db.execute(
        f"UPDATE deck_cards SET {', '.join(sets)}, updated_at=now() WHERE id=${len(args)}", *args)
    return True


async def delete_card(card_id: int) -> bool:
    res = await db.execute("DELETE FROM deck_cards WHERE id=$1", card_id)
    return res.endswith("1")


async def card_image(card_id: int) -> tuple[str, bytes] | None:
    r = await db.fetchrow("SELECT image_mime, image_data FROM deck_cards WHERE id=$1", card_id)
    if not r or r["image_data"] is None:
        return None
    return r["image_mime"] or "application/octet-stream", bytes(r["image_data"])
