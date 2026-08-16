import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API || 'https://pranav-os.onrender.com'

// ?demo — a fully-lived-in day so the design can be judged before real data exists
const DEMO = typeof window !== 'undefined' && window.location.search.includes('demo')

const MOCK_TODAY = {
  date: '2026-08-18', now: '15:42', status: 'confirmed',
  energy_note: 'built for 5h40 of sleep — nap repaid at 14:30',
  blocks: [
    { id: 1, title: 'Wake protocol', domain: 'gym', color: '#6E4A72', start: '07:50', end: '08:15', status: 'done', fixed: false, next_action: null },
    { id: 2, title: 'OSINT demo — client run', domain: 'internship', color: '#8C3A2E', start: '09:00', end: '10:30', status: 'done', fixed: true, next_action: null },
    { id: 3, title: 'Class — DBMS', domain: 'uni', color: '#565C66', start: '11:00', end: '13:00', status: 'done', fixed: true, next_action: null },
    { id: 4, title: 'Nap — ledger repayment', domain: 'gym', color: '#6E4A72', start: '14:30', end: '14:50', status: 'done', fixed: false, next_action: null },
    { id: 5, title: 'A* paper — ablations', domain: 'research', color: '#3F6B52', start: '15:30', end: '17:00', status: 'started', fixed: false, next_action: 'run config 3 — you were mid-table yesterday' },
    { id: 6, title: 'Telangana sync', domain: 'internship', color: '#8C3A2E', start: '17:00', end: '18:00', status: 'planned', fixed: true, next_action: null },
    { id: 7, title: 'Trading — module 7', domain: 'trading', color: '#3E5F86', start: '19:00', end: '20:00', status: 'planned', fixed: false, next_action: 're-watch last 5 min of orderflow lecture' },
    { id: 8, title: 'Reward — Netflix, 1 ep committed', domain: null, color: '#3E433C', start: '20:15', end: '21:05', status: 'planned', fixed: false, next_action: null },
    { id: 9, title: 'Startup — ship digest cron', domain: 'startup', color: '#8A6642', start: '21:15', end: '22:00', status: 'planned', fixed: false, next_action: 'deploy the digest cron — 3 steps from launch' },
    { id: 10, title: 'Tech read — RL fine-tuning thread', domain: 'tech', color: '#A5822B', start: '22:05', end: '22:35', status: 'sacrificed', fixed: false, next_action: null },
  ],
}

const MOCK_RAIL = {
  next_fixed: { title: 'Telangana sync', at: '17:00' },
  sleep: { hours: 5.7, debt: -2.1 },
  floors: [
    { slug: 'tech', name: 'Tech Learning', done: 2, target: 5, ok: false },
    { slug: 'research', name: 'Masters & Research', done: 2, target: 3, ok: false },
    { slug: 'gym', name: 'Gym / Health', done: 5, target: 7, ok: false },
    { slug: 'trading', name: 'Trading', done: 5, target: 5, ok: true },
    { slug: 'startup', name: 'Startup', done: 4, target: 4, ok: true },
  ],
  masters_days: 168,
  protocol: { steps_done: 4, steps_total: 4, completed: true },
}

const HOUR_PX = 52

function mins(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function Plane({ b, dayStart }) {
  const top = ((mins(b.start) - dayStart * 60) / 60) * HOUR_PX
  const height = Math.max(((mins(b.end) - mins(b.start)) / 60) * HOUR_PX - 3, 18)
  const cls = ['plane', b.status, b.fixed ? 'fixed' : '', height < 34 ? 'slim' : ''].join(' ')
  return (
    <div className={cls} style={{ top, height, background: b.color + 'CC' }}>
      <div className="t">{b.domain ? `${b.domain} · ` : ''}{b.title}</div>
      {b.next_action && height >= 60 && <div className="na">→ {b.next_action}</div>}
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
        <div className="label">Next</div>
        {rail.next_fixed ? (
          <>
            <div className="big acid">{rail.next_fixed.at}</div>
            <div className="small">{rail.next_fixed.title}</div>
          </>
        ) : (
          <div className="small">nothing fixed ahead today</div>
        )}
      </div>

      <div className="inst">
        <div className="label">Tonight</div>
        {rail.sleep && rail.sleep.debt != null ? (
          <>
            <div className="big">{rail.sleep.debt > 0 ? '+' : ''}{rail.sleep.debt.toFixed(1)}<span className="unit">H LEDGER</span></div>
            <div className="small">last night: {rail.sleep.hours ? rail.sleep.hours.toFixed(1) + 'h' : '—'}</div>
          </>
        ) : (
          <div className="small">no sleep data yet — say "sleeping" tonight</div>
        )}
      </div>

      <div className="inst">
        <div className="label">
          Floors{atRisk > 0 && <><span className="warn" />{atRisk} at risk</>}
        </div>
        {rail.floors.map((f) => (
          <div key={f.slug} className={`floor-row ${f.ok ? 'ok-row' : 'risk'}`}>
            <span className="name">{f.name}</span>
            <span className="cells">
              {Array.from({ length: f.target }, (_, i) => (
                <span key={i} className={`cell ${i < f.done ? 'f' : ''}`} />
              ))}
            </span>
            <span className={`score ${f.ok ? 'good' : 'bad'}`}>
              {f.done}/{f.target}{f.ok ? ' ✓' : ''}
            </span>
          </div>
        ))}
      </div>

      <div className="inst">
        <div className="label">Arcs</div>
        {rail.masters_days != null ? (
          <div className="big acid">{rail.masters_days}<span className="unit">DAYS · MASTERS</span></div>
        ) : (
          <div className="small">masters date not set — onboarding pending</div>
        )}
      </div>

      <div className="proto-chip">
        {rail.protocol
          ? `WAKE ${rail.protocol.completed ? '✓' : `${rail.protocol.steps_done}/${rail.protocol.steps_total}`}`
          : 'WAKE PROTOCOL · NOT CONFIGURED'}
      </div>
    </aside>
  )
}

export default function App() {
  const [today, setToday] = useState(null)
  const [rail, setRail] = useState(null)

  useEffect(() => {
    if (DEMO) {
      setToday(MOCK_TODAY)
      setRail(MOCK_RAIL)
      return
    }
    const load = () => {
      fetch(`${API}/api/today`).then((r) => r.json()).then(setToday).catch(() => {})
      fetch(`${API}/api/rail`).then((r) => r.json()).then(setRail).catch(() => {})
    }
    load()
    const id = setInterval(load, 60_000)
    return () => clearInterval(id)
  }, [])

  if (!today || !rail) return <div className="loading">Pranav OS · connecting</div>

  const current = today.blocks.find((b) => b.status === 'started')
  return (
    <div className="cockpit">
      <header className="head">
        <div className="brand">
          <h1>Today</h1>
          <div className="sub">{today.date} · {today.status || 'no plan'}</div>
        </div>
        <div className="current">
          <div className="label">Current block</div>
          <h2>{current ? current.title : '—'}</h2>
          {current?.next_action && <div className="closeout">{current.next_action}</div>}
          {!current && today.energy_note && <div className="closeout">{today.energy_note}</div>}
        </div>
        <div className="timer">
          <span className={`chip ${current ? '' : 'idle'}`}>
            {current ? `IN BLOCK · ends ${current.end}` : 'BETWEEN BLOCKS'}
          </span>
        </div>
      </header>
      <main><Timeline today={today} /></main>
      <Rail rail={rail} />
    </div>
  )
}
