# PROGRESS

## Done (F1–F16 all verified with evidence in evidence/)
- F1 Review room (engine + paper-world page + /review) · F2 Lists+deadlines · F3 Finance
- F4 Voice transcription (Gemini native, verified on real TTS speech) · F5 Meeting mode
- F6 Day-close PNG tile (Pillow, visually verified) · F7 Inline buttons (verified via PROD webhook)
- F8 Per-domain playlists · F9 Library page + resurfacing engine + reading slot + review-ready nudge
- F10 Arcs page · F11 Sleep & Energy page + energy logging in tick
- F12 Password vault (scrypt+AESGCM, round-trip verified, bot pointers-only, reset clean for real setup)
- F13 Talk room + decisions log · F14 Rules page (rules/floors/dials whitelist)
- F15 Move dialog + fixed-conflict flag + force + next-week ghost skeleton
- F16 Tick idempotency verified on prod (double-tick, 0 dupes, engines isolated)
- Infra hardening: LLM quota ladder (3.7-flash 20/day!), transient retries, tick engine isolation,
  two date-cast SQL fixes

## In progress
- F17: prod endpoint sweep running (evidence/f17-prod-sweep.txt) -> fresh-eyes evaluator -> final report

## Next
- After PASS: update KB (non-rig/pranav-os), memory, remove Desktop/test-results.json marker,
  final report to Pranav (incl. stray test messages in his chat + vault reset note + /onboard reminder)

## Notes
- All 12 cockpit pages exist: today/week/wall/review + more▾(library/arcs/sleep/talk/lists/finance/vault/rules)
- All 10 bot flows live; personal inputs (playlists, onboard, vault password) come from Pranav post-completion
- Evidence flow + harness quirks + TZ-fixture gotchas: see git history of this file
