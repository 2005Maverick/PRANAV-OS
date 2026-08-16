import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API || 'https://pranav-os.onrender.com'

const HOUR_PX = 34
const DAY_START = 0 // midnight; full 24h grid

function mins(hhmm) {
  const [h, m] = hhmm.split(':').map(Number)
  return h * 60 + m
}

function Plane({ b }) {
  const top = (mins(b.start) / 60 - DAY_START) * HOUR_PX
  const height = Math.max(((mins(b.end) - mins(b.start)) / 60) * HOUR_PX - 2, 16)
  const cls = ['plane', b.status, b.fixed ? 'fixed' : ''].join(' ')
  return (
    <div className={cls} style={{ top, height, background: b.color + 'CC' }}>
      <div className="t">{b.domain ? `${b.domain} · ` : ''}{b.title}</div>
      {b.next_action && height > 40 && <div className="na">↳ {b.next_action}</div>}
    </div>
  )
}

function Timeline({ today }) {
  const nowTop = (mins(today.now) / 60 - DAY_START) * HOUR_PX
  const hours = Array.from({ length: 25 }, (_, i) => i)
  if (!today.blocks.length)
    return (
      <div className="empty-day">
        <div className="voice">No composition yet for today.</div>
        <div className="hint">tell the bot: /plan — or wait for tonight's draft</div>
      </div>
    )
  return (
    <div className="timeline">
      <div className="tl-grid" style={{ height: 24 * HOUR_PX }}>
        {hours.map((h) => (
          <div key={h} className={`tl-hour ${h % 6 === 0 ? 'major' : ''}`}>
            <span className="h">{String(h).padStart(2, '0')}:00</span>
            <span className="rule" />
          </div>
        ))}
        {today.blocks.map((b) => <Plane key={b.id} b={b} />)}
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
          <div className="small">no sleep data yet — say “sleeping” tonight</div>
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
          <>
            <div className="big acid">{rail.masters_days}<span className="unit">DAYS · MASTERS</span></div>
          </>
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
