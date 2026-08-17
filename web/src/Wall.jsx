import { useState } from 'react'

const DAY_START = 6 * 60
const DAY_END = 24 * 60

function mins(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function Tile({ t, dim, onOpen }) {
  if (!t) return <div className="tile-slot" />
  const done = t.blocks.filter((b) => b.status === 'done').length
  const title = t.blocks.length
    ? `${t.date} · ${done}/${t.blocks.length} blocks done${t.protocol ? ' · protocol ✓' : ''}`
    : `${t.date} · no composition`
  return (
    <div className={`tile ${t.blocks.length ? '' : 'empty'} ${dim ? 'dim' : ''}`}
      title={title} onClick={() => t.blocks.length && onOpen(t)}>
      <div className="tile-canvas">
        {t.blocks.map((b) => {
          const top = ((mins(b.start) - DAY_START) / (DAY_END - DAY_START)) * 100
          const h = Math.max(((mins(b.end) - mins(b.start)) / (DAY_END - DAY_START)) * 100, 3)
          return (
            <span key={b.id} className={`tbar ${b.status}`}
              style={{ top: `${top}%`, height: `${h}%`, background: b.color }} />
          )
        })}
      </div>
      <div className="tile-foot">
        <span className="mono">{t.label}</span>
        {t.protocol && <span className="pdot" />}
      </div>
    </div>
  )
}

function DayDetail({ t, onClose }) {
  const mark = { done: '✓', skipped: '✗', sacrificed: '→', started: '▶' }
  return (
    <div className="day-detail" onClick={onClose}>
      <div className="dd-panel" onClick={(e) => e.stopPropagation()}>
        <div className="dd-head">
          <span className="dd-date">{t.date}</span>
          <span className="mono dd-meta">
            {t.blocks.filter((b) => b.status === 'done').length}/{t.blocks.length} done
            {t.protocol ? ' · protocol ✓' : ''}
          </span>
          <button className="dd-close" onClick={onClose}>×</button>
        </div>
        <div className="dd-blocks">
          {t.blocks.map((b) => (
            <div key={b.id} className={`dd-row ${b.status}`} style={{ '--c': b.color }}>
              <span className="dd-mark mono">{mark[b.status] || '·'}</span>
              <span className="dd-time mono">{b.start}–{b.end}</span>
              <span className="dd-title">{b.title}</span>
              <span className="dd-status mono">{b.status}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function Wall({ tiles }) {
  const [open, setOpen] = useState(null)
  const [domain, setDomain] = useState(null)
  const [protoOnly, setProtoOnly] = useState(false)

  const domains = [...new Map(
    tiles.flatMap((t) => t.blocks)
      .filter((b) => b.domain)
      .map((b) => [b.domain, b.color])
  ).entries()]

  const dimmed = (t) => {
    if (!t) return false
    if (protoOnly && !t.protocol) return true
    if (domain && !t.blocks.some((b) => b.domain === domain)) return true
    return false
  }

  const weeks = []
  let week = []
  for (const t of tiles) {
    const d = new Date(t.date + 'T00:00:00')
    const wd = (d.getDay() + 6) % 7
    if (week.length === 0) for (let i = 0; i < wd; i++) week.push(null)
    week.push({ ...t, _m: d.getMonth(), _day: d.getDate() })
    if (week.length === 7) { weeks.push(week); week = [] }
  }
  if (week.length) { while (week.length < 7) week.push(null); weeks.push(week) }

  const rows = weeks.map((w, i) => {
    const firstOfMonth = w.find((t) => t && t._day === 1)
    const label = firstOfMonth ? MONTHS[firstOfMonth._m]
      : i === 0 ? MONTHS[w.find(Boolean)?._m] : null
    return { w, label }
  })

  const composed = tiles.filter((t) => t.blocks.length).length
  const proto = tiles.filter((t) => t.protocol).length
  const doneBlocks = tiles.reduce((a, t) => a + t.blocks.filter((b) => b.status === 'done').length, 0)

  return (
    <div className="wall">
      <div className="wall-head">
        <span className="voice">your discipline, rendered — one tile per closed day</span>
        <span className="wall-stats mono">
          {tiles.length} days · {Math.round((composed / (tiles.length || 1)) * 100)}% composed ·
          {' '}{Math.round((proto / (tiles.length || 1)) * 100)}% protocol · {doneBlocks} blocks done
        </span>
      </div>
      <div className="wall-filters">
        {domains.map(([slug, color]) => (
          <button key={slug}
            className={`wf-chip ${domain === slug ? 'on' : ''}`}
            style={{ '--c': color }}
            onClick={() => setDomain(domain === slug ? null : slug)}>
            {slug}
          </button>
        ))}
        <button className={`wf-chip proto ${protoOnly ? 'on' : ''}`}
          onClick={() => setProtoOnly(!protoOnly)}>
          protocol days
        </button>
      </div>
      <div className="wall-cal">
        <div className="wall-dow">
          <span />
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="mono">{d}</span>)}
        </div>
        {rows.map(({ w, label }, i) => (
          <div key={i} className="wall-row">
            <span className="wall-month mono">{label || ''}</span>
            {w.map((t, j) => (
              <Tile key={t ? t.date : `e${j}`} t={t} dim={dimmed(t)} onOpen={setOpen} />
            ))}
          </div>
        ))}
      </div>
      {open && <DayDetail t={open} onClose={() => setOpen(null)} />}
    </div>
  )
}
