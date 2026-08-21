// Money data layer — one interface, two implementations.
//   • memory  (demo=true)  — pure client-side ledger; mirrors the backend math
//   • fetch   (demo=false) — the live API; X-API-Key is added by App.jsx's fetch wrapper
// Every method returns a Promise so callers are identical in both modes.
// A passbook, in code: accounts + a running ledger of income / expense / transfer,
// monthly budgets, recurring bills, a 30-day forecast, and read-only Arcs goals.

const API = import.meta.env.VITE_API || 'https://pranav-os.onrender.com'

/* ---------- money formatting ---------- */
const inrFmt = new Intl.NumberFormat('en-IN', {
  style: 'currency', currency: 'INR', maximumFractionDigits: 0,
})

// currency for the ledger / accounts (always ₹, no decimals)
export function inr(n) {
  return inrFmt.format(Math.round(Number(n) || 0))
}

// a goal can carry its own unit (₹, km, books…). ₹ routes through Intl.
export function fmtUnit(n, unit) {
  const v = Math.round(Number(n) || 0)
  if (!unit || unit === '₹' || unit === 'INR' || unit === 'Rs') return inr(v)
  return `${new Intl.NumberFormat('en-IN').format(v)} ${unit}`
}

export const KINDS = ['income', 'expense', 'transfer']
export const ACCOUNT_TYPES = ['bank', 'cash', 'wallet', 'card', 'savings']

/* ---------- shared ledger math (both modes reuse the shapes) ---------- */
const monthOf = (d) => (d || '').slice(0, 7)

function balanceOf(acc, txns) {
  let bal = Number(acc.opening) || 0
  for (const t of txns) {
    const amt = Number(t.amount) || 0
    if (t.kind === 'income' && t.account_id === acc.id) bal += amt
    else if (t.kind === 'expense' && t.account_id === acc.id) bal -= amt
    else if (t.kind === 'transfer') {
      if (t.account_id === acc.id) bal -= amt
      if (t.transfer_account_id === acc.id) bal += amt
    }
  }
  return bal
}

function budgetStatus(budgets, txns, month) {
  return budgets
    .filter((b) => b.month === month)
    .map((b) => {
      const spent = txns
        .filter((t) => t.kind === 'expense' && t.category === b.category && monthOf(t.date) === month)
        .reduce((a, t) => a + (Number(t.amount) || 0), 0)
      const budget = Number(b.amount) || 0
      const left = budget - spent
      return {
        category: b.category, budget, spent, left,
        over: spent > budget,
        pct: budget ? Math.round((spent / budget) * 100) : 0,
      }
    })
    .sort((a, b) => (b.over - a.over) || (b.pct - a.pct))
}

/* ---------- demo seed (deterministic; the passbook lived-in) ---------- */
// Anchored to a fixed month so the demo always shows a full ledger,
// independent of the wall clock.
const DEMO_MONTH = '2026-08'
const DEMO_TODAY = new Date('2026-08-21T00:00:00')

const SEED_ACCOUNTS = [
  { id: 'a-cash', name: 'Cash', type: 'cash', opening: 2000 },
  { id: 'a-hdfc', name: 'HDFC', type: 'bank', opening: 40000 },
  { id: 'a-upi', name: 'UPI', type: 'wallet', opening: 12000 },
]

const SEED_TXNS = [
  { id: 't01', account_id: 'a-hdfc', kind: 'income', amount: 65000, category: 'Salary', payee: 'Acme Corp', note: 'August pay', date: '2026-08-01' },
  { id: 't02', account_id: 'a-hdfc', kind: 'expense', amount: 15000, category: 'Housing', payee: 'Landlord', note: 'Rent', date: '2026-08-05' },
  { id: 't03', account_id: 'a-hdfc', kind: 'transfer', amount: 5000, category: '', payee: 'To Cash', note: 'wallet top-up', date: '2026-08-06', transfer_account_id: 'a-cash' },
  { id: 't04', account_id: 'a-upi', kind: 'expense', amount: 2100, category: 'Groceries', payee: 'BigBasket', note: '', date: '2026-08-07' },
  { id: 't05', account_id: 'a-upi', kind: 'expense', amount: 1200, category: 'Eating out', payee: 'Truffles', note: 'dinner', date: '2026-08-08' },
  { id: 't06', account_id: 'a-upi', kind: 'expense', amount: 800, category: 'Transport', payee: 'Uber', note: '', date: '2026-08-10' },
  { id: 't07', account_id: 'a-upi', kind: 'expense', amount: 1800, category: 'Groceries', payee: 'Zepto', note: '', date: '2026-08-12' },
  { id: 't08', account_id: 'a-hdfc', kind: 'expense', amount: 2000, category: 'Eating out', payee: 'Toit', note: 'friends', date: '2026-08-14' },
  { id: 't09', account_id: 'a-cash', kind: 'expense', amount: 2200, category: 'Groceries', payee: 'Local market', note: '', date: '2026-08-15' },
  { id: 't10', account_id: 'a-hdfc', kind: 'income', amount: 8000, category: 'Freelance', payee: 'Side project', note: 'invoice #4', date: '2026-08-16' },
  { id: 't11', account_id: 'a-upi', kind: 'expense', amount: 2000, category: 'Eating out', payee: 'Swiggy', note: '', date: '2026-08-18' },
  { id: 't12', account_id: 'a-hdfc', kind: 'expense', amount: 1500, category: 'Bills', payee: 'BESCOM', note: 'electricity', date: '2026-08-19' },
]

const SEED_BUDGETS = [
  { category: 'Groceries', month: DEMO_MONTH, amount: 8000 },
  { category: 'Eating out', month: DEMO_MONTH, amount: 4000 },
  { category: 'Transport', month: DEMO_MONTH, amount: 2000 },
  { category: 'Bills', month: DEMO_MONTH, amount: 3000 },
]

const SEED_RECURRING = [
  { id: 'r-netflix', name: 'Netflix', kind: 'expense', amount: 649, category: 'Subscriptions', account_id: 'a-upi', cadence: 'monthly', day_of_month: 26, next_due: '2026-08-26' },
  { id: 'r-rent', name: 'Rent', kind: 'expense', amount: 15000, category: 'Housing', account_id: 'a-hdfc', cadence: 'monthly', day_of_month: 2, next_due: '2026-09-02' },
]

const SEED_GOALS = [
  { id: 'g1', title: 'Save ₹1,00,000', target: 100000, unit: '₹', saved: 25000, pct: 25, deadline: '2026-11-20' },
]

/* ---------- memory implementation (demo) ---------- */
function createMemoryApi() {
  let accounts = SEED_ACCOUNTS.map((a) => ({ ...a }))
  let txns = SEED_TXNS.map((t) => ({ ...t }))
  let budgets = SEED_BUDGETS.map((b) => ({ ...b }))
  let recurring = SEED_RECURRING.map((r) => ({ ...r }))
  const goals = SEED_GOALS.map((g) => ({ ...g }))
  let seq = 1000

  const now = () => DEMO_TODAY
  const inDays = (dateStr) =>
    Math.round((new Date(dateStr + 'T00:00:00') - now()) / 86400000)

  const accountsWithBalance = () =>
    accounts.map((a) => ({ ...a, balance: balanceOf(a, txns) }))

  const netWorth = () =>
    accountsWithBalance().reduce((s, a) => s + a.balance, 0)

  const sortedTxns = () =>
    [...txns].sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : (a.id < b.id ? 1 : -1)))

  const forecast = (days) => {
    const net = netWorth()
    const upcoming = recurring
      .map((r) => ({
        id: r.id, name: r.name, kind: r.kind, amount: Number(r.amount) || 0,
        category: r.category, account_id: r.account_id, cadence: r.cadence,
        next_due: r.next_due, in_days: inDays(r.next_due),
      }))
      .filter((u) => u.in_days >= 0 && u.in_days <= days)
      .sort((a, b) => a.in_days - b.in_days)
    const upIncome = upcoming.filter((u) => u.kind === 'income').reduce((a, u) => a + u.amount, 0)
    const upExpense = upcoming.filter((u) => u.kind === 'expense').reduce((a, u) => a + u.amount, 0)
    return { net_now: net, projected: net + upIncome - upExpense, window_days: days, upcoming }
  }

  const dashboard = () => {
    const month = DEMO_MONTH
    const inMonth = txns.filter((t) => monthOf(t.date) === month)
    const spent_month = inMonth.filter((t) => t.kind === 'expense').reduce((a, t) => a + (Number(t.amount) || 0), 0)
    const earned_month = inMonth.filter((t) => t.kind === 'income').reduce((a, t) => a + (Number(t.amount) || 0), 0)
    return {
      accounts: accountsWithBalance(),
      net_worth: netWorth(),
      month,
      spent_month,
      earned_month,
      recent: sortedTxns().slice(0, 12),
      budgets: budgetStatus(budgets, txns, month),
      forecast: forecast(30),
      goals: goals.map((g) => ({ ...g })),
    }
  }

  return {
    getDashboard: () => Promise.resolve(dashboard()),

    listTxns({ account_id, month, q } = {}) {
      const ql = (q || '').toLowerCase()
      const hits = sortedTxns().filter((t) =>
        (!account_id || t.account_id === account_id || t.transfer_account_id === account_id) &&
        (!month || monthOf(t.date) === month) &&
        (!ql || `${t.payee} ${t.category} ${t.note}`.toLowerCase().includes(ql)))
      return Promise.resolve({ txns: hits })
    },
    createTxn(payload) {
      const id = `txn-${++seq}`
      const t = {
        id,
        account_id: payload.account_id,
        kind: KINDS.includes(payload.kind) ? payload.kind : 'expense',
        amount: Number(payload.amount) || 0,
        category: payload.category || '',
        payee: payload.payee || '',
        note: payload.note || '',
        date: payload.date || DEMO_TODAY.toISOString().slice(0, 10),
        transfer_account_id: payload.kind === 'transfer' ? (payload.transfer_account_id || '') : undefined,
      }
      txns = [t, ...txns]
      return Promise.resolve({ id })
    },
    updateTxn(id, patch) {
      txns = txns.map((t) => (t.id === id
        ? { ...t, ...patch, amount: patch.amount != null ? Number(patch.amount) || 0 : t.amount }
        : t))
      return Promise.resolve({ ok: true })
    },
    deleteTxn(id) {
      txns = txns.filter((t) => t.id !== id)
      return Promise.resolve({ ok: true })
    },

    listAccounts: () => Promise.resolve({ accounts: accountsWithBalance() }),
    createAccount({ name, type, opening }) {
      const id = `acc-${++seq}`
      accounts = [...accounts, { id, name: name || 'Account', type: type || 'bank', opening: Number(opening) || 0 }]
      return Promise.resolve({ id })
    },
    updateAccount(id, patch) {
      accounts = accounts.map((a) => (a.id === id
        ? { ...a, ...patch, opening: patch.opening != null ? Number(patch.opening) || 0 : a.opening }
        : a))
      return Promise.resolve({ ok: true })
    },
    deleteAccount(id) {
      accounts = accounts.filter((a) => a.id !== id)
      txns = txns.filter((t) => t.account_id !== id && t.transfer_account_id !== id)
      return Promise.resolve({ ok: true })
    },

    listBudgets(month) {
      return Promise.resolve({ budgets: budgetStatus(budgets, txns, month || DEMO_MONTH) })
    },
    setBudget({ category, month, amount }) {
      const m = month || DEMO_MONTH
      const exists = budgets.some((b) => b.category === category && b.month === m)
      budgets = exists
        ? budgets.map((b) => (b.category === category && b.month === m ? { ...b, amount: Number(amount) || 0 } : b))
        : [...budgets, { category, month: m, amount: Number(amount) || 0 }]
      return Promise.resolve({ ok: true })
    },
    deleteBudget({ category, month }) {
      const m = month || DEMO_MONTH
      budgets = budgets.filter((b) => !(b.category === category && b.month === m))
      return Promise.resolve({ ok: true })
    },

    listRecurring: () => Promise.resolve({
      recurring: recurring.map((r) => ({ ...r, in_days: inDays(r.next_due) })),
    }),
    createRecurring(payload) {
      const id = `rec-${++seq}`
      recurring = [...recurring, {
        id,
        name: payload.name || 'Bill',
        kind: KINDS.includes(payload.kind) ? payload.kind : 'expense',
        amount: Number(payload.amount) || 0,
        category: payload.category || '',
        account_id: payload.account_id || (accounts[0] && accounts[0].id) || '',
        cadence: payload.cadence || 'monthly',
        day_of_month: payload.day_of_month != null ? Number(payload.day_of_month) : undefined,
        next_due: payload.next_due || '',
      }]
      return Promise.resolve({ id })
    },
    deleteRecurring(id) {
      recurring = recurring.filter((r) => r.id !== id)
      return Promise.resolve({ ok: true })
    },
    postRecurring(id) {
      const r = recurring.find((x) => x.id === id)
      if (!r) return Promise.reject(new Error('Recurring not found'))
      const txnId = `txn-${++seq}`
      txns = [{
        id: txnId, account_id: r.account_id, kind: r.kind, amount: Number(r.amount) || 0,
        category: r.category || '', payee: r.name, note: 'auto · recurring',
        date: DEMO_TODAY.toISOString().slice(0, 10),
      }, ...txns]
      // advance next_due one cadence step
      const advance = (d, cad) => {
        const dt = new Date(d + 'T00:00:00')
        if (cad === 'weekly') dt.setDate(dt.getDate() + 7)
        else dt.setMonth(dt.getMonth() + 1)
        return dt.toISOString().slice(0, 10)
      }
      recurring = recurring.map((x) => (x.id === id
        ? { ...x, next_due: x.next_due ? advance(x.next_due, x.cadence) : x.next_due }
        : x))
      return Promise.resolve({ txn_id: txnId })
    },

    getForecast: (days) => Promise.resolve(forecast(days || 30)),
    getGoals: () => Promise.resolve({ goals: goals.map((g) => ({ ...g })) }),
  }
}

/* ---------- fetch implementation (real) ---------- */
async function req(path, opts) {
  const r = await fetch(`${API}${path}`, opts)
  if (!r.ok) throw new Error(`Request failed (${r.status})`)
  return r.json()
}
const jsonBody = (method, body) => ({
  method, headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body),
})
const qs = (obj) => {
  const p = new URLSearchParams()
  Object.entries(obj || {}).forEach(([k, v]) => { if (v != null && v !== '') p.set(k, v) })
  const s = p.toString()
  return s ? `?${s}` : ''
}

function createFetchApi() {
  return {
    getDashboard: () => req(`/api/money`),
    listTxns: (f) => req(`/api/money/txns${qs(f)}`),
    createTxn: (b) => req(`/api/money/txn`, jsonBody('POST', b)),
    updateTxn: (id, b) => req(`/api/money/txn/${id}`, jsonBody('PUT', b)),
    deleteTxn: (id) => req(`/api/money/txn/${id}`, { method: 'DELETE' }),

    listAccounts: () => req(`/api/money/accounts`),
    createAccount: (b) => req(`/api/money/account`, jsonBody('POST', b)),
    updateAccount: (id, b) => req(`/api/money/account/${id}`, jsonBody('PUT', b)),
    deleteAccount: (id) => req(`/api/money/account/${id}`, { method: 'DELETE' }),

    listBudgets: (month) => req(`/api/money/budgets${qs({ month })}`),
    setBudget: (b) => req(`/api/money/budget`, jsonBody('POST', b)),
    deleteBudget: ({ category, month }) => req(`/api/money/budget${qs({ category, month })}`, { method: 'DELETE' }),

    listRecurring: () => req(`/api/money/recurring`),
    createRecurring: (b) => req(`/api/money/recurring`, jsonBody('POST', b)),
    deleteRecurring: (id) => req(`/api/money/recurring/${id}`, { method: 'DELETE' }),
    postRecurring: (id) => req(`/api/money/recurring/${id}/post`, { method: 'POST' }),

    getForecast: (days) => req(`/api/money/forecast${qs({ days })}`),
    getGoals: () => req(`/api/money/goals`),
  }
}

export function createMoneyApi(demo) {
  return demo ? createMemoryApi() : createFetchApi()
}
