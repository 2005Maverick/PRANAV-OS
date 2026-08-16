const COL_H = 600

function mins(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

// lane-split overlapping blocks so they share the column width side by side
function layout(blocks) {
  const bs = blocks
    .map((b) => ({ ...b, s: mins(b.start), e: mins(b.end) }))
    .sort((a, b) => a.s - b.s || a.e - b.e)
  const out = []
  let cluster = []
  let clusterEnd = -1
  const flush = () => {
    if (!cluster.length) return
    const lanes = []
    for (const b of cluster) {
      let li = lanes.findIndex((end) => end <= b.s)
      if (li === -1) { li = lanes.length; lanes.push(0) }
      lanes[li] = b.e
      b.lane = li
    }
    for (const b of cluster) b.laneCount = lanes.length
    out.push(...cluster)
    cluster = []
  }
  for (const b of bs) {
    if (cluster.length && b.s >= clusterEnd) flush()
    clusterEnd = cluster.length ? Math.max(clusterEnd, b.e) : b.e
    cluster.push(b)
  }
  flush()
  return out
}

function range(days) {
  let lo = 24 * 60, hi = 0
  for (const d of days) for (const b of d.blocks) {
    lo = Math.min(lo, mins(b.start)); hi = Math.max(hi, mins(b.end))
  }
  if (hi <= lo) { lo = 6 * 60; hi = 24 * 60 }
  return [Math.max(Math.floor(lo / 60) - 1, 0) * 60, Math.min(Math.ceil(hi / 60), 24) * 60]
}

function WeekPlane({ b, lo, hi }) {
  const y = (m) => ((m - lo) / (hi - lo)) * COL_H
  const top = y(b.s)
  const height = Math.max(y(b.e) - top - 2, 6)
  const w = 100 / b.laneCount
  const cls = ['wplane', b.status, b.fixed ? 'fixed' : ''].join(' ')
  return (
    <div className={cls} title={`${b.title} · ${b.start}–${b.end}`}
      style={{
        top, height, '--c': b.color,
        left: `calc(${w * b.lane}% + 5px)`,
        width: `calc(${w}% - 10px)`,
      }}>
      {height >= 20 && <span className="wt">{b.title}</span>}
      {height >= 38 && <span className="wtime">{b.start}–{b.end}</span>}
    </div>
  )
}

function Spectrum({ blocks }) {
  const total = blocks.reduce((a, b) => a + (b.e - b.s), 0) || 1
  return (
    <div className="spectrum">
      {blocks.map((b) => (
        <span key={b.id} style={{ flex: (b.e - b.s) / total, background: b.color }}
          className={b.status === 'skipped' || b.status === 'sacrificed' ? 'sp-dim' : ''} />
      ))}
    </div>
  )
}

export default function Week({ days }) {
  const laid = days.map((d) => ({ ...d, blocks: layout(d.blocks) }))
  const [lo, hi] = range(laid)
  const hours = []
  for (let h = Math.ceil(lo / 60); h <= hi / 60; h += 3) hours.push(h)
  const y = (m) => ((m - lo) / (hi - lo)) * COL_H
  return (
    <div className="week">
      <div className="wk-gutter">
        {hours.map((h) => (
          <span key={h} className="wk-h" style={{ top: y(h * 60) }}>
            {String(h).padStart(2, '0')}
          </span>
        ))}
      </div>
      {laid.map((d) => {
        const workMin = d.blocks.reduce((a, b) => a + (b.e - b.s), 0)
        return (
          <div key={d.name} className={`wcol ${d.today ? 'is-today' : ''}`}>
            <div className="wcol-head">
              <span className="wd">{d.name}</span>
              <span className="wdate mono">{d.date}</span>
              <span className="whrs mono">{workMin ? (workMin / 60).toFixed(1) + 'h' : '—'}</span>
            </div>
            <div className="wcol-grid" style={{ height: COL_H }}>
              {hours.map((h) => (
                <span key={h} className="wk-rule" style={{ top: y(h * 60) }} />
              ))}
              {d.blocks.map((b) => <WeekPlane key={b.id} b={b} lo={lo} hi={hi} />)}
            </div>
            <Spectrum blocks={d.blocks} />
          </div>
        )
      })}
    </div>
  )
}
