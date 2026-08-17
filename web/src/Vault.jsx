import { useEffect, useState } from 'react'

const API = import.meta.env.VITE_API || 'https://pranav-os.onrender.com'

export default function Vault({ demo }) {
  const [status, setStatus] = useState(demo ? { has_password: true, entries: 2 } : null)
  const [pw, setPw] = useState('')
  const [entries, setEntries] = useState(null)
  const [flash, setFlash] = useState(null)
  const [form, setForm] = useState({ label: '', pointer: '', secret: '' })

  useEffect(() => {
    if (demo) return
    fetch(`${API}/api/vault/status`).then((r) => r.json()).then(setStatus).catch(() => {})
  }, [])

  const note = (m) => { setFlash(m); setTimeout(() => setFlash(null), 3000) }

  const setup = async () => {
    if (demo) return note('demo mode')
    const r = await fetch(`${API}/api/vault/setup`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    }).then((x) => x.json()).catch(() => null)
    if (r?.reply === 'ok') { note('Vault armed. This password is unrecoverable — keep it.'); setStatus({ ...status, has_password: true }) }
    else note(r?.reply || 'failed')
  }

  const unlock = async () => {
    if (demo) {
      setEntries([
        { id: 1, label: 'telangana staging', kind: 'pointer', pointer: 'Bitwarden → telangana-staging', secret: null },
        { id: 2, label: 'college wifi', kind: 'encrypted', pointer: null, secret: 'hostel@2026' },
      ])
      return
    }
    const r = await fetch(`${API}/api/vault/unlock`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw }),
    }).then((x) => x.json()).catch(() => null)
    if (r?.ok) setEntries(r.entries)
    else note('Wrong password.')
  }

  const add = async () => {
    if (demo) return note('demo mode')
    if (!form.label) return note('Label required')
    const r = await fetch(`${API}/api/vault/add`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password: pw, ...form, pointer: form.pointer || null, secret: form.secret || null }),
    }).then((x) => x.json()).catch(() => null)
    if (r?.reply === 'ok') { note('Stored encrypted.'); setForm({ label: '', pointer: '', secret: '' }); unlock() }
    else note(r?.reply || 'failed')
  }

  if (!status) return <div className="loading">checking the vault…</div>

  return (
    <div className="page-wrap">
      <p className="page-voice">
        Locked by your password — the server keeps only a salt and a verifier.
        The bot only ever shows pointers.
      </p>
      {flash && <div className="rc-hint mono" style={{ color: 'var(--acid)', marginBottom: 12 }}>{flash}</div>}

      {!status.has_password ? (
        <div className="vault-box">
          <div className="label mono">Set the vault password (min 8 chars — unrecoverable)</div>
          <div className="vault-row">
            <input type="password" className="lib-search" value={pw} onChange={(e) => setPw(e.target.value)} placeholder="vault password" />
            <button className="rv-btn dark-btn" onClick={setup}>arm the vault</button>
          </div>
        </div>
      ) : !entries ? (
        <div className="vault-box">
          <div className="label mono">{status.entries} entr{status.entries === 1 ? 'y' : 'ies'} · locked</div>
          <div className="vault-row">
            <input type="password" className="lib-search" value={pw} onChange={(e) => setPw(e.target.value)}
              placeholder="password" onKeyDown={(e) => e.key === 'Enter' && unlock()} />
            <button className="rv-btn dark-btn" onClick={unlock}>unlock</button>
          </div>
        </div>
      ) : (
        <>
          <div className="vault-row" style={{ marginBottom: 16 }}>
            <button className="rv-btn dark-btn" onClick={() => { setEntries(null); setPw('') }}>🔒 lock</button>
          </div>
          {entries.map((e) => (
            <div key={e.id} className="lib-card" style={{ marginBottom: 10 }}>
              <div className="lib-title">{e.label}</div>
              {e.pointer && <div className="lib-body mono">→ {e.pointer}</div>}
              {e.secret && <div className="vault-secret mono">{e.secret}</div>}
            </div>
          ))}
          <div className="vault-box" style={{ marginTop: 18 }}>
            <div className="label mono">Add entry (leave secret empty for pointer-only)</div>
            <div className="vault-form">
              <input className="lib-search" placeholder="label — e.g. college wifi" value={form.label}
                onChange={(e) => setForm({ ...form, label: e.target.value })} />
              <input className="lib-search" placeholder="pointer — e.g. Bitwarden → item name" value={form.pointer}
                onChange={(e) => setForm({ ...form, pointer: e.target.value })} />
              <input className="lib-search" type="password" placeholder="secret value (encrypted)" value={form.secret}
                onChange={(e) => setForm({ ...form, secret: e.target.value })} />
              <button className="rv-btn dark-btn" onClick={add}>store</button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
