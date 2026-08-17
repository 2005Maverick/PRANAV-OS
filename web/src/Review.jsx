import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API || 'https://pranav-os.onrender.com'
const domainCode = (domain) => `var(--m-${domain || 'reward'}, var(--_p-graph))`

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
    { domain: 'internship', name: 'Internship', planned_h: 14, done_h: 12.5, done: 9, skipped: 1, sacrificed: 0 },
    { domain: 'research', name: 'Masters & Research', planned_h: 6, done_h: 3.5, done: 2, skipped: 1, sacrificed: 1 },
    { domain: 'trading', name: 'Trading', planned_h: 5, done_h: 5, done: 5, skipped: 0, sacrificed: 0 },
    { domain: 'tech', name: 'Tech Learning', planned_h: 3, done_h: 1.2, done: 2, skipped: 2, sacrificed: 1 },
  ] },
  nudges: { total_ignored: 3, kinds: [
    { kind: 'block_start', total: 22, ignored: 2 },
    { kind: 'checkin', total: 11, ignored: 1 },
  ] },
  proposals: [
    { id: 1, observation: 'Tech Learning died 3× in the late band this window', proposal: 'Stop scheduling Tech Learning late; move it to the class gap' },
  ],
  ideas: [
    { id: 11, title: 'Newsletter audio version', body: 'auto-generate weekly audio', created: '2026-08-14' },
    { id: 12, title: 'A Can opener', body: null, created: '2026-08-17' },
  ],
  masters_days: 168,
}

export default function Review({ demo }) {
  const [data, setData] = useState(demo ? MOCK_REVIEW : null)
  const [flash, setFlash] = useState(null)
  const [doneIds, setDoneIds] = useState([])
  const [signed, setSigned] = useState(false)

  const load = () => {
    if (demo) return
    fetch(`${API}/api/review/weekly`).then((r) => r.json()).then(setData).catch(() => {})
  }
  useEffect(load, [])

  const act = async (path, body, label) => {
    if (demo) { setFlash(`${label} (demo)`); setTimeout(() => setFlash(null), 2500); return true }
    try {
      const r = await fetch(`${API}${path}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
      })
      const d = await r.json()
      setFlash(d.reply || label)
      setTimeout(() => setFlash(null), 3500)
      load()
      return true
    } catch {
      setFlash('Could not reach the server.')
      setTimeout(() => setFlash(null), 3500)
      return false
    }
  }

  if (!data) {
    return (
      <div className="sheet-loading" aria-label="Reading the week">
        <div className="skel" style={{ height: 48, width: '40%' }} />
        <div className="skel" style={{ height: 96 }} />
        <div className="skel" style={{ height: 96, width: '80%' }} />
      </div>
    )
  }

  const behind = data.floors.filter((f) => !f.ok)
  const weekNo = Math.ceil((new Date(data.end) - new Date(data.end.slice(0, 4) + '-01-01')) / 604800000)
  const ideas = data.ideas.filter((i) => !doneIds.includes(i.id))

  return (
    <div className="review">
      <div className="rv-doc">
        <p className="rv-intro">The week, checked before issue.</p>
        <span className="rv-period">{data.start} → {data.end}</span>
        {flash && <span className="rv-flash">{flash}</span>}

        <div className="rv-cols">
        <div>
        <section className="rvs">
          <span className="rvs-idx" aria-hidden="true">01</span>
          <div>
            <h2 className="rvs-title">Where you stand</h2>
            <p className="rvs-note">
              {behind.length
                ? `${behind.length} of ${data.floors.length} weekly minimums are behind: ${behind.map((f) => f.name).join(', ')}.`
                : 'Every weekly minimum met. Rare air.'}
            </p>
            {data.floors.map((f) => (
              <div key={f.slug} className={`rv-min ${f.ok ? 'ok' : ''}`}>
                <div className="rv-min-line">
                  <span className="rv-min-name">{f.name}</span>
                  <span className="rv-min-score">{f.done}/{f.target}</span>
                </div>
                <div className="rv-ticks">
                  {Array.from({ length: f.target }, (_, i) => (
                    <span key={i} className={i < f.done ? 'f' : ''} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>

        <section className="rvs">
          <span className="rvs-idx" aria-hidden="true">04</span>
          <div>
            <h2 className="rvs-title">What you ignored</h2>
            <p className="rvs-note">
              {data.nudges.total_ignored
                ? `${data.nudges.total_ignored} nudges went unanswered. Should the system change — or should you?`
                : 'Every nudge answered. You and the system are in step.'}
            </p>
            {data.nudges.kinds.filter((k) => k.ignored > 0).map((k) => (
              <div key={k.kind} className="pvr-num" style={{ display: 'block', marginBottom: 'var(--s-1)' }}>
                {k.kind.replace('_', ' ')}: {k.ignored} of {k.total} ignored
              </div>
            ))}
          </div>
        </section>
        </div>

        <div>
        <section className="rvs">
          <span className="rvs-idx" aria-hidden="true">02</span>
          <div>
            <h2 className="rvs-title">Plan against reality</h2>
            {data.reality.domains.map((d) => (
              <div key={d.domain} className="pvr" style={{ '--c': domainCode(d.domain) }}>
                <div className="pvr-line">
                  <span className="pvr-name"><span className="swatch" aria-hidden="true" />{d.name}</span>
                  <span className="pvr-num">
                    {d.done_h.toFixed(1)}h of {d.planned_h.toFixed(1)}h
                    {d.skipped ? ` · ${d.skipped} skipped` : ''}{d.sacrificed ? ` · ${d.sacrificed} moved` : ''}
                  </span>
                </div>
                <div className="pvr-track">
                  <span className="pvr-done" style={{ width: `${Math.min((d.done_h / (d.planned_h || 1)) * 100, 100)}%` }} />
                </div>
              </div>
            ))}
            {!data.reality.domains.length && <p className="rvs-note">No blocks recorded in this window yet.</p>}
          </div>
        </section>

        <section className="rvs">
          <span className="rvs-idx" aria-hidden="true">03</span>
          <div>
            <h2 className="rvs-title">Change orders</h2>
            {data.proposals.length ? data.proposals.map((p) => (
              <div key={p.id} className="co-card">
                <div className="co-obs">{p.observation}</div>
                <div className="co-prop">{p.proposal}</div>
                <div className="co-actions">
                  <button className="btn btn-primary" onClick={() => act('/api/review/proposal', { id: p.id, approve: true }, 'Change order issued — now a standing rule')}>
                    Issue change order
                  </button>
                  <button className="btn" onClick={() => act('/api/review/proposal', { id: p.id, approve: false }, 'Rejected')}>Reject</button>
                </div>
              </div>
            )) : <p className="rvs-note">No changes proposed — the plan held its shape this week.</p>}
          </div>
        </section>

        <section className="rvs">
          <span className="rvs-idx" aria-hidden="true">05</span>
          <div>
            <h2 className="rvs-title">This week's ideas</h2>
            {ideas.map((i) => (
              <div key={i.id} className="idea-row">
                <div className="idea-main">
                  <div className="idea-title">{i.title}</div>
                  {i.body && <div className="idea-body">{i.body}</div>}
                </div>
                <span className="idea-date">{i.created}</span>
                {['keep', 'schedule', 'kill'].map((a) => (
                  <button key={a} className="btn"
                    onClick={() => { setDoneIds([...doneIds, i.id]); act('/api/review/idea', { id: i.id, action: a }, `Idea ${a}`) }}>
                    {a}
                  </button>
                ))}
              </div>
            ))}
            {!ideas.length && <p className="rvs-note">Idea inbox is clear.</p>}
          </div>
        </section>

        </div>
        </div>

        <div className="rv-signoff">
          <button className="btn" onClick={() => act('/api/plan/tomorrow', {}, 'Tomorrow drafted — check the bot')}>
            Draft tomorrow
          </button>
          <button className="btn btn-primary" disabled={signed}
            onClick={async () => { if (await act('/api/review/complete', { kind: data.kind }, 'Week signed off')) setSigned(true) }}>
            Sign off the week
          </button>
          {signed && <span className="stamp-mark">Reviewed · W{weekNo}</span>}
        </div>
      </div>
    </div>
  )
}
