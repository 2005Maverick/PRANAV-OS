import { useEffect, useMemo, useState } from 'react'
import { createSleepApi } from './sleepApi.js'
import SleepDial, { LedgerStrip, PayoffMarks } from './SleepDial.jsx'

// SHEET 07 · SLEEP & ENERGY — the hand-drawn 24-hour dial is the whole point
// (see SleepDial.jsx). This file is the page: the dial's frame, the debt ledger
// input, the wind-down protocol checklist, the payoff read, and the sleep-window
// controls. Every mutation is optimistic where cheap and resyncs from the store.

const todayIso = () => new Date().toISOString().slice(0, 10)

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

  const debtAfter = d && d.logs && d.logs.length ? d.logs[0].debt_after : null

  return (
    <div className="page-wrap wide slp-sheet">
      <p className="page-voice">The night shift — when you actually sleep, and when the mind is sharp.</p>
      {err && <p className="slp-err anno" role="alert">{err}</p>}

      {d && (
        <div className="slp-grid">
          <section className="slp-hero">
            <SleepDial usual={d.usual} topology={d.topology} debt={debtAfter} />
            <SetWindow usual={d.usual} run={run} api={api} />
          </section>

          <div className="slp-side">
            <DebtLedger logs={d.logs} run={run} api={api} />
            <Protocol protocol={d.protocol} runs={d.runs} run={run} api={api} demo={demo} />
            <Payoff correlation={d.correlation} />
          </div>
        </div>
      )}
    </div>
  )
}

/* ============================= debt ledger ============================= */
function DebtLedger({ logs, run, api }) {
  const [hours, setHours] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    const h = parseFloat(hours)
    if (!Number.isFinite(h) || h <= 0 || h > 24) return
    setHours('')
    await run(() => api.logNight({ hours: h }))
  }

  return (
    <section className="slp-block">
      <div className="slp-h">
        <span className="cap">Debt ledger</span>
        <span className="anno slp-h-sub">last {Math.min((logs || []).length, 14)} nights · target 7.5h</span>
      </div>
      <LedgerStrip logs={logs} />
      <form className="slp-logform" onSubmit={submit}>
        <label className="slp-log-lab anno" htmlFor="slp-hours">how many hours last night?</label>
        <input id="slp-hours" className="rc-in slim" value={hours} inputMode="decimal"
          onChange={(e) => setHours(e.target.value)} placeholder="7.5" aria-label="Hours slept last night" />
        <button className="chip on" type="submit">log the night</button>
      </form>
    </section>
  )
}

/* ============================= wind-down protocol ============================= */
function Protocol({ protocol, runs, run, api, demo }) {
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
    // tally tonight's run whenever the count changes
    run(() => api.saveRun({ done: next.size, total }))
  }

  const openEdit = () => {
    setDraft(steps.map((s) => s.text).join('\n'))
    setEditing(true)
  }
  const saveEdit = async () => {
    const list = draft.split('\n').map((s) => s.trim()).filter(Boolean)
    await run(() => api.saveProtocol({ steps: list }))
    setEditing(false)
    setChecked(new Set())
    setFlash(demo ? 'Saved (demo)' : 'Wind-down saved')
    setTimeout(() => setFlash(null), 2500)
  }

  return (
    <section className="slp-block">
      <div className="slp-h">
        <span className="cap">Wind-down protocol</span>
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
                    {s.essential && <span className="slp-ess anno" title="Essential step">essential</span>}
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

/* ============================= payoff ============================= */
function Payoff({ correlation }) {
  const c = correlation || {}
  const has = c.with != null && c.without != null
  const ratio = has && c.without > 0 ? (c.with / c.without) : null

  return (
    <section className="slp-block">
      <div className="slp-h"><span className="cap">Does the wind-down pay?</span></div>
      <PayoffMarks withV={c.with ?? null} withoutV={c.without ?? null} />
      {has ? (
        <p className="slp-takeaway">
          {ratio && ratio >= 1.1
            ? <>Wind-down nights buy about <strong>{ratio.toFixed(1)}×</strong> the deep work — {c.with}h vs {c.without}h.</>
            : ratio && ratio <= 0.9
              ? <>No edge yet — {c.with}h with, {c.without}h without. Keep logging.</>
              : <>About even so far — {c.with}h with, {c.without}h without.</>}
        </p>
      ) : (
        <p className="slp-takeaway anno">Needs a couple of weeks of both kinds of nights before a verdict.</p>
      )}
    </section>
  )
}

/* ============================= set the sleep window ============================= */
function SetWindow({ usual, run, api }) {
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
      <span className="cap slp-window-h">Sleep window</span>
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
      <span className="anno slp-window-note">sets the inked band on the dial</span>
    </div>
  )
}
