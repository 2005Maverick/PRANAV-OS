// Sleep & Energy data layer — one interface, two implementations.
//   • memory  (demo=true)  — pure client-side store, mirrors the backend maths
//   • fetch   (demo=false) — the live API; X-API-Key is added by App.jsx's fetch wrapper
// Every method returns a Promise so callers are identical in both modes.
//
// Shape the UI consumes:
//   { logs:    [{date, hours, debt_after}],           newest first (~30)
//     topology:[{hour:0-23, deep, shallow, failed}],  energy per hour of day
//     protocol:[{id, sort, text, essential}],         wind-down checklist steps
//     runs:    [{date, completed:bool}],              protocol completion per day
//     correlation: {with:number|null, without:number|null},
//     usual:   {sleep:"HH:MM"|null, wake:"HH:MM"|null} }

const API = import.meta.env.VITE_API || 'https://pranav-os.onrender.com'

/* ---------- date + maths helpers (mirror the backend) ---------- */
const DAY = 86400000
const TARGET = 7.5 // hours per night the ledger measures against
const iso = (d) => d.toISOString().slice(0, 10)
const todayIso = () => iso(new Date())
const addDays = (isoStr, n) => iso(new Date(new Date(isoStr + 'T00:00:00').getTime() + n * DAY))
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

// rolling 7-night sleep debt: sum of (hours − target) over the trailing week,
// clamped to [−6, +3]. Negative = sleep owed, positive = banked.
// Input: raw [{date, hours}] in any order → output newest-first with debt_after.
export function withDebt(rawLogs) {
  const asc = [...rawLogs]
    .filter((l) => l && l.date)
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0))
  const out = asc.map((l, i) => {
    let acc = 0
    for (let j = Math.max(0, i - 6); j <= i; j++) {
      acc += (asc[j].hours || 0) - TARGET
    }
    return { ...l, debt_after: Math.round(clamp(acc, -6, 3) * 10) / 10 }
  })
  return out.reverse() // newest first
}

/* ---------- demo seed ---------- */
function seedTopology() {
  // energy peaks ~10-12 and ~16-18, dips ~14-15 and late night.
  // sharpness = deep*1 + shallow*0.35 − failed*0.8 → the peak lands at 11:00.
  return [
    { hour: 6, deep: 0, shallow: 1, failed: 1 },
    { hour: 7, deep: 1, shallow: 1, failed: 0 },
    { hour: 8, deep: 2, shallow: 2, failed: 0 },
    { hour: 9, deep: 3, shallow: 2, failed: 0 },
    { hour: 10, deep: 5, shallow: 2, failed: 0 },
    { hour: 11, deep: 7, shallow: 2, failed: 0 }, // peak
    { hour: 12, deep: 6, shallow: 1, failed: 1 },
    { hour: 13, deep: 3, shallow: 2, failed: 1 },
    { hour: 14, deep: 1, shallow: 2, failed: 3 }, // afternoon dip
    { hour: 15, deep: 1, shallow: 1, failed: 3 }, // dip
    { hour: 16, deep: 4, shallow: 2, failed: 1 },
    { hour: 17, deep: 5, shallow: 2, failed: 0 },
    { hour: 18, deep: 4, shallow: 3, failed: 1 },
    { hour: 19, deep: 2, shallow: 3, failed: 1 },
    { hour: 20, deep: 2, shallow: 2, failed: 1 },
    { hour: 21, deep: 3, shallow: 1, failed: 2 },
    { hour: 22, deep: 2, shallow: 1, failed: 3 },
    { hour: 23, deep: 1, shallow: 0, failed: 4 }, // late-night die-off
    { hour: 0, deep: 0, shallow: 0, failed: 3 },
    { hour: 1, deep: 0, shallow: 0, failed: 2 },
  ]
}

function seedLogs() {
  const t = todayIso()
  const hrs = [7.4, 6.9, 8.1, 5.9, 6.3, 7.7, 5.2, 6.8, 7.9, 6.1, 7.2, 5.6, 8.0, 6.7]
  // hrs[0] is 14 nights ago … hrs[13] is last night
  return hrs.map((h, i) => ({ date: addDays(t, -(hrs.length - i)), hours: h }))
}

function seedProtocol() {
  return [
    { id: 'p1', sort: 0, text: 'Screens off', essential: true },
    { id: 'p2', sort: 1, text: 'Read 10 pages', essential: true },
    { id: 'p3', sort: 2, text: 'Dim lights', essential: false },
    { id: 'p4', sort: 3, text: "Tomorrow's first block noted", essential: false },
    { id: 'p5', sort: 4, text: 'Stretch', essential: false },
  ]
}

function seedState() {
  const t = todayIso()
  return {
    logs: seedLogs(),
    topology: seedTopology(),
    protocol: seedProtocol(),
    runs: [
      { date: addDays(t, -1), completed: true },
      { date: addDays(t, -2), completed: true },
      { date: addDays(t, -3), completed: false },
      { date: addDays(t, -4), completed: true },
    ],
    correlation: { with: 3.2, without: 1.8 },
    usual: { sleep: '00:30', wake: '08:00' },
  }
}

/* ---------- memory implementation (demo) ---------- */
function createMemoryApi() {
  // internal store keeps logs raw {date, hours}; debt is derived on read
  let state = seedState()
  let seq = 100
  const today = () => todayIso()

  const snapshot = () => ({
    logs: withDebt(state.logs),
    topology: state.topology.map((t) => ({ ...t })),
    protocol: [...state.protocol].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0)).map((p) => ({ ...p })),
    runs: state.runs.map((r) => ({ ...r })),
    correlation: { ...state.correlation },
    usual: { ...state.usual },
  })

  return {
    get() {
      return Promise.resolve(snapshot())
    },
    logNight({ hours, date }) {
      const h = Number(hours)
      if (!Number.isFinite(h) || h < 0 || h > 24) {
        return Promise.reject(new Error('Hours must be between 0 and 24'))
      }
      const d = date || today()
      const others = state.logs.filter((l) => l.date !== d)
      state = { ...state, logs: [...others, { date: d, hours: Math.round(h * 10) / 10 }] }
      const withd = withDebt(state.logs)
      const rec = withd.find((l) => l.date === d)
      return Promise.resolve({ hours: rec.hours, debt: rec.debt_after })
    },
    saveRun({ done, total }) {
      const dn = Math.max(0, Math.round(done || 0))
      const tot = Math.max(0, Math.round(total || 0))
      const completed = tot > 0 && dn >= tot
      const d = today()
      const others = state.runs.filter((r) => r.date !== d)
      state = { ...state, runs: [{ date: d, completed }, ...others] }
      return Promise.resolve({ completed, done: dn, total: tot })
    },
    saveProtocol({ steps }) {
      const list = (steps || []).map((s) => String(s).trim()).filter(Boolean)
      const prev = state.protocol
      const next = list.map((text, i) => {
        const match = prev.find((p) => p.text === text)
        return { id: match ? match.id : `p${++seq}`, sort: i, text, essential: match ? match.essential : i < 1 }
      })
      state = { ...state, protocol: next }
      return Promise.resolve({ ok: true })
    },
    setWindow({ key, value }) {
      if (key !== 'usual_sleep' && key !== 'usual_wake') {
        return Promise.reject(new Error('Unknown setting'))
      }
      const field = key === 'usual_sleep' ? 'sleep' : 'wake'
      state = { ...state, usual: { ...state.usual, [field]: value || null } }
      return Promise.resolve({ ok: true })
    },
  }
}

/* ---------- fetch implementation (real) ---------- */
async function req(path, opts) {
  const r = await fetch(`${API}${path}`, opts)
  if (!r.ok) throw new Error(`Request failed (${r.status})`)
  return r.json()
}
const jsonBody = (method, body) => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})

function createFetchApi() {
  return {
    get: () => req('/api/sleep'),
    logNight: (b) => req('/api/sleep/log', jsonBody('POST', b)),
    saveRun: (b) => req('/api/sleep/run', jsonBody('POST', b)),
    saveProtocol: (b) => req('/api/sleep/protocol', jsonBody('POST', b)),
    setWindow: ({ key, value }) => req('/api/rules/setting', jsonBody('POST', { key, value })),
  }
}

export function createSleepApi(demo) {
  return demo ? createMemoryApi() : createFetchApi()
}

/* ---------- shared derivations (used by the page + the dial) ---------- */
export const SLEEP_TARGET = TARGET

// "HH:MM" → decimal hours (null-safe)
export function parseHM(s) {
  if (!s || typeof s !== 'string' || !s.includes(':')) return null
  const [h, m] = s.split(':').map((x) => parseInt(x, 10))
  if (!Number.isFinite(h) || !Number.isFinite(m)) return null
  return clamp(h, 0, 23) + clamp(m, 0, 59) / 60
}

// hours in bed across a window that may wrap midnight
export function windowHours(sleep, wake) {
  const s = parseHM(sleep)
  const w = parseHM(wake)
  if (s == null || w == null) return null
  const dur = (w <= s ? w + 24 : w) - s
  return Math.round(dur * 10) / 10
}

// sharpness score for one topology hour, floored at 0
export function sharpness(t) {
  return Math.max(0, (t.deep || 0) * 1 + (t.shallow || 0) * 0.35 - (t.failed || 0) * 0.8)
}

// the single peak hour (highest sharpness), or null when there is no data
export function peakHour(topology) {
  let best = null
  for (const t of topology || []) {
    const s = sharpness(t)
    if (s > 0 && (!best || s > best.score)) best = { hour: t.hour, score: s }
  }
  return best
}
