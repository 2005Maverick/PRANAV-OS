# Pranav OS

Personal operating system: an external executive that plans, replans, captures,
hounds, and remembers — bot-first (Telegram), cockpit-second (web).

Design docs (the contract for everything built here):
- Design proposal: https://claude.ai/code/artifact/c0a57735-8c54-497f-92fb-3549f1e0618c
- Field manual (flows + features + build order): https://claude.ai/code/artifact/40227d48-bd77-4a9b-b04e-c7fefcd24026

## Structure
- `server/` — FastAPI + python-telegram-bot + APScheduler + Postgres. The brain.
  - `schema.sql` — full DB (designed once; covers all 12 cockpit pages + 10 bot flows)
- `web/` — React/Vite cockpit (ink `#0B0C0A` · bone `#F2EFE9` · acid `#C8FF00`,
  domain planes, grotesque UI + serif voice + mono instruments)
- `docs/` — decisions, deploy notes

## Build order (spine → vertical slices)
1. Spine: schema ✓, config, LLM client (LiteLLM gateway), bot skeleton, scheduler
2. Slice 1 — heartbeat (bot only): capture, evening plan, morning brief, block pings, replan
3. Slice 2 — Today page + design tokens
4. Slice 3 — protocols: wake gate, check-ins, close-outs, floors, Netflix pre-commit, sleep engine
5. Slice 4 — Week, Wall, Review (shared composition renderer)
6. Slice 5 — Arcs, Library, Lists, Finance, Vault, Sleep page, Talk, Rules

## Runtime requirements
- Must run 24/7 for nudges (laptop-only = broken system). Target host: TBD.
- Secrets via `.env` (never committed): TELEGRAM_BOT_TOKEN, DATABASE_URL,
  LITELLM_BASE_URL, LITELLM_API_KEY, VAULT_KEY.
