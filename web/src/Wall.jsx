const DAY_START = 6 * 60
const DAY_END = 24 * 60

function mins(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function Tile({ t }) {
  if (!t) return <div className="tile-slot" />
  const done = t.blocks.filter((b) => b.status === 'done').length
  const title = t.blocks.length
    ? `${t.date} · ${done}/${t.blocks.length} blocks done${t.protocol ? ' · protocol ✓' : ''}`
    : `${t.date} · no composition`
  return (
    <div className={`tile ${t.blocks.length ? '' : 'empty'}`} title={title}>
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

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

export default function Wall({ tiles }) {
  // calendar-align: rows are weeks, columns Mon..Sun
  const weeks = []
  let week = []
  for (const t of tiles) {
    const d = new Date(t.date + 'T00:00:00')
    const wd = (d.getDay() + 6) % 7 // Mon=0
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
      <div className="wall-cal">
        <div className="wall-dow">
          <span />
          {['M', 'T', 'W', 'T', 'F', 'S', 'S'].map((d, i) => <span key={i} className="mono">{d}</span>)}
        </div>
        {rows.map(({ w, label }, i) => (
          <div key={i} className="wall-row">
            <span className="wall-month mono">{label || ''}</span>
            {w.map((t, j) => <Tile key={t ? t.date : `e${j}`} t={t} />)}
          </div>
        ))}
      </div>
    </div>
  )
}
