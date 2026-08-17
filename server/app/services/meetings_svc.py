"""Meeting mode: start -> collect notes (text/voice transcripts) -> summarize."""
import datetime as dt
import json
import re

from .. import config, db, llm

MEETING_START_RE = re.compile(r"^meeting\s*[:\-]\s*(.+)$", re.I)
MEETING_END_RE = re.compile(r"^(meeting over|end meeting|meeting done)\b", re.I)


async def active_id() -> int | None:
    v = await db.get_setting("meeting_active")
    return int(v) if v else None


async def start(name: str) -> str:
    lib_id = await db.fetchval(
        "INSERT INTO library_items (section, title, body) VALUES ('meeting',$1,'') RETURNING id",
        f"Meeting — {name}"[:120])
    mid = await db.fetchval(
        "INSERT INTO meetings (library_id, name) VALUES ($1,$2) RETURNING id", lib_id, name[:120])
    await db.set_setting("meeting_active", str(mid))
    return f"Notes on for “{name}”. Talk, voice-note, or paste as it happens. Say `meeting over` when done."


async def note(text: str) -> str:
    mid = await active_id()
    if not mid:
        return "No meeting running."
    lib = await db.fetchval("SELECT library_id FROM meetings WHERE id=$1", mid)
    stamp = dt.datetime.now(config.TZ).strftime("%H:%M")
    await db.execute(
        "UPDATE library_items SET body = COALESCE(body,'') || $2 WHERE id=$1",
        lib, f"[{stamp}] {text}\n")
    return "noted."


async def end() -> str:
    mid = await active_id()
    if not mid:
        return "No meeting running."
    row = await db.fetchrow(
        "SELECT m.id, m.name, m.library_id, li.body FROM meetings m "
        "JOIN library_items li ON li.id=m.library_id WHERE m.id=$1", mid)
    await db.set_setting("meeting_active", "")
    notes = row["body"] or "(no notes captured)"
    parsed = await llm.json_call(
        "Summarize this meeting and extract action items. mine=true for items Pranav "
        "must do himself. Keep the summary under 6 lines.\n"
        f"MEETING: {row['name']}\nNOTES:\n{notes[:6000]}\n"
        'JSON: {"summary":"...","actions":[{"text":"...","mine":true}]}')
    summary = (parsed or {}).get("summary", "Summary unavailable — raw notes kept.")
    actions = (parsed or {}).get("actions", [])
    await db.execute(
        "UPDATE meetings SET ended_at=now(), summary=$2, action_items=$3 WHERE id=$1",
        mid, summary, json.dumps(actions))
    mine = [a for a in actions if a.get("mine")]
    for a in mine:
        await db.execute(
            "INSERT INTO commitments (title, status) VALUES ($1,'open')",
            f"[{row['name']}] {a['text']}"[:200])
    lines = [f"Meeting closed — “{row['name']}”.", "", summary]
    if mine:
        lines.append("")
        lines.append(f"Your action items ({len(mine)}) — queued for planning:")
        lines += [f"• {a['text']}" for a in mine]
    return "\n".join(lines)
