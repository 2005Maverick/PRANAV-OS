const DAY_START = 6 * 60
const DAY_END = 24 * 60
const COL_H = 560

function mins(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function y(m) {
  return ((m - DAY_START) / (DAY_END - DAY_START)) * COL_H
}

function WeekPlane({ b }) {
  const top = y(mins(b.start))
  const height = Math.max(y(mins(b.end)) - top - 2, 5)
  const cls = ['wplane', b.status, b.fixed ? 'fixed' : ''].join(' ')
  const title = `${b.title} · ${b.start}–${b.end}`
  return (
    <div className={cls} style={{ top, height, '--c': b.color }} title={title}>
      {height >= 22 && <span className="wt">{b.title}</span>}
      {height >= 40 && <span className="wtime">{b.start}</span>}
    </div>
  )
}

export default function Week({ days }) {
  const hours = [6, 9, 12, 15, 18, 21, 24]
  return (
    <div className="week">
      <div className="wk-gutter">
        {hours.map((h) => (
          <span key={h} className="wk-h" style={{ top: y(h * 60) }}>
            {String(h).padStart(2, '0')}
          </span>
        ))}
      </div>
      {days.map((d) => (
        <div key={d.name} className={`wcol ${d.today ? 'is-today' : ''}`}>
          <div className="wcol-head">
            <span className="wd">{d.name}</span>
            <span className="wdate mono">{d.date}</span>
          </div>
          <div className="wcol-grid" style={{ height: COL_H }}>
            {hours.map((h) => (
              <span key={h} className="wk-rule" style={{ top: y(h * 60) }} />
            ))}
            {d.blocks.map((b) => <WeekPlane key={b.id} b={b} />)}
          </div>
          <div className="wcol-foot mono">{d.status}</div>
        </div>
      ))}
    </div>
  )
}
