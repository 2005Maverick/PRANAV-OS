# PROGRESS

## Done
- F1 Review room: engine (services/review.py) + /api/review/* + cockpit paper-world page + /review bot
- F2 Lists & deadlines: services/lists_fin.py (add/new/show lists, weekly_day firing, 28/7/2 lead nudges, remind-me parser) + Lists page + tick wiring
- F3 Finance: spent/subscription parsing + /api/finance + Money page
- F4 Voice transcription: services/transcribe.py (Gemini native REST, 3-attempt retry) wired in bot voice handler + meeting notes
- F5 Meeting mode: services/meetings_svc.py (start/note/end -> summary + action_items -> commitments)
- F6 Day-close tile: services/tile.py (Pillow PNG, verified visually) + evening_close sends photo
- F7 Inline buttons: brief confirm/adjust, ping started/+15/skip, callbacks verified through PROD webhook
- F8 Playlists: domains.playlist_url (migrated), 'playlist for X: url' parser, ping/API/NOW-card carry it
- LLM hardening: transient retry + QUOTA LADDER (gemini-3.7-flash free tier = only 20 req/day! ladder falls to 3.5-flash -> 3-flash-preview -> 3.1-flash-lite -> flash-lite-latest)
- Tick armored: engines isolated (one failure can't 500 the heartbeat); fixed date-cast bug in commitments query

## In progress
- F9 Library page + resurfacing engine

## Next
- F10 Arcs, F11 Sleep page + energy logging, F12 Vault (password-derived key), F13 Talk, F14 Rules,
  F15 Week move-dialog + ghost draft, F16 engines wrap (resurface+pattern gen in tick), F17 deploy+fresh-eyes

## Notes
- Evidence flow: run verifier -> write to evidence/*.txt -> Read it (tracker logs) -> flip CRITERIA
- Harness hooks resolve project root from SESSION cwd (Desktop) -> marker Desktop/test-results.json
  activates tracking (remove at end of run + noted in final report)
- verify scripts in server/scripts/verify_*.py; all seed AND clean their own TEST rows in Neon (prod DB!)
- Windows TTS for speech fixtures: PowerShell System.Speech -> evidence/tts-sample.wav
- Test callback sent 1 visible msg to Pranav's chat ("Go. I'm quiet...") — explain in final report
- gemini-3.7-flash daily quota may be exhausted on heavy build days; ladder handles it
- Bash tool cwd currently repo root; server venv: server/.venv/Scripts/python.exe
