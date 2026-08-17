import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API || 'https://pranav-os.onrender.com'

const MOCK_LISTS = { lists: [
  { id: 1, name: 'going-home', fire_kind: 'manual', fire_param: null, items: [
    { id: 1, text: 'charger + hard disk', checked: false },
    { id: 2, text: 'documents folder', checked: false },
    { id: 3, text: 'the kurta', checked: true },
  ] },
  { id: 2, name: 'weekly buy', fire_kind: 'weekly_day', fire_param: 'saturday', items: [
    { id: 4, text: 'protein bars', checked: false },
    { id: 5, text: 'coffee', checked: false },
  ] },
] }

const MOCK_FIN = {
  entries: [
    { id: 1, amount: 450, category: 'food', note: 'dinner', spent_on: '2026-08-17' },
    { id: 2, amount: 120, category: 'transport', note: 'auto', spent_on: '2026-08-17' },
    { id: 3, amount: 649, category: 'subscriptions', note: 'netflix', spent_on: '2026-08-15' },
  ],
  months: [
    { month: '2026-08', category: 'food', total: 3450 },
    { month: '2026-08', category: 'subscriptions', total: 1250 },
    { month: '2026-08', category: 'transport', total: 890 },
  ],
  subscriptions: [{ id: 1, name: 'netflix', amount: 649, period: 'monthly', renews_on: null, active: true }],
  deadlines: [{ id: 1, title: 'DAAD scholarship application', due_date: '2026-10-15' }],
}

const DOWS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']
const CAT_COLORS = {
  food: '#9A4434', transport: '#486992', subscriptions: '#7C5681', shopping: '#B29036',
  health: '#4A7A5F', education: '#646B76', fun: '#97744E', other: '#3E433C',
}

export function Lists({ demo }) {
  const [data, setData] = useState(demo ? MOCK_LISTS : null)
  const load = () => {
    if (demo) return
    fetch(`${API}/api/lists`).then((r) => r.json()).then(setData).catch(() => {})
  }
  useEffect(load, [])

  const toggle = async (item) => {
    if (demo) return
    await fetch(`${API}/api/lists/check`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: item.id, checked: !item.checked }),
    }).catch(() => {})
    load()
  }
  const setFire = async (list, kind, param) => {
    if (demo) return
    await fetch(`${API}/api/lists/fire-rule`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ id: list.id, fire_kind: kind, fire_param: param }),
    }).catch(() => {})
    load()
  }

  if (!data) return <div className="loading">loading lists…</div>
  return (
    <div className="page-wrap">
      <p className="page-voice">Lists that fire themselves — tell the bot "add X to Y list" anytime.</p>
      <div className="lists-grid">
        {data.lists.map((l) => (
          <div key={l.id} className="lst-card">
            <div className="lst-head">
              <span className="lst-name">{l.name}</span>
              <select className="lst-fire mono" value={l.fire_kind === 'weekly_day' ? l.fire_param : l.fire_kind}
                onChange={(e) => {
                  const v = e.target.value
                  if (DOWS.includes(v)) setFire(l, 'weekly_day', v)
                  else setFire(l, 'manual', null)
                }}>
                <option value="manual">fires: manually</option>
                {DOWS.map((d) => <option key={d} value={d}>fires: every {d}</option>)}
              </select>
            </div>
            {l.items.map((i) => (
              <label key={i.id} className={`lst-item ${i.checked ? 'done' : ''}`}>
                <input type="checkbox" checked={i.checked} onChange={() => toggle(i)} />
                <span>{i.text}</span>
              </label>
            ))}
            {!l.items.length && <div className="lst-empty">empty — add from the bot</div>}
          </div>
        ))}
        {!data.lists.length && <p className="page-voice">No lists yet — tell the bot: new list going-home</p>}
      </div>
    </div>
  )
}

export function Finance({ demo }) {
  const [data, setData] = useState(demo ? MOCK_FIN : null)
  useEffect(() => {
    if (demo) return
    fetch(`${API}/api/finance`).then((r) => r.json()).then(setData).catch(() => {})
  }, [])
  if (!data) return <div className="loading">loading money…</div>

  const thisMonth = data.months.filter((m) => m.month === data.months[0]?.month)
  const monthTotal = thisMonth.reduce((a, m) => a + Number(m.total), 0)
  return (
    <div className="page-wrap">
      <div className="fin-top">
        <div className="fin-stat">
          <div className="label mono">This month</div>
          <div className="fin-big mono">₹{monthTotal.toFixed(0)}</div>
        </div>
        <div className="fin-cats">
          {thisMonth.map((m) => (
            <div key={m.category} className="fin-cat">
              <span className="fin-dot" style={{ background: CAT_COLORS[m.category] || '#3E433C' }} />
              <span className="fin-cname">{m.category}</span>
              <span className="mono fin-cval">₹{Number(m.total).toFixed(0)}</span>
            </div>
          ))}
          {!thisMonth.length && <span className="lst-empty">tell the bot: spent 450 on dinner</span>}
        </div>
      </div>

      {data.deadlines.length > 0 && (
        <div className="fin-sec">
          <div className="label mono">Deadlines being watched</div>
          {data.deadlines.map((d) => (
            <div key={d.id} className="fin-row">
              <span>{d.title}</span>
              <span className="mono fin-cval">{d.due_date}</span>
            </div>
          ))}
        </div>
      )}

      {data.subscriptions.length > 0 && (
        <div className="fin-sec">
          <div className="label mono">Subscriptions</div>
          {data.subscriptions.map((s) => (
            <div key={s.id} className="fin-row">
              <span>{s.name}</span>
              <span className="mono fin-cval">₹{Number(s.amount).toFixed(0)}/{s.period}</span>
            </div>
          ))}
        </div>
      )}

      <div className="fin-sec">
        <div className="label mono">Recent</div>
        {data.entries.map((e) => (
          <div key={e.id} className="fin-row">
            <span className="fin-dot" style={{ background: CAT_COLORS[e.category] || '#3E433C' }} />
            <span className="fin-note">{e.note}</span>
            <span className="mono dim2">{e.spent_on}</span>
            <span className="mono fin-cval">₹{Number(e.amount).toFixed(0)}</span>
          </div>
        ))}
        {!data.entries.length && <span className="lst-empty">nothing logged yet</span>}
      </div>
    </div>
  )
}
