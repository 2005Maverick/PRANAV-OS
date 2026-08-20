// Arcs data layer — one interface, two implementations.
//   • memory  (demo=true)  — pure client-side store, mirrors the backend maths
//   • fetch   (demo=false) — the live API; X-API-Key is added by App.jsx's fetch wrapper
// Every method returns a Promise so callers are identical in both modes.
//
// ArcNode shape (enriched, what the UI consumes):
//   { id, title, type:'project'|'umbrella'|'target'|'ongoing', domain, deadline,
//     days_left, note, status, progress:0-100|null,
//     steps:[{id,kind:'do'|'keep'|'checkpoint',title,est_minutes,spent_minutes,done,
//             waiting_on,cadence,last_done,sort}],
//     children:[ArcNode],
//     target:{amount,target,unit,pct,on_pace,need_per_week,at_per_week,pace_pct}, // target only
//     rhythm:{total,on_rhythm} }

const API = import.meta.env.VITE_API || 'https://pranav-os.onrender.com'

/* ---------- date helpers (mirror the backend) ---------- */
const DAY = 86400000
const iso = (d) => d.toISOString().slice(0, 10)
const todayIso = () => iso(new Date())
const addDays = (isoStr, n) => iso(new Date(new Date(isoStr + 'T00:00:00').getTime() + n * DAY))
const daysBetween = (a, b) =>
  Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / DAY)

const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n))
const sum = (arr, f) => arr.reduce((a, x) => a + f(x), 0)

/* ---------- shared maths (identical to the server's rollups) ---------- */
// project progress = sum(est of DONE do-steps) / sum(est of ALL do-steps).
// est is floored to 1 so untimed steps still count.
function doProgress(steps) {
  const dos = steps.filter((s) => s.kind === 'do')
  if (!dos.length) return null
  const tot = sum(dos, (s) => Math.max(s.est_minutes || 0, 1))
  const done = sum(dos.filter((s) => s.done), (s) => Math.max(s.est_minutes || 0, 1))
  return tot ? Math.round((done / tot) * 100) : 0
}

function checkpointRatio(steps) {
  const ck = steps.filter((s) => s.kind === 'checkpoint')
  if (!ck.length) return null
  return Math.round((ck.filter((s) => s.done).length / ck.length) * 100)
}

function onRhythm(step, today) {
  if (!step.last_done) return false
  const gap = daysBetween(step.last_done, today)
  if (step.cadence === 'daily') return gap <= 1
  if (step.cadence === 'weekly') return gap <= 7
  return gap <= 7
}

function rhythmOf(steps, today) {
  const keeps = steps.filter((s) => s.kind === 'keep')
  return { total: keeps.length, on_rhythm: keeps.filter((s) => onRhythm(s, today)).length }
}

/* ---------- enrich a raw record into an ArcNode ---------- */
function enrich(rec, all, today) {
  const steps = [...(rec.steps || [])].sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0))
  const children = all
    .filter((n) => n.parent_id === rec.id)
    .map((c) => enrich(c, all, today))

  const days_left = rec.deadline ? daysBetween(today, rec.deadline) : null

  let progress = null
  let target = null

  if (rec.type === 'project') {
    progress = doProgress(steps) ?? 0
  } else if (rec.type === 'target') {
    const amount = sum(rec.contribs || [], (c) => c.amount || 0)
    const goal = rec.target_amount || 0
    const pct = goal ? clamp(Math.round((amount / goal) * 100), 0, 100) : 0
    const weeksLeft = Math.max((days_left ?? 0) / 7, 0.15)
    const created = rec.created || today
    const elapsedDays = Math.max(daysBetween(created, today), 1)
    const totalDays = Math.max(daysBetween(created, rec.deadline || today), 1)
    const need_per_week = amount >= goal ? 0 : Math.round((goal - amount) / weeksLeft)
    const at_per_week = Math.round(amount / (elapsedDays / 7))
    const pace_pct = clamp(Math.round((elapsedDays / totalDays) * 100), 0, 100)
    target = {
      amount, target: goal, unit: rec.target_unit || '₹',
      pct, on_pace: pct >= pace_pct, need_per_week, at_per_week, pace_pct,
    }
    progress = pct
  } else if (rec.type === 'umbrella') {
    const parts = []
    children.forEach((c) => { if (c.progress != null) parts.push(c.progress) })
    const own = doProgress(steps)
    if (own != null) parts.push(own)
    const ck = checkpointRatio(steps)
    if (ck != null) parts.push(ck)
    progress = parts.length ? Math.round(sum(parts, (x) => x) / parts.length) : 0
  } else {
    progress = null // ongoing — no percentage, only rhythm
  }

  return {
    id: rec.id, title: rec.title, type: rec.type, domain: rec.domain || 'reward',
    deadline: rec.deadline || null, days_left, note: rec.note || '',
    status: rec.status || 'active', progress, steps, children,
    target, rhythm: rhythmOf(steps, today),
  }
}

/* ---------- demo seed — one of every type, richly filled ---------- */
function seedRecords() {
  const t = todayIso()
  const step = (id, kind, title, extra = {}) => ({
    id, kind, title, est_minutes: 0, spent_minutes: 0, done: false,
    waiting_on: null, cadence: null, last_done: null, sort: 0, ...extra,
  })

  const paperSteps = (p) => [
    step(`${p}-s1`, 'do', 'Read 6 papers', { est_minutes: 180, spent_minutes: 180, done: true, sort: 0 }),
    step(`${p}-s2`, 'do', 'Build ablation harness', { est_minutes: 240, spent_minutes: 240, done: true, sort: 1 }),
    step(`${p}-s3`, 'do', 'Run config 3', { est_minutes: 120, sort: 2 }),
    step(`${p}-s4`, 'do', 'Write §4 Method', { est_minutes: 180, sort: 3 }),
    step(`${p}-c1`, 'checkpoint', 'Camera-ready submitted', { sort: 4 }),
  ]

  return [
    // 1 · PROJECT — the paper
    {
      id: 'paper', type: 'project', title: 'A* main paper', domain: 'research',
      created: addDays(t, -18), deadline: addDays(t, 41), parent_id: null,
      note: 'The whole submission rests on the ablation table.',
      steps: paperSteps('paper'), contribs: [],
    },

    // 2 · UMBRELLA — foreign university
    {
      id: 'uni', type: 'umbrella', title: "Foreign university — Fall '27", domain: 'uni',
      created: addDays(t, -30), deadline: addDays(t, 168), parent_id: null,
      note: 'Two apps, one paper, three letters.',
      steps: [
        step('uni-k1', 'keep', 'Mail 2 professors', { cadence: 'weekly', last_done: addDays(t, -3), sort: 0 }),
        step('uni-c1', 'checkpoint', '3 LORs collected', { waiting_on: 'Prof. Rao', sort: 1 }),
        step('uni-c2', 'checkpoint', 'SOP final draft', { sort: 2 }),
      ],
      contribs: [],
    },
    // umbrella child A — GRE
    {
      id: 'gre', type: 'project', title: 'GRE', domain: 'uni',
      created: addDays(t, -20), deadline: addDays(t, 60), parent_id: 'uni',
      note: '', steps: [
        step('gre-s1', 'do', 'Vocab · 500 words', { est_minutes: 300, spent_minutes: 300, done: true, sort: 0 }),
        step('gre-s2', 'do', 'Practice test 1', { est_minutes: 180, sort: 1 }),
        step('gre-s3', 'do', 'Practice test 2', { est_minutes: 180, sort: 2 }),
      ], contribs: [],
    },
    // umbrella child B — a nested copy of the paper
    {
      id: 'uni-paper', type: 'project', title: 'Portfolio paper', domain: 'research',
      created: addDays(t, -12), deadline: addDays(t, 120), parent_id: 'uni',
      note: '', steps: paperSteps('unipaper'), contribs: [],
    },

    // 3 · TARGET — savings
    {
      id: 'save', type: 'target', title: 'Save ₹1,00,000', domain: 'reward',
      created: addDays(t, -35), deadline: addDays(t, 90), parent_id: null,
      target_amount: 100000, target_unit: '₹', note: 'The safety runway.',
      steps: [], contribs: [
        { id: 'save-c1', amount: 10000, note: 'August salary skim', on_date: addDays(t, -30) },
        { id: 'save-c2', amount: 8000, note: 'Freelance', on_date: addDays(t, -16) },
        { id: 'save-c3', amount: 7000, note: 'Sold old gear', on_date: addDays(t, -4) },
      ],
    },

    // 4 · ONGOING — trading discipline
    {
      id: 'trade', type: 'ongoing', title: 'Trading discipline', domain: 'trading',
      created: addDays(t, -60), deadline: null, parent_id: null,
      note: 'Reps, not predictions.',
      steps: [
        step('trade-k1', 'keep', '1h session', { cadence: 'daily', last_done: todayIso(), sort: 0 }),
        step('trade-k2', 'keep', 'Journal review', { cadence: 'weekly', last_done: addDays(t, -2), sort: 1 }),
      ], contribs: [],
    },
  ]
}

/* ---------- memory implementation (demo) ---------- */
function createMemoryApi() {
  let records = seedRecords()
  let seq = 1000
  const nid = (p) => `${p}-${++seq}`
  const today = () => todayIso()

  const findRec = (id) => records.find((r) => r.id === id)
  const findStep = (sid) => {
    for (const r of records) {
      const s = (r.steps || []).find((x) => x.id === sid)
      if (s) return { rec: r, step: s }
    }
    return null
  }

  // remove a node and every descendant, immutably
  const descendants = (id) => {
    const out = new Set([id])
    let grew = true
    while (grew) {
      grew = false
      records.forEach((r) => {
        if (r.parent_id && out.has(r.parent_id) && !out.has(r.id)) { out.add(r.id); grew = true }
      })
    }
    return out
  }

  const replaceStep = (sid, patch) => {
    records = records.map((r) => ({
      ...r,
      steps: (r.steps || []).map((s) => (s.id === sid ? { ...s, ...patch } : s)),
    }))
  }

  return {
    getTree() {
      const t = today()
      const arcs = records.filter((r) => !r.parent_id).map((r) => enrich(r, records, t))
      return Promise.resolve({ arcs, today: t })
    },
    getNode(id) {
      const t = today()
      const rec = findRec(id)
      if (!rec) return Promise.reject(new Error('Arc not found'))
      const node = enrich(rec, records, t)
      const parentRec = rec.parent_id ? findRec(rec.parent_id) : null
      return Promise.resolve({
        ...node,
        parent: parentRec ? { id: parentRec.id, title: parentRec.title, type: parentRec.type } : null,
        contribs: rec.type === 'target' ? [...(rec.contribs || [])] : undefined,
      })
    },
    createArc({ title, type, domain, parent_id, deadline, target_amount, target_unit, note }) {
      const id = nid('arc')
      const rec = {
        id, type: type || 'project', title: title || 'Untitled arc',
        domain: domain || 'reward', parent_id: parent_id || null,
        deadline: deadline || null, created: today(),
        target_amount: target_amount || null, target_unit: target_unit || '₹',
        note: note || '', status: 'active', steps: [], contribs: [],
      }
      records = [rec, ...records]
      return Promise.resolve({ id })
    },
    updateArc(id, patch) {
      records = records.map((r) => (r.id === id ? { ...r, ...patch } : r))
      return Promise.resolve({ ok: true })
    },
    deleteArc(id) {
      const gone = descendants(id)
      records = records.filter((r) => !gone.has(r.id))
      return Promise.resolve({ ok: true })
    },
    addStep(id, { kind, title, est_minutes, waiting_on, cadence }) {
      const rec = findRec(id)
      if (!rec) return Promise.reject(new Error('Arc not found'))
      const sid = nid('s')
      const s = {
        id: sid, kind: kind || 'do', title: title || 'New step',
        est_minutes: est_minutes || 0, spent_minutes: 0, done: false,
        waiting_on: waiting_on || null, cadence: cadence || null,
        last_done: null, sort: (rec.steps || []).length,
      }
      records = records.map((r) => (r.id === id ? { ...r, steps: [...(r.steps || []), s] } : r))
      return Promise.resolve({ id: sid })
    },
    updateStep(sid, patch) {
      if (!findStep(sid)) return Promise.reject(new Error('Step not found'))
      replaceStep(sid, patch)
      return Promise.resolve({ ok: true })
    },
    logStep(sid, { minutes, mark_done }) {
      const hit = findStep(sid)
      if (!hit) return Promise.reject(new Error('Step not found'))
      const spent = (hit.step.spent_minutes || 0) + (minutes || 0)
      replaceStep(sid, {
        spent_minutes: spent,
        ...(mark_done ? { done: true, last_done: today() } : {}),
      })
      return Promise.resolve({ ok: true })
    },
    tickStep(sid) {
      if (!findStep(sid)) return Promise.reject(new Error('Step not found'))
      replaceStep(sid, { done: true, last_done: today() })
      return Promise.resolve({ ok: true })
    },
    deleteStep(sid) {
      records = records.map((r) => ({
        ...r, steps: (r.steps || []).filter((s) => s.id !== sid),
      }))
      return Promise.resolve({ ok: true })
    },
    addContrib(id, { amount, note, on_date }) {
      const rec = findRec(id)
      if (!rec) return Promise.reject(new Error('Arc not found'))
      const cid = nid('c')
      const c = { id: cid, amount: amount || 0, note: note || '', on_date: on_date || today() }
      records = records.map((r) => (r.id === id ? { ...r, contribs: [...(r.contribs || []), c] } : r))
      return Promise.resolve({ id: cid })
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
    getTree: () => req(`/api/arcs/tree`),
    getNode: (id) => req(`/api/arcs/node/${id}`),
    createArc: (b) => req(`/api/arcs`, jsonBody('POST', b)),
    updateArc: (id, b) => req(`/api/arcs/${id}`, jsonBody('PUT', b)),
    deleteArc: (id) => req(`/api/arcs/${id}`, { method: 'DELETE' }),
    addStep: (id, b) => req(`/api/arcs/${id}/step`, jsonBody('POST', b)),
    updateStep: (sid, b) => req(`/api/arcs/step/${sid}`, jsonBody('PUT', b)),
    logStep: (sid, b) => req(`/api/arcs/step/${sid}/log`, jsonBody('POST', b)),
    tickStep: (sid) => req(`/api/arcs/step/${sid}/tick`, { method: 'POST' }),
    deleteStep: (sid) => req(`/api/arcs/step/${sid}`, { method: 'DELETE' }),
    addContrib: (id, b) => req(`/api/arcs/${id}/contrib`, jsonBody('POST', b)),
  }
}

export function createArcsApi(demo) {
  return demo ? createMemoryApi() : createFetchApi()
}
