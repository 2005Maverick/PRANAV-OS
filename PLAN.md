# Pranav OS — Completion Plan (Master Protocol run, 2026-08-17)

## Final restatement
Complete Pranav OS to 100% of the locked spec: 12 cockpit pages full-capability,
10 bot flows complete, remaining engines live. Purpose (never forget): an
external executive that makes Pranav consistent — plans/replans, captures,
hounds with reason, remembers everything. Friction down, never dashboard-ware.

## Interview outcomes (2026-08-17)
1. Voice→Gemini transcription: YES
2. Vault: PASSWORD-PROTECTED — key derived from Pranav's password (scrypt),
   server stores salt+verifier only; decrypt only in cockpit after password
   entry; bot returns pointers only (secrets never in chat history)
3. Week move-block dialog instead of drag: YES (drag deferred)
4. Day-close composition tile as PNG (Pillow server-side): YES
5. Playlists etc. personal inputs: provided by Pranav AFTER completion —
   build mechanisms, defaults empty
6. Build order: Review → Lists+Deadlines+Finance → Voice+Meeting →
   Tile+Buttons → Library → Arcs → Sleep → Vault → Talk → Rules → Week/Wall
   extras. Capability over polish.

## Architecture (established, unchanged)
- server/: FastAPI + python-telegram-bot (webhook) + Neon PG + Gemini 3-tier
  (lite=classify, flash=daily, pro=deep). Cloud: Render + cron-job.org tick.
- web/: React/Vite cockpit, locked design system (ink/verdigris/pigment cards,
  Geist Sans/Mono + Instrument Serif). Elastic-time layouts.
- All new engines must be tick-driven + idempotent (webhook world, free tier).

## Key decisions this run
- Review = cockpit guided flow + bot /review conversational twin. Weekly data
  primitives (pattern proposals, ignored-nudge audit) computed server-side.
- Resurfacing = tick job: reading items get resurface_at; surfaced via bot at
  slot time; Library page shows queue order.
- Energy learning = on block done/skip, log energy_observations(hour, kind);
  Sleep page renders topology; planner prompt already consumes peaks setting.
- Deadline nudges = tick job over commitments.lead_days.
- Playlist mechanism = domains.playlist_url column + "playlist for <domain>: url".
- Conflict flags = /api/move validates overlap vs fixed blocks before applying.
- Vault crypto: scrypt(password, salt) -> AES-GCM key. POST /api/vault/unlock
  returns decrypted entries (no key persisted server-side beyond request).

## Risks
- Context-window resets: PROGRESS.md is the handoff; verify state before resuming.
- Render free-tier cold starts during verification: retry once before judging.
- Gemini JSON drift: all json_call sites parse defensively (existing pattern).

## Assumptions ledger
- A1: Sunday review timing default Sun 18:00 IST (editable later via Rules).
- A2: Reading slot default Sat 10:00 IST (editable via Rules/settings).
- A3: Finance currency INR, no paise precision needed in summaries.
- A4: Vault password set on first use via cockpit (not bot).
- A5: Meeting mode ends via "meeting over" or auto after 3h.
- A6: Monthly review = same flow + finance/arcs extras, triggered 1st of month.
