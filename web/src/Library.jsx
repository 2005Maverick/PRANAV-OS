import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Editor from './Editor.jsx'
import { createLibApi } from './libApi.js'

// The map pulls in the (heavy) force-graph engine — load it only when opened.
const GraphModal = lazy(() => import('./GraphModal.jsx'))

// SHEET 05 · LIBRARY — the vault, made real. The REDLINE look is unchanged;
// the writing engine (TipTap → markdown), the shelf, the connections rail and
// the map are wired to the library API (or an in-memory store in ?demo).

const AUTOSAVE_MS = 800
const SEARCH_MS = 300

// friendly timestamp: ISO -> "today · 18:29" / "yesterday" / "22 Aug".
// Demo passes already-friendly strings, which fall through unchanged.
function fmtWhen(v) {
  if (!v) return ''
  const d = new Date(v)
  if (isNaN(d.getTime())) return v
  const now = new Date()
  const y = new Date(now); y.setDate(now.getDate() - 1)
  const hhmm = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  if (d.toDateString() === now.toDateString()) return `today · ${hhmm}`
  if (d.toDateString() === y.toDateString()) return 'yesterday'
  return d.toLocaleDateString([], { day: 'numeric', month: 'short' })
}

function NoteRow({ n, active, onOpen }) {
  return (
    <button className={`lb-row ${active ? 'on' : ''}`} onClick={() => onOpen(n.id)}
      style={{ '--c': `var(--m-${n.tag}, var(--_p-graph))` }}>
      <span className="lb-row-dot" aria-hidden="true" />
      <span className="lb-row-main">
        <span className="lb-row-title">{n.title}</span>
        <span className="lb-row-ex">{n.excerpt || 'Empty note'}</span>
      </span>
      <span className="lb-row-meta anno">{fmtWhen(n.updated)}</span>
    </button>
  )
}

export default function Library({ demo }) {
  const api = useMemo(() => createLibApi(demo), [demo])

  const [notes, setNotes] = useState([])
  const [openId, setOpenId] = useState(null)
  const [note, setNote] = useState(null)      // full open note
  const [q, setQ] = useState('')
  const [showGraph, setShowGraph] = useState(false)
  const [leftOpen, setLeftOpen] = useState(true)
  const [rightOpen, setRightOpen] = useState(true)
  const [save, setSave] = useState('idle')    // idle | saving | saved
  const [err, setErr] = useState(null)
  const [tagDraft, setTagDraft] = useState('')

  const saveTimer = useRef(null)
  const pending = useRef({})

  /* ---------- list (search) ---------- */
  const loadList = useCallback(async (query, keepOpen) => {
    try {
      const d = await api.listNotes(query)
      const list = d.notes || []
      setNotes(list)
      setErr(null)
      if (!keepOpen && !openId && list.length) setOpenId(list[0].id)
      return list
    } catch {
      setErr('Could not load your notes.')
      return []
    }
  }, [api, openId])

  useEffect(() => {
    const t = setTimeout(() => { loadList(q, true) }, SEARCH_MS)
    return () => clearTimeout(t)
  }, [q]) // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadList('', false) }, []) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- open a note ---------- */
  useEffect(() => {
    if (!openId) { setNote(null); return }
    let live = true
    api.getNote(openId)
      .then((n) => { if (live) { setNote(n); setSave('idle'); setErr(null) } })
      .catch(() => { if (live) setErr('Could not open that note.') })
    return () => { live = false }
  }, [openId, api])

  /* ---------- autosave (debounced PUT of whatever changed) ---------- */
  const scheduleSave = useCallback((patch) => {
    if (!openId) return
    pending.current = { ...pending.current, ...patch }
    setSave('saving')
    if (saveTimer.current) clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(async () => {
      const body = pending.current
      pending.current = {}
      try {
        await api.updateNote(openId, body)
        setSave('saved')
        // reflect title/tag/excerpt changes back into the shelf without a full reload
        setNotes((prev) => prev.map((n) => (n.id === openId
          ? { ...n, ...(body.title != null ? { title: body.title } : {}),
              ...(body.tags != null ? { tags: body.tags, tag: body.tags[0] || 'uni' } : {}) }
          : n)))
      } catch {
        setSave('idle')
        setErr('Changes are not saving — check the connection.')
      }
    }, AUTOSAVE_MS)
  }, [api, openId])

  const onBody = useCallback((md) => {
    setNote((n) => (n ? { ...n, body_md: md } : n))
    scheduleSave({ body_md: md })
  }, [scheduleSave])

  const onTitle = (e) => {
    const title = e.target.value
    setNote((n) => (n ? { ...n, title } : n))
    scheduleSave({ title })
  }

  /* ---------- shelf actions ---------- */
  const newNote = async () => {
    try {
      const { id } = await api.createNote({ title: 'Untitled', body_md: '', tags: [] })
      await loadList('', true)
      setQ('')
      setOpenId(id)
    } catch { setErr('Could not create a note.') }
  }

  const openDaily = async () => {
    try {
      const { id } = await api.daily()
      await loadList('', true)
      setOpenId(id)
    } catch { setErr('Could not open today’s daily note.') }
  }

  const togglePin = async () => {
    if (!note) return
    const pinned = !note.pinned
    setNote({ ...note, pinned })
    setNotes((prev) => prev.map((n) => (n.id === note.id ? { ...n, pinned } : n)))
    try { await api.pinNote(note.id, pinned) } catch { setErr('Could not pin the note.') }
  }

  const deleteNote = async () => {
    if (!note) return
    if (!window.confirm(`Delete “${note.title}”? This can’t be undone.`)) return
    const id = note.id
    const remaining = notes.filter((n) => n.id !== id)
    setNotes(remaining)
    setOpenId(remaining[0]?.id || null)
    try { await api.deleteNote(id) } catch { setErr('Could not delete the note.'); loadList(q, true) }
  }

  /* ---------- tags ---------- */
  const setTags = (tags) => {
    setNote((n) => (n ? { ...n, tags } : n))
    scheduleSave({ tags })
  }
  const addTag = (e) => {
    e.preventDefault()
    const t = tagDraft.trim().toLowerCase()
    if (!t || !note || note.tags.includes(t)) { setTagDraft(''); return }
    setTags([...note.tags, t])
    setTagDraft('')
  }
  const removeTag = (t) => { if (note) setTags(note.tags.filter((x) => x !== t)) }

  const graphNotes = useMemo(
    () => notes.map((n) => ({ id: n.id, title: n.title, tag: n.tag })),
    [notes])

  const pinned = notes.filter((n) => n.pinned)
  const rest = notes.filter((n) => !n.pinned)
  const crumb = note ? `${note.tags[0] || 'note'} · ${(note.title || '').toLowerCase().replace(/\s+/g, '-').slice(0, 24)}` : ''

  return (
    <div className={`lb ${leftOpen ? '' : 'lc'} ${rightOpen ? '' : 'rc'}`}>
      {/* ---- left: the shelf ---- */}
      {leftOpen ? (
      <aside className="lb-shelf">
        <div className="lb-rail-head">
          <span className="cap">Notes</span>
          <button className="lb-collapse" onClick={() => setLeftOpen(false)}
            title="Hide the notes list" aria-label="Hide the notes list">«</button>
        </div>
        <div className="lb-search">
          <span className="lb-search-i anno" aria-hidden="true">⌕</span>
          <input className="lb-search-in" placeholder="Search the library…"
            value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search notes" />
        </div>
        <button className="btn btn-primary lb-new" onClick={newNote}>＋ New note</button>
        <button className="btn lb-daily" onClick={openDaily}>◴ Daily note</button>

        {err && <p className="lb-inline-err anno" role="alert">{err}</p>}

        {pinned.length > 0 && (
          <>
            <div className="lb-group cap">Pinned</div>
            {pinned.map((n) => <NoteRow key={n.id} n={n} active={n.id === openId} onOpen={setOpenId} />)}
          </>
        )}
        <div className="lb-group cap">This week</div>
        {rest.map((n) => <NoteRow key={n.id} n={n} active={n.id === openId} onOpen={setOpenId} />)}
        {!notes.length && <p className="lb-empty anno">{q ? `No note matches “${q}”.` : 'No notes yet — start one.'}</p>}
      </aside>
      ) : (
        <button className="lb-strip left" onClick={() => setLeftOpen(true)}
          title="Show the notes list" aria-label="Show the notes list">
          <span className="lb-strip-txt">» Notes</span>
        </button>
      )}

      {/* ---- middle: the page ---- */}
      <section className="lb-page">
        {note ? (
          <div className="lb-doc">
            <div className="lb-doc-head">
              <span className="lb-crumb anno">{crumb}</span>
              <span className="lb-doc-actions">
                <span className="lb-doc-meta anno">
                  {save === 'saving' ? 'Saving…' : save === 'saved' ? 'Saved ✓' : `Edited ${fmtWhen(note.updated)}`}
                </span>
                <button className="lb-act" onClick={togglePin}
                  title={note.pinned ? 'Unpin' : 'Pin'} aria-label={note.pinned ? 'Unpin' : 'Pin'}>
                  {note.pinned ? '★' : '☆'}
                </button>
                <button className="lb-act lb-act-del" onClick={deleteNote}
                  title="Delete note" aria-label="Delete note">Delete</button>
              </span>
            </div>
            <input className="lb-h1 lb-title" value={note.title} onChange={onTitle}
              placeholder="Untitled" aria-label="Note title" />
            <Editor key={note.id} note={note} allNotes={graphNotes} onChange={onBody}
              onOpenLink={(title) => {
                const t = title.toLowerCase()
                const hit = notes.find((n) => n.title.toLowerCase() === t)
                if (hit) setOpenId(hit.id)
                else setErr(`No note titled “${title}” yet — type it to create one.`)
              }} />
          </div>
        ) : (
          <div className="lb-doc lb-doc-empty">
            <p className="lb-empty anno">{err || 'Select a note, or start a new one.'}</p>
          </div>
        )}
      </section>

      {/* ---- right: the connections ---- */}
      {rightOpen ? (
      <aside className="lb-links">
        <div className="lb-rail-head">
          <span className="cap">Connections</span>
          <button className="lb-collapse" onClick={() => setRightOpen(false)}
            title="Hide connections" aria-label="Hide connections">»</button>
        </div>
        {note && (
          <>
            <div className="lb-links-sec">
              <div className="lb-group cap">Mentioned in</div>
              {(note.mentioned_in || []).map((m) => (
                <button key={m.id} className="lb-conn" onClick={() => setOpenId(m.id)}>
                  <span className="lb-conn-title">{m.title}</span>
                  <span className="lb-conn-where anno">{m.where}</span>
                </button>
              ))}
              {!(note.mentioned_in || []).length && <p className="lb-empty anno">No backlinks yet.</p>}
            </div>
            <div className="lb-links-sec">
              <div className="lb-group cap">Related</div>
              {(note.related || []).map((r) => (
                <button key={r.id} className="lb-conn" onClick={() => setOpenId(r.id)}
                  style={{ '--c': `var(--m-${r.tag}, var(--_p-graph))` }}>
                  <span className="lb-conn-dot" aria-hidden="true" />
                  <span className="lb-conn-title">{r.title}</span>
                </button>
              ))}
              {!(note.related || []).length && <p className="lb-empty anno">Nothing related yet.</p>}
            </div>
            <div className="lb-links-sec">
              <div className="lb-group cap">Tags</div>
              <div className="lb-tags">
                {note.tags.map((t) => (
                  <button key={t} className="lb-tag lb-tag-x" style={{ '--c': `var(--m-${t}, var(--_p-graph))` }}
                    onClick={() => removeTag(t)} title="Remove tag">{t} ×</button>
                ))}
              </div>
              <form className="lb-tag-add" onSubmit={addTag}>
                <input className="lb-tag-in" value={tagDraft} onChange={(e) => setTagDraft(e.target.value)}
                  placeholder="add a tag…" aria-label="Add a tag" />
              </form>
            </div>
          </>
        )}
        <button className="btn lb-graph-btn" onClick={() => setShowGraph(true)}>
          ◍ Open the map
        </button>
      </aside>
      ) : (
        <button className="lb-strip right" onClick={() => setRightOpen(true)}
          title="Show connections" aria-label="Show connections">
          <span className="lb-strip-txt">Connections «</span>
        </button>
      )}

      {showGraph && (
        <Suspense fallback={null}>
          <GraphModal api={api} currentId={note?.id} onClose={() => setShowGraph(false)}
            onOpenNote={(id) => { setShowGraph(false); setOpenId(id) }} />
        </Suspense>
      )}
    </div>
  )
}
