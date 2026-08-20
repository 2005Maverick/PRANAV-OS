import { useEffect, useMemo, useState } from 'react'
import { createSleepApi, windowHours } from './sleepApi.js'
import { History, HeatStrip, PayoffBars } from './SleepViz.jsx'

// SHEET 07 · SLEEP & ENERGY — a clean, concrete health tracker. Big glanceable
// cards: last night, sleep history, a focus heat-strip, the wind-down routine,
// the payoff read, and the usual window. Crisp SVG (SleepViz.jsx), tokens only,
// Day + Night print. Every mutation is optimistic then resyncs from the store;
// a failure surfaces inline and never crashes the sheet.

const todayIso = () => new Date().toISOString().slice(0, 10)

/* format decimal hours → "6h 30m" (or "7h") */
function fmtHM(h) {
  if (h == null || !Number.isFinite(h)) return '—'
  const whole = Math.floor(h)
  const mins = Math.round((h - whole) * 60)
  if (mins === 0) return `${whole}h`
  if (mins === 60) return `${whole + 1}h`
  return `${whole}h ${pad2(mins)}m`
}
const pad2 = (n) => String(n).padStart(2, '0')

/* status pill from hours slept */
function statusOf(h) {
  if (h == null) return null
  if (h < 6) return { label: 'Short', tone: 'accent' }
  if (h < 7) return { label: 'Light', tone: 'warning' }
  if (h <= 8.5) return { label: 'Solid', tone: 'success' }
  return { label: 'Long', tone: 'muted' }
}

/* ============================= page ============================= */
export default function Sleep({ demo }) {
  const api = useMemo(() => createSleepApi(demo), [demo])
  const [d, setD] = useState(null)
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState(null)

  const refresh = async () => {
    try {
      const data = await api.get()
      setD(data)
      setErr(null)
    } catch {
      setErr('Could not read the nights — check the connection or the cockpit key.')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { refresh() }, [api]) // eslint-disable-line react-hooks/exhaustive-deps

  // run a mutation, then resync; a failure surfaces inline, never crashes the sheet
  const run = async (fn) => {
    try {
      await fn()
      await refresh()
    } catch {
      setErr('That change did not save — nothing was lost, try again.')
      await refresh().catch(() => {})
    }
  }

  if (loading) return <div className="loading">reading the nights…</div>

  return (
    <div className="page-wrap wide slp-sheet">
      <p className="page-voice">The night shift — when you actually sleep, and when the mind is sharp.</p>
      {err && <p className="slp-err anno" role="alert">{err}</p>}

      {d && (
        <div className="slp-grid">
          <LastNight logs={d.logs} usual={d.usual} run={run} api={api} />
          <HistoryPanel logs={d.logs} />
          <SharpPanel topology={d.topology} />
          <Routine protocol={d.protocol} runs={d.runs} run={run} api={api} demo={demo} />
          <Payoff correlation={d.correlation} />
          <WindowPanel usual={d.usual} run={run} api={api} />
        </div>
      )}
    </div>
  )
}

/* ============================= 1 · last night (hero) ============================= */
function LastNight({ logs, usual, run, api }) {
  const [hours, setHours] = useState('')
  const list = logs || []
  const last = list.length ? list[0] : null
  const status = last ? statusOf(last.hours) : null
  const debt = last ? last.debt_after : null

  const winH = windowHours(usual?.sleep, usual?.wake)
  const hasWindow = usual?.sleep && usual?.wake

  const submit = async (e) => {
    e.preventDefault()
    const h = parseFloat(hours)
    if (!Number.isFinite(h) || h <= 0 || h > 24) return
    setHours('')
    await run(() => api.logNight({ hours: h }))
  }

  return (
    <section className="slp-hero">
      <div className="slp-h">
        <span className="cap">Last night</span>
        {last && <span className="slp-h-sub anno">logged {last.date}</span>}
      </div>

      {last ? (
        <>
          <div className="slp-hero-top">
            <span className="slp-big">{fmtHM(last.hours)}</span>
            {status && <span className={`slp-pill ${status.tone}`}>{status.label}</span>}
          </div>
          <div className="slp-hero-meta">
            {hasWindow && (
              <span className="anno">
                {usual.sleep} → {usual.wake}{winH != null ? ` · ${winH}h` : ''}
              </span>
            )}
            {debt != null && (
              <span className={`anno slp-debt ${debt < 0 ? 'owed' : 'banked'}`}>
                {debt < 0 ? `−${Math.abs(debt).toFixed(1)}h owed` : debt > 0 ? `+${debt.toFixed(1)}h banked` : 'on target'}
              </span>
            )}
          </div>
        </>
      ) : (
        <p className="slp-hero-empty">Log last night to start.</p>
      )}

      <form className="slp-logform" onSubmit={submit}>
        <label className="slp-log-lab anno" htmlFor="slp-hours">log last night</label>
        <input id="slp-hours" className="rc-in slim" value={hours} inputMode="decimal"
          onChange={(e) => setHours(e.target.value)} placeholder="6.5" aria-label="Hours slept last night" />
        <button className="chip on" type="submit">save</button>
      </form>
    </section>
  )
}

/* ============================= 2 · sleep history ============================= */
function HistoryPanel({ logs }) {
  const nights = (logs || []).slice(0, 14)
  const n = nights.length
  const avg = n ? (nights.reduce((s, l) => s + (l.hours || 0), 0) / n) : null

  return (
    <section className="slp-block slp-wide">
      <div className="slp-h">
        <span className="cap">Sleep — last 14 nights</span>
        {n > 0 && <span className="slp-h-sub anno">avg {avg.toFixed(1)}h · {n} nights</span>}
      </div>
      <History logs={logs} />
    </section>
  )
}

/* ============================= 3 · when you're sharp ============================= */
function SharpPanel({ topology }) {
  const has = (topology || []).length > 0
  const peak = has ? sharpestHour(topology) : null

  return (
    <section className="slp-block slp-wide">
      <div className="slp-h">
        <span className="cap">When you're actually sharp</span>
      </div>
      <HeatStrip topology={topology} />
      {peak != null && (
        <p className="slp-takeaway anno">sharpest around {pad2(peak)}:00 — protect that block</p>
      )}
    </section>
  )
}

// tiny local peak (avoids re-importing peakHour just for the hour number)
function sharpestHour(topology) {
  let best = null
  for (const t of topology || []) {
    const s = Math.max(0, (t.deep || 0) + (t.shallow || 0) * 0.35 - (t.failed || 0) * 0.8)
    if (s > 0 && (!best || s > best.s)) best = { hour: t.hour, s }
  }
  return best ? best.hour : null
}

/* ============================= 4 · wind-down routine ============================= */
function Routine({ protocol, runs, run, api, demo }) {
  const steps = protocol || []
  const [checked, setChecked] = useState(() => new Set())
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [flash, setFlash] = useState(null)

  const total = steps.length
  const done = checked.size
  const todayRun = (runs || []).find((r) => r.date === todayIso())

  const toggle = (id) => {
    const next = new Set(checked)
    if (next.has(id)) next.delete(id); else next.add(id)
    setChecked(next)
    run(() => api.saveRun({ done: next.size, total }))
  }

  const openEdit = () => {
    setDraft(steps.map((s) => s.text).join('\n'))
    setEditing(true)
  }
  const saveEdit = async () => {
    const listOut = draft.split('\n').map((s) => s.trim()).filter(Boolean)
    await run(() => api.saveProtocol({ steps: listOut }))
    setEditing(false)
    setChecked(new Set())
    setFlash(demo ? 'Saved (demo)' : 'Wind-down saved')
    setTimeout(() => setFlash(null), 2500)
  }

  return (
    <section className="slp-block">
      <div className="slp-h">
        <span className="cap">Wind-down routine</span>
        {!editing && (
          <span className="anno slp-h-sub">
            {todayRun && todayRun.completed ? 'done tonight ✓' : `${done}/${total || '—'} tonight`}
          </span>
        )}
      </div>

      {editing ? (
        <div className="slp-edit">
          <textarea className="slp-proto" rows={6} value={draft}
            onChange={(e) => setDraft(e.target.value)}
            aria-label="Wind-down steps, one per line"
            placeholder={'Screens off\nRead 10 pages\nDim lights'} />
          <p className="slp-edit-hint anno">One step per line. Order is the list.</p>
          <div className="slp-edit-foot">
            <button className="chip on" onClick={saveEdit}>save steps</button>
            <button className="chip" onClick={() => setEditing(false)}>cancel</button>
          </div>
        </div>
      ) : total ? (
        <>
          <ul className="slp-checklist">
            {steps.map((s) => {
              const on = checked.has(s.id)
              return (
                <li key={s.id} className={`slp-step ${on ? 'on' : ''}`}>
                  <button className="slp-step-btn" onClick={() => toggle(s.id)}
                    aria-pressed={on} aria-label={`${on ? 'Uncheck' : 'Check'} ${s.text}`}>
                    <span className="slp-tick" aria-hidden="true">{on ? '✓' : ''}</span>
                    <span className="slp-step-text">{s.text}</span>
                    {s.essential && <span className="slp-ess anno" title="Essential step">must</span>}
                  </button>
                </li>
              )
            })}
          </ul>
          <div className="slp-block-foot">
            <button className="rc-add anno" onClick={openEdit}>✎ edit steps</button>
            {flash && <span className="anno slp-flash">{flash}</span>}
          </div>
        </>
      ) : (
        <div className="slp-empty">
          <p className="anno">No wind-down yet. A short fixed sequence before bed is what makes tomorrow's first block land.</p>
          <button className="chip on" onClick={openEdit}>write the steps</button>
        </div>
      )}
    </section>
  )
}

/* ============================= 5 · does it pay ============================= */
function Payoff({ correlation }) {
  const c = correlation || {}
  const has = c.with != null && c.without != null
  const ratio = has && c.without > 0 ? (c.with / c.without) : null

  return (
    <section className="slp-block">
      <div className="slp-h"><span className="cap">Does the wind-down pay?</span></div>
      <PayoffBars withV={c.with ?? null} withoutV={c.without ?? null} />
      {has ? (
        <p className="slp-takeaway">
          {ratio && ratio >= 1.05
            ? <>Wind-down days ≈ <strong>{ratio.toFixed(1)}×</strong> the deep work — {c.with}h vs {c.without}h.</>
            : ratio && ratio <= 0.95
              ? <>No edge yet — {c.with}h with, {c.without}h without.</>
              : <>About even so far — {c.with}h with, {c.without}h without.</>}
        </p>
      ) : (
        <p className="slp-takeaway anno">Needs a couple of weeks of both kinds of nights before a verdict.</p>
      )}
    </section>
  )
}

/* ============================= 6 · usual window ============================= */
function WindowPanel({ usual, run, api }) {
  const [sleep, setSleep] = useState(usual?.sleep || '')
  const [wake, setWake] = useState(usual?.wake || '')

  useEffect(() => { setSleep(usual?.sleep || ''); setWake(usual?.wake || '') }, [usual?.sleep, usual?.wake])

  const winH = windowHours(sleep, wake)
  const saveSleep = () => {
    if (sleep && sleep !== (usual?.sleep || '')) run(() => api.setWindow({ key: 'usual_sleep', value: sleep }))
  }
  const saveWake = () => {
    if (wake && wake !== (usual?.wake || '')) run(() => api.setWindow({ key: 'usual_wake', value: wake }))
  }

  return (
    <section className="slp-block">
      <div className="slp-h">
        <span className="cap">Usual window</span>
        {winH != null && <span className="anno slp-h-sub">{winH}h in bed</span>}
      </div>
      <div className="slp-window">
        <label className="slp-time">
          <span className="anno">to bed</span>
          <input className="rc-in slim" type="time" value={sleep}
            onChange={(e) => setSleep(e.target.value)} onBlur={saveSleep} aria-label="Usual sleep time" />
        </label>
        <label className="slp-time">
          <span className="anno">wake</span>
          <input className="rc-in slim" type="time" value={wake}
            onChange={(e) => setWake(e.target.value)} onBlur={saveWake} aria-label="Usual wake time" />
        </label>
      </div>
    </section>
  )
}
