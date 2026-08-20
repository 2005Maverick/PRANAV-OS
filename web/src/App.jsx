import { useEffect, useRef, useState } from 'react'
import Week from './Week.jsx'
import Wall from './Wall.jsx'
import Review from './Review.jsx'
import { Lists, Finance } from './ListsFinance.jsx'
import Library from './Library.jsx'
import Arcs from './Arcs.jsx'
import { Sleep } from './ArcsSleep.jsx'
import Vault from './Vault.jsx'
import { Talk, Rules } from './TalkRules.jsx'
import { MOCK_TODAY, MOCK_RAIL, mkWeek, mkWall } from './mocks.js'

const API = import.meta.env.VITE_API || 'https://pranav-os.onrender.com'

// ?demo — a fully-lived-in day so the design can be judged before real data exists
const DEMO = typeof window !== 'undefined' && window.location.search.includes('demo')
// ?empty — force the empty-day teaching state (design review)
const EMPTY = typeof window !== 'undefined' && window.location.search.includes('empty')

// every API call carries the cockpit key (single-user auth)
if (typeof window !== 'undefined' && !window.__keyedFetch) {
  window.__keyedFetch = true
  const orig = window.fetch.bind(window)
  window.fetch = (url, opts = {}) => {
    if (String(url).startsWith(API)) {
      opts = { ...opts, headers: { ...(opts.headers || {}), 'X-API-Key': localStorage.getItem('pranav_key') || '' } }
    }
    return orig(url, opts)
  }
}

function mins(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

/* ---------- elastic time: rooms keep readable height, gaps compress ---------- */
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

  const GAP_PAD = 8
  const hFor = (g, sc) => g.kind === 'block'
    ? Math.max(g.d * sc, 52)
    : Math.min(Math.max(g.d * sc, g.d >= 10 ? 20 : 4), 72)
  let lo = 0.05, hi = 6
  for (let i = 0; i < 26; i++) {
    const mid = (lo + hi) / 2
    const t = segs.reduce((a, g) => a + hFor(g, mid), 0) + GAP_PAD * segs.filter((g) => g.kind === 'block').length
    if (t > availH) hi = mid; else lo = mid
  }
  const scale = Math.max(lo, 1.0) // comfort floor; overflow scrolls
  let y = 0
  for (const g of segs) {
    g.y = y
    g.h = hFor(g, scale)
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

const fmtGap = (m) => `${m >= 60 ? Math.floor(m / 60) + 'H ' : ''}${m % 60 ? (m % 60) + 'M' : ''}`.trim()

const domainCode = (domain) => `var(--m-${domain || 'reward'}, var(--_p-graph))`

function Room({ b, top, height }) {
  const cls = ['room', b.status, b.fixed ? 'fixed' : '', height < 44 ? 'slim' : ''].join(' ')
  const revised = b.status === 'sacrificed' || b.status === 'skipped'
  return (
    <div className={cls} style={{ top, height, '--c': domainCode(b.domain) }}>
      <div className="r-row">
        <span className="r-title">
          <span className="swatch" aria-hidden="true" />
          {b.domain && <span className="r-dom">{b.domain}</span>}
          {b.title}
        </span>
        <span className="r-time">{b.start}–{b.end}</span>
      </div>
      {b.next_action && height >= 72 && <div className="r-next">→ {b.next_action}</div>}
      {revised && <span className="rev-tag">Δ {b.status}</span>}
    </div>
  )
}

function Section({ today }) {
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

  const nowM = mins(today.now)
  const { segs, yOf, total, d0, d1 } = elasticLayout(today.blocks, nowM, Math.max((wrapH || 700) - 56, 300))
  const nowY = yOf(nowM)

  useEffect(() => {
    const scroller = wrapRef.current
    if (!scroller) return
    if (scroller.scrollHeight > scroller.clientHeight + 8) {
      scroller.scrollTop = Math.max(nowY - scroller.clientHeight * 0.38, 0)
    }
  }, [Math.round(nowY), total])

  const marks = []
  let lastY = -99
  for (let h = Math.ceil(d0 / 60); h <= d1 / 60; h++) {
    const y = yOf(h * 60)
    if (y - lastY >= 20) { marks.push({ h, y }); lastY = y }
  }

  return (
    <div className="section-pane" ref={wrapRef}>
      <div className="section-grid" style={{ height: total }}>
        {marks.map(({ h, y }) => (
          <div key={h} className="hourmark" style={{ top: y }}>
            <span className="hm-t">{String(h).padStart(2, '0')}:00</span>
            {h % 3 === 0 && <span className="hm-rule" />}
          </div>
        ))}
        {segs.filter((g) => g.kind === 'gap' && g.d >= 10).map((g) => (
          <div key={`g${g.s}`} className="dim" style={{ top: g.y + g.h / 2 }}>
            <span className="d-tick" />
            <span className="d-line" />
            <span className="d-label">{fmtGap(g.d)} FREE</span>
            <span className="d-line" />
            <span className="d-tick" />
          </div>
        ))}
        {segs.filter((g) => g.kind === 'block').map((g) => (
          <Room key={g.b.id} b={g.b} top={g.y} height={g.h} />
        ))}
        <div className="redline" style={{ top: nowY }}>
          <span className="rl-tag">{today.now}</span>
        </div>
      </div>
    </div>
  )
}

/* ---------- schedule of works (rail) ---------- */
function SiteNote() {
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
      setFlash('Filed to Notes (demo).')
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
        setFlash('Could not reach the server — note not saved.')
      }
    }
    inputRef.current?.blur()
    setTimeout(() => setFlash(null), 4000)
  }

  return (
    <form className="site-note" onSubmit={submit}>
      <div className="sn-row">
        <input ref={inputRef} className="field" aria-label="Site note — capture anything"
          value={val} onChange={(e) => setVal(e.target.value)}
          placeholder="note anything — it files itself" />
        <button type="submit" className="btn" aria-label="file the note">file</button>
      </div>
      <span className={`sn-hint ${flash ? 'sn-flash' : ''}`}>
        {flash || 'PRESS C TO WRITE FROM ANYWHERE'}
      </span>
    </form>
  )
}

function Works({ rail, today }) {
  const current = today.blocks.find((b) => b.status === 'started')
  const nowM = mins(today.now)
  const upcoming = today.blocks.filter((b) => b.status === 'planned' && mins(b.start) > nowM)
  const next = upcoming[0]
  const behind = rail.floors.filter((f) => !f.ok).length
  const minsLeft = current ? Math.max(mins(current.end) - nowM, 0) : null
  const pct = current
    ? Math.min(Math.round(((nowM - mins(current.start)) / (mins(current.end) - mins(current.start))) * 100), 100)
    : 0

  return (
    <aside className="works" aria-label="Schedule of works">
      <div className="works-h"><span className="cap" style={{ color: 'var(--text-faint)' }}>Schedule of works</span></div>

      {current ? (
        <div className="current-work" style={{ '--c': domainCode(current.domain) }}>
          <div className="cw-dom"><span className="swatch" aria-hidden="true" />Now{current.domain ? ` · ${current.domain}` : ''}</div>
          <div className="cw-title">{current.title}</div>
          <div className="cw-count">{minsLeft}<span className="u">MIN LEFT</span></div>
          {current.next_action && <div className="cw-next">→ {current.next_action}</div>}
          <div className="cw-bar">
            <span className="anno">{pct}%</span>
            <span className="cw-track"><span style={{ width: `${pct}%` }} /></span>
          </div>
          {current.playlist_url && (
            <a className="cw-playlist" href={current.playlist_url} target="_blank" rel="noreferrer">▶ playlist</a>
          )}
        </div>
      ) : (
        <div className="current-work">
          <div className="cw-dom">Now</div>
          <div className="cw-title" style={{ color: 'var(--text-muted)', fontWeight: 400 }}>Between works</div>
          {today.energy_note && <div className="cw-next">{today.energy_note}</div>}
        </div>
      )}

      <div className="works-sec">
        <div className="works-row">
          <span className="wr-main">
            {next ? next.title : 'Nothing else scheduled today'}
            {next && <span className="wr-sub"> · next</span>}
          </span>
          {next && <span className="anno">{next.start}</span>}
        </div>
        {upcoming[1] && (
          <div className="works-row">
            <span className="wr-main wr-sub">{upcoming[1].title}</span>
            <span className="anno">{upcoming[1].start}</span>
          </div>
        )}
      </div>

      <div className="works-sec">
        <div className="works-row">
          <span className="wr-main">Sleep</span>
          {rail.sleep && rail.sleep.debt != null ? (
            <span className="anno">
              {rail.sleep.debt > 0 ? '+' : '−'}{Math.abs(rail.sleep.debt).toFixed(1)}h
              {rail.sleep.close ? ` · bed by ${rail.sleep.close}` : ''}
            </span>
          ) : (
            <span className="anno">say “sleeping” tonight</span>
          )}
        </div>
      </div>

      <div className="works-sec">
        <div className="cap">
          <span>This week</span>
          {behind > 0 && <span className="flag">{behind} behind</span>}
        </div>
        <div style={{ marginTop: 'var(--s-3)' }}>
          {rail.floors.map((f) => (
            <div key={f.slug} className={`min-row ${f.ok ? 'ok' : ''}`}>
              <div className="min-line">
                <span className="min-name">{f.name}</span>
                <span className="min-score">{f.done}/{f.target}</span>
              </div>
              <div className="min-ticks">
                {Array.from({ length: f.target }, (_, i) => (
                  <span key={i} className={i < f.done ? 'f' : ''} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="works-sec">
        <div className="works-row">
          <span className="wr-main wr-sub">Morning routine</span>
          <span className="anno">
            {rail.protocol
              ? (rail.protocol.completed ? 'done ✓' : `${rail.protocol.steps_done}/${rail.protocol.steps_total}`)
              : 'not set up'}
          </span>
        </div>
      </div>

      <SiteNote />
    </aside>
  )
}

/* ---------- title block ---------- */
const SHEETS = [
  ['today', '01', 'Today'], ['week', '02', 'Week'], ['review', '03', 'Review'],
]
const INDEX = [
  ['wall', '04', 'The Wall'], ['library', '05', 'Library'], ['arcs', '06', 'Arcs'], ['sleep', '07', 'Sleep'],
  ['talk', '08', 'Talk'], ['lists', '09', 'Lists'], ['finance', '10', 'Money'], ['vault', '11', 'Vault'], ['rules', '12', 'Rules'],
]

function TitleBlock({ view, setView, today, onArm, arming, theme, onTheme }) {
  const sheet = [...SHEETS, ...INDEX].find(([v]) => v === view) || SHEETS[0]
  const dateStr = new Date(today.date + 'T00:00:00').toLocaleDateString('en-GB', {
    weekday: 'short', day: '2-digit', month: 'short',
  })
  return (
    <header className="masthead">
      <div className="mh-id">
        <span className="mh-no anno" aria-hidden="true">{sheet[1]}</span>
        <h1 className="mh-name">{sheet[2]}</h1>
      </div>
      <span className="mh-meta">{dateStr}</span>
      <nav className="mh-nav" aria-label="Sheets">
        {SHEETS.map(([v, no, name]) => (
          <button key={v} className={`tb-tab ${view === v ? 'on' : ''}`} onClick={() => setView(v)}>
            {name}
          </button>
        ))}
        <select className="tb-tab more" aria-label="Sheet index"
          value={INDEX.some(([v]) => v === view) ? view : ''}
          onChange={(e) => e.target.value && setView(e.target.value)}>
          <option value="" disabled>More</option>
          {INDEX.map(([v, no, name]) => <option key={v} value={v}>{name}</option>)}
        </select>
        <button className="tb-tab" onClick={onTheme}
          aria-label={theme === 'light' ? 'Switch to night print' : 'Switch to paper'}>
          {theme === 'light' ? 'Night' : 'Day'}
        </button>
      </nav>
      {today.status === 'draft' && (
        <button className="btn btn-primary" onClick={onArm} disabled={arming}>
          {arming ? 'Arming…' : 'Arm the day'}
        </button>
      )}
    </header>
  )
}

/* ---------- states ---------- */
function KeyGate({ onSet }) {
  const [val, setVal] = useState('')
  return (
    <div className="stamp-gate">
      <div className="stamp">
        <span className="cap st-title">Pranav OS · Drawing Set</span>
        <span className="st-sub">Enter the cockpit key to open the sheets.</span>
        <form onSubmit={(e) => { e.preventDefault(); if (val.trim()) { localStorage.setItem('pranav_key', val.trim()); onSet() } }}>
          <input className="field" type="password" autoFocus value={val} aria-label="Cockpit key"
            onChange={(e) => setVal(e.target.value)} placeholder="cockpit key" />
          <button className="btn btn-primary" type="submit">Open</button>
        </form>
      </div>
    </div>
  )
}

function LoadingSheet() {
  return (
    <div className="sheet-loading" aria-label="Loading today's drawing">
      <div className="skel" style={{ height: 64 }} />
      <div className="skel" style={{ height: 96, width: '70%' }} />
      <div className="skel" style={{ height: 48, width: '85%' }} />
      <div className="skel" style={{ height: 96, width: '75%' }} />
      <div className="skel" style={{ height: 48, width: '60%' }} />
    </div>
  )
}

function EmptyDay() {
  return (
    <div className="sheet-empty">
      <span className="cap se-title">No drawing issued for today</span>
      <p className="se-body">
        The plan is drafted every evening, or on demand. Tell the bot
        <strong> /plan</strong> and today's sheet appears here.
      </p>
      <a className="btn btn-primary" href="https://t.me/Pranav_os_bot" target="_blank" rel="noreferrer">
        Open the bot
      </a>
    </div>
  )
}

function FetchError({ onRetry }) {
  return (
    <div className="banner-error" role="alert">
      <span className="mark" aria-hidden="true">!</span>
      <p><strong>Couldn't reach the server.</strong> The drawing set is safe — this is a
        connection problem. Check your network or the cockpit key, then try again.</p>
      <button className="btn" onClick={onRetry}>Retry</button>
      <button className="btn" onClick={() => { localStorage.removeItem('pranav_key'); window.location.reload() }}>
        Re-enter key
      </button>
    </div>
  )
}

/* ---------- app ---------- */
export default function App() {
  const [view, setView] = useState('today')
  const [today, setToday] = useState(null)
  const [rail, setRail] = useState(null)
  const [week, setWeek] = useState(null)
  const [wall, setWall] = useState(null)
  const [failed, setFailed] = useState(false)
  const [arming, setArming] = useState(false)
  const [hasKey, setHasKey] = useState(
    DEMO || (typeof window !== 'undefined' && !!localStorage.getItem('pranav_key')))
  const [theme, setTheme] = useState(
    (typeof window !== 'undefined' && localStorage.getItem('pranav_theme')) || 'light')

  useEffect(() => {
    document.documentElement.dataset.theme = theme
    localStorage.setItem('pranav_theme', theme)
  }, [theme])

  const load = () => {
    if (DEMO) {
      setToday(EMPTY ? { ...MOCK_TODAY, blocks: [], status: null } : MOCK_TODAY)
      setRail(MOCK_RAIL)
      setWeek(mkWeek())
      setWall(mkWall())
      return
    }
    setFailed(false)
    Promise.all([
      fetch(`${API}/api/today`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json() }),
      fetch(`${API}/api/rail`).then((r) => { if (!r.ok) throw new Error(r.status); return r.json() }),
    ]).then(([t, ra]) => { setToday(t); setRail(ra) })
      .catch(() => setFailed(true))
    fetch(`${API}/api/week`).then((r) => r.json()).then((d) => setWeek(d.days)).catch(() => {})
    fetch(`${API}/api/wall`).then((r) => r.json()).then((d) => setWall(d.tiles)).catch(() => {})
  }

  useEffect(() => {
    if (!hasKey) return
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [hasKey])

  const arm = async () => {
    if (DEMO) return
    setArming(true)
    try {
      await fetch(`${API}/api/day/confirm`, { method: 'POST' })
      await load()
    } finally { setArming(false) }
  }

  if (!hasKey) return <KeyGate onSet={() => setHasKey(true)} />
  if (failed && !today) {
    return (
      <div className="drawing">
        <FetchError onRetry={load} />
      </div>
    )
  }
  if (!today || !rail) {
    return (
      <div className="drawing">
        <LoadingSheet />
      </div>
    )
  }

  const isToday = view === 'today'
  return (
    <div className="drawing">
      <TitleBlock view={view} setView={setView} today={today} onArm={arm} arming={arming}
        theme={theme} onTheme={() => setTheme(theme === 'light' ? 'dark' : 'light')} />
      {failed && <FetchError onRetry={load} />}
      <div className={`sheet-body ${isToday ? '' : 'full'}`}>
        {isToday && (today.blocks.length ? <Section today={today} /> : <EmptyDay />)}
        {isToday && <Works rail={rail} today={today} />}
        {view === 'week' && (week ? <Week days={week} rail={rail} now={today.now} demo={DEMO} /> : <div className="sheet-empty"><span className="cap se-title">No week data yet</span></div>)}
        {view === 'wall' && (wall ? <Wall tiles={wall} /> : <div className="sheet-empty"><span className="cap se-title">The wall begins when your first day closes</span></div>)}
        {view === 'review' && <Review demo={DEMO} />}
        {view === 'lists' && <Lists demo={DEMO} />}
        {view === 'finance' && <Finance demo={DEMO} />}
        {view === 'library' && <Library demo={DEMO} />}
        {view === 'arcs' && <Arcs demo={DEMO} />}
        {view === 'sleep' && <Sleep demo={DEMO} />}
        {view === 'vault' && <Vault demo={DEMO} />}
        {view === 'talk' && <Talk demo={DEMO} />}
        {view === 'rules' && <Rules demo={DEMO} />}
      </div>
    </div>
  )
}
