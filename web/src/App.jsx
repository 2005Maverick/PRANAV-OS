import { useEffect, useState } from 'react'
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

function CaptureBar() {
  const [val, setVal] = useState('')
  const [flash, setFlash] = useState(null)
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
        setFlash('Capture failed — is the server up?')
      }
    }
    setTimeout(() => setFlash(null), 4000)
  }
  return (
    <form className="capture" onSubmit={submit}>
      <input
        value={val}
        onChange={(e) => setVal(e.target.value)}
        placeholder="capture anything — idea: …, note: …, a link, a prompt"
      />
      {flash && <span className="cap-flash">{flash}</span>}
    </form>
  )
}

function UpNext({ today }) {
  const nowM = mins(today.now)
  const next = today.blocks
    .filter((b) => b.status === 'planned' && mins(b.start) > nowM)
    .slice(0, 2)
  if (!next.length) return null
  return (
    <div className="upnext">
      <span className="un-label">up next</span>
      {next.map((b) => (
        <span key={b.id} className="un-chip" style={{ '--c': b.color }}>
          <span className="un-t mono">{b.start}</span> {b.title}
        </span>
      ))}
    </div>
  )
}

function Timeline({ today }) {
  if (!today.blocks.length)
    return (
      <div className="empty-day">
        <div className="voice">No composition yet for today.</div>
        <div className="hint">tell the bot: /plan — or wait for tonight's draft</div>
      </div>
    )
  // dynamic window: an hour of air around the day's actual span (now included)
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

function Rail({ rail }) {
  const atRisk = rail.floors.filter((f) => !f.ok).length
  return (
    <aside className="rail">
      <div className="inst">
        <div className="label">Next fixed</div>
        {rail.next_fixed ? (
          <div className="split">
            <span className="ev">{rail.next_fixed.title}</span>
            <span className="mono acid">{rail.next_fixed.at}</span>
          </div>
        ) : (
          <div className="small">nothing fixed ahead today</div>
        )}
      </div>

      <div className="inst">
        <div className="label">Sleep ledger</div>
        {rail.sleep && rail.sleep.debt != null ? (
          <>
            <div className="big">{rail.sleep.debt > 0 ? '+' : '−'}{Math.abs(rail.sleep.debt).toFixed(1)}<span className="u">h</span></div>
            <div className="small">
              last night {rail.sleep.hours ? rail.sleep.hours.toFixed(1) + 'h' : '—'}
              {rail.sleep.close ? ` · close ${rail.sleep.close}` : ' · repaying tonight'}
            </div>
          </>
        ) : (
          <div className="small">no data yet — say "sleeping" tonight</div>
        )}
      </div>

      <div className="inst">
        <div className="label">
          <span>Floors</span>
          {atRisk > 0 && <span className="label-note">{atRisk} at risk</span>}
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

      <div className="inst">
        <div className="label">Masters arc</div>
        {rail.masters_days != null ? (
          <>
            <div className="big acid">{rail.masters_days}<span className="u">days</span></div>
            <div className="small">to application window</div>
          </>
        ) : (
          <div className="small">date not set — onboarding pending</div>
        )}
      </div>

      <div className="proto-chip mono">
        {rail.protocol
          ? (rail.protocol.completed ? 'wake protocol — done' : `wake protocol ${rail.protocol.steps_done}/${rail.protocol.steps_total}`)
          : 'wake protocol — not configured'}
      </div>
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

  const current = today.blocks.find((b) => b.status === 'started')
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
        <div className="current">
          <div className="label">Current block</div>
          <h2>{current ? current.title : '—'}</h2>
          {current?.next_action && <div className="closeout">{current.next_action}</div>}
          {!current && today.energy_note && <div className="closeout">{today.energy_note}</div>}
        </div>
        <div className="timer">
          {current?.playlist_url && (
            <a className="chip playlist" href={current.playlist_url} target="_blank" rel="noreferrer">▶ playlist</a>
          )}
          <span className={`chip ${current ? '' : 'idle'}`}>
            {current
              ? `IN BLOCK · ${Math.max(mins(current.end) - mins(today.now), 0)}m left · ends ${current.end}`
              : 'BETWEEN BLOCKS'}
          </span>
        </div>
      </header>
      <main>
        {view === 'today' && (
          <>
            <div className="today-top">
              <CaptureBar />
              <UpNext today={today} />
            </div>
            <Timeline today={today} />
          </>
        )}
        {view === 'week' && (week ? <Week days={week} rail={rail} /> : <div className="empty-day"><div className="voice">No week data yet.</div></div>)}
        {view === 'wall' && (wall ? <Wall tiles={wall} /> : <div className="empty-day"><div className="voice">The wall begins when your first day closes.</div></div>)}
      </main>
      {view === 'today' && <Rail rail={rail} />}
    </div>
  )
}
