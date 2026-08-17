"""F4/F5 verification: real-speech transcription + meeting mode end-to-end."""
import asyncio
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from app import db  # noqa: E402
from app.services import meetings_svc, transcribe  # noqa: E402

WAV = os.path.join(os.path.dirname(__file__), "..", "..", "evidence", "tts-sample.wav")


async def main():
    await db.init_pool()

    # F4: transcribe real generated speech
    audio = open(WAV, "rb").read()
    txt = await transcribe.transcribe(audio, "audio/wav")
    print("transcript:", txt)
    ok = txt and ("newsletter" in txt.lower() or "audio" in txt.lower())
    print("F4 speech recognized:", bool(ok))

    # F5: meeting lifecycle
    print("start:", await meetings_svc.start("TESTMTG sync"))
    print("note1:", await meetings_svc.note("client wants the heat map filter by Friday"))
    print("note2:", await meetings_svc.note("I must send the access list to their analyst"))
    endtxt = await meetings_svc.end()
    print("end:", endtxt.replace("\n", " / ")[:300])
    row = await db.fetchrow(
        "SELECT summary, action_items FROM meetings WHERE name='TESTMTG sync' ORDER BY id DESC LIMIT 1")
    print("db summary set:", bool(row and row["summary"]))
    print("db actions:", (row["action_items"] or "[]")[:200] if row else None)
    cms = await db.fetch("SELECT title FROM commitments WHERE title LIKE '%TESTMTG%'")
    print("commitments created:", len(cms))

    # cleanup
    await db.execute("DELETE FROM commitments WHERE title LIKE '%TESTMTG%'")
    await db.execute("DELETE FROM meetings WHERE name='TESTMTG sync'")
    await db.execute("DELETE FROM library_items WHERE title LIKE '%TESTMTG%'")
    print("cleanup done")


asyncio.run(main())
