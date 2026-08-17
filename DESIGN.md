# DESIGN.md — Pranav OS Redesign (Master Redesign Protocol run, 2026-08-18)

## Phase 0 — outcomes
Wholesale redesign; concepts sacred (day-as-composition, floors-not-streaks, NOW
instrument, labeled gaps, Review-as-different-room), skin replaced entirely.
Mood: **precise · expensive · calm · serious · mine · user-optimized**.
References standing: Neoconda (conviction), Mondrian tribute (rigor),
RenderVision (editorial confidence). Judgment screen: TODAY.
Workflow: one page → Pranav reviews → "perfect" → next page.
Banned by Pranav on top of the slop list: clutter, small text, dead space.

## Phase 1 — audit of the current design (diagnosis)
- Sits inside a known AI cluster-rut: near-black + one electric accent (verdigris).
- No type scale: 19 ad-hoc font sizes (9–44px, many <12px). Violates his own
  "small text" ban.
- No spacing scale: 9/11/14/18/22/26/36… off-grid everywhere.
- Radius zoo: 2,4,5,6,7,8,9,10,11,12,16.
- States incomplete: fetch failures leave infinite "connecting"; no skeletons;
  empty states thin; focus states default-browser.
- What works (keep): IA (12 sheets + rail), elastic time, labeled gaps,
  NOW instrument, demo mode, key gate, paper-Review concept.

## Phase 3 — Direction

**MECHANISM** — The system *drafts* your day from your life's domains, holds you
to the drawing, and marks every change: plans bend visibly, days archive into a
flat-file of sheets.

**THE RUT** — productivity dashboards ship near-black + neon + mono glow
(we were wearing it); the tasteful opposite is warm-cream serif journaling.
Both excluded, plus all AI cluster-looks.

**CANDIDATE WORLDS**
1. Architect's working drawing set (sections, dimension lines, title blocks,
   revision clouds, redline markups) — planning IS drafting; changes ARE revisions.
2. JR-East night wayfinding (domain = line color, day = line diagram) — glanceable, calm.
3. Trader's private ledger (baize green, gilt rules, oldstyle figures) — expensive, bookish.
4. Observatory logbook / ephemeris tables — nocturnal, tabular; too passive.
5. Flight-deck paper checklists — protocol culture; too close to instrument-panel rut.

**CHOSEN WORLD — "REDLINE": the architect's night drawing set.**
Not the safest pick (that was JR wayfinding). Fit: this product's verbs are the
drafting room's verbs — draft, revise, dimension, schedule of works, sheet,
archive. His mood words map exactly: plotted precision, expensive paper-and-ink
restraint, calm authority. Night scene honored via *drafting-film blue*, not black.

**THESIS** — Your life, issued as a drawing set: every day is a numbered sheet,
every plan a section, every change a revision. Refuses the glowing dashboard.

**WORLD (recognizable with content removed)** — Deep Prussian drafting-film
ground (never black), ivory hairline linework, a boxed TITLE BLOCK on every
sheet, true dimension lines with end-ticks on empty time, section-hatching on
fixed structure, muted material fills for domains, and exactly one signal:
REDLINE red-orange for now/at-risk/primary. Crisp small radii. No glow ever.

**TYPE** — Display+body: **Archivo** (grotesque with drafting-stencil DNA;
title blocks in 650 caps, letterspaced). Annotation: **IBM Plex Mono** 400/500 —
functional only (times, dimensions, title-block meta), never body. 2 families,
3 weights (400/500/650).

**COLOR STRATEGY — Restrained**: blue-film neutrals + ONE accent (redline).
Domain material fills are *desaturated architectural render chips* (muted,
equal-lightness family) — they are fills of the drawing, not accents; the only
saturated voice is the redline.

**FIRST VIEWPORT (Today)** — a sheet: title block strip (PROJECT · SHEET 01 —
TODAY · DATE · REV/status · the one primary action), below it the day drawn as
a dimensioned section with the NOW redline cutting through. An hour later you
remember: "my day was an architectural drawing with a red line through now."

**SIGNATURE MOMENT (one per sheet)** — Today: the NOW redline + revision-marked
blocks (moved/sacrificed get the drafting change-mark). Everything else quiet.

## Phase 4 — Token spec (the mathematics)

TYPE (base 16, ratio 1.2, whole px): 12 caption-annotation · 13 small-annotation
· 16 body · 19 lg · 23 xl · 28 2xl · 33 3xl · 40 display.
UI text floor 14 → interface strings use ≥14 (13/12 reserved for mono
annotations & captions only). Line-height: body 1.5, headings 1.15–1.25.
Letter-spacing: display −0.015em; caps labels +0.08em; body 0.

SPACING: 4 8 12 16 24 32 48 64 96. Proximity: within-group = half between-group
(label→control 8, control→control 24; heading closer to its text than to prior section).

LAYOUT: 12-col, 24px gutters; sheet max 1280; rail 360; split ≈ 62/38;
card padding 16/24; section padding 48–64 (app density).

COLOR (OKLCH; raw values live once, in :root palette layer):
film-900 oklch(0.17 0.030 252) page ground
film-800 oklch(0.20 0.032 252) sheet surface
film-700 oklch(0.24 0.032 250) raised
line-600 oklch(0.34 0.025 250) border strong
line-700 oklch(0.28 0.022 250) border faint
ivory     oklch(0.93 0.012 95) text-primary (ink of the plot)
ivory-mut oklch(0.68 0.015 95) text-muted
ivory-fnt oklch(0.50 0.012 250) text-faint (annotations)
redline   oklch(0.62 0.185 32) accent lines/large text (≥19px)
redline-t oklch(0.74 0.150 32) accent small text (4.5:1 on film)
ok        oklch(0.72 0.10 150) success · warn oklch(0.78 0.12 85) · danger = redline
Materials (equal-L chips, C≈0.07–0.10): brick 0.56/35 · copper 0.60/60 ·
ochre 0.63/85 · sage 0.58/150 · slateblu 0.56/250 · plum 0.56/320 ·
graphite 0.52/255 (C 0.02) · felt 0.45/145 (C 0.03, reward).
Distribution ≈ 60 ground / 30 surface-line / 10 accent.

RADIUS family: 2 (chips/inputs) · 4 (buttons/cells) · 8 (cards/panels) ·
12 (modals). inner = outer − padding.

ELEVATION: 3 tokens, blue-tinted (never black), light from top:
e1 0 1px 2px oklch(0.10 0.03 252 /.5); e2 = e1 + 0 4px 12px /.35;
e3 = e2 + 0 12px 32px /.3. Dark elevation primarily via surface lightening.

MOTION: 150ms small / 220ms medium / 320ms large; ease-out in, ease-in out;
transform/opacity only (signature may use clip-path); prefers-reduced-motion
kills all non-essential motion.

## Phase 5 — Wireframe: SHEET 01 · TODAY
Zones (top→bottom, left→right):
1. TITLE BLOCK (full-width strip, boxed cells): [PROJECT: PRANAV OS] [SHEET 01 —
   TODAY] [DATE] [STATUS cell: DRAFT/CONFIRMED/CLOSED] [PRIMARY ACTION: "Arm the
   day" (only when draft; the single dominant control)] [sheet nav 01–04 + index]
2. LEFT 62% — THE SECTION: elastic-time drawing; hour annotations left (mono 12);
   blocks = material-filled rooms (title 16/500, time mono 13 right); fixed
   structure = section hatch; gaps = true dimension lines "|— 1H 30M —|";
   NOW = 2px redline + red tag; done rooms recede (opacity), sacrificed/moved
   carry the revision mark. Signature lives here only.
3. RIGHT 38% — SCHEDULE OF WORKS (rail): CURRENT WORK card (room material,
   countdown mono 28, next-action 16 italic-less), NEXT row, SLEEP row (human
   words), WEEK MINIMUMS (name 14 + n/n mono + tick-bar), ROUTINE row,
   SITE NOTE capture (input + hint; C summons).
4. States: loading = drawing-in skeleton lines; error = plain-language banner +
   retry; empty = teaching sheet ("No drawing issued for today") + real CTA to
   the bot; key gate styled as sheet stamp.
Reading path: title block → NOW → schedule. Squint: redline + title block survive.
Max 4 type sizes on screen. One primary action.

## Decisions
- Legacy pages keep working during the page-by-page pass via alias tokens
  (old var names → new palette) until each sheet is rebuilt. One-line: migration
  without breakage.
- Verdigris, Geist, Instrument Serif retired. Fonts self-hosted via fontsource.
- Old feature-harness CRITERIA.json (18/18 passed) archived by git history;
  file now carries the redesign contract.

## Assumptions ledger
- A1 Dark scene stands (1–3 AM usage) — realized as blue film, not black.
- A2 Bot voice/identity untouched this run (cockpit only) except day-tile PNG
  restyle when we reach Wall (to match sheets).
- A3 "user optimized" = fewer, larger, calmer elements; glance-first; his two
  bans (small text, clutter) enforced by the 14px UI floor and spacing scale.
- A4 Demo mode remains the design-review harness.
