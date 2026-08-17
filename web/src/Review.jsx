import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API || 'https://pranav-os.onrender.com'

const MOCK_REVIEW = {
  kind: 'weekly', start: '2026-08-11', end: '2026-08-17',
  floors: [
    { slug: 'trading', name: 'Trading', done: 5, target: 5, ok: true },
    { slug: 'research', name: 'Masters & Research', done: 2, target: 3, ok: false },
    { slug: 'tech', name: 'Tech Learning', done: 2, target: 5, ok: false },
    { slug: 'startup', name: 'Startup', done: 4, target: 4, ok: true },
    { slug: 'gym', name: 'Gym / Health', done: 5, target: 7, ok: false },
  ],
  reality: { domains: [
    { domain: 'internship', name: 'Internship', color: '#8C3A2E', planned_h: 14, done_h: 12.5, done: 9, skipped: 1, sacrificed: 0 },
    { domain: 'research', name: 'Masters & Research', color: '#3F6B52', planned_h: 6, done_h: 3.5, done: 2, skipped: 1, sacrificed: 1 },
    { domain: 'trading', name: 'Trading', color: '#3E5F86', planned_h: 5, done_h: 5, done: 5, skipped: 0, sacrificed: 0 },
    { domain: 'tech', name: 'Tech Learning', color: '#A5822B', planned_h: 3, done_h: 1.2, done: 2, skipped: 2, sacrificed: 1 },
  ] },
  nudges: { total_ignored: 3, kinds: [
    { kind: 'block_start', total: 22, ignored: 2 },
    { kind: 'checkin', total: 11, ignored: 1 },
  ] },
  proposals: [
    { id: 1, observation: 'Tech Learning died 3x in the late band this window', proposal: 'Stop scheduling Tech Learning in the late; move it to a different band' },
  ],
  ideas: [
    { id: 11, title: 'Newsletter audio version', body: 'auto-generate weekly audio', created: '2026-08-14' },
    { id: 12, title: 'A Can opener', body: null, created: '2026-08-17' },
  ],
  sleep: [], masters_days: 168,
}

function Bar({ value, max, color }) {
  return (
    <div className="rv-bar">
      <span style={{ width: `${Math.min((value / (max || 1)) * 100, 100)}%`, background: color }} />
    </div>
  )
}

export default function Review({ demo }) {
  const [data, setData] = useState(demo ? MOCK_REVIEW : null)
  const [flash, setFlash] = useState(null)
  const [doneIds, setDoneIds] = useState([])

  const load = () => {
    if (demo) return
    fetch(`${API}/api/review/weekly`).then((r) => r.json()).then(setData).catch(() => {})
  }
  useEffect(load, [])

  const act = async (path, body, label) => {
    if (demo) { setFlash(`${label} (demo)`); setTimeout(() => setFlash(null), 2500); return }
    try {
      const r = await fetch(`${API}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const d = await r.json()
      setFlash(d.reply || label)
      setTimeout(() => setFlash(null), 3500)
      load()
    } catch { setFlash('Failed — server unreachable') }
  }

  if (!data) return <div className="loading">reading the week…</div>

  const behind = data.floors.filter((f) => !f.ok)
  return (
    <div className="paper">
      <div className="rv-wrap">
        <header className="rv-head">
          <h2 className="rv-title">Week in review.</h2>
          <span className="rv-period mono">{data.start} → {data.end}</span>
          {flash && <span className="rv-flash">{flash}</span>}
        </header>

        <section className="rv-sec">
          <div className="rv-eyebrow mono">01 · Where you stand</div>
          <p className="rv-voice">
            {behind.length
              ? `${behind.length} of ${data.floors.length} weekly targets are behind — ${behind.map((f) => f.name).join(', ')}.`
              : 'Every weekly target met. That is rare air.'}
          </p>
          <div className="rv-floors">
            {data.floors.map((f) => (
              <div key={f.slug} className={`rv-floor ${f.ok ? 'ok' : ''}`}>
                <span className="rv-fname">{f.name}</span>
                <Bar value={f.done} max={f.target} color={f.ok ? '#7B8E7E' : '#B4762E'} />
                <span className="rv-fscore mono">{f.done}/{f.target}</span>
              </div>
            ))}
          </div>
        </section>

        <section className="rv-sec">
          <div className="rv-eyebrow mono">02 · Plan vs reality</div>
          <div className="rv-domains">
            {data.reality.domains.map((d) => (
              <div key={d.domain} className="rv-dom">
                <div className="rv-dom-line">
                  <span className="rv-dot" style={{ background: d.color }} />
                  <span className="rv-fname">{d.name}</span>
                  <span className="rv-fscore mono">
                    {d.done_h.toFixed(1)}h of {d.planned_h.toFixed(1)}h
                    {d.skipped ? ` · ${d.skipped} skipped` : ''}
                    {d.sacrificed ? ` · ${d.sacrificed} sacrificed` : ''}
                  </span>
                </div>
                <Bar value={d.done_h} max={d.planned_h} color={d.color} />
              </div>
            ))}
            {!data.reality.domains.length && <p className="rv-voice">No blocks recorded this window yet.</p>}
          </div>
        </section>

        <section className="rv-sec">
          <div className="rv-eyebrow mono">03 · Patterns — should the plan change?</div>
          {data.proposals.length ? data.proposals.map((p) => (
            <div key={p.id} className="rv-card">
              <div className="rv-obs">{p.observation}</div>
              <div className="rv-prop">{p.proposal}</div>
              <div className="rv-actions">
                <button className="rv-btn yes" onClick={() => act('/api/review/proposal', { id: p.id, approve: true }, 'Approved → standing rule')}>make it a rule</button>
                <button className="rv-btn" onClick={() => act('/api/review/proposal', { id: p.id, approve: false }, 'Rejected')}>reject</button>
              </div>
            </div>
          )) : <p className="rv-voice">No new patterns worth changing the plan for.</p>}
        </section>

        <section className="rv-sec">
          <div className="rv-eyebrow mono">04 · What you ignored</div>
          <p className="rv-voice">
            {data.nudges.total_ignored
              ? `${data.nudges.total_ignored} nudges went unanswered this window. Should the system change — or should you?`
              : 'You answered every nudge. The system and you are in sync.'}
          </p>
          {data.nudges.kinds.filter((k) => k.ignored > 0).map((k) => (
            <div key={k.kind} className="rv-nudge mono">{k.kind}: {k.ignored} of {k.total} ignored</div>
          ))}
        </section>

        <section className="rv-sec">
          <div className="rv-eyebrow mono">05 · This week's ideas</div>
          {data.ideas.filter((i) => !doneIds.includes(i.id)).map((i) => (
            <div key={i.id} className="rv-card">
              <div className="rv-obs">{i.title}</div>
              {i.body && <div className="rv-prop">{i.body}</div>}
              <div className="rv-actions">
                {['keep', 'schedule', 'kill'].map((a) => (
                  <button key={a} className={`rv-btn ${a === 'schedule' ? 'yes' : ''}`}
                    onClick={() => { setDoneIds([...doneIds, i.id]); act('/api/review/idea', { id: i.id, action: a }, `Idea ${a}`) }}>
                    {a}
                  </button>
                ))}
              </div>
            </div>
          ))}
          {!data.ideas.filter((i) => !doneIds.includes(i.id)).length && <p className="rv-voice">Idea inbox is clear.</p>}
        </section>

        <section className="rv-sec rv-final">
          <div className="rv-eyebrow mono">06 · Close the week</div>
          <div className="rv-actions">
            <button className="rv-btn yes big" onClick={() => act('/api/plan/tomorrow', {}, "Tomorrow drafted — check the bot")}>draft tomorrow</button>
            <button className="rv-btn big" onClick={() => act('/api/review/complete', { kind: data.kind }, 'Week closed. Go live it.')}>complete review</button>
          </div>
        </section>
      </div>
    </div>
  )
}
