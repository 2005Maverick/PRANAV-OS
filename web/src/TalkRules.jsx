import { useEffect, useRef, useState } from 'react'

const API = import.meta.env.VITE_API || 'https://pranav-os.onrender.com'

const MOCK_TALK = {
  messages: [
    { role: 'user', content: 'thinking the newsletter could pivot to per-niche versions' },
    { role: 'assistant', content: 'You decided on Aug 11 to deploy the text product first. This is ~6 sessions of new scope. File it as post-launch, or argue why it beats shipping.' },
  ],
  decisions: [
    { id: 1, topic: 'newsletter stack', decision: 'text product first, audio after deploy', created: '2026-08-11' },
  ],
}

const MOCK_RULES = {
  rules: [
    { id: 1, kind: 'preference', rule_text: 'Deep work scheduled in stated peaks: 22:00-01:00', source: 'explicit', approved: '2026-08-17' },
    { id: 2, kind: 'learned', rule_text: 'Stop scheduling Tech Learning in the late; move it earlier', source: 'pattern_approved', approved: '2026-08-17' },
  ],
  floors: [
    { slug: 'research', name: 'Masters & Research', floor_type: 'sessions_per_window', floor_target: 3, floor_minutes: 90 },
    { slug: 'trading', name: 'Trading', floor_type: 'sessions_per_window', floor_target: 5, floor_minutes: 60 },
    { slug: 'tech', name: 'Tech Learning', floor_type: 'sessions_per_window', floor_target: 5, floor_minutes: 35 },
  ],
  settings: { checkin_minutes: '45', nudge_tone: 'blunt', reading_day: 'saturday', reading_hour: '10', usual_sleep: '00:30', usual_wake: '07:45', masters_date: '2027-02-01' },
  proposals: [],
}

export function Talk({ demo }) {
  const [data, setData] = useState(demo ? MOCK_TALK : null)
  const [val, setVal] = useState('')
  const [busy, setBusy] = useState(false)
  const endRef = useRef(null)

  const load = () => {
    if (demo) return
    fetch(`${API}/api/talk`).then((r) => r.json()).then(setData).catch(() => {})
  }
  useEffect(load, [])
  useEffect(() => { endRef.current?.scrollIntoView({ behavior: 'smooth' }) }, [data])

  const send = async (e) => {
    e.preventDefault()
    const text = val.trim()
    if (!text || busy) return
    setVal('')
    setData((d) => ({ ...d, messages: [...d.messages, { role: 'user', content: text }] }))
    if (demo) {
      setData((d) => ({ ...d, messages: [...d.messages, { role: 'assistant', content: '(demo) I hear you — the real brain answers when connected.' }] }))
      return
    }
    setBusy(true)
    const r = await fetch(`${API}/api/talk`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: text }),
    }).then((x) => x.json()).catch(() => ({ reply: 'Server unreachable.' }))
    setBusy(false)
    setData((d) => ({ ...d, messages: [...d.messages, { role: 'assistant', content: r.reply }] }))
    if (text.toLowerCase().startsWith('decide:')) load()
  }

  if (!data) return <div className="loading">entering the room…</div>
  return (
    <div className="talk-wrap">
      <div className="talk-main">
        <div className="talk-scroll">
          {data.messages.map((m, i) => (
            <div key={i} className={`talk-msg ${m.role}`}>
              <div className="talk-bubble">{m.content}</div>
            </div>
          ))}
          {busy && <div className="talk-msg assistant"><div className="talk-bubble dim2">thinking…</div></div>}
          <div ref={endRef} />
        </div>
        <form className="talk-input" onSubmit={send}>
          <input value={val} onChange={(e) => setVal(e.target.value)}
            placeholder="think out loud — or `decide: …` to log a decision" />
          <button className="rc-send" type="submit">➤</button>
        </form>
      </div>
      <aside className="talk-side">
        <div className="label mono" style={{ marginBottom: 10 }}>Decisions on record</div>
        {data.decisions.map((d) => (
          <div key={d.id} className="lib-card" style={{ marginBottom: 8 }}>
            <div className="lib-title" style={{ fontSize: 13 }}>{d.topic}</div>
            <div className="lib-body">{d.decision}</div>
            <div className="mono dim2">{d.created}</div>
          </div>
        ))}
        {!data.decisions.length && <div className="lst-empty">say `decide: …` and it lives here forever</div>}
      </aside>
    </div>
  )
}

export function Rules({ demo }) {
  const [data, setData] = useState(demo ? MOCK_RULES : null)
  const [newRule, setNewRule] = useState('')
  const [flash, setFlash] = useState(null)

  const load = () => {
    if (demo) return
    fetch(`${API}/api/rules`).then((r) => r.json()).then(setData).catch(() => {})
  }
  useEffect(load, [])
  const note = (m) => { setFlash(m); setTimeout(() => setFlash(null), 2500) }
  const post = async (path, body, label) => {
    if (demo) return note(`${label} (demo)`)
    await fetch(`${API}${path}`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
    }).catch(() => {})
    note(label)
    load()
  }

  if (!data) return <div className="loading">reading the contract…</div>
  return (
    <div className="page-wrap wide">
      <p className="page-voice">The system's contract with you — every rule visible, every rule yours.</p>
      {flash && <div className="rc-hint mono" style={{ color: 'var(--acid)', marginBottom: 10 }}>{flash}</div>}
      <div className="rules-cols">
        <div>
          <div className="fin-sec"><div className="label mono">Standing rules</div>
            {data.rules.map((r) => (
              <div key={r.id} className="fin-row">
                <span>{r.rule_text}</span>
                <span className="mono dim2">{r.source === 'pattern_approved' ? 'learned' : 'yours'} · {r.approved}</span>
                <button className="rv-btn dark-btn" onClick={() => post('/api/rules/rule-off', { id: r.id }, 'Rule retired')}>retire</button>
              </div>
            ))}
            <div className="vault-row" style={{ marginTop: 10 }}>
              <input className="lib-search" placeholder="new rule — e.g. no hard work before 11"
                value={newRule} onChange={(e) => setNewRule(e.target.value)} />
              <button className="rv-btn dark-btn"
                onClick={() => { if (newRule.trim()) { post('/api/rules/rule', { text: newRule }, 'Rule added'); setNewRule('') } }}>add</button>
            </div>
          </div>
          {data.proposals.length > 0 && (
            <div className="fin-sec"><div className="label mono">Waiting for your call</div>
              {data.proposals.map((p) => (
                <div key={p.id} className="lib-card" style={{ marginBottom: 8 }}>
                  <div className="lib-body">{p.observation}</div>
                  <div className="lib-title" style={{ fontSize: 13 }}>{p.proposal}</div>
                  <div className="rv-actions">
                    <button className="rv-btn dark-btn" onClick={() => post('/api/review/proposal', { id: p.id, approve: true }, 'Now a rule')}>approve</button>
                    <button className="rv-btn dark-btn" onClick={() => post('/api/review/proposal', { id: p.id, approve: false }, 'Rejected')}>reject</button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
        <div>
          <div className="fin-sec"><div className="label mono">Weekly minimums</div>
            {data.floors.filter((f) => f.floor_type !== 'none').map((f) => (
              <div key={f.slug} className="fin-row">
                <span>{f.name}</span>
                <input className="rules-num mono" type="number" defaultValue={f.floor_target ?? ''}
                  onBlur={(e) => post('/api/rules/floor', { slug: f.slug, target: Number(e.target.value) || null }, `${f.name} floor updated`)} />
                <span className="dim2 mono">×</span>
                <input className="rules-num mono" type="number" defaultValue={f.floor_minutes ?? ''}
                  onBlur={(e) => post('/api/rules/floor', { slug: f.slug, minutes: Number(e.target.value) || null }, `${f.name} minutes updated`)} />
                <span className="dim2 mono">min</span>
              </div>
            ))}
          </div>
          <div className="fin-sec"><div className="label mono">Dials</div>
            {[
              ['checkin_minutes', 'check-in every (min)'],
              ['nudge_tone', 'nudge tone (blunt/firm/light)'],
              ['checkin_start', 'check-ins from (HH:MM)'],
              ['checkin_end', 'check-ins until (HH:MM)'],
              ['reading_day', 'reading slot day'],
              ['reading_hour', 'reading slot hour'],
              ['usual_sleep', 'usual sleep (HH:MM)'],
              ['usual_wake', 'usual wake (HH:MM)'],
              ['masters_date', 'masters date (YYYY-MM-DD)'],
            ].map(([k, label]) => (
              <div key={k} className="fin-row">
                <span>{label}</span>
                <input className="rules-set mono" defaultValue={data.settings[k] || ''}
                  onBlur={(e) => e.target.value && post('/api/rules/setting', { key: k, value: e.target.value }, `${label} saved`)} />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
