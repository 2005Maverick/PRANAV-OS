import { useEffect, useMemo, useState } from 'react'
import { createArcsApi } from './arcsApi.js'
import ArcRoute from './ArcRoute.jsx'

// SHEET 06 · ARCS — the long game. Every arc is a hand-inked survey route
// (see ArcRoute.jsx). This file is the page: the stack of route cards, the
// inline step/goal editors, and the optimistic API plumbing.

const DOMAINS = ['research', 'uni', 'internship', 'startup', 'tech', 'trading', 'gym', 'reward']
const TYPES = [
  ['project', 'Project'], ['umbrella', 'Umbrella'], ['target', 'Target'], ['ongoing', 'Keep-going'],
]
const TYPE_LABEL = { project: 'Project', umbrella: 'Umbrella', target: 'Target', ongoing: 'Keep-going' }

const inr = (n) => (n || 0).toLocaleString('en-IN')
const money = (n, unit) => `${unit || '₹'}${inr(n)}`

function findNode(arcs, id) {
  for (const a of arcs) {
    if (a.id === id) return a
    const hit = findNode(a.children || [], id)
    if (hit) return hit
  }
  return null
}

function urgencyRank(a) {
  if (a.days_left == null) return Number.MAX_SAFE_INTEGER
  return a.days_left
}

/* ============================= page ============================= */
export default function Arcs({ demo }) {
  const api = useMemo(() => createArcsApi(demo), [demo])
  const [arcs, setArcs] = useState([])
  const [today, setToday] = useState(null)
  const [err, setErr] = useState(null)
  const [loading, setLoading] = useState(true)
  const [focusId, setFocusId] = useState(null)
  const [openId, setOpenId] = useState(null)
  const [editing, setEditing] = useState(null) // {arcId, stepId}
  const [newOpen, setNewOpen] = useState(false)

  const refresh = async () => {
    try {
      const d = await api.getTree()
      setArcs([...d.arcs].sort((a, b) => urgencyRank(a) - urgencyRank(b)))
      setToday(d.today)
      setErr(null)
    } catch {
      setErr('Could not load your arcs — check the connection or the cockpit key.')
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

  const openChild = (id) => { setFocusId(id); setEditing(null) }

  if (loading) return <div className="loading">plotting the long game…</div>

  const focus = focusId ? findNode(arcs, focusId) : null

  return (
    <div className="page-wrap wide arcs-sheet">
      <div className="arcs-top">
        <p className="page-voice">The long game — every arc a route, surveyed by hand.</p>
        {!focus && (
          <button className="btn btn-primary arcs-new-btn" onClick={() => setNewOpen((v) => !v)}>
            ＋ New goal
          </button>
        )}
      </div>

      {err && <p className="arcs-err anno" role="alert">{err}</p>}

      {newOpen && !focus && (
        <NewGoalForm onCancel={() => setNewOpen(false)} onCreate={async (body) => {
          await run(() => api.createArc(body))
          setNewOpen(false)
        }} />
      )}

      {focus ? (
        <div className="arcs-focus">
          <button className="arcs-back anno" onClick={() => setFocusId(null)}>‹ back to the set</button>
          <ArcCard node={focus} today={today} expanded api={api} run={run}
            editing={editing} setEditing={setEditing} onOpenChild={openChild} focusMode />
        </div>
      ) : (
        <div className="arcs-stack">
          {arcs.map((node) => (
            <ArcCard key={node.id} node={node} today={today}
              expanded={openId === node.id}
              onToggle={() => { setOpenId(openId === node.id ? null : node.id); setEditing(null) }}
              api={api} run={run} editing={editing} setEditing={(e) => { setEditing(e); if (e) setOpenId(node.id) }}
              onOpenChild={openChild} />
          ))}
          {!arcs.length && (
            <p className="arcs-empty anno">No arcs yet. Draw the first route with ＋ New goal.</p>
          )}
        </div>
      )}
    </div>
  )
}

/* ============================= one route card ============================= */
function ArcCard({ node, today, expanded, onToggle, api, run, editing, setEditing, onOpenChild, focusMode }) {
  const headMeta = () => {
    if (node.type === 'ongoing') return `${node.rhythm.on_rhythm}/${node.rhythm.total} on rhythm`
    if (node.type === 'target') return `${node.target?.pct ?? 0}%`
    return `${node.progress ?? 0}%`
  }

  const onStepClick = (step) => setEditing({ arcId: node.id, stepId: step.id })
  const onTick = (step) => run(() => api.tickStep(step.id))

  return (
    <article className="route-card" style={{ '--c': `var(--m-${node.domain}, var(--_p-graph))` }}>
      <button className="rc-head" onClick={focusMode ? undefined : onToggle}
        aria-expanded={expanded} disabled={focusMode}>
        <span className="rc-head-l">
          <span className="rc-dom-dot" aria-hidden="true" />
          <span className="rc-title">{node.title}</span>
          <span className="rc-type anno">{TYPE_LABEL[node.type]}{node.domain ? ` · ${node.domain}` : ''}</span>
        </span>
        <span className="rc-head-r">
          <span className="rc-meta anno">{headMeta()}</span>
          {node.days_left != null && (
            <span className={`rc-days anno ${node.days_left < 14 ? 'soon' : ''}`}>
              {node.days_left < 0 ? `${Math.abs(node.days_left)}d over` : `${node.days_left}d left`}
            </span>
          )}
          {!focusMode && <span className="rc-chev anno" aria-hidden="true">{expanded ? '▾' : '▸'}</span>}
        </span>
      </button>

      <div className="rc-draw">
        <ArcRoute node={node} today={today} onOpenChild={onOpenChild}
          onStepClick={onStepClick} onTick={onTick} />
      </div>

      {node.type === 'target' && node.target && <TargetReadout t={node.target} days={node.days_left} />}

      {expanded && (
        <div className="rc-body">
          <ArcBody node={node} api={api} run={run} editing={editing} setEditing={setEditing}
            onOpenChild={onOpenChild} />
          <ArcActions node={node} api={api} run={run} onClosed={() => onOpenChild(null)} />
        </div>
      )}
    </article>
  )
}

/* ---------- target numeric readout (always visible on target cards) ---------- */
function TargetReadout({ t, days }) {
  return (
    <div className="tg-readout">
      <div className="tg-big">
        <span className="tg-amount">{money(t.amount, t.unit)}</span>
        <span className="tg-of anno"> / {money(t.target, t.unit)}</span>
      </div>
      <div className="tg-pace anno">
        {days != null && <span>{days < 0 ? `${Math.abs(days)}d over` : `${days} days left`} · </span>}
        <span className={t.on_pace ? '' : 'off'}>
          need {money(t.need_per_week, t.unit)}/wk · at {money(t.at_per_week, t.unit)}/wk
        </span>
      </div>
    </div>
  )
}

/* ============================= expanded body per type ============================= */
function ArcBody({ node, api, run, editing, setEditing, onOpenChild }) {
  if (node.type === 'target') {
    return <TargetBody node={node} api={api} run={run} />
  }
  if (node.type === 'ongoing') {
    // the tick-rails live in the drawing; here we edit the keep list
    return (
      <>
        <StepList node={node} api={api} run={run} editing={editing} setEditing={setEditing}
          kinds={['keep']} />
        <AddStep node={node} api={api} run={run} kinds={['keep', 'checkpoint']} />
      </>
    )
  }
  // project + umbrella
  return (
    <>
      {node.type === 'umbrella' && node.children.length > 0 && (
        <div className="rc-children">
          <div className="rc-sub-h cap">Sub-goals</div>
          {node.children.map((c) => (
            <button key={c.id} className="rc-child-row" onClick={() => onOpenChild(c.id)}
              style={{ '--c': `var(--m-${c.domain}, var(--_p-graph))` }}>
              <span className="rc-child-dot" aria-hidden="true" />
              <span className="rc-child-title">{c.title}</span>
              <span className="rc-child-meta anno">{c.progress ?? 0}% · open ›</span>
            </button>
          ))}
        </div>
      )}
      <StepList node={node} api={api} run={run} editing={editing} setEditing={setEditing}
        kinds={node.type === 'umbrella' ? ['keep', 'checkpoint'] : ['do', 'checkpoint']} />
      <div className="rc-add-row">
        <AddStep node={node} api={api} run={run}
          kinds={node.type === 'umbrella' ? ['keep', 'checkpoint'] : ['do', 'checkpoint']} />
        {node.type === 'umbrella' && <AddSubGoal node={node} api={api} run={run} />}
      </div>
    </>
  )
}

/* ---------- editable step list ---------- */
function StepList({ node, api, run, editing, setEditing, kinds }) {
  const steps = node.steps.filter((s) => kinds.includes(s.kind))
  if (!steps.length) return <p className="rc-none anno">No {kinds.join('/')} steps yet.</p>
  return (
    <ul className="rc-steps">
      {steps.map((s) => (
        <li key={s.id} className="rc-step">
          {editing && editing.stepId === s.id ? (
            <StepEditor step={s} api={api} run={run} onClose={() => setEditing(null)} />
          ) : (
            <button className="rc-step-row" onClick={() => setEditing({ arcId: node.id, stepId: s.id })}>
              <span className={`rc-step-mark ${s.kind} ${s.done ? 'done' : ''}`} aria-hidden="true">
                {s.kind === 'checkpoint' ? '◆' : s.done ? '●' : '○'}
              </span>
              <span className="rc-step-title">{s.title}</span>
              <span className="rc-step-meta anno">
                {s.kind === 'do' && s.est_minutes ? fmtHrs(s.est_minutes) : ''}
                {s.kind === 'keep' && s.cadence ? s.cadence : ''}
                {s.kind === 'checkpoint' && s.waiting_on ? `waiting: ${s.waiting_on}` : ''}
              </span>
            </button>
          )}
        </li>
      ))}
    </ul>
  )
}

const fmtHrs = (m) => (m % 60 === 0 ? `${m / 60}h` : `${(m / 60).toFixed(1)}h`)

/* ---------- inline step editor ---------- */
function StepEditor({ step, api, run, onClose }) {
  const [title, setTitle] = useState(step.title)
  const [waiting, setWaiting] = useState(step.waiting_on || '')
  const [cadence, setCadence] = useState(step.cadence || 'weekly')

  const saveTitle = () => {
    const t = title.trim()
    if (t && t !== step.title) run(() => api.updateStep(step.id, { title: t }))
  }
  const appendEst = (mins) => run(() => api.updateStep(step.id, { est_minutes: (step.est_minutes || 0) + mins }))
  const logTime = (mins) => run(() => api.logStep(step.id, { minutes: mins }))
  const toggleDone = () => run(() => api.updateStep(step.id, { done: !step.done }))
  const saveWaiting = () => run(() => api.updateStep(step.id, { waiting_on: waiting.trim() || null }))
  const saveCadence = (c) => { setCadence(c); run(() => api.updateStep(step.id, { cadence: c })) }
  const del = () => run(() => api.deleteStep(step.id))

  return (
    <div className="rc-editor">
      <input className="rc-in" value={title} onChange={(e) => setTitle(e.target.value)}
        onBlur={saveTitle} onKeyDown={(e) => e.key === 'Enter' && (saveTitle(), onClose())}
        aria-label="Step title" autoFocus />

      {step.kind === 'do' && (
        <div className="rc-ed-row">
          <span className="rc-ed-lab anno">plan</span>
          <button className="chip" onClick={() => appendEst(30)}>+30m</button>
          <button className="chip" onClick={() => appendEst(60)}>+1h</button>
          <span className="rc-ed-est anno">{step.est_minutes ? fmtHrs(step.est_minutes) : 'no est'}</span>
          <span className="rc-ed-lab anno">did</span>
          <button className="chip" onClick={() => logTime(30)}>log 30m</button>
          <button className="chip" onClick={() => logTime(60)}>log 1h</button>
          <button className={`chip ${step.done ? 'on' : ''}`} onClick={toggleDone}>
            {step.done ? '✓ done' : 'mark done'}
          </button>
        </div>
      )}

      {step.kind === 'checkpoint' && (
        <div className="rc-ed-row">
          <button className={`chip ${step.done ? 'on' : ''}`} onClick={toggleDone}>
            {step.done ? '✓ reached' : 'mark reached'}
          </button>
          <input className="rc-in slim" value={waiting} onChange={(e) => setWaiting(e.target.value)}
            onBlur={saveWaiting} placeholder="waiting on…" aria-label="Waiting on" />
        </div>
      )}

      {step.kind === 'keep' && (
        <div className="rc-ed-row">
          <button className="chip" onClick={() => run(() => api.tickStep(step.id))}>✓ did it today</button>
          <select className="rc-sel" value={cadence} onChange={(e) => saveCadence(e.target.value)}
            aria-label="Cadence">
            <option value="daily">daily</option>
            <option value="weekly">weekly</option>
          </select>
        </div>
      )}

      <div className="rc-ed-foot">
        <button className="chip danger" onClick={del}>delete</button>
        <button className="chip" onClick={onClose}>done</button>
      </div>
    </div>
  )
}

/* ---------- add step ---------- */
function AddStep({ node, api, run, kinds }) {
  const [open, setOpen] = useState(false)
  const [kind, setKind] = useState(kinds[0])
  const [title, setTitle] = useState('')
  const [hours, setHours] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    const t = title.trim()
    if (!t) return
    const body = { kind, title: t }
    if (kind === 'do' && hours) body.est_minutes = Math.round(parseFloat(hours) * 60)
    if (kind === 'keep') body.cadence = 'weekly'
    await run(() => api.addStep(node.id, body))
    setTitle(''); setHours(''); setOpen(false)
  }

  if (!open) return <button className="rc-add anno" onClick={() => setOpen(true)}>＋ add step</button>
  return (
    <form className="rc-add-form" onSubmit={submit}>
      {kinds.length > 1 && (
        <select className="rc-sel" value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Step kind">
          {kinds.map((k) => <option key={k} value={k}>{k}</option>)}
        </select>
      )}
      <input className="rc-in" value={title} onChange={(e) => setTitle(e.target.value)}
        placeholder="what's the step?" aria-label="Step title" autoFocus />
      {kind === 'do' && (
        <input className="rc-in slim" value={hours} onChange={(e) => setHours(e.target.value)}
          placeholder="hrs" inputMode="decimal" aria-label="Estimated hours" />
      )}
      <button className="chip on" type="submit">add</button>
      <button className="chip" type="button" onClick={() => setOpen(false)}>×</button>
    </form>
  )
}

/* ---------- add sub-goal (umbrella) ---------- */
function AddSubGoal({ node, api, run }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('')

  const submit = async (e) => {
    e.preventDefault()
    const t = title.trim()
    if (!t) return
    await run(() => api.createArc({ title: t, type: 'project', domain: node.domain, parent_id: node.id }))
    setTitle(''); setOpen(false)
  }

  if (!open) return <button className="rc-add anno" onClick={() => setOpen(true)}>＋ sub-goal</button>
  return (
    <form className="rc-add-form" onSubmit={submit}>
      <input className="rc-in" value={title} onChange={(e) => setTitle(e.target.value)}
        placeholder="new sub-goal…" aria-label="Sub-goal title" autoFocus />
      <button className="chip on" type="submit">add</button>
      <button className="chip" type="button" onClick={() => setOpen(false)}>×</button>
    </form>
  )
}

/* ---------- target body — contribs + add saving ---------- */
function TargetBody({ node, api, run }) {
  const [amount, setAmount] = useState('')
  const [note, setNote] = useState('')
  const [contribs, setContribs] = useState(null)

  useEffect(() => {
    let live = true
    api.getNode(node.id).then((n) => { if (live) setContribs(n.contribs || []) }).catch(() => {})
    return () => { live = false }
  }, [api, node.id, node.progress])

  const submit = async (e) => {
    e.preventDefault()
    const a = parseFloat(amount)
    if (!a || a <= 0) return
    await run(() => api.addContrib(node.id, { amount: Math.round(a), note: note.trim() }))
    setAmount(''); setNote('')
  }

  const unit = node.target?.unit || '₹'
  return (
    <div className="tg-body">
      <div className="rc-sub-h cap">Savings logged</div>
      <ul className="tg-list">
        {(contribs || []).map((c) => (
          <li key={c.id} className="tg-item">
            <span className="tg-item-amt">{money(c.amount, unit)}</span>
            <span className="tg-item-note">{c.note || '—'}</span>
            <span className="tg-item-date anno">{(c.on_date || '').slice(5)}</span>
          </li>
        ))}
        {contribs && !contribs.length && <li className="rc-none anno">Nothing saved yet.</li>}
      </ul>
      <form className="tg-add" onSubmit={submit}>
        <span className="tg-add-unit anno">{unit}</span>
        <input className="rc-in slim" value={amount} onChange={(e) => setAmount(e.target.value)}
          placeholder="amount" inputMode="numeric" aria-label="Saving amount" />
        <input className="rc-in" value={note} onChange={(e) => setNote(e.target.value)}
          placeholder="note (optional)" aria-label="Saving note" />
        <button className="chip on" type="submit">＋ add saving</button>
      </form>
    </div>
  )
}

/* ---------- arc-level actions (edit deadline / delete) ---------- */
function ArcActions({ node, api, run, onClosed }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState(node.title)
  const [deadline, setDeadline] = useState(node.deadline || '')

  const saveTitle = () => {
    const t = title.trim()
    if (t && t !== node.title) run(() => api.updateArc(node.id, { title: t }))
  }
  const saveDeadline = () => {
    if (deadline !== (node.deadline || '')) run(() => api.updateArc(node.id, { deadline: deadline || null }))
  }
  const del = () => {
    if (!window.confirm(`Delete “${node.title}” and everything under it? This can't be undone.`)) return
    run(() => api.deleteArc(node.id)).then(() => onClosed && onClosed())
  }

  if (!open) {
    return (
      <div className="rc-actions">
        <button className="rc-add anno" onClick={() => setOpen(true)}>⚙ arc settings</button>
      </div>
    )
  }
  return (
    <div className="rc-actions open">
      <label className="rc-field">
        <span className="rc-ed-lab anno">title</span>
        <input className="rc-in" value={title} onChange={(e) => setTitle(e.target.value)} onBlur={saveTitle} />
      </label>
      {node.type !== 'ongoing' && (
        <label className="rc-field">
          <span className="rc-ed-lab anno">deadline</span>
          <input className="rc-in slim" type="date" value={deadline}
            onChange={(e) => setDeadline(e.target.value)} onBlur={saveDeadline} />
        </label>
      )}
      <div className="rc-ed-foot">
        <button className="chip danger" onClick={del}>delete arc</button>
        <button className="chip" onClick={() => setOpen(false)}>close</button>
      </div>
    </div>
  )
}

/* ---------- new goal form ---------- */
function NewGoalForm({ onCreate, onCancel }) {
  const [type, setType] = useState('project')
  const [title, setTitle] = useState('')
  const [domain, setDomain] = useState('research')
  const [deadline, setDeadline] = useState('')
  const [amount, setAmount] = useState('')
  const [unit, setUnit] = useState('₹')

  const submit = (e) => {
    e.preventDefault()
    const t = title.trim()
    if (!t) return
    const body = { title: t, type, domain }
    if (type !== 'ongoing' && deadline) body.deadline = deadline
    if (type === 'target') {
      body.target_amount = Math.round(parseFloat(amount) || 0)
      body.target_unit = unit || '₹'
    }
    onCreate(body)
  }

  return (
    <form className="arcs-newform" onSubmit={submit}>
      <div className="nf-types">
        {TYPES.map(([v, label]) => (
          <button key={v} type="button" className={`nf-type ${type === v ? 'on' : ''}`}
            onClick={() => setType(v)}>{label}</button>
        ))}
      </div>
      <div className="nf-fields">
        <input className="rc-in" value={title} onChange={(e) => setTitle(e.target.value)}
          placeholder="name the arc…" aria-label="Goal title" autoFocus />
        <select className="rc-sel" value={domain} onChange={(e) => setDomain(e.target.value)} aria-label="Domain">
          {DOMAINS.map((d) => <option key={d} value={d}>{d}</option>)}
        </select>
        {type !== 'ongoing' && (
          <input className="rc-in slim" type="date" value={deadline}
            onChange={(e) => setDeadline(e.target.value)} aria-label="Deadline" />
        )}
        {type === 'target' && (
          <>
            <input className="rc-in slim" value={unit} onChange={(e) => setUnit(e.target.value)}
              placeholder="₹" aria-label="Unit" />
            <input className="rc-in slim" value={amount} onChange={(e) => setAmount(e.target.value)}
              placeholder="target amount" inputMode="numeric" aria-label="Target amount" />
          </>
        )}
        <button className="btn btn-primary" type="submit">Draw it</button>
        <button className="btn" type="button" onClick={onCancel}>Cancel</button>
      </div>
    </form>
  )
}
