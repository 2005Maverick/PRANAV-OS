const DAY_START = 6 * 60
const DAY_END = 24 * 60

function mins(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function Tile({ t }) {
  const done = t.blocks.filter((b) => b.status === 'done').length
  const title = t.blocks.length
    ? `${t.date} · ${done}/${t.blocks.length} blocks done${t.protocol ? ' · protocol ✓' : ''}`
    : `${t.date} · no composition`
  return (
    <div className={`tile ${t.blocks.length ? '' : 'empty'}`} title={title}>
      <div className="tile-canvas">
        {t.blocks.map((b) => {
          const top = ((mins(b.start) - DAY_START) / (DAY_END - DAY_START)) * 100
          const h = Math.max(((mins(b.end) - mins(b.start)) / (DAY_END - DAY_START)) * 100, 2)
          return (
            <span key={b.id} className={`tbar ${b.status}`}
              style={{ top: `${top}%`, height: `${h}%`, background: b.color }} />
          )
        })}
      </div>
      <div className="tile-foot">
        <span className="mono">{t.month ? `${t.month} ` : ''}{t.label}</span>
        {t.protocol && <span className="pdot" />}
      </div>
    </div>
  )
}

export default function Wall({ tiles }) {
  return (
    <div className="wall">
      <div className="wall-head">
        <span className="voice">your discipline, rendered — one tile per closed day</span>
      </div>
      <div className="wall-grid">
        {tiles.map((t) => <Tile key={t.date} t={t} />)}
      </div>
    </div>
  )
}
