// Decks data layer — one interface, two implementations.
//   • memory  (demo=true)  — pure client-side store, mirrors the backend logic
//   • fetch   (demo=false) — the live API; X-API-Key is added by App.jsx's fetch wrapper
// Every method returns a Promise so callers are identical in both modes.
// Image cards: getCardImage() returns an object-URL (memory: the seeded data-URL;
// fetch: blob via the keyed window.fetch) — callers revoke it on unmount.

const API = import.meta.env.VITE_API || 'https://pranav-os.onrender.com'

/* ---------- helpers ---------- */
const KINDS = ['prompt', 'note', 'link', 'image']

function excerptOf(body) {
  const line = (body || '')
    .split('\n')
    .map((s) => s.replace(/^[#>\-*\s]+/, '').replace(/[`*_]/g, '').trim())
    .find(Boolean)
  return (line || '').slice(0, 120)
}

/* ---------- seed data for demo ---------- */
// one small inline SVG so the image tile + lightbox are demoable offline
const SEED_IMG = 'data:image/svg+xml;utf8,' + encodeURIComponent(
  `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360">
    <rect width="480" height="360" fill="#b44322"/>
    <rect x="28" y="28" width="424" height="304" fill="none" stroke="#f4ecd8" stroke-width="2"/>
    <line x1="28" y1="120" x2="452" y2="120" stroke="#f4ecd8" stroke-width="1" opacity="0.6"/>
    <line x1="160" y1="28" x2="160" y2="332" stroke="#f4ecd8" stroke-width="1" opacity="0.6"/>
    <circle cx="240" cy="200" r="54" fill="none" stroke="#f4ecd8" stroke-width="2"/>
    <text x="240" y="300" fill="#f4ecd8" font-family="monospace" font-size="20" text-anchor="middle">PLATE 01 · SITE</text>
  </svg>`)

const SEED_DECKS = [
  { id: 'd1', name: 'Prompts', domain: 'research' },
  { id: 'd2', name: 'X links', domain: 'startup' },
  { id: 'd3', name: 'References', domain: 'tech' },
  { id: 'd4', name: 'Ideas', domain: 'reward' },
]

const SEED_CARDS = [
  {
    id: 'c1', deck_id: 'd1', kind: 'prompt', title: 'OSINT entity extraction',
    url: '', tags: ['osint', 'json'], has_image: false, updated: 'today · 09:14',
    body: [
      'You are an intelligence analyst. From the article below, extract every named',
      'ENTITY, its STANCE, and any EVENTS, and return STRICT JSON only — no prose.',
      '',
      'Rules:',
      '- One object per entity: { "name", "type", "stance", "evidence" }',
      '- stance ∈ {support, oppose, neutral}',
      '- Drop anything you cannot ground in a verbatim span of the text',
      '- Never invent dates; use null when unknown',
      '',
      'Return: { "entities": [...], "events": [...] }',
    ].join('\n'),
  },
  {
    id: 'c2', deck_id: 'd1', kind: 'prompt', title: 'Newspaper summariser (3-line)',
    url: '', tags: ['news', 'summary'], has_image: false, updated: 'yesterday',
    body: [
      'Summarise the article in exactly three lines for a briefing card:',
      '1. What happened (one clause, past tense)',
      '2. Why it matters (the second-order effect)',
      '3. What to watch next (a concrete, checkable signal)',
      '',
      'No hedging, no adjectives, no "reportedly". Plain declaratives.',
    ].join('\n'),
  },
  {
    id: 'c3', deck_id: 'd1', kind: 'image', title: 'Prompt-flow whiteboard',
    url: '', tags: ['sketch'], has_image: true, updated: 'Aug 18', image: SEED_IMG, body: '',
  },
  {
    id: 'c4', deck_id: 'd2', kind: 'link', title: 'The bitter lesson, revisited',
    url: 'https://x.com/karpathy/status/1234567890', tags: ['ml', 'thread'],
    has_image: false, updated: 'today · 08:02', body: 'A long thread on scaling vs. cleverness. Save the reply chain.',
  },
  {
    id: 'c5', deck_id: 'd2', kind: 'link', title: 'minisearch — tiny full-text search',
    url: 'https://github.com/lucaong/minisearch', tags: ['lib', 'search'],
    has_image: false, updated: 'Aug 17', body: 'In-memory fuzzy + prefix search, ~7KB. Using it for the card wall.',
  },
  {
    id: 'c6', deck_id: 'd2', kind: 'link', title: 'How Ground News does blindspots',
    url: 'https://www.theverge.com/features/ground-news-bias', tags: ['news', 'read'],
    has_image: false, updated: 'Aug 15', body: 'Bias-distribution UI worth stealing for the OSINT desk.',
  },
  {
    id: 'c7', deck_id: 'd3', kind: 'note', title: 'ef_search tuning — the number that mattered',
    url: '', tags: ['pgvector', 'perf'], has_image: false, updated: 'Aug 16',
    body: [
      'Dropping ef_search from 120 to 40 cut query latency ~3x with no measurable',
      'recall loss on our corpus. shared_buffers is still the real ceiling (128MB',
      'vs a 6.9GB index) — that is the next lever, not ef_search.',
    ].join('\n'),
  },
  {
    id: 'c8', deck_id: 'd3', kind: 'link', title: 'IBM Plex Mono — specimen',
    url: 'https://fonts.google.com/specimen/IBM+Plex+Mono', tags: ['type'],
    has_image: false, updated: 'Aug 12', body: 'The annotation face used across the drawing set.',
  },
  {
    id: 'c9', deck_id: 'd4', kind: 'note', title: 'Audio edition off the digest',
    url: '', tags: ['product'], has_image: false, updated: 'today · 07:40',
    body: 'Auto-generate a two-host, ~6-minute read off the weekly digest. Ship it as an RSS enclosure so it lands in podcast apps.',
  },
  {
    id: 'c10', deck_id: 'd4', kind: 'note', title: 'Heat-map filter on the district view',
    url: '', tags: ['ui'], has_image: false, updated: 'Aug 14',
    body: 'Colour districts by incident density, with a 30-day time slider. Reuse the OSINT entity pass before rendering.',
  },
]

/* ---------- memory implementation (demo) ---------- */
function createMemoryApi() {
  let decks = SEED_DECKS.map((d) => ({ ...d }))
  let cards = SEED_CARDS.map((c) => ({ ...c }))
  let seq = 1000

  const listItem = (c) => ({
    id: c.id, deck_id: c.deck_id, kind: c.kind, title: c.title, url: c.url,
    tags: c.tags, has_image: !!c.has_image, excerpt: excerptOf(c.body), updated: c.updated,
  })

  const withCounts = () =>
    decks.map((d) => ({ ...d, count: cards.filter((c) => c.deck_id === d.id).length }))

  return {
    listDecks() {
      return Promise.resolve({ decks: withCounts() })
    },
    createDeck({ name, domain }) {
      const id = `deck-${++seq}`
      decks = [...decks, { id, name: name || 'Untitled deck', domain: domain || '' }]
      return Promise.resolve({ id })
    },
    updateDeck(id, patch) {
      decks = decks.map((d) => (d.id === id ? { ...d, ...patch } : d))
      return Promise.resolve({ ok: true })
    },
    deleteDeck(id) {
      decks = decks.filter((d) => d.id !== id)
      cards = cards.filter((c) => c.deck_id !== id)
      return Promise.resolve({ ok: true })
    },
    listCards(deckId, q) {
      const ql = (q || '').toLowerCase()
      const hits = cards.filter((c) =>
        (!deckId || c.deck_id === deckId) &&
        (!ql || (c.title + ' ' + c.body + ' ' + c.url + ' ' + c.tags.join(' ')).toLowerCase().includes(ql)))
      return Promise.resolve({ cards: hits.map(listItem) })
    },
    getCard(id) {
      const c = cards.find((x) => x.id === id)
      if (!c) return Promise.reject(new Error('Card not found'))
      return Promise.resolve({ ...listItem(c), body: c.body })
    },
    createCard(deckId, { kind, title, body, url, tags }) {
      const id = `card-${++seq}`
      const card = {
        id, deck_id: deckId, kind: KINDS.includes(kind) ? kind : 'note',
        title: title || 'Untitled', url: url || '', tags: tags || [],
        has_image: false, updated: 'just now', body: body || '',
      }
      cards = [card, ...cards]
      return Promise.resolve({ id })
    },
    uploadCard(deckId, file, title) {
      const id = `card-${++seq}`
      return new Promise((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => {
          const card = {
            id, deck_id: deckId, kind: 'image',
            title: title || file.name || 'Image', url: '', tags: [],
            has_image: true, updated: 'just now', body: '', image: reader.result,
          }
          cards = [card, ...cards]
          resolve({ id })
        }
        reader.onerror = () => reject(new Error('Could not read the file'))
        reader.readAsDataURL(file)
      })
    },
    updateCard(id, patch) {
      cards = cards.map((c) => (c.id === id ? { ...c, ...patch, updated: 'just now' } : c))
      return Promise.resolve({ ok: true })
    },
    deleteCard(id) {
      cards = cards.filter((c) => c.id !== id)
      return Promise.resolve({ ok: true })
    },
    getCardImage(id) {
      const c = cards.find((x) => x.id === id)
      // the seeded data-URL is used directly as the img src (no object-URL to revoke)
      return Promise.resolve({ url: c ? c.image : '', revoke: false })
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
    listDecks: () => req(`/api/decks`),
    createDeck: (b) => req(`/api/decks`, jsonBody('POST', b)),
    updateDeck: (id, b) => req(`/api/decks/${id}`, jsonBody('PUT', b)),
    deleteDeck: (id) => req(`/api/decks/${id}`, { method: 'DELETE' }),
    listCards: (deckId, q) => {
      const qs = new URLSearchParams()
      if (deckId) qs.set('deck_id', deckId)
      if (q) qs.set('q', q)
      const s = qs.toString()
      return req(`/api/decks/cards${s ? `?${s}` : ''}`)
    },
    getCard: (id) => req(`/api/decks/card/${id}`),
    createCard: (deckId, b) => req(`/api/decks/${deckId}/card`, jsonBody('POST', b)),
    uploadCard: (deckId, file, title) => {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('title', title || file.name || '')
      return req(`/api/decks/${deckId}/card/upload`, { method: 'POST', body: fd })
    },
    updateCard: (id, b) => req(`/api/decks/card/${id}`, jsonBody('PUT', b)),
    deleteCard: (id) => req(`/api/decks/card/${id}`, { method: 'DELETE' }),
    async getCardImage(id) {
      // <img src> can't send X-API-Key — fetch through the patched window.fetch and blob it
      const r = await fetch(`${API}/api/decks/card/${id}/image`)
      if (!r.ok) throw new Error(`Image failed (${r.status})`)
      const blob = await r.blob()
      return { url: URL.createObjectURL(blob), revoke: true }
    },
  }
}

export function createDecksApi(demo) {
  return demo ? createMemoryApi() : createFetchApi()
}

export { KINDS }
