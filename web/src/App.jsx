import { useEffect, useRef, useState } from 'react'
import Week from './Week.jsx'
import Wall from './Wall.jsx'
import { MOCK_TODAY, MOCK_RAIL, mkWeek, mkWall } from './mocks.js'

const API = import.meta.env.VITE_API || 'https://pranav-os.onrender.com'

// ?demo — a fully-lived-in day so the design can be judged before real data exists
const DEMO = typeof window !== 'undefined' && window.location.search.includes('demo')

const HOUR_PX = 52

function mins(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function Plane({ b, top, height }) {
  const cls = ['plane', b.status, b.fixed ? 'fixed' : '', height < 40 ? 'slim' : ''].join(' ')
  return (
    <div className={cls} style={{ top, height, '--c': b.color }}>
      <div className="row">
        <span className="tw">
          {b.domain && <span className="dom">{b.domain}</span>}
          <span className="t">{b.title}</span>
        </span>
        <span className="time">{b.start}–{b.end}</span>
      </div>
      {b.next_action && height >= 64 && <div className="na">→ {b.next_action}</div>}
    </div>
  )
}

// Elastic time: blocks get a readable minimum height; gaps compress to pay
// for it. A binary search finds the scale where everything exactly fits.
function elasticLayout(blocks, nowM, availH) {
  const sorted = [...blocks].sort((a, b) => mins(a.start) - mins(b.start))
  const first = Math.min(...sorted.map((b) => mins(b.start)), nowM)
  const last = Math.max(...sorted.map((b) => mins(b.end)), nowM)
  const d0 = Math.max(Math.floor(first / 60) * 60, 0)
  const d1 = Math.min(Math.ceil(last / 60) * 60, 24 * 60)

  const segs = []
  let cur = d0
  for (const b of sorted) {
    const s = mins(b.start), e = mins(b.end)
    if (s > cur) segs.push({ kind: 'gap', s: cur, d: s - cur })
    segs.push({ kind: 'block', s, d: Math.max(e - s, 1), b })
    cur = Math.max(cur, e)
  }
  if (cur < d1) segs.push({ kind: 'gap', s: cur, d: d1 - cur })

  const GAP_PAD = 6 // vertical breathing between cards
  const hFor = (g, sc) => g.kind === 'block'
    ? Math.max(g.d * sc, 44)
    : Math.min(Math.max(g.d * sc, g.d >= 10 ? 14 : 2), 64)
  let lo = 0.05, hi = 6
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2
    const t = segs.reduce((a, g) => a + hFor(g, mid), 0) + GAP_PAD * segs.filter((g) => g.kind === 'block').length
    if (t > availH) hi = mid; else lo = mid
  }
  let y = 0
  for (const g of segs) {
    g.y = y
    g.h = hFor(g, lo)
    y += g.h + (g.kind === 'block' ? GAP_PAD : 0)
  }
  const yOf = (m) => {
    for (const g of segs) {
      if (m <= g.s + g.d) {
        const f = Math.min(Math.max((m - g.s) / g.d, 0), 1)
        return g.y + f * g.h
      }
    }
    return y
  }
  return { segs, yOf, total: y, d0, d1 }
}

function Timeline({ today }) {
  const wrapRef = useRef(null)
  const [wrapH, setWrapH] = useState(0)

  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setWrapH(el.clientHeight)
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [today.blocks.length])

  if (!today.blocks.length)
    return (
      <div className="empty-day">
        <div className="voice">No plan yet for today.</div>
        <div className="hint">tell the bot: /plan — or wait for tonight's draft</div>
      </div>
    )
  const nowM = mins(today.now)
  const { segs, yOf, total, d0, d1 } = elasticLayout(today.blocks, nowM, Math.max((wrapH || 700) - 46, 300))

  // hour labels via the elastic map; skip any that would crowd (<16px apart)
  const marks = []
  let lastY = -99
  for (let h = Math.ceil(d0 / 60); h <= d1 / 60; h++) {
    const y = yOf(h * 60)
    if (y - lastY >= 16) { marks.push({ h, y }); lastY = y }
  }
  const fmtGap = (m) => `${m >= 60 ? Math.floor(m / 60) + 'h ' : ''}${m % 60 ? (m % 60) + 'm' : ''}`.trim()
  return (
    <div className="timeline" ref={wrapRef}>
      <div className="tl-grid" style={{ height: total }}>
        {marks.map(({ h, y }) => (
          <div key={h} className={`tl-hour ${h % 3 === 0 ? 'major' : ''}`} style={{ top: y }}>
            <span className="h">{String(h).padStart(2, '0')}:00</span>
            {h % 3 === 0 && <span className="rule" />}
          </div>
        ))}
        {segs.filter((g) => g.kind === 'gap' && g.d >= 10).map((g) => (
          <div key={`g${g.s}`} className="gap-divider" style={{ top: g.y + g.h / 2 }}>
            <span className="gd-line short" />
            <span className="gd-text">{fmtGap(g.d)} free</span>
            <span className="gd-line" />
          </div>
        ))}
        {segs.filter((g) => g.kind === 'block').map((g) => (
          <Plane key={g.b.id} b={g.b} top={g.y} height={g.h} />
        ))}
        <div className="nowline" style={{ top: yOf(nowM) }}>
          <span className="tag">NOW {today.now}</span>
        </div>
      </div>
    </div>
  )
}

function RailCapture() {
  const [val, setVal] = useState('')
  const [flash, setFlash] = useState(null)
  const inputRef = useRef(null)

  useEffect(() => {
    const onKey = (e) => {
      const typing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)
      if (!typing && (e.key === 'c' || e.key === 'C')) {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const submit = async (e) => {
    e.preventDefault()
    const text = val.trim()
    if (!text) return
    setVal('')
    if (DEMO) {
      setFlash('Saved → Notes (demo).')
    } else {
      try {
        const r = await fetch(`${API}/api/capture`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        })
        const d = await r.json()
        setFlash(d.reply)
      } catch {
        setFlash('Save failed — is the server up?')
      }
    }
    inputRef.current?.blur()
    setTimeout(() => setFlash(null), 4000)
  }

  return (
    <form className="rail-capture" onSubmit={submit}>
      <div className="rc-box">
        <input
          ref={inputRef}
          value={val}
          onChange={(e) => setVal(e.target.value)}
          placeholder="save a thought, a link, anything…"
        />
        <button type="submit" className="rc-send" aria-label="save">➤</button>
      </div>
      <span className="rc-hint mono">{flash || 'press C anywhere to write here'}</span>
    </form>
  )
}

function Rail({ rail, today }) {
  const current = today.blocks.find((b) => b.status === 'started')
  const nowM = mins(today.now)
  const upcoming = today.blocks
    .filter((b) => b.status === 'planned' && mins(b.start) > nowM)
    .slice(0, 2)
  const behind = rail.floors.filter((f) => !f.ok).length
  const minsLeft = current ? Math.max(mins(current.end) - nowM, 0) : null
  const pct = current
    ? Math.min(Math.round(((nowM - mins(current.start)) / (mins(current.end) - mins(current.start))) * 100), 100)
    : 0

  return (
    <aside className="rail">
      {current ? (
        <div className="now-card" style={{ '--c': current.color }}>
          <div className="nc-eyebrow mono">Now{current.domain ? ` · ${current.domain}` : ''}</div>
          <div className="nc-title">{current.title}</div>
          <div className="nc-count mono">{minsLeft}<span className="nc-unit">min left</span></div>
          {current.next_action && <div className="nc-action">→ {current.next_action}</div>}
          <div className="nc-progress">
            <span className="nc-pct mono">{pct}%</span>
            <div className="nc-bar"><span style={{ width: `${pct}%` }} /></div>
          </div>
        </div>
      ) : (
        <div className="now-card idle">
          <div className="nc-eyebrow mono">Now</div>
          <div className="nc-title dim-t">Between blocks</div>
          {today.energy_note && <div className="nc-action">{today.energy_note}</div>}
        </div>
      )}

      {upcoming.length > 0 && (
        <div className="next-card" style={{ '--c': upcoming[0].color }}>
          <div className="nc-eyebrow mono">Next · {upcoming[0].start}</div>
          <div className="nx-title">{upcoming[0].title}</div>
          {upcoming[1] && (
            <div className="nx-after mono">{upcoming[1].start}  {upcoming[1].title}</div>
          )}
        </div>
      )}

      <div className="inst">
        <div className="label">Sleep</div>
        {rail.sleep && rail.sleep.debt != null ? (
          <>
            <div className="big">{rail.sleep.debt > 0 ? '+' : '−'}{Math.abs(rail.sleep.debt).toFixed(1)}<span className="u">h</span></div>
            <div className="small">
              {rail.sleep.debt < 0 ? 'short this week' : 'ahead this week'}
              {rail.sleep.hours ? ` · last night ${rail.sleep.hours.toFixed(1)}h` : ''}
              {rail.sleep.close ? ` · sleep by ${rail.sleep.close}` : ''}
            </div>
          </>
        ) : (
          <div className="small">no data yet — tell the bot "sleeping" tonight</div>
        )}
      </div>

      <div className="inst">
        <div className="label">
          <span>This week</span>
          {behind > 0 && <span className="label-note">{behind} behind</span>}
        </div>
        <div className="floors">
          {rail.floors.map((f) => (
            <div key={f.slug} className={`frow ${f.ok ? 'ok' : 'risk'}`}>
              <div className="frow-line">
                <span className="name">{f.name}</span>
                <span className="score mono">{f.done}/{f.target}</span>
              </div>
              <div className="bar">
                {Array.from({ length: f.target }, (_, i) => (
                  <span key={i} className={`seg ${i < f.done ? 'f' : ''}`} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="proto-chip mono">
        {rail.protocol
          ? (rail.protocol.completed ? 'morning routine ✓' : `morning routine ${rail.protocol.steps_done}/${rail.protocol.steps_total}`)
          : 'morning routine — not set up yet'}
      </div>

      <RailCapture />
    </aside>
  )
}

const VIEWS = ['today', 'week', 'wall']

export default function App() {
  const [view, setView] = useState('today')
  const [today, setToday] = useState(null)
  const [rail, setRail] = useState(null)
  const [week, setWeek] = useState(null)
  const [wall, setWall] = useState(null)

  useEffect(() => {
    if (DEMO) {
      setToday(MOCK_TODAY)
      setRail(MOCK_RAIL)
      setWeek(mkWeek())
      setWall(mkWall())
      return
    }
    const load = () => {
      fetch(`${API}/api/today`).then((r) => r.json()).then(setToday).catch(() => {})
      fetch(`${API}/api/rail`).then((r) => r.json()).then(setRail).catch(() => {})
      fetch(`${API}/api/week`).then((r) => r.json()).then((d) => setWeek(d.days)).catch(() => {})
      fetch(`${API}/api/wall`).then((r) => r.json()).then((d) => setWall(d.tiles)).catch(() => {})
    }
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [])

  if (!today || !rail) return <div className="loading">Pranav OS · connecting</div>

  const titles = { today: 'Today', week: 'Week', wall: 'The Wall' }
  return (
    <div className={`cockpit ${view === 'today' ? '' : 'full'}`}>
      <header className="head">
        <div className="brand">
          <h1>{titles[view]}</h1>
          <nav className="tabs">
            {VIEWS.map((v) => (
              <button key={v} className={`tab ${view === v ? 'on' : ''}`} onClick={() => setView(v)}>
                {v}
              </button>
            ))}
          </nav>
        </div>
      </header>
      <main>
        {view === 'today' && <Timeline today={today} />}
        {view === 'week' && (week ? <Week days={week} rail={rail} /> : <div className="empty-day"><div className="voice">No week data yet.</div></div>)}
        {view === 'wall' && (wall ? <Wall tiles={wall} /> : <div className="empty-day"><div className="voice">The wall begins when your first day closes.</div></div>)}
      </main>
      {view === 'today' && <Rail rail={rail} today={today} />}
    </div>
  )
}
