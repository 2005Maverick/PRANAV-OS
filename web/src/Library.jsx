import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API || 'https://pranav-os.onrender.com'

const SECTIONS = ['all', 'note', 'idea', 'prompt', 'reading', 'reel', 'file', 'meeting']

const MOCK_LIB = {
  counts: { note: 4, idea: 3, prompt: 2, reading: 5, reel: 1, meeting: 2 },
  items: [
    { id: 1, section: 'idea', title: 'Newsletter audio version', body: 'auto-generate weekly audio with the pipeline', idea_status: 'raw', created: '2026-08-14', surfaced_ct: 0, resurface_at: null },
    { id: 2, section: 'reading', title: 'RL fine-tuning thread', url: 'https://x.com/example', est_minutes: 8, created: '2026-08-17', surfaced_ct: 0, resurface_at: null },
    { id: 3, section: 'prompt', title: 'OSINT extraction prompt', body: 'You are an intelligence analyst. Extract entities…', created: '2026-08-12', surfaced_ct: 1, resurface_at: null },
    { id: 4, section: 'note', title: 'Tile cache bug fixed', body: 'push tomorrow after the demo', created: '2026-08-17', surfaced_ct: 0, resurface_at: null },
    { id: 5, section: 'meeting', title: 'Meeting — Telangana sync', body: '[17:02] client wants heat map filter…', created: '2026-08-16', surfaced_ct: 0, resurface_at: null },
  ],
}

export default function Library({ demo }) {
  const [data, setData] = useState(demo ? MOCK_LIB : null)
  const [section, setSection] = useState('all')
  const [q, setQ] = useState('')
  const [flash, setFlash] = useState(null)

  const load = () => {
    if (demo) return
    const p = new URLSearchParams()
    if (section !== 'all') p.set('section', section)
    if (q) p.set('q', q)
    fetch(`${API}/api/library?${p}`).then((r) => r.json()).then(setData).catch(() => {})
  }
  useEffect(load, [section, q])

  if (!data) return <div className="loading">opening the library…</div>

  const items = demo
    ? data.items.filter((i) => (section === 'all' || i.section === section) &&
        (!q || (i.title + (i.body || '')).toLowerCase().includes(q.toLowerCase())))
    : data.items

  const resurface = async (id, days) => {
    if (demo) { setFlash('Will come back (demo)'); setTimeout(() => setFlash(null), 2000); return }
    await fetch(`${API}/api/library/resurface`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id, days }),
    }).catch(() => {})
    setFlash(`Coming back in ${days}d`)
    setTimeout(() => setFlash(null), 2500)
    load()
  }

  const copy = (text) => {
    navigator.clipboard?.writeText(text)
    setFlash('Copied')
    setTimeout(() => setFlash(null), 1500)
  }

  return (
    <div className="page-wrap wide">
      <div className="lib-bar">
        <div className="lib-tabs">
          {SECTIONS.map((s) => (
            <button key={s} className={`wf-chip ${section === s ? 'on' : ''}`}
              onClick={() => setSection(s)}>
              {s}{s !== 'all' && data.counts?.[s] ? ` ${data.counts[s]}` : ''}
            </button>
          ))}
        </div>
        <input className="lib-search" placeholder="search everything…"
          value={q} onChange={(e) => setQ(e.target.value)} />
        {flash && <span className="rc-hint mono" style={{ color: 'var(--acid)' }}>{flash}</span>}
      </div>
      <div className="lib-grid">
        {items.map((i) => (
          <div key={i.id} className="lib-card">
            <div className="lib-head">
              <span className="wf-chip on lib-sec">{i.section}</span>
              <span className="mono dim2">{i.created}</span>
              {i.idea_status && <span className="mono dim2">· {i.idea_status}</span>}
              {i.resurface_at && <span className="mono lib-back">↩ returns</span>}
            </div>
            <div className="lib-title">{i.title}</div>
            {i.body && <div className="lib-body">{i.body.slice(0, 220)}{i.body.length > 220 ? '…' : ''}</div>}
            {i.url && <a className="lib-url mono" href={i.url} target="_blank" rel="noreferrer">{i.url.slice(0, 60)}</a>}
            <div className="lib-actions">
              {i.section === 'prompt' && i.body && (
                <button className="rv-btn dark-btn" onClick={() => copy(i.body)}>copy</button>
              )}
              <button className="rv-btn dark-btn" onClick={() => resurface(i.id, 1)}>back tomorrow</button>
              <button className="rv-btn dark-btn" onClick={() => resurface(i.id, 7)}>back in a week</button>
            </div>
          </div>
        ))}
        {!items.length && <p className="page-voice">Nothing here yet — send anything to the bot.</p>}
      </div>
    </div>
  )
}
