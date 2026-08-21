import { useCallback, useEffect, useRef, useState } from 'react'

const API = import.meta.env.VITE_API || 'https://pranav-os.onrender.com'
const IDLE_LOCK_MS = 3 * 60 * 1000 // re-lock after 3 min of no interaction

const DEMO_ENTRIES = [
  { id: 1, label: 'Telangana staging', kind: 'pointer', pointer: 'Bitwarden → telangana-staging', secret: null },
  { id: 2, label: 'College wifi', kind: 'encrypted', pointer: null, secret: 'hostel@2026' },
  { id: 3, label: 'Neon — pranav-os', kind: 'encrypted', pointer: 'console.neon.tech', secret: 'npg_xxx…redacted' },
]

function Padlock() {
  return (
    <svg className="vlt-lock" width="40" height="46" viewBox="0 0 40 46" fill="none" aria-hidden="true">
      <rect x="4" y="18" width="32" height="24" rx="4" stroke="currentColor" strokeWidth="2" />
      <path d="M11 18v-5a9 9 0 0 1 18 0v5" stroke="currentColor" strokeWidth="2" fill="none" />
      <circle cx="20" cy="28" r="3" fill="currentColor" />
      <path d="M20 31v5" stroke="currentColor" strokeWidth="2" />
    </svg>
  )
}

const isUrl = (s) => typeof s === 'string' && /^https?:\/\//i.test(s)

export default function Vault({ demo }) {
  const [status, setStatus] = useState(demo ? { has_password: true, entries: 3 } : null)
  const [pw, setPw] = useState('')
  const [entries, setEntries] = useState(null)
  const [flash, setFlash] = useState(null)
  const [q, setQ] = useState('')
  const [shown, setShown] = useState(() => new Set())
  const [form, setForm] = useState({ label: '', pointer: '', secret: '' })
  const [busy, setBusy] = useState(false)
  const idleRef = useRef(null)

  const note = (m) => { setFlash(m); setTimeout(() => setFlash(null), 3000) }

  const lock = useCallback(() => {
    setEntries(null); setPw(''); setShown(new Set()); setQ('')
    setForm({ label: '', pointer: '', secret: '' })
  }, [])

  useEffect(() => {
    if (demo) return
    fetch(`${API}/api/vault/status`).then((r) => r.json()).then(setStatus).catch(() => {})
  }, [demo])

  // idle auto-lock while unlocked
  const bumpIdle = useCallback(() => {
    if (idleRef.current) clearTimeout(idleRef.current)
    idleRef.current = setTimeout(() => { lock(); note('Auto-locked after idle.') }, IDLE_LOCK_MS)
  }, [lock])
  useEffect(() => {
    if (!entries) return
    bumpIdle()
    return () => idleRef.current && clearTimeout(idleRef.current)
  }, [entries, bumpIdle])

  const setup = async () => {
    if (demo) return note('demo mode')
    if (pw.length < 8) return note('Use at least 8 characters.')
    setBusy(true)
    const r = await fetch(`${API}/api/vault/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    }).then((x) => x.json()).catch(() => null)
    setBusy(false)
    if (r?.reply === 'ok') { note('Vault armed — this password is unrecoverable. Keep it.'); setStatus({ ...status, has_password: true }) }
    else note(r?.reply || 'Failed.')
  }

  const unlock = async () => {
    if (demo) { setEntries(DEMO_ENTRIES); return }
    setBusy(true)
    const r = await fetch(`${API}/api/vault/unlock`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    }).then((x) => x.json()).catch(() => null)
    setBusy(false)
    if (r?.ok) setEntries(r.entries)
    else note('Wrong password.')
  }

  const add = async () => {
    if (!form.label.trim()) return note('A label is required.')
    if (demo) {
      setEntries([...entries, { id: Date.now(), label: form.label, kind: form.secret ? 'encrypted' : 'pointer', pointer: form.pointer || null, secret: form.secret || null }])
      setForm({ label: '', pointer: '', secret: '' }); note('Stored, encrypted.'); return
    }
    const r = await fetch(`${API}/api/vault/add`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw, label: form.label, pointer: form.pointer || null, secret: form.secret || null }),
    }).then((x) => x.json()).catch(() => null)
    if (r?.reply === 'ok') { note('Stored, encrypted.'); setForm({ label: '', pointer: '', secret: '' }); unlock() }
    else note(r?.reply || 'Failed.')
  }

  const remove = async (id, label) => {
    if (!window.confirm(`Delete “${label}” from the vault? This can’t be undone.`)) return
    if (demo) { setEntries(entries.filter((e) => e.id !== id)); return }
    const r = await fetch(`${API}/api/vault/delete`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw, id }),
    }).then((x) => x.json()).catch(() => null)
    if (r?.reply === 'ok') setEntries(entries.filter((e) => e.id !== id))
    else note(r?.reply || 'Failed.')
  }

  const reveal = (id) => setShown((s) => { const n = new Set(s); n.has(id) ? n.delete(id) : n.add(id); return n })
  const copy = async (secret) => {
    try { await navigator.clipboard.writeText(secret); note('Copied — it clears from view when you lock.') }
    catch { note('Copy failed — reveal and copy manually.') }
  }

  if (!status) return <div className="vlt-loading anno">checking the vault…</div>

  const list = entries
    ? entries.filter((e) => !q || (e.label + (e.pointer || '')).toLowerCase().includes(q.toLowerCase()))
    : []

  return (
    <div className="vlt" onMouseDown={entries ? bumpIdle : undefined} onKeyDown={entries ? bumpIdle : undefined}>
      <p className="vlt-lead">
        Locked by a password only you hold. The server keeps only a salt and a verifier —
        never the password, never the key. The bot only ever shows pointers.
      </p>
      {flash && <div className="vlt-flash anno" role="status">{flash}</div>}

      {!status.has_password ? (
        <div className="vlt-drawer">
          <Padlock />
          <div className="vlt-drawer-title">Set the vault password</div>
          <p className="vlt-warn anno">min 8 characters · unrecoverable if lost</p>
          <input type="password" className="field vlt-field" value={pw} autoComplete="off"
            onChange={(e) => setPw(e.target.value)} placeholder="new vault password"
            onKeyDown={(e) => e.key === 'Enter' && setup()} />
          <button className="btn btn-primary vlt-primary" onClick={setup} disabled={busy}>Arm the vault</button>
        </div>
      ) : !entries ? (
        <div className="vlt-drawer">
          <Padlock />
          <div className="vlt-drawer-title">{status.entries} entr{status.entries === 1 ? 'y' : 'ies'} · locked</div>
          <input type="password" className="field vlt-field" value={pw} autoComplete="off"
            onChange={(e) => setPw(e.target.value)} placeholder="vault password"
            onKeyDown={(e) => e.key === 'Enter' && unlock()} />
          <button className="btn btn-primary vlt-primary" onClick={unlock} disabled={busy}>Unlock</button>
        </div>
      ) : (
        <>
          <div className="vlt-bar">
            <span className="cap">{entries.length} unlocked</span>
            <input className="field vlt-search" placeholder="search labels…" value={q}
              onChange={(e) => setQ(e.target.value)} aria-label="Search vault" />
            <button className="btn" onClick={() => { lock(); note('Locked.') }}>Lock now</button>
          </div>

          <div className="vlt-list">
            {list.map((e) => (
              <div key={e.id} className="vlt-entry">
                <div className="vlt-entry-head">
                  <span className="vlt-label">{e.label}</span>
                  <span className="vlt-kind anno">{e.kind === 'encrypted' ? 'secret' : 'pointer'}</span>
                  <button className="vlt-x" onClick={() => remove(e.id, e.label)} aria-label="Delete entry">Delete</button>
                </div>
                {e.pointer && (
                  <div className="vlt-pointer">
                    → {isUrl(e.pointer)
                      ? <a href={e.pointer} target="_blank" rel="noreferrer">{e.pointer}</a>
                      : <span className="anno">{e.pointer}</span>}
                  </div>
                )}
                {e.secret != null && (
                  <div className="vlt-secret-row">
                    <span className="vlt-secret anno">{shown.has(e.id) ? e.secret : '•'.repeat(Math.min(e.secret.length, 20))}</span>
                    <button className="vlt-mini" onClick={() => reveal(e.id)}>{shown.has(e.id) ? 'hide' : 'reveal'}</button>
                    <button className="vlt-mini" onClick={() => copy(e.secret)}>copy</button>
                  </div>
                )}
              </div>
            ))}
            {!list.length && <p className="vlt-empty anno">{q ? `Nothing matches “${q}”.` : 'The vault is empty — add your first entry below.'}</p>}
          </div>

          <div className="vlt-add">
            <div className="cap vlt-add-title">Add an entry</div>
            <p className="vlt-add-note anno">Leave the secret empty for a pointer-only entry (a hint to where the real secret lives).</p>
            <input className="field" placeholder="label — e.g. college wifi" value={form.label}
              onChange={(e) => setForm({ ...form, label: e.target.value })} />
            <input className="field" placeholder="pointer — a URL or 'Bitwarden → item'" value={form.pointer}
              onChange={(e) => setForm({ ...form, pointer: e.target.value })} />
            <input className="field" type="password" autoComplete="off" placeholder="secret value (encrypted at rest)"
              value={form.secret} onChange={(e) => setForm({ ...form, secret: e.target.value })} />
            <button className="btn btn-primary" onClick={add}>Store, encrypted</button>
          </div>
        </>
      )}
    </div>
  )
}
