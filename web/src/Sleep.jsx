import { useEffect, useMemo, useState } from 'react'
import { createSleepApi, windowHours } from './sleepApi.js'
import { EnergyCurve, DebtSpark, History, PayoffBars, energySentence } from './SleepViz.jsx'

// SHEET 07 · SLEEP & ENERGY — a full-width, product-grade morning surface.
// The hero is a large smooth energy curve across the waking day with a live NOW
// marker; below it, sleep debt (the driver), last night + history, the wind-down
// routine, and the payoff read. Crisp SVG (SleepViz.jsx), REDLINE tokens only,
// Day + Night print. Every mutation is optimistic then resyncs from the store;
// a failure surfaces inline and never crashes the sheet.

const todayIso = () => new Date().toISOString().slice(0, 10)
const pad2 = (n) => String(n).padStart(2, '0')

/* format decimal hours → "6h 30m" (or "7h") */
function fmtHM(h) {
  if (h == null || !Number.isFinite(h)) return '—'
  const whole = Math.floor(h)
  const mins = Math.round((h - whole) * 60)
  if (mins === 0) return `${whole}h`
  if (mins === 60) return `${whole + 1}h`
  return `${whole}h ${pad2(mins)}m`
}

/* status pill from hours slept */
function statusOf(h) {
  if (h == null) return null
  if (h < 6) return { label: 'Short', tone: 'accent' }
  if (h < 7) return { label: 'Light', tone: 'warning' }
  if (h <= 8.5) return { label: 'Solid', tone: 'success' }
  return { label: 'Long', tone: 'muted' }
}

/* plain coaching line from the current debt figure */
function debtCoach(debt) {
  if (debt == null) return null
  const owed = debt < 0 ? -debt : 0
  if (owed > 3) return 'Deep debt — it’s capping your afternoon energy. Aim +1h tonight.'
  if (owed >= 1.5) return 'Some debt — an earlier night clears it.'
  return 'Debt’s under control. Hold the line.'
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
          <Hero topology={d.topology} usual={d.usual} />
          <DebtPanel logs={d.logs} usual={d.usual} run={run} api={api} />
          <NightPanel logs={d.logs} run={run} api={api} />
          <Routine protocol={d.protocol} runs={d.runs} run={run} api={api} demo={demo} />
          <Payoff correlation={d.correlation} />
        </div>
      )}
    </div>
  )
}

/* ============================= 1 · hero — your day's energy ============================= */
function Hero({ topology, usual }) {
  const sentence = energySentence(topology)
  return (
    <section className="slp-hero">
      <div className="slp-hero-head">
        <span className="cap slp-hero-title">Your day’s energy</span>
        <p className="slp-hero-sentence">
          {sentence || 'Your energy curve fills in as you log deep-work blocks through the day.'}
        </p>
      </div>
      <EnergyCurve topology={topology} usual={usual} />
    </section>
  )
}

/* ============================= 2 · sleep debt (the driver) ============================= */
function DebtPanel({ logs, usual, run, api }) {
  const list = logs || []
  const last = list.length ? list[0] : null
  const debt = last ? last.debt_after : null
  const owed = debt != null && debt < 0 ? Math.abs(debt) : 0
  const banked = debt != null && debt > 0 ? debt : 0
  const coach = debtCoach(debt)
  const winH = windowHours(usual?.sleep, usual?.wake)

  const bigText = debt == null ? '—' : owed > 0 ? `−${owed.toFixed(1)}h` : banked > 0 ? `+${banked.toFixed(1)}h` : '0h'
  const tag = owed > 0 ? 'owed' : banked > 0 ? 'banked' : debt == null ? '' : 'level'

  return (
    <section className="slp-block slp-debt-panel">
      <div className="slp-h">
        <span className="cap">Sleep debt</span>
        <span className="slp-h-sub anno">14-night trend</span>
      </div>

      <div className="slp-debt-num">
        <span className={`slp-big${owed > 0 ? ' owed' : ''}`}>{bigText}</span>
        {tag && <span className="anno slp-debt-tag">{tag}</span>}
      </div>

      <DebtSpark logs={logs} />

      {coach && <p className="slp-takeaway">{coach}</p>}

      <div className="slp-debt-window anno">
        asleep {usual?.sleep || '--:--'} → {usual?.wake || '--:--'}{winH != null ? ` · ${winH}h` : ''}
      </div>

      <WindowControls usual={usual} run={run} api={api} />
    </section>
  )
}

/* usual-window time inputs, folded into the debt panel */
function WindowControls({ usual, run, api }) {
  const [sleep, setSleep] = useState(usual?.sleep || '')
  const [wake, setWake] = useState(usual?.wake || '')

  useEffect(() => { setSleep(usual?.sleep || ''); setWake(usual?.wake || '') }, [usual?.sleep, usual?.wake])

  const saveSleep = () => {
    if (sleep && sleep !== (usual?.sleep || '')) run(() => api.setWindow({ key: 'usual_sleep', value: sleep }))
  }
  const saveWake = () => {
    if (wake && wake !== (usual?.wake || '')) run(() => api.setWindow({ key: 'usual_wake', value: wake }))
  }

  return (
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
  )
}

/* ============================= 3 · last night + history ============================= */
function NightPanel({ logs, run, api }) {
  const [hours, setHours] = useState('')
  const list = logs || []
  const last = list.length ? list[0] : null
  const status = last ? statusOf(last.hours) : null
  const nights = list.slice(0, 14)
  const n = nights.length
  const avg = n ? nights.reduce((s, l) => s + (l.hours || 0), 0) / n : null

  const submit = async (e) => {
    e.preventDefault()
    const h = parseFloat(hours)
    if (!Number.isFinite(h) || h <= 0 || h > 24) return
    setHours('')
    await run(() => api.logNight({ hours: h }))
  }

  return (
    <section className="slp-block slp-night-panel">
      <div className="slp-night-top">
        <div className="slp-night-stat">
          <div className="slp-h slp-night-h">
            <span className="cap">Last night</span>
            {last && <span className="slp-h-sub anno">{last.date}</span>}
          </div>
          <div className="slp-night-figure">
            <span className="slp-big">{last ? fmtHM(last.hours) : '—'}</span>
            {status && <span className={`slp-pill ${status.tone}`}>{status.label}</span>}
          </div>
          {!last && <p className="slp-hero-empty">Log last night to start.</p>}
        </div>

        <form className="slp-logform" onSubmit={submit}>
          <label className="slp-log-lab anno" htmlFor="slp-hours">log last night</label>
          <div className="slp-log-row">
            <input id="slp-hours" className="rc-in slim" value={hours} inputMode="decimal"
              onChange={(e) => setHours(e.target.value)} placeholder="6.5" aria-label="Hours slept last night" />
            <button className="chip on" type="submit">save</button>
          </div>
        </form>
      </div>

      <div className="slp-h slp-hist-h">
        <span className="cap">Last 14 nights</span>
        {n > 0 && <span className="slp-h-sub anno">avg {avg.toFixed(1)}h · {n} nights</span>}
      </div>
      <History logs={logs} />
    </section>
  )
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
    <section className="slp-block slp-routine">
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
          <p className="anno">No wind-down yet. A short fixed sequence before bed is what makes tomorrow’s first block land.</p>
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
    <section className="slp-block slp-payoff">
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
