import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API || 'https://pranav-os.onrender.com'

const MOCK_SLEEP = {
  logs: [
    { date: '2026-08-17', hours: 5.7, debt_after: -2.1 },
    { date: '2026-08-16', hours: 7.2, debt_after: -0.3 },
    { date: '2026-08-15', hours: 6.8, debt_after: -0.7 },
    { date: '2026-08-14', hours: 8.1, debt_after: 0.1 },
  ],
  topology: [
    { hour: 9, deep: 2, shallow: 1, failed: 0 }, { hour: 11, deep: 5, shallow: 2, failed: 1 },
    { hour: 15, deep: 3, shallow: 4, failed: 2 }, { hour: 19, deep: 1, shallow: 3, failed: 0 },
    { hour: 22, deep: 6, shallow: 1, failed: 1 }, { hour: 23, deep: 4, shallow: 0, failed: 2 },
  ],
  protocol: [{ id: 1, text: 'water' }, { id: 2, text: 'freshen up' }, { id: 3, text: '10 pushups' }, { id: 4, text: '5 min sunlight' }],
  runs: [{ date: '2026-08-17', completed: true }, { date: '2026-08-16', completed: true }, { date: '2026-08-15', completed: false }],
  correlation: { with: 3.4, without: 1.6 },
  usual: { sleep: '00:30', wake: '07:45' },
}

export function Sleep({ demo }) {
  const [d, setD] = useState(demo ? MOCK_SLEEP : null)
  const [steps, setSteps] = useState(null)
  const [flash, setFlash] = useState(null)
  useEffect(() => {
    if (demo) return
    fetch(`${API}/api/sleep`).then((r) => r.json()).then(setD).catch(() => {})
  }, [])
  if (!d) return <div className="loading">reading the nights…</div>

  const maxDeep = Math.max(...d.topology.map((t) => t.deep + t.shallow), 1)
  const saveProtocol = async () => {
    const list = (steps ?? d.protocol.map((p) => p.text).join('\n')).split('\n').filter(Boolean)
    if (demo) { setFlash('Saved (demo)'); setTimeout(() => setFlash(null), 2000); return }
    await fetch(`${API}/api/sleep/protocol`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ steps: list }),
    }).catch(() => {})
    setFlash('Morning routine saved — gates tomorrow\'s brief')
    setTimeout(() => setFlash(null), 3000)
  }

  return (
    <div className="page-wrap wide">
      <div className="slp-cols">
        <div>
          <div className="fin-sec"><div className="label mono">Last nights</div>
            <div className="slp-bars">
              {[...d.logs].reverse().map((l) => (
                <div key={l.date} className="slp-bar" title={`${l.date}: ${l.hours ?? '—'}h (ledger ${l.debt_after ?? '—'})`}>
                  <span style={{ height: `${(l.hours || 0) * 10}px` }}
                    className={l.hours && l.hours < 6.5 ? 'low' : ''} />
                  <em className="mono">{l.date.slice(8)}</em>
                </div>
              ))}
              {!d.logs.length && <span className="lst-empty">say "sleeping" tonight — the ledger starts</span>}
            </div>
          </div>
          <div className="fin-sec"><div className="label mono">When you actually do deep work</div>
            <div className="slp-topo">
              {Array.from({ length: 18 }, (_, i) => i + 6).map((h) => {
                const t = d.topology.find((x) => x.hour === h) || { deep: 0, shallow: 0, failed: 0 }
                return (
                  <div key={h} className="topo-col" title={`${h}:00 — deep ${t.deep}, shallow ${t.shallow}, failed ${t.failed}`}>
                    <div className="topo-stack">
                      <span className="t-deep" style={{ height: `${(t.deep / maxDeep) * 54}px` }} />
                      <span className="t-shallow" style={{ height: `${(t.shallow / maxDeep) * 54}px` }} />
                      <span className="t-fail" style={{ height: `${(t.failed / maxDeep) * 30}px` }} />
                    </div>
                    {h % 3 === 0 && <em className="mono">{h}</em>}
                  </div>
                )
              })}
            </div>
            <div className="topo-legend mono">
              <span><i className="t-deep" /> deep done</span>
              <span><i className="t-shallow" /> shallow</span>
              <span><i className="t-fail" /> died</span>
            </div>
          </div>
        </div>
        <div>
          <div className="fin-sec"><div className="label mono">Morning routine (gates the brief)</div>
            <textarea className="slp-proto" rows={6}
              defaultValue={d.protocol.map((p) => p.text).join('\n')}
              onChange={(e) => setSteps(e.target.value)} />
            <div className="rv-actions">
              <button className="rv-btn dark-btn" onClick={saveProtocol}>save routine</button>
              {flash && <span className="rc-hint mono" style={{ color: 'var(--acid)', alignSelf: 'center' }}>{flash}</span>}
            </div>
          </div>
          <div className="fin-sec"><div className="label mono">Does the routine pay?</div>
            {d.correlation.with != null && d.correlation.without != null ? (
              <p className="page-voice" style={{ marginBottom: 0 }}>
                Routine days: {d.correlation.with}h of deep work. Without: {d.correlation.without}h.
                {d.correlation.with > d.correlation.without ? ' The routine pays.' : ' Not enough data yet.'}
              </p>
            ) : <span className="lst-empty">needs a couple of weeks of data</span>}
          </div>
          <div className="fin-sec"><div className="label mono">Baseline</div>
            <div className="fin-row"><span>usual sleep</span><span className="mono">{d.usual.sleep || 'not set'}</span></div>
            <div className="fin-row"><span>usual wake</span><span className="mono">{d.usual.wake || 'not set'}</span></div>
          </div>
        </div>
      </div>
    </div>
  )
}
