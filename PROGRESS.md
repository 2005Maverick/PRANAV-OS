# PROGRESS

## Done
- (this run) Harness created: PLAN.md, CRITERIA.json (17 criteria, all failing), PROGRESS.md
- (prior sessions) Deployed heartbeat: bot @Pranav_os_bot on Render webhook + Neon + cron tick;
  planner/replan/brief/close; protocols (wake gate, escalations, check-ins, rewards);
  /onboard; sleep math; capture; Today/Week/Wall pages complete on locked design system.

## In progress
- F1 Review room (starting)

## Next
- F2 Lists+deadlines, F3 Finance, then per PLAN order

## Notes
- DEV: server venv at server/.venv (Py3.11); web: npm run dev (port 5173); ?demo = mock mode
- PROD: push to main -> Render autodeploys (~2-3 min); verify https://pranav-os.onrender.com/tick?key=9d4b1f8a63e07c25
- DB = Neon (prod AND dev — same DB, be careful with test rows; clean up after verify)
- Owner chat id 1693407101; LLM via LITELLM_* env vars -> Gemini OpenAI-compat
- Windows: beware PowerShell -replace mojibake on unicode — use python or Edit tool for
  files containing em-dashes; write files with explicit utf-8
- Telegram sends from scripts: use bot token from server/.env
- /onboard NOT yet run by Pranav — all personal inputs empty; features must degrade gracefully
