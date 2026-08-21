import { useMemo, useState } from 'react'
import { inr, KINDS } from './moneyApi.js'

// SHEET 09 · MONEY — the ledger. A ruled passbook of transactions with a
// quick add-row at the head. Amounts are tabular mono, right-aligned;
// expense is redlined (−), income is ink (+), transfer is muted (⇄).

const KIND_PICK = [
  ['expense', 'Out'], ['income', 'In'], ['transfer', '⇄'],
]

function fmtDate(d) {
  if (!d) return ''
  const dt = new Date(d + 'T00:00:00')
  if (Number.isNaN(dt.getTime())) return d
  return dt.toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })
}

function Amount({ t }) {
  if (t.kind === 'income') return <span className="mo-amt mo-in">+{inr(t.amount)}</span>
  if (t.kind === 'transfer') return <span className="mo-amt mo-xfer">⇄ {inr(t.amount)}</span>
  return <span className="mo-amt mo-out">−{inr(t.amount)}</span>
}

/* ---------- quick add-row (posts instantly) ---------- */
function AddRow({ accounts, categories, defaultAccount, onCreate }) {
  const today = new Date().toISOString().slice(0, 10)
  const [kind, setKind] = useState('expense')
  const [amount, setAmount] = useState('')
  const [accountId, setAccountId] = useState(defaultAccount || (accounts[0] && accounts[0].id) || '')
  const [toAccount, setToAccount] = useState('')
  const [category, setCategory] = useState('')
  const [payee, setPayee] = useState('')
  const [date, setDate] = useState(today)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState(null)

  const submit = async (e) => {
    e.preventDefault()
    if (busy) return
    const amt = Number(amount)
    if (!accountId || !(amt > 0)) { setErr('Enter an amount and an account.'); return }
    if (kind === 'transfer' && (!toAccount || toAccount === accountId)) {
      setErr('Pick a different destination account.'); return
    }
    setBusy(true)
    setErr(null)
    try {
      await onCreate({
        account_id: accountId, kind, amount: amt,
        category: kind === 'transfer' ? '' : category.trim(),
        payee: payee.trim(), date,
        transfer_account_id: kind === 'transfer' ? toAccount : undefined,
      })
      setAmount(''); setPayee(''); setCategory('')
    } catch {
      setErr('Could not post — check the connection.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <form className="mo-addrow" onSubmit={submit}>
      <div className="mo-kindpick" role="group" aria-label="Kind">
        {KIND_PICK.map(([k, label]) => (
          <button type="button" key={k} className={`mo-kindbtn ${kind === k ? `on ${k}` : ''}`}
            onClick={() => setKind(k)} aria-pressed={kind === k}>{label}</button>
        ))}
      </div>
      <input className="field mo-in-payee" value={payee} onChange={(e) => setPayee(e.target.value)}
        placeholder="payee / note" aria-label="Payee" />
      {kind === 'transfer' ? (
        <select className="field mo-in-cat" value={toAccount} onChange={(e) => setToAccount(e.target.value)}
          aria-label="To account">
          <option value="">to…</option>
          {accounts.filter((a) => a.id !== accountId).map((a) => (
            <option key={a.id} value={a.id}>{a.name}</option>
          ))}
        </select>
      ) : (
        <input className="field mo-in-cat" value={category} onChange={(e) => setCategory(e.target.value)}
          placeholder="category" aria-label="Category" list="mo-cats" />
      )}
      <select className="field mo-in-acct" value={accountId} onChange={(e) => setAccountId(e.target.value)}
        aria-label="Account">
        {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
      </select>
      <input className="field mo-in-date" type="date" value={date} onChange={(e) => setDate(e.target.value)}
        aria-label="Date" />
      <input className="field mo-in-amt" value={amount} onChange={(e) => setAmount(e.target.value)}
        placeholder="0" inputMode="decimal" aria-label="Amount" />
      <button type="submit" className="btn btn-primary mo-addbtn" disabled={busy}>
        {busy ? '…' : 'Post'}
      </button>
      {err && <span className="mo-inline-err anno" role="alert">{err}</span>}
      <datalist id="mo-cats">
        {categories.map((c) => <option key={c} value={c} />)}
      </datalist>
    </form>
  )
}

/* ---------- the ruled ledger ---------- */
export default function Ledger({ accounts, txns, categories, defaultAccount, onCreate, onOpenTxn }) {
  const nameOf = useMemo(() => {
    const m = {}
    accounts.forEach((a) => { m[a.id] = a.name })
    return m
  }, [accounts])

  const acctLabel = (t) => t.kind === 'transfer'
    ? `${nameOf[t.account_id] || '—'} → ${nameOf[t.transfer_account_id] || '—'}`
    : (nameOf[t.account_id] || '—')

  return (
    <div className="mo-ledger">
      <AddRow accounts={accounts} categories={categories}
        defaultAccount={defaultAccount} onCreate={onCreate} />

      <div className="mo-table" role="table" aria-label="Ledger">
        <div className="mo-thead" role="row">
          <span role="columnheader" className="mo-c-date">Date</span>
          <span role="columnheader" className="mo-c-payee">Payee</span>
          <span role="columnheader" className="mo-c-cat">Category</span>
          <span role="columnheader" className="mo-c-acct">Account</span>
          <span role="columnheader" className="mo-c-amt">Amount</span>
        </div>
        {txns.length ? txns.map((t) => (
          <button key={t.id} className="mo-tr" role="row" onClick={() => onOpenTxn(t)}
            title="Edit or delete">
            <span role="cell" className="mo-c-date anno">{fmtDate(t.date)}</span>
            <span role="cell" className="mo-c-payee">
              {t.payee || <span className="mo-faint">—</span>}
              {t.note && <span className="mo-note"> · {t.note}</span>}
            </span>
            <span role="cell" className="mo-c-cat">
              {t.category ? <span className="mo-tag">{t.category}</span> : <span className="mo-faint">—</span>}
            </span>
            <span role="cell" className="mo-c-acct anno">{acctLabel(t)}</span>
            <span role="cell" className="mo-c-amt"><Amount t={t} /></span>
          </button>
        )) : (
          <p className="mo-empty anno">No entries for this filter. Post one above.</p>
        )}
      </div>
    </div>
  )
}

/* ---------- transaction editor (modal) ---------- */
export function TxnEditor({ txn, accounts, categories, onClose, onSave, onDelete }) {
  const [kind, setKind] = useState(txn.kind)
  const [amount, setAmount] = useState(String(txn.amount ?? ''))
  const [accountId, setAccountId] = useState(txn.account_id)
  const [toAccount, setToAccount] = useState(txn.transfer_account_id || '')
  const [category, setCategory] = useState(txn.category || '')
  const [payee, setPayee] = useState(txn.payee || '')
  const [note, setNote] = useState(txn.note || '')
  const [date, setDate] = useState(txn.date || '')
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  const save = async (e) => {
    e.preventDefault()
    if (busy) return
    const amt = Number(amount)
    if (!(amt > 0)) { setErr('Enter an amount.'); return }
    if (kind === 'transfer' && (!toAccount || toAccount === accountId)) {
      setErr('Pick a different destination account.'); return
    }
    setBusy(true)
    setErr(null)
    try {
      await onSave(txn.id, {
        account_id: accountId, kind, amount: amt,
        category: kind === 'transfer' ? '' : category.trim(),
        payee: payee.trim(), note: note.trim(), date,
        transfer_account_id: kind === 'transfer' ? toAccount : '',
      })
      onClose()
    } catch {
      setErr('Could not save — check the connection.')
      setBusy(false)
    }
  }

  const del = async () => {
    if (!window.confirm('Delete this entry? This can’t be undone.')) return
    try {
      await onDelete(txn.id)
      onClose()
    } catch {
      setErr('Could not delete the entry.')
    }
  }

  return (
    <div className="mv-overlay" onClick={onClose}>
      <div className="mv-panel mo-editor" onClick={(e) => e.stopPropagation()}>
        <div className="mv-head">
          <span className="mv-title">Edit entry</span>
          <button className="mv-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form onSubmit={save}>
          <div className="mo-kindpick mo-kindpick-wide" role="group" aria-label="Kind">
            {KINDS.map((k) => (
              <button type="button" key={k} className={`mo-kindbtn ${kind === k ? `on ${k}` : ''}`}
                onClick={() => setKind(k)} aria-pressed={kind === k}>
                {k === 'expense' ? 'Out' : k === 'income' ? 'In' : 'Transfer'}
              </button>
            ))}
          </div>
          <div className="mo-field-row">
            <label className="mo-field">
              <span className="mo-lbl anno">Amount</span>
              <input className="field mono" value={amount} onChange={(e) => setAmount(e.target.value)}
                inputMode="decimal" autoFocus />
            </label>
            <label className="mo-field">
              <span className="mo-lbl anno">Date</span>
              <input className="field" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </label>
          </div>
          <div className="mo-field-row">
            <label className="mo-field">
              <span className="mo-lbl anno">{kind === 'transfer' ? 'From' : 'Account'}</span>
              <select className="field" value={accountId} onChange={(e) => setAccountId(e.target.value)}>
                {accounts.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
              </select>
            </label>
            {kind === 'transfer' ? (
              <label className="mo-field">
                <span className="mo-lbl anno">To</span>
                <select className="field" value={toAccount} onChange={(e) => setToAccount(e.target.value)}>
                  <option value="">choose…</option>
                  {accounts.filter((a) => a.id !== accountId).map((a) => (
                    <option key={a.id} value={a.id}>{a.name}</option>
                  ))}
                </select>
              </label>
            ) : (
              <label className="mo-field">
                <span className="mo-lbl anno">Category</span>
                <input className="field" value={category} onChange={(e) => setCategory(e.target.value)}
                  list="mo-cats-edit" />
                <datalist id="mo-cats-edit">
                  {categories.map((c) => <option key={c} value={c} />)}
                </datalist>
              </label>
            )}
          </div>
          <label className="mo-field">
            <span className="mo-lbl anno">Payee</span>
            <input className="field" value={payee} onChange={(e) => setPayee(e.target.value)} />
          </label>
          <label className="mo-field">
            <span className="mo-lbl anno">Note</span>
            <input className="field" value={note} onChange={(e) => setNote(e.target.value)} />
          </label>
          {err && <p className="mo-inline-err anno" role="alert">{err}</p>}
          <div className="mo-foot">
            <button type="button" className="btn mo-del" onClick={del}>Delete</button>
            <span className="mo-foot-spacer" />
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
