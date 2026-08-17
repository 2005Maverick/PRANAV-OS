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

function Plane({ b, dayStart }) {
  const top = ((mins(b.start) - dayStart * 60) / 60) * HOUR_PX
  const height = Math.max(((mins(b.end) - mins(b.start)) / 60) * HOUR_PX - 7, 18)
  const cls = ['plane', b.status, b.fixed ? 'fixed' : '', height < 34 ? 'slim' : ''].join(' ')
  return (
    <div className={cls} style={{ top, height, '--c': b.color }}>
      <div className="row">
        <span className="tw">
          {b.domain && <span className="dom">{b.domain}</span>}
          <span className="t">{b.title}</span>
        </span>
        <span className="time">{b.start}–{b.end}</span>
      </div>
      {b.next_action && height >= 60 && <div className="na">→ {b.next_action}</div>}
    </div>
  )
}

function Timeline({ today }) {
  if (!today.blocks.length)
    return (
      <div className="empty-day">
        <div className="voice">No plan yet for today.</div>
        <div className="hint">tell the bot: /plan — or wait for tonight's draft</div>
      </div>
    )
  const firstMin = Math.min(...today.blocks.map((b) => mins(b.start)), mins(today.now))
  const lastMin = Math.max(...today.blocks.map((b) => mins(b.end)), mins(today.now))
  const dayStart = Math.max(Math.floor(firstMin / 60) - 1, 0)
  const dayEnd = Math.min(Math.ceil(lastMin / 60) + 1, 24)
  const hours = Array.from({ length: dayEnd - dayStart + 1 }, (_, i) => dayStart + i)
  const nowTop = ((mins(today.now) - dayStart * 60) / 60) * HOUR_PX
  return (
    <div className="timeline">
      <div className="tl-grid" style={{ height: (dayEnd - dayStart) * HOUR_PX }}>
        {hours.map((h) => (
          <div key={h} className={`tl-hour ${h % 6 === 0 ? 'major' : ''}`} style={{ top: (h - dayStart) * HOUR_PX }}>
            <span className="h">{String(h).padStart(2, '0')}:00</span>
            <span className="rule" />
          </div>
        ))}
        {today.blocks.map((b) => <Plane key={b.id} b={b} dayStart={dayStart} />)}
        <div className="nowline" style={{ top: nowTop }}>
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
