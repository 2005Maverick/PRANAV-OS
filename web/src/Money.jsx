import { useCallback, useEffect, useMemo, useState } from 'react'
import { createMoneyApi, inr, fmtUnit, KINDS, ACCOUNT_TYPES } from './moneyApi.js'
import Ledger, { TxnEditor } from './Ledger.jsx'

// SHEET 09 · MONEY — a hand-ruled passbook. Accounts + net worth across the top,
// a wide running ledger as the hero, then budgets, a 30-day forecast, and
// read-only savings goals (which live in Arcs). REDLINE: warm paper, blue-black
// ink, one red accent for money-out and over-budget.

const DEFAULT_CATS = ['Groceries', 'Eating out', 'Transport', 'Bills', 'Housing', 'Subscriptions', 'Salary', 'Freelance']

function ymNow() {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
}
function monthLabel(ym) {
  if (!ym) return ''
  const [y, m] = ym.split('-').map(Number)
  return new Date(y, m - 1, 1).toLocaleDateString('en-GB', { month: 'long', year: 'numeric' })
}
const clamp = (n) => Math.min(Math.max(n, 0), 100)

/* ---------- account chip ---------- */
function AccountChip({ acc, active, onSelect, onEdit }) {
  return (
    <div className={`mo-acct ${active ? 'on' : ''}`}>
      <button className="mo-acct-main" onClick={onSelect} aria-pressed={active}>
        <span className="mo-acct-top">
          <span className="mo-acct-name">{acc.name}</span>
          <span className="mo-acct-type anno">{acc.type}</span>
        </span>
        <span className={`mo-acct-bal mono ${acc.balance < 0 ? 'mo-out' : ''}`}>{inr(acc.balance)}</span>
      </button>
      <button className="mo-acct-edit" onClick={onEdit} title="Edit account" aria-label={`Edit ${acc.name}`}>✎</button>
    </div>
  )
}

/* ---------- budgets panel ---------- */
function Budgets({ budgets, onSet, onEdit, onDelete }) {
  return (
    <section className="mo-panel">
      <div className="mo-panel-head">
        <span className="cap">Budgets</span>
        <button className="mo-panel-add" onClick={onSet}>＋ Budget</button>
      </div>
      {budgets.length ? (
        <div className="mo-budgets">
          {budgets.map((b) => (
            <div key={b.category} className={`mo-budget ${b.over ? 'over' : ''}`}>
              <div className="mo-budget-line">
                <button className="mo-budget-cat" onClick={() => onEdit(b)} title="Edit budget">{b.category}</button>
                <span className="mo-budget-nums mono">
                  {inr(b.spent)} <span className="mo-faint">/ {inr(b.budget)}</span>
                </span>
                <button className="mo-budget-x" onClick={() => onDelete(b)} aria-label={`Remove ${b.category} budget`}>✕</button>
              </div>
              <div className="mo-bar" role="progressbar" aria-valuenow={b.pct} aria-valuemin={0} aria-valuemax={100}>
                <span className={`mo-bar-fill ${b.over ? 'over' : ''}`} style={{ width: `${clamp(b.pct)}%` }} />
              </div>
              <div className="mo-budget-foot anno">
                {b.over
                  ? <span className="mo-out">{inr(-b.left)} over</span>
                  : <span className="mo-faint">{inr(b.left)} left · {b.pct}%</span>}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="mo-empty anno">No budgets set for {'this month'}. Add one to track a category.</p>
      )}
    </section>
  )
}

/* ---------- forecast panel ---------- */
function Forecast({ forecast, accounts, onAddRecurring, onPost }) {
  if (!forecast) return null
  const up = forecast.projected >= forecast.net_now
  const nameOf = (id) => (accounts.find((a) => a.id === id)?.name) || ''
  return (
    <section className="mo-panel">
      <div className="mo-panel-head">
        <span className="cap">Forecast · {forecast.window_days}d</span>
        <button className="mo-panel-add" onClick={onAddRecurring}>＋ Recurring</button>
      </div>
      <div className="mo-forecast-now">
        <span className="anno mo-faint">Projected balance</span>
        <span className="mo-forecast-val mono">
          <span className={`mo-arrow ${up ? 'up' : 'down'}`}>{up ? '↑' : '↓'}</span>
          {inr(forecast.projected)}
        </span>
        <span className="anno mo-faint">now {inr(forecast.net_now)}</span>
      </div>
      <div className="mo-upcoming">
        <span className="cap mo-up-title">Upcoming</span>
        {forecast.upcoming && forecast.upcoming.length ? forecast.upcoming.map((u) => (
          <div key={u.id} className="mo-up-row">
            <span className="mo-up-name">{u.name}
              {nameOf(u.account_id) && <span className="mo-faint anno"> · {nameOf(u.account_id)}</span>}
            </span>
            <span className={`mo-up-amt mono ${u.kind === 'expense' ? 'mo-out' : 'mo-in'}`}>
              {u.kind === 'expense' ? '−' : '+'}{inr(u.amount)}
            </span>
            <span className="mo-up-due anno">{u.in_days <= 0 ? 'due' : `in ${u.in_days}d`}</span>
            <button className="mo-up-post" onClick={() => onPost(u.id)} title="Post as a real entry">post now</button>
          </div>
        )) : (
          <p className="mo-empty anno">No bills due in the next {forecast.window_days} days.</p>
        )}
      </div>
    </section>
  )
}

/* ---------- goals panel (read-only; goals live in Arcs) ---------- */
function Goals({ goals }) {
  return (
    <section className="mo-panel">
      <div className="mo-panel-head">
        <span className="cap">Goals</span>
        <span className="anno mo-faint">from Arcs</span>
      </div>
      {goals && goals.length ? (
        <div className="mo-goals">
          {goals.map((g) => {
            const pct = g.pct != null ? g.pct : (g.target ? Math.round((g.saved / g.target) * 100) : 0)
            return (
              <div key={g.id} className="mo-goal">
                <div className="mo-goal-line">
                  <span className="mo-goal-title">{g.title}</span>
                  <span className="mo-goal-nums mono">
                    {fmtUnit(g.saved, g.unit)} <span className="mo-faint">/ {fmtUnit(g.target, g.unit)}</span>
                  </span>
                </div>
                <div className="mo-bar" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
                  <span className="mo-bar-fill goal" style={{ width: `${clamp(pct)}%` }} />
                </div>
                <div className="mo-goal-foot anno mo-faint">
                  {pct}%{g.deadline ? ` · by ${new Date(g.deadline + 'T00:00:00').toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}` : ''}
                </div>
              </div>
            )
          })}
          <p className="mo-goal-note anno mo-faint">Goals live in Arcs — add money there.</p>
        </div>
      ) : (
        <p className="mo-empty anno">Set a savings target in Arcs and it shows here.</p>
      )}
    </section>
  )
}

/* ---------- account modal (create / edit) ---------- */
function AccountModal({ account, onClose, onSave, onDelete }) {
  const editing = !!account
  const [name, setName] = useState(account?.name || '')
  const [type, setType] = useState(account?.type || 'bank')
  const [opening, setOpening] = useState(account ? String(account.opening ?? '') : '')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    if (!name.trim()) { setErr('Name the account.'); return }
    setBusy(true); setErr(null)
    try {
      await onSave(account?.id, { name: name.trim(), type, opening: Number(opening) || 0 })
      onClose()
    } catch { setErr('Could not save the account.'); setBusy(false) }
  }
  const del = async () => {
    if (!window.confirm(`Delete “${account.name}” and its entries? This can’t be undone.`)) return
    try { await onDelete(account.id); onClose() } catch { setErr('Could not delete the account.') }
  }

  return (
    <div className="mv-overlay" onClick={onClose}>
      <div className="mv-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mv-head">
          <span className="mv-title">{editing ? 'Edit account' : 'New account'}</span>
          <button className="mv-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form onSubmit={submit}>
          <label className="mo-field">
            <span className="mo-lbl anno">Name</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus
              placeholder="e.g. HDFC" />
          </label>
          <div className="mo-field-row">
            <label className="mo-field">
              <span className="mo-lbl anno">Type</span>
              <select className="field" value={type} onChange={(e) => setType(e.target.value)}>
                {ACCOUNT_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
              </select>
            </label>
            <label className="mo-field">
              <span className="mo-lbl anno">Opening balance</span>
              <input className="field mono" value={opening} onChange={(e) => setOpening(e.target.value)}
                inputMode="decimal" placeholder="0" />
            </label>
          </div>
          {err && <p className="mo-inline-err anno" role="alert">{err}</p>}
          <div className="mo-foot">
            {editing && <button type="button" className="btn mo-del" onClick={del}>Delete</button>}
            <span className="mo-foot-spacer" />
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : editing ? 'Save' : 'Add account'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ---------- budget modal ---------- */
function BudgetModal({ preset, month, categories, onClose, onSave }) {
  const [category, setCategory] = useState(preset?.category || '')
  const [amount, setAmount] = useState(preset ? String(preset.budget ?? '') : '')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    if (!category.trim() || !(Number(amount) > 0)) { setErr('Pick a category and an amount.'); return }
    setBusy(true); setErr(null)
    try {
      await onSave({ category: category.trim(), month, amount: Number(amount) })
      onClose()
    } catch { setErr('Could not save the budget.'); setBusy(false) }
  }

  return (
    <div className="mv-overlay" onClick={onClose}>
      <div className="mv-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mv-head">
          <span className="mv-title">Set budget · {monthLabel(month)}</span>
          <button className="mv-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form onSubmit={submit}>
          <label className="mo-field">
            <span className="mo-lbl anno">Category</span>
            <input className="field" value={category} onChange={(e) => setCategory(e.target.value)}
              list="mo-cats" autoFocus disabled={!!preset} placeholder="Groceries" />
          </label>
          <label className="mo-field">
            <span className="mo-lbl anno">Monthly budget</span>
            <input className="field mono" value={amount} onChange={(e) => setAmount(e.target.value)}
              inputMode="decimal" placeholder="0" />
          </label>
          {err && <p className="mo-inline-err anno" role="alert">{err}</p>}
          <div className="mo-foot">
            <span className="mo-foot-spacer" />
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ---------- recurring modal ---------- */
function RecurringModal({ accounts, categories, onClose, onSave }) {
  const [name, setName] = useState('')
  const [kind, setKind] = useState('expense')
  const [amount, setAmount] = useState('')
  const [cadence, setCadence] = useState('monthly')
  const [dayOfMonth, setDayOfMonth] = useState('1')
  const [accountId, setAccountId] = useState((accounts[0] && accounts[0].id) || '')
  const [category, setCategory] = useState('')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    if (!name.trim() || !(Number(amount) > 0)) { setErr('Name it and set an amount.'); return }
    setBusy(true); setErr(null)
    try {
      await onSave({
        name: name.trim(), kind, amount: Number(amount), category: category.trim(),
        account_id: accountId, cadence,
        day_of_month: cadence === 'monthly' ? Number(dayOfMonth) || 1 : undefined,
      })
      onClose()
    } catch { setErr('Could not save the recurring bill.'); setBusy(false) }
  }

  return (
    <div className="mv-overlay" onClick={onClose}>
      <div className="mv-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mv-head">
          <span className="mv-title">New recurring</span>
          <button className="mv-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form onSubmit={submit}>
          <label className="mo-field">
            <span className="mo-lbl anno">Name</span>
            <input className="field" value={name} onChange={(e) => setName(e.target.value)} autoFocus
              placeholder="e.g. Netflix" />
          </label>
          <div className="mo-field-row">
            <label className="mo-field">
              <span className="mo-lbl anno">Kind</span>
              <select className="field" value={kind} onChange={(e) => setKind(e.target.value)}>
                {KINDS.filter((k) => k !== 'transfer').map((k) => <option key={k} value={k}>{k}</option>)}
              </select>
            </label>
            <label className="mo-field">
              <span className="mo-lbl anno">Amount</span>
              <input className="field mono" value={amount} onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal" placeholder="0" />
            </label>
          </div>
          <div className="mo-field-row">
            <label className="mo-field">
              <span className="mo-lbl anno">Cadence</span>
              <select className="field" value={cadence} onChange={(e) => setCadence(e.target.value)}>
                <option value="monthly">monthly</option>
                <option value="weekly">weekly</option>
              </select>
            </label>
            {cadence === 'monthly' && (
              <label className="mo-field">
                <span className="mo-lbl anno">Day of month</span>
                <input className="field mono" value={dayOfMonth} onChange={(e) => setDayOfMonth(e.target.value)}
                  inputMode="numeric" placeholder="1" />
              </label>
            )}
          </div>
          <div className="mo-field-row">
            <label className="mo-field">
              <span className="mo-lbl anno">Account</span>
              <select className="field" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            <label className="mo-field">
              <span className="mo-lbl anno">Category</span>
              <input className="field" value={category} onChange={(e) => setCategory(e.target.value)}
                list="mo-cats" placeholder="optional" />
            </label>
          </div>
          {err && <p className="mo-inline-err anno" role="alert">{err}</p>}
          <div className="mo-foot">
            <span className="mo-foot-spacer" />
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Add bill'}</button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ---------- page ---------- */
export default function Money({ demo }) {
  const api = useMemo(() => createMoneyApi(demo), [demo])

  const [dash, setDash] = useState(null)
  const [txns, setTxns] = useState([])
  const [month, setMonth] = useState(ymNow())
  const [activeAccount, setActiveAccount] = useState(null)
  const [q, setQ] = useState('')
  const [err, setErr] = useState(null)

  const [openTxn, setOpenTxn] = useState(null)
  const [acctModal, setAcctModal] = useState(false)      // false | null (new) | account (edit)
  const [budgetModal, setBudgetModal] = useState(false)  // false | null (new) | budget (edit)
  const [recurModal, setRecurModal] = useState(false)

  const loadDash = useCallback(async () => {
    try {
      const d = await api.getDashboard()
      setDash(d)
      setErr(null)
    } catch { setErr('Could not load your money sheet.') }
  }, [api])

  const loadTxns = useCallback(async () => {
    try {
      const d = await api.listTxns({ account_id: activeAccount || undefined, month, q: q.trim() || undefined })
      setTxns(d.txns || [])
    } catch { setErr('Could not load the ledger.') }
  }, [api, activeAccount, month, q])

  useEffect(() => { loadDash() }, [loadDash])
  useEffect(() => { loadTxns() }, [loadTxns])

  const refresh = useCallback(async () => {
    await Promise.all([loadDash(), loadTxns()])
  }, [loadDash, loadTxns])

  const categories = useMemo(() => {
    const set = new Set(DEFAULT_CATS)
    ;(dash?.budgets || []).forEach((b) => set.add(b.category))
    txns.forEach((t) => { if (t.category) set.add(t.category) })
    return [...set].sort()
  }, [dash, txns])

  const accounts = dash?.accounts || []

  /* ---- txn actions ---- */
  const createTxn = async (payload) => {
    await api.createTxn(payload)
    await refresh()
  }
  const saveTxn = async (id, patch) => {
    setTxns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)))
    await api.updateTxn(id, patch)
    await refresh()
  }
  const deleteTxn = async (id) => {
    setTxns((prev) => prev.filter((t) => t.id !== id))
    await api.deleteTxn(id)
    await refresh()
  }

  /* ---- account actions ---- */
  const saveAccount = async (id, patch) => {
    if (id) await api.updateAccount(id, patch)
    else await api.createAccount(patch)
    await refresh()
  }
  const deleteAccount = async (id) => {
    if (activeAccount === id) setActiveAccount(null)
    await api.deleteAccount(id)
    await refresh()
  }

  /* ---- budget actions ---- */
  const saveBudget = async (payload) => { await api.setBudget(payload); await refresh() }
  const deleteBudget = async (b) => {
    if (!window.confirm(`Remove the ${b.category} budget?`)) return
    setDash((prev) => prev ? { ...prev, budgets: prev.budgets.filter((x) => x.category !== b.category) } : prev)
    try { await api.deleteBudget({ category: b.category, month }) } finally { await refresh() }
  }

  /* ---- recurring actions ---- */
  const saveRecurring = async (payload) => { await api.createRecurring(payload); await refresh() }
  const postRecurring = async (id) => {
    try { await api.postRecurring(id); await refresh() }
    catch { setErr('Could not post that bill.') }
  }

  if (!dash) {
    return (
      <div className="mo-wrap">
        <div className="mo-loading">
          <div className="skel" style={{ height: 72 }} />
          <div className="skel" style={{ height: 240, marginTop: 'var(--s-4)' }} />
        </div>
      </div>
    )
  }

  const activeName = activeAccount ? (accounts.find((a) => a.id === activeAccount)?.name || 'Account') : 'All accounts'

  return (
    <div className="mo-wrap">
      {/* ---- top strip: accounts + net worth ---- */}
      <div className="mo-strip">
        <div className="mo-accounts">
          {accounts.map((a) => (
            <AccountChip key={a.id} acc={a} active={activeAccount === a.id}
              onSelect={() => setActiveAccount(activeAccount === a.id ? null : a.id)}
              onEdit={() => setAcctModal(a)} />
          ))}
          <button className="mo-acct mo-acct-add" onClick={() => setAcctModal(null)}>＋ Account</button>
        </div>
        <div className="mo-totals">
          <div className="mo-networth">
            <span className="cap mo-nw-lbl">Net worth</span>
            <span className={`mo-nw-val mono ${dash.net_worth < 0 ? 'mo-out' : ''}`}>{inr(dash.net_worth)}</span>
          </div>
          <div className="mo-monthstat">
            <span className="mo-ms-row anno"><span className="mo-in">↑ {inr(dash.earned_month)}</span> in</span>
            <span className="mo-ms-row anno"><span className="mo-out">↓ {inr(dash.spent_month)}</span> out</span>
            <span className="mo-ms-month anno mo-faint">{monthLabel(dash.month)}</span>
          </div>
        </div>
      </div>

      {err && <p className="mo-inline-err anno mo-banner" role="alert">{err}</p>}

      {/* ---- body: ledger (hero) + right rail ---- */}
      <div className="mo-cols">
        <section className="mo-ledger-col">
          <div className="mo-filters">
            <span className="mo-scope">
              {activeName}
              {activeAccount && <button className="mo-scope-x" onClick={() => setActiveAccount(null)} aria-label="Clear account filter">×</button>}
            </span>
            <input className="field mo-month" type="month" value={month}
              onChange={(e) => setMonth(e.target.value)} aria-label="Month" />
            <div className="mo-search">
              <span className="mo-search-i anno" aria-hidden="true">⌕</span>
              <input className="mo-search-in" value={q} onChange={(e) => setQ(e.target.value)}
                placeholder="search payee, category, note…" aria-label="Search ledger" />
              {q && <button className="mo-search-x" onClick={() => setQ('')} aria-label="Clear search">×</button>}
            </div>
          </div>

          <Ledger accounts={accounts} txns={txns} categories={categories}
            defaultAccount={activeAccount} onCreate={createTxn} onOpenTxn={setOpenTxn} />
        </section>

        <aside className="mo-rail">
          <Budgets budgets={dash.budgets || []}
            onSet={() => setBudgetModal(null)} onEdit={(b) => setBudgetModal(b)} onDelete={deleteBudget} />
          <Forecast forecast={dash.forecast} accounts={accounts}
            onAddRecurring={() => setRecurModal(true)} onPost={postRecurring} />
          <Goals goals={dash.goals || []} />
        </aside>
      </div>

      {openTxn && (
        <TxnEditor txn={openTxn} accounts={accounts} categories={categories}
          onClose={() => setOpenTxn(null)} onSave={saveTxn} onDelete={deleteTxn} />
      )}
      {acctModal !== false && (
        <AccountModal account={acctModal || undefined}
          onClose={() => setAcctModal(false)} onSave={saveAccount} onDelete={deleteAccount} />
      )}
      {budgetModal !== false && (
        <BudgetModal preset={budgetModal || undefined} month={month} categories={categories}
          onClose={() => setBudgetModal(false)} onSave={saveBudget} />
      )}
      {recurModal && (
        <RecurringModal accounts={accounts} categories={categories}
          onClose={() => setRecurModal(false)} onSave={saveRecurring} />
      )}

      <datalist id="mo-cats">
        {categories.map((c) => <option key={c} value={c} />)}
      </datalist>
    </div>
  )
}
