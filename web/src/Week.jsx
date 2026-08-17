import { useEffect, useState } from 'react'

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

// shared elastic axis: hours quiet across ALL days compress for every column,
// keeping the 7 columns perfectly aligned while busy hours get the space
function sharedElastic(days, colTarget) {
  const all = days.flatMap((d) => d.blocks)
  if (!all.length) return null
  const d0 = Math.max(Math.floor(Math.min(...all.map((b) => mins(b.start))) / 60) * 60, 0)
  const d1 = Math.min(Math.ceil(Math.max(...all.map((b) => mins(b.end))) / 60) * 60, 24 * 60)
  const iv = all.map((b) => [mins(b.start), mins(b.end)]).sort((a, b) => a[0] - b[0])
  const busy = []
  for (const [s, e] of iv) {
    if (busy.length && s <= busy[busy.length - 1][1] + 15) {
      busy[busy.length - 1][1] = Math.max(busy[busy.length - 1][1], e)
    } else busy.push([s, e])
  }
  const segs = []
  let cur = d0
  for (const [s, e] of busy) {
    if (s > cur) segs.push({ kind: 'quiet', s: cur, d: s - cur })
    segs.push({ kind: 'busy', s, d: e - s })
    cur = e
  }
  if (cur < d1) segs.push({ kind: 'quiet', s: cur, d: d1 - cur })

  const hFor = (g, sc) => g.kind === 'busy'
    ? g.d * sc
    : Math.min(Math.max(g.d * sc * 0.3, 16), 44)
  let lo = 0.1, hi = 4
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2
    if (segs.reduce((a, g) => a + hFor(g, mid), 0) > colTarget) hi = mid; else lo = mid
  }
  const sc = Math.max(lo, 0.85)
  let y = 0
  for (const g of segs) { g.y = y; g.h = hFor(g, sc); y += g.h }
  const yOf = (m) => {
    for (const g of segs) {
      if (m <= g.s + g.d) {
        const f = Math.min(Math.max((m - g.s) / g.d, 0), 1)
        return g.y + f * g.h
      }
    }
    return y
  }
  return { yOf, total: y, d0, d1, segs }
}

function WeekPlane({ b, yOf, onMove }) {
  const top = yOf(b.s)
  const height = Math.max(yOf(b.e) - top - 3, 18)
  const w = 100 / b.laneCount
  const cls = ['wplane', b.status, b.fixed ? 'fixed' : ''].join(' ')
  return (
    <div className={cls} title={`${b.title} · ${b.start}–${b.end}${b.fixed ? ' · fixed' : ' · click to move'}`}
      onClick={() => !b.fixed && b.status === 'planned' && onMove(b)}
      style={{
        top, height, '--c': b.color,
        left: `calc(${w * b.lane}% + 5px)`,
        width: `calc(${w}% - 10px)`,
        cursor: !b.fixed && b.status === 'planned' ? 'pointer' : 'default',
      }}>
      {height >= 18 && <span className="wt">{b.title}</span>}
      {height >= 40 && <span className="wtime">{b.start}–{b.end}</span>}
    </div>
  )
}

function MoveDialog({ block, onClose, onDone, demo }) {
  const [start, setStart] = useState(block.start)
  const [msg, setMsg] = useState(null)
  const API = import.meta.env.VITE_API || 'https://pranav-os.onrender.com'
  const apply = async (force = false) => {
    if (demo) { setMsg({ ok: true, text: 'Moved (demo).' }); setTimeout(onDone, 700); return }
    const r = await fetch(`${API}/api/move`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ block_id: block.id, start, force }),
    }).then((x) => x.json()).catch(() => ({ ok: false, error: 'server unreachable' }))
    if (r.ok) {
      setMsg({ ok: true, text: r.overlaps ? `Moved — overlaps “${r.overlaps}”, consider a replan.` : 'Moved.' })
      setTimeout(onDone, 900)
    } else if (r.conflict) {
      setMsg({ ok: false, text: `Collides with fixed “${r.conflict}”.`, conflict: true })
    } else {
      setMsg({ ok: false, text: r.error || 'failed' })
    }
  }
  return (
    <div className="day-detail" onClick={onClose}>
      <div className="dd-panel mv-panel" onClick={(e) => e.stopPropagation()}>
        <div className="dd-head"><span className="dd-date">Move “{block.title}”</span>
          <button className="dd-close" onClick={onClose}>×</button></div>
        <div className="vault-row">
          <span className="mono dim2">start at</span>
          <input className="lib-search mono" type="time" value={start} onChange={(e) => setStart(e.target.value)} />
          <button className="rv-btn dark-btn" onClick={() => apply(false)}>move</button>
        </div>
        {msg && (
          <div className="mv-msg mono" style={{ color: msg.ok ? 'var(--acid)' : 'var(--amber)' }}>
            {msg.text}
            {msg.conflict && <button className="rv-btn dark-btn" style={{ marginLeft: 10 }} onClick={() => apply(true)}>move anyway</button>}
          </div>
        )}
      </div>
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

const GHOST_MOCK = { days: [
  { name: 'Mon', date: '24', fixed: [{ title: 'Class — DBMS', start_t: '11:00:00', end_t: '13:00:00' }] },
  { name: 'Tue', date: '25', fixed: [] },
  { name: 'Wed', date: '26', fixed: [{ title: 'Class — ML', start_t: '09:30:00', end_t: '11:00:00' }] },
  { name: 'Thu', date: '27', fixed: [{ title: 'Class — DBMS', start_t: '11:00:00', end_t: '13:00:00' }] },
  { name: 'Fri', date: '28', fixed: [] }, { name: 'Sat', date: '29', fixed: [] }, { name: 'Sun', date: '30', fixed: [] },
] }

export default function Week({ days, rail, now, demo }) {
  const [moving, setMoving] = useState(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [ghost, setGhost] = useState(demo ? GHOST_MOCK : null)
  const API = import.meta.env.VITE_API || 'https://pranav-os.onrender.com'
  const isLateWeek = demo || new Date().getDay() === 0 || new Date().getDay() >= 5

  useEffect(() => {
    if (demo || !isLateWeek) return
    fetch(`${API}/api/week-ghost`).then((r) => r.json()).then(setGhost).catch(() => {})
  }, [])

  const laid = days.map((d) => ({ ...d, blocks: layout(d.blocks) }))
  const ax = sharedElastic(laid, 620)
  if (!ax) {
    return (
      <div className="empty-day">
        <div className="voice">Nothing planned this week yet.</div>
      </div>
    )
  }
  const { yOf, total, d0, d1, segs } = ax
  const marks = []
  let lastY = -99
  for (let h = Math.ceil(d0 / 60); h <= d1 / 60; h++) {
    const y = yOf(h * 60)
    if (y - lastY >= 17) { marks.push({ h, y }); lastY = y }
  }
  const nowM = now ? mins(now) : null
  return (
    <div className="week-page">
      {rail?.floors && (
        <div className="week-floors">
          <span className="un-label">this week</span>
          {rail.floors.map((f) => (
            <span key={f.slug} className={`wk-floor ${f.ok ? 'ok' : ''}`}>
              {f.name} <span className="mono">{f.done}/{f.target}</span>
            </span>
          ))}
        </div>
      )}
      <div className="week">
        <div className="wk-gutter">
          {marks.map(({ h, y }) => (
            <span key={h} className="wk-h" style={{ top: y }}>
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
              <div className="wcol-grid" style={{ height: total }}>
                {segs.filter((g) => g.kind === 'quiet').map((g) => (
                  <span key={g.s} className="wk-quiet" style={{ top: g.y, height: g.h }} />
                ))}
                {marks.filter(({ h }) => h % 3 === 0).map(({ h, y }) => (
                  <span key={h} className="wk-rule" style={{ top: y }} />
                ))}
                {d.blocks.map((b) => <WeekPlane key={b.id} b={b} yOf={yOf} onMove={setMoving} />)}
                {d.today && nowM != null && nowM >= d0 && nowM <= d1 && (
                  <span className="wk-now" style={{ top: yOf(nowM) }} />
                )}
              </div>
              <Spectrum blocks={d.blocks} />
            </div>
          )
        })}
      </div>
      {ghost && isLateWeek && (
        <div className="ghost-week">
          <div className="un-label">next week — the fixed skeleton</div>
          <div className="ghost-row">
            {ghost.days.map((g) => (
              <div key={g.name} className="ghost-day">
                <span className="mono ghost-d">{g.name} {g.date}</span>
                {g.fixed.map((f, i) => (
                  <span key={i} className="ghost-item mono">
                    {f.start_t.slice(0, 5)} {f.title}
                  </span>
                ))}
                {!g.fixed.length && <span className="ghost-item mono ghost-open">open</span>}
              </div>
            ))}
          </div>
        </div>
      )}
      {moving && (
        <MoveDialog block={moving} demo={demo}
          onClose={() => setMoving(null)}
          onDone={() => { setMoving(null); if (!demo) window.location.reload() }} />
      )}
    </div>
  )
}
