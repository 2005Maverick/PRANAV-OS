"""Capture: anything in -> filed + one-line confirmation of where it went."""
import re
import json
from .. import db, llm

URL_RE = re.compile(r"https?://\S+")

SECTION_PREFIXES = {
    "note:": "note", "note :": "note",
    "idea:": "idea", "idea :": "idea",
    "prompt:": "prompt", "prompt :": "prompt",
    "read:": "reading", "save:": None,  # save: -> classify
}


async def capture_text(raw: str, tg_file_id: str | None = None) -> str:
    """File the item, return the confirmation line for the bot."""
    lower = raw.lower().strip()
    section = None
    body = raw.strip()

    for prefix, sec in SECTION_PREFIXES.items():
        if lower.startswith(prefix):
            section = sec
            body = raw[len(prefix):].strip()
            break

    if section is None and URL_RE.search(raw) and len(raw) < 600:
        section = "reading"

    guess = None
    if section is None:
        from .. import config
        guess = await llm.json_call(
            model=config.LLM_MODEL_LITE,
            prompt=f"Classify this captured item into exactly one section:\n"
            f"note | idea | prompt | reading | file\n"
            f'Also produce a short title (<=8 words) and the domain slug if obvious '
            f"(research|trading|startup|uni|tech|gym|internship, else null).\n"
            f'Item: {raw[:1200]}\n'
            f'JSON: {{"section": "...", "title": "...", "domain": null}}'
        )
        section = (guess or {}).get("section", "note")
        if section not in ("note", "idea", "prompt", "reading", "reel", "file", "meeting"):
            section = "note"

    title = (guess or {}).get("title") if guess else None
    if not title:
        title = body.split("\n")[0][:80] or section
    domain_slug = (guess or {}).get("domain") if guess else None

    domain_id = None
    if domain_slug:
        domain_id = await db.fetchval("SELECT id FROM domains WHERE slug=$1", domain_slug)

    url_m = URL_RE.search(raw)
    item_id = await db.fetchval(
        """INSERT INTO library_items (section, domain_id, title, body, url, tg_file_id, idea_status)
           VALUES ($1,$2,$3,$4,$5,$6, CASE WHEN $1='idea' THEN 'raw' END)
           RETURNING id""",
        section, domain_id, title, body, url_m.group(0) if url_m else None, tg_file_id,
    )
    await db.execute(
        "INSERT INTO inbox_items (raw, tg_file_id, kind_guess, routed_to, routed_id, triaged) "
        "VALUES ($1,$2,$3,$4,$5,TRUE)",
        raw[:2000], tg_file_id, section, "library", item_id,
    )

    nice = {"note": "Notes", "idea": "Ideas", "prompt": "Prompt vault", "reading": "Reading queue",
            "reel": "Reels", "file": "Files", "meeting": "Meetings"}[section]
    extra = " — it'll resurface in your reading slot" if section == "reading" else ""
    return f"Saved → {nice}: “{title}”{extra}."


async def capture_media(kind: str, tg_file_id: str, caption: str | None) -> str:
    """Voice/photo/video/document captures."""
    section = "reel" if kind == "video" else "file"
    title = (caption or f"{kind} capture").split("\n")[0][:80]
    item_id = await db.fetchval(
        "INSERT INTO library_items (section, title, body, tg_file_id) VALUES ($1,$2,$3,$4) RETURNING id",
        section, title, caption, tg_file_id,
    )
    await db.execute(
        "INSERT INTO inbox_items (raw, tg_file_id, kind_guess, routed_to, routed_id, triaged) "
        "VALUES ($1,$2,$3,'library',$4,TRUE)",
        caption or kind, tg_file_id, section, item_id,
    )
    nice = "Reels" if section == "reel" else "Files"
    return f"Saved → {nice}: “{title}”."
