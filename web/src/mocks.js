// Demo-mode data — a lived-in day, week, and wall so design can be judged
// before real history exists. Deterministic (seeded) so every refresh matches.

export const MOCK_TODAY = {
  date: '2026-08-18', now: '15:42', status: 'confirmed',
  energy_note: 'built for 5h40 of sleep — nap repaid at 14:30',
  blocks: [
    { id: 1, title: 'Wake protocol', domain: 'gym', color: '#6E4A72', start: '07:50', end: '08:15', status: 'done', fixed: false, next_action: null },
    { id: 2, title: 'OSINT demo — client run', domain: 'internship', color: '#8C3A2E', start: '09:00', end: '10:30', status: 'done', fixed: true, next_action: null },
    { id: 3, title: 'Class — DBMS', domain: 'uni', color: '#565C66', start: '11:00', end: '13:00', status: 'done', fixed: true, next_action: null },
    { id: 4, title: 'Nap — ledger repayment', domain: 'gym', color: '#6E4A72', start: '14:30', end: '14:50', status: 'done', fixed: false, next_action: null },
    { id: 5, title: 'A* paper — ablations', domain: 'research', color: '#3F6B52', start: '15:30', end: '17:00', status: 'started', fixed: false, next_action: 'run config 3 — you were mid-table yesterday' },
    { id: 6, title: 'Telangana sync', domain: 'internship', color: '#8C3A2E', start: '17:00', end: '18:00', status: 'planned', fixed: true, next_action: null },
    { id: 7, title: 'Trading — module 7', domain: 'trading', color: '#3E5F86', start: '19:00', end: '20:00', status: 'planned', fixed: false, next_action: 're-watch last 5 min of orderflow lecture' },
    { id: 8, title: 'Reward — Netflix, 1 ep committed', domain: null, color: '#3E433C', start: '20:15', end: '21:05', status: 'planned', fixed: false, next_action: null },
    { id: 9, title: 'Startup — ship digest cron', domain: 'startup', color: '#8A6642', start: '21:15', end: '22:00', status: 'planned', fixed: false, next_action: 'deploy the digest cron — 3 steps from launch' },
    { id: 10, title: 'Tech read — RL fine-tuning thread', domain: 'tech', color: '#A5822B', start: '22:05', end: '22:35', status: 'sacrificed', fixed: false, next_action: null },
  ],
}

export const MOCK_RAIL = {
  next_fixed: { title: 'Telangana sync', at: '17:00' },
  sleep: { hours: 5.7, debt: -2.1 },
  floors: [
    { slug: 'tech', name: 'Tech Learning', done: 2, target: 5, ok: false },
    { slug: 'research', name: 'Masters & Research', done: 2, target: 3, ok: false },
    { slug: 'gym', name: 'Gym / Health', done: 5, target: 7, ok: false },
    { slug: 'trading', name: 'Trading', done: 5, target: 5, ok: true },
    { slug: 'startup', name: 'Startup', done: 4, target: 4, ok: true },
  ],
  masters_days: 168,
  protocol: { steps_done: 4, steps_total: 4, completed: true },
}

// ---- seeded generator ------------------------------------------------------
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const D = {
  internship: '#8C3A2E', research: '#3F6B52', trading: '#3E5F86',
  startup: '#8A6642', uni: '#565C66', tech: '#A5822B', gym: '#6E4A72',
}

function hm(mins) {
  const h = Math.floor(mins / 60), m = mins % 60
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`
}

function synthDay(rand, date, isPast) {
  const blocks = []
  let id = 1
  const add = (domain, title, start, len, opts = {}) => {
    const status = isPast
      ? (rand() < 0.72 ? 'done' : rand() < 0.5 ? 'skipped' : 'sacrificed')
      : 'planned'
    blocks.push({
      id: id++, title, domain, color: domain ? D[domain] : '#3E433C',
      start: hm(start), end: hm(start + len), status,
      fixed: !!opts.fixed, next_action: null,
    })
  }
  add('gym', 'Wake protocol', 470 + Math.floor(rand() * 4) * 15, 25)
  if (rand() < 0.8) add('internship', 'Internship block', 540 + Math.floor(rand() * 3) * 30, 90 + Math.floor(rand() * 3) * 30, { fixed: rand() < 0.4 })
  if (rand() < 0.7) add('uni', 'Class', 660 + Math.floor(rand() * 2) * 60, 120, { fixed: true })
  if (rand() < 0.55) add('research', 'A* paper', 930 + Math.floor(rand() * 3) * 30, 90)
  add('trading', 'Trading', 1140 + Math.floor(rand() * 2) * 30, 60)
  if (rand() < 0.6) add('startup', 'Startup ship-step', 1275, 45)
  if (rand() < 0.5) add('tech', 'Tech read', 1330, 30)
  return blocks
}

export function mkWeek() {
  const rand = mulberry32(20260818)
  const names = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
  return names.map((name, i) => ({
    name, date: `${17 + i}`,
    today: i === 1,
    status: i < 1 ? 'closed' : i === 1 ? 'confirmed' : 'draft',
    blocks: synthDay(rand, null, i < 1),
  }))
}

export function mkWall(n = 63) {
  const rand = mulberry32(99)
  const tiles = []
  for (let i = 0; i < n; i++) {
    const day = new Date(2026, 7, 17 - (n - i))
    const missed = rand() < 0.12
    tiles.push({
      date: day.toISOString().slice(0, 10),
      label: String(day.getDate()).padStart(2, '0'),
      month: day.getDate() <= 7 || i === 0 ? day.toLocaleString('en', { month: 'short' }) : null,
      protocol: rand() < 0.74,
      blocks: missed ? [] : synthDay(rand, null, true),
    })
  }
  return tiles
}
