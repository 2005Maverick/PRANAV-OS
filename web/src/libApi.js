// Library data layer — one interface, two implementations.
//   • memory  (demo=true)  — pure client-side store, mirrors the backend logic
//   • fetch   (demo=false) — the live API; X-API-Key is added by App.jsx's fetch wrapper
// Every method returns a Promise so callers are identical in both modes.

const API = import.meta.env.VITE_API || 'https://pranav-os.onrender.com'

/* ---------- markdown helpers (mirror the backend's wikilink parsing) ---------- */
const WIKILINK = /\[\[([^\]]+)\]\]/g

export function extractLinks(md) {
  const out = []
  const re = new RegExp(WIKILINK.source, 'g')
  let m
  while ((m = re.exec(md || '')) !== null) out.push(m[1].trim())
  return out
}

function excerptOf(md) {
  const lines = (md || '')
    .replace(WIKILINK, '$1')
    .split('\n')
    .map((s) => s.replace(/^[#>\-*\s]+/, '').replace(/[`*_]/g, '').trim())
    .filter(Boolean)
  return (lines[0] || '').slice(0, 96)
}

/* ---------- seed notes for demo (markdown bodies with literal [[wikilinks]]) ---------- */
const SEED_NOTES = [
  {
    id: 'n1', title: 'A* paper — ablations', tags: ['research', 'uni'],
    pinned: true, is_daily: false, created: 'Aug 12', updated: 'today · 15:52',
    body_md: [
      'The whole submission rests on the ablation table. Config 3 is the one to beat — it',
      'was mid-table yesterday, so today is the scheduler fix and one clean re-run. The',
      'risk framing lives in [[Trading — liquidity sweeps]].',
      '',
      '## Today’s runs',
      '',
      '- [x] Re-run config 3 with the fixed schedule',
      '- [ ] Log seeds 41–45 into the sheet',
      '- [ ] Draft the caption for Table 2',
      '',
      '## The result to reproduce',
      '',
      '```',
      'ef_search = 40      # was 120 — killed latency',
      'top_k     = 8',
      'seed      = 43      # the mid-table run',
      '```',
      '',
      '> If it isn’t in the table, it didn’t happen. Write the number down the moment it lands.',
    ].join('\n'),
  },
  {
    id: 'n2', title: 'OSINT extraction prompt', tags: ['internship'],
    pinned: true, is_daily: false, created: 'Aug 09', updated: 'yesterday',
    body_md: [
      'You are an intelligence analyst. Extract **entities**, **stances**, and events from',
      'the article, returning strict JSON. No prose, no hedging.',
      '',
      '- One object per entity',
      '- Stance in {support, oppose, neutral}',
      '- Drop anything you cannot ground in the text',
    ].join('\n'),
  },
  {
    id: 'n3', title: 'Newsletter — audio version', tags: ['startup'],
    pinned: false, is_daily: false, created: 'Aug 14', updated: 'Aug 14',
    body_md: [
      'Auto-generate the weekly audio off the pipeline. Two-host read, ~6 minutes.',
      '',
      '- [ ] Wire the TTS step after the digest lands',
      '- [ ] Ship an RSS enclosure so it lands in podcast apps',
    ].join('\n'),
  },
  {
    id: 'n4', title: 'Telangana sync — notes', tags: ['internship'],
    pinned: false, is_daily: false, created: 'Aug 16', updated: 'Aug 16',
    body_md: [
      'Client wants a heat-map filter on the district view. Reuse the [[OSINT extraction',
      'prompt]] for the entity pass before rendering.',
      '',
      '## Asks',
      '',
      '- District-level colour by incident density',
      '- A time slider across the last 30 days',
    ].join('\n'),
  },
  {
    id: 'n5', title: 'Trading — liquidity sweeps', tags: ['trading'],
    pinned: false, is_daily: false, created: 'Aug 15', updated: 'Aug 15',
    body_md: [
      'Mark the session highs; sweep then displacement. The A-plus setup is a sweep of',
      'the prior-day high into an unfilled gap.',
      '',
      '> Patience at the level beats prediction of the level.',
    ].join('\n'),
  },
  {
    id: 'n6', title: 'Reading — RL fine-tuning thread', tags: ['research'],
    pinned: false, is_daily: false, created: 'Aug 17', updated: 'Aug 17',
    body_md: [
      'A long thread on RL fine-tuning stability. Relevant to the scheduler question in',
      '[[A* paper — ablations]] — same instability, different loss.',
    ].join('\n'),
  },
]

/* ---------- memory implementation (demo) ---------- */
function createMemoryApi(seed) {
  let notes = seed.map((n) => ({ ...n }))
  let seq = 1000

  const byId = (id) => notes.find((n) => n.id === id)
  const primaryTag = (n) => n.tags[0] || 'uni'

  const toListItem = (n) => ({
    id: n.id, title: n.title, excerpt: excerptOf(n.body_md),
    tags: n.tags, tag: primaryTag(n), pinned: !!n.pinned,
    is_daily: !!n.is_daily, updated: n.updated,
  })

  const mentionedIn = (n) =>
    notes
      .filter((o) => o.id !== n.id &&
        extractLinks(o.body_md).some((t) => t.toLowerCase() === n.title.toLowerCase()))
      .map((o) => ({ id: o.id, title: o.title, where: primaryTag(o) }))

  const related = (n) =>
    notes
      .filter((o) => o.id !== n.id && o.tags.some((t) => n.tags.includes(t)))
      .map((o) => ({ id: o.id, title: o.title, tag: primaryTag(o) }))

  return {
    listNotes(q) {
      const ql = (q || '').toLowerCase()
      const hits = notes.filter((n) => !ql || (n.title + ' ' + n.body_md).toLowerCase().includes(ql))
      return Promise.resolve({ notes: hits.map(toListItem), count: hits.length })
    },
    getNote(id) {
      const n = byId(id)
      if (!n) return Promise.reject(new Error('Note not found'))
      return Promise.resolve({
        id: n.id, title: n.title, body_md: n.body_md, tags: n.tags,
        pinned: !!n.pinned, is_daily: !!n.is_daily, daily_date: n.daily_date || null,
        created: n.created, updated: n.updated,
        mentioned_in: mentionedIn(n), related: related(n),
      })
    },
    createNote({ title, body_md, tags }) {
      const id = `mem-${++seq}`
      const note = {
        id, title: title || 'Untitled', body_md: body_md || '', tags: tags || [],
        pinned: false, is_daily: false, created: 'just now', updated: 'just now',
      }
      notes = [note, ...notes]
      return Promise.resolve({ id })
    },
    updateNote(id, patch) {
      notes = notes.map((n) => (n.id === id ? { ...n, ...patch, updated: 'just now' } : n))
      return Promise.resolve({ ok: true })
    },
    deleteNote(id) {
      notes = notes.filter((n) => n.id !== id)
      return Promise.resolve({ ok: true })
    },
    pinNote(id, pinned) {
      notes = notes.map((n) => (n.id === id ? { ...n, pinned } : n))
      return Promise.resolve({ ok: true })
    },
    getGraph() {
      const nodes = notes.map((n) => ({ id: n.id, title: n.title, tag: primaryTag(n) }))
      const index = new Map(notes.map((n) => [n.title.toLowerCase(), n.id]))
      const edges = []
      notes.forEach((n) =>
        extractLinks(n.body_md).forEach((t) => {
          const target = index.get(t.toLowerCase())
          if (target && target !== n.id) edges.push({ source: n.id, target })
        }))
      return Promise.resolve({ nodes, edges })
    },
    daily() {
      const today = new Date().toISOString().slice(0, 10)
      let d = notes.find((n) => n.is_daily && n.daily_date === today)
      if (!d) {
        d = {
          id: `mem-daily-${today}`, title: `Daily · ${today}`, body_md: '',
          tags: ['reward'], pinned: false, is_daily: true, daily_date: today,
          created: 'just now', updated: 'just now',
        }
        notes = [d, ...notes]
      }
      return Promise.resolve({ id: d.id })
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
    listNotes: (q) => req(`/api/library/notes?q=${encodeURIComponent(q || '')}`),
    getNote: (id) => req(`/api/library/note/${id}`),
    createNote: (b) => req(`/api/library/note`, jsonBody('POST', b)),
    updateNote: (id, b) => req(`/api/library/note/${id}`, jsonBody('PUT', b)),
    deleteNote: (id) => req(`/api/library/note/${id}`, { method: 'DELETE' }),
    pinNote: (id, pinned) => req(`/api/library/note/${id}/pin`, jsonBody('POST', { pinned })),
    getGraph: () => req(`/api/library/graph`),
    daily: () => req(`/api/library/daily`, { method: 'POST' }),
  }
}

export function createLibApi(demo) {
  return demo ? createMemoryApi(SEED_NOTES) : createFetchApi()
}
