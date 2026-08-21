import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import MiniSearch from 'minisearch'
import { createDecksApi, KINDS } from './decksApi.js'
import DeckCard from './DeckCard.jsx'

// SHEET 08 · DECKS — a personal library of saved CARDS grouped into user-made
// decks, with instant client-side search across everything. Deck rail (left) +
// masonry card wall (middle) + always-on search bar. REDLINE, memos × mymind.

const KIND_PICK = [
  ['prompt', 'Prompt'], ['note', 'Note'], ['link', 'Link'], ['image', 'Image'],
]

function parseTags(str) {
  return (str || '')
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
}

/* ---------- deck rail ---------- */
function DeckRow({ deck, active, onSelect, onRename, onDelete }) {
  const dot = deck.domain
    ? { '--c': `var(--m-${deck.domain}, var(--_p-graph))` }
    : {}
  return (
    <div className={`dk-deck ${active ? 'on' : ''}`} style={dot}>
      <button className="dk-deck-main" onClick={onSelect}>
        {deck.domain && <span className="dk-deck-dot" aria-hidden="true" />}
        <span className="dk-deck-name">{deck.name}</span>
        <span className="dk-deck-count anno">{deck.count}</span>
      </button>
      <span className="dk-deck-acts">
        <button className="dk-deck-act" title="Rename deck" aria-label={`Rename ${deck.name}`}
          onClick={onRename}>✎</button>
        <button className="dk-deck-act" title="Delete deck" aria-label={`Delete ${deck.name}`}
          onClick={onDelete}>✕</button>
      </span>
    </div>
  )
}

/* ---------- add / edit composer (modal) ---------- */
function Composer({ decks, activeDeck, onClose, onCreate, onUpload, err }) {
  const [kind, setKind] = useState('prompt')
  const [deckId, setDeckId] = useState(activeDeck || (decks[0] && decks[0].id) || '')
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('')
  const [tags, setTags] = useState('')
  const [file, setFile] = useState(null)
  const [busy, setBusy] = useState(false)

  // smart paste — a pasted URL preselects Link; a pasted image file uploads
  const onPaste = (e) => {
    const items = e.clipboardData?.items || []
    for (const it of items) {
      if (it.kind === 'file' && it.type.startsWith('image/')) {
        setKind('image')
        setFile(it.getAsFile())
        e.preventDefault()
        return
      }
    }
    const text = e.clipboardData?.getData('text') || ''
    if (/^https?:\/\/\S+$/i.test(text.trim()) && kind !== 'link') {
      setKind('link')
      setUrl(text.trim())
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    if (!deckId || busy) return
    setBusy(true)
    try {
      if (kind === 'image') {
        if (!file) { setBusy(false); return }
        await onUpload(deckId, file, title || file.name)
      } else {
        await onCreate(deckId, {
          kind, title: title || 'Untitled', body, url: kind === 'link' ? url : '',
          tags: parseTags(tags),
        })
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="mv-overlay" onClick={onClose}>
      <div className="mv-panel dk-composer" onClick={(e) => e.stopPropagation()} onPaste={onPaste}>
        <div className="mv-head">
          <span className="mv-title">Add a card</span>
          <button className="mv-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <form onSubmit={submit}>
          <div className="dk-kindpick">
            {KIND_PICK.map(([k, label]) => (
              <button type="button" key={k} className={`dk-kindbtn ${kind === k ? 'on' : ''}`}
                onClick={() => setKind(k)}>{label}</button>
            ))}
          </div>

          <label className="dk-field">
            <span className="dk-lbl anno">Deck</span>
            <select className="field dk-select" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
              {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </label>

          <label className="dk-field">
            <span className="dk-lbl anno">Title</span>
            <input className="field" value={title} onChange={(e) => setTitle(e.target.value)}
              placeholder={kind === 'image' ? 'caption (optional)' : 'a name for this card'} autoFocus />
          </label>

          {kind === 'link' && (
            <label className="dk-field">
              <span className="dk-lbl anno">URL</span>
              <input className="field" value={url} onChange={(e) => setUrl(e.target.value)}
                placeholder="https://…" inputMode="url" />
            </label>
          )}

          {kind === 'image' ? (
            <label className="dk-field">
              <span className="dk-lbl anno">Image</span>
              <input className="field dk-file" type="file" accept="image/*"
                onChange={(e) => setFile(e.target.files?.[0] || null)} />
            </label>
          ) : (
            <label className="dk-field">
              <span className="dk-lbl anno">{kind === 'link' ? 'Note (optional)' : 'Body'}</span>
              <textarea className="field dk-textarea" value={body} onChange={(e) => setBody(e.target.value)}
                rows={kind === 'prompt' ? 7 : 4}
                placeholder={kind === 'prompt' ? 'the full prompt…' : 'write it down…'} />
            </label>
          )}

          <label className="dk-field">
            <span className="dk-lbl anno">Tags</span>
            <input className="field" value={tags} onChange={(e) => setTags(e.target.value)}
              placeholder="comma, separated" />
          </label>

          {err && <p className="dk-inline-err anno" role="alert">{err}</p>}
          <div className="dk-composer-foot">
            <button type="button" className="btn" onClick={onClose}>Cancel</button>
            <button type="submit" className="btn btn-primary" disabled={busy}>
              {busy ? 'Adding…' : 'Add card'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

/* ---------- card detail / edit (modal) ---------- */
function CardEditor({ api, card, decks, onClose, onSaved, onDeleted }) {
  const [full, setFull] = useState(null)
  const [title, setTitle] = useState('')
  const [body, setBody] = useState('')
  const [url, setUrl] = useState('')
  const [tags, setTags] = useState('')
  const [deckId, setDeckId] = useState(card.deck_id)
  const [err, setErr] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let live = true
    api.getCard(card.id)
      .then((c) => {
        if (!live) return
        setFull(c)
        setTitle(c.title || '')
        setBody(c.body || '')
        setUrl(c.url || '')
        setTags((c.tags || []).join(', '))
        setDeckId(c.deck_id)
      })
      .catch(() => { if (live) setErr('Could not open that card.') })
    return () => { live = false }
  }, [api, card.id])

  const save = async (e) => {
    e.preventDefault()
    if (busy) return
    setBusy(true)
    try {
      const patch = { title, body, url, tags: parseTags(tags), deck_id: deckId }
      await api.updateCard(card.id, patch)
      onSaved(card.id, patch)
      onClose()
    } catch {
      setErr('Could not save — check the connection.')
      setBusy(false)
    }
  }

  const del = async () => {
    if (!window.confirm(`Delete “${title || 'this card'}”? This can't be undone.`)) return
    try {
      await api.deleteCard(card.id)
      onDeleted(card.id)
      onClose()
    } catch {
      setErr('Could not delete the card.')
    }
  }

  return (
    <div className="mv-overlay" onClick={onClose}>
      <div className="mv-panel dk-editor" onClick={(e) => e.stopPropagation()}>
        <div className="mv-head">
          <span className="mv-title">{KINDS.includes(card.kind) ? card.kind : 'card'}</span>
          <button className="mv-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        {full ? (
          <form onSubmit={save}>
            <label className="dk-field">
              <span className="dk-lbl anno">Title</span>
              <input className="field" value={title} onChange={(e) => setTitle(e.target.value)} />
            </label>
            {(card.kind === 'link') && (
              <label className="dk-field">
                <span className="dk-lbl anno">URL</span>
                <input className="field" value={url} onChange={(e) => setUrl(e.target.value)} />
              </label>
            )}
            {card.kind !== 'image' && (
              <label className="dk-field">
                <span className="dk-lbl anno">Body</span>
                <textarea className={`field dk-textarea ${card.kind === 'prompt' ? 'mono' : ''}`}
                  value={body} onChange={(e) => setBody(e.target.value)} rows={card.kind === 'prompt' ? 9 : 5} />
              </label>
            )}
            <div className="dk-field-row">
              <label className="dk-field">
                <span className="dk-lbl anno">Deck</span>
                <select className="field dk-select" value={deckId} onChange={(e) => setDeckId(e.target.value)}>
                  {decks.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </label>
              <label className="dk-field">
                <span className="dk-lbl anno">Tags</span>
                <input className="field" value={tags} onChange={(e) => setTags(e.target.value)}
                  placeholder="comma, separated" />
              </label>
            </div>
            {err && <p className="dk-inline-err anno" role="alert">{err}</p>}
            <div className="dk-composer-foot">
              <button type="button" className="btn dk-del" onClick={del}>Delete</button>
              <span className="dk-foot-spacer" />
              <button type="button" className="btn" onClick={onClose}>Cancel</button>
              <button type="submit" className="btn btn-primary" disabled={busy}>
                {busy ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        ) : (
          <p className="dk-empty anno">{err || 'Loading…'}</p>
        )}
      </div>
    </div>
  )
}

/* ---------- lightbox ---------- */
function Lightbox({ src, onClose }) {
  return (
    <div className="mv-overlay dk-lightbox" onClick={onClose}>
      <img src={src} alt="" onClick={(e) => e.stopPropagation()} />
      <button className="mv-close dk-lb-close" onClick={onClose} aria-label="Close">×</button>
    </div>
  )
}

/* ---------- page ---------- */
export default function Decks({ demo }) {
  const api = useMemo(() => createDecksApi(demo), [demo])

  const [decks, setDecks] = useState([])
  const [activeDeck, setActiveDeck] = useState(null)  // null = All
  const [cards, setCards] = useState([])              // list items for the current view
  const [q, setQ] = useState('')
  const [err, setErr] = useState(null)
  const [composing, setComposing] = useState(false)
  const [composerErr, setComposerErr] = useState(null)
  const [openCard, setOpenCard] = useState(null)
  const [lightbox, setLightbox] = useState('')
  const [newDeckName, setNewDeckName] = useState('')
  const [adding, setAdding] = useState(false)

  /* ---- decks ---- */
  const loadDecks = useCallback(async () => {
    try {
      const d = await api.listDecks()
      setDecks(d.decks || [])
      setErr(null)
    } catch {
      setErr('Could not load your decks.')
    }
  }, [api])

  /* ---- cards for the active deck (or all) ---- */
  const loadCards = useCallback(async (deckId) => {
    try {
      const d = await api.listCards(deckId || undefined, '')
      setCards(d.cards || [])
      setErr(null)
    } catch {
      setErr('Could not load cards.')
    }
  }, [api])

  useEffect(() => { loadDecks() }, [loadDecks])
  useEffect(() => { loadCards(activeDeck) }, [activeDeck, loadCards])

  /* ---- MiniSearch index over the loaded cards ---- */
  const index = useMemo(() => {
    const ms = new MiniSearch({
      fields: ['title', 'excerpt', 'url', 'tagStr'],
      storeFields: ['id'],
      searchOptions: { prefix: true, fuzzy: 0.2, boost: { title: 2 } },
    })
    ms.addAll(cards.map((c) => ({
      id: c.id, title: c.title || '', excerpt: c.excerpt || '',
      url: c.url || '', tagStr: (c.tags || []).join(' '),
    })))
    return ms
  }, [cards])

  const visible = useMemo(() => {
    const query = q.trim()
    if (!query) return cards
    const hitIds = new Set(index.search(query).map((r) => r.id))
    return cards.filter((c) => hitIds.has(c.id))
  }, [q, cards, index])

  const totalCount = useMemo(
    () => decks.reduce((a, d) => a + (d.count || 0), 0), [decks])

  /* ---- deck actions ---- */
  const createDeck = async (e) => {
    e.preventDefault()
    const name = newDeckName.trim()
    if (!name) { setAdding(false); return }
    try {
      const { id } = await api.createDeck({ name })
      setNewDeckName('')
      setAdding(false)
      await loadDecks()
      setActiveDeck(id)
    } catch { setErr('Could not create the deck.') }
  }

  const renameDeck = async (deck) => {
    const name = window.prompt('Rename deck', deck.name)
    if (name == null) return
    const trimmed = name.trim()
    if (!trimmed || trimmed === deck.name) return
    setDecks((prev) => prev.map((d) => (d.id === deck.id ? { ...d, name: trimmed } : d)))
    try { await api.updateDeck(deck.id, { name: trimmed }) }
    catch { setErr('Could not rename the deck.'); loadDecks() }
  }

  const deleteDeck = async (deck) => {
    if (!window.confirm(`Delete deck “${deck.name}” and its cards? This can't be undone.`)) return
    setDecks((prev) => prev.filter((d) => d.id !== deck.id))
    if (activeDeck === deck.id) setActiveDeck(null)
    try { await api.deleteDeck(deck.id) }
    catch { setErr('Could not delete the deck.'); loadDecks() }
  }

  /* ---- card actions ---- */
  const createCard = async (deckId, payload) => {
    setComposerErr(null)
    try {
      await api.createCard(deckId, payload)
      setComposing(false)
      await Promise.all([loadDecks(), loadCards(activeDeck)])
    } catch { setComposerErr('Could not add the card.') }
  }

  const uploadCard = async (deckId, file, title) => {
    setComposerErr(null)
    try {
      await api.uploadCard(deckId, file, title)
      setComposing(false)
      await Promise.all([loadDecks(), loadCards(activeDeck)])
    } catch { setComposerErr('Could not upload the image.') }
  }

  const onCardSaved = (id, patch) => {
    setCards((prev) => {
      // a move to another deck removes it from a single-deck view
      if (patch.deck_id && activeDeck && patch.deck_id !== activeDeck) {
        return prev.filter((c) => c.id !== id)
      }
      return prev.map((c) => (c.id === id
        ? { ...c, title: patch.title, url: patch.url, tags: patch.tags,
            deck_id: patch.deck_id || c.deck_id,
            excerpt: (patch.body || '').split('\n').find(Boolean)?.slice(0, 120) || c.excerpt }
        : c))
    })
    loadDecks()
  }

  const onCardDeleted = (id) => {
    setCards((prev) => prev.filter((c) => c.id !== id))
    loadDecks()
  }

  const openDetail = (id) => {
    const c = cards.find((x) => x.id === id)
    if (c) setOpenCard(c)
  }

  const activeName = activeDeck
    ? (decks.find((d) => d.id === activeDeck)?.name || 'Deck')
    : 'All decks'

  return (
    <div className="dk-wrap">
      {/* ---- left: deck rail ---- */}
      <aside className="dk-rail">
        <div className="dk-rail-head cap">Decks</div>
        <button className={`dk-deck all ${activeDeck === null ? 'on' : ''}`}
          onClick={() => setActiveDeck(null)}>
          <span className="dk-deck-name">All</span>
          <span className="dk-deck-count anno">{totalCount}</span>
        </button>

        {decks.map((d) => (
          <DeckRow key={d.id} deck={d} active={activeDeck === d.id}
            onSelect={() => setActiveDeck(d.id)}
            onRename={() => renameDeck(d)}
            onDelete={() => deleteDeck(d)} />
        ))}

        {adding ? (
          <form className="dk-newdeck" onSubmit={createDeck}>
            <input className="field" autoFocus value={newDeckName}
              onChange={(e) => setNewDeckName(e.target.value)}
              onBlur={() => { if (!newDeckName.trim()) setAdding(false) }}
              placeholder="deck name…" aria-label="New deck name" />
          </form>
        ) : (
          <button className="dk-newdeck-btn" onClick={() => setAdding(true)}>＋ New deck</button>
        )}

        {!decks.length && (
          <p className="dk-empty anno">No decks yet — a deck is a shelf for your cards. Make your first one.</p>
        )}
      </aside>

      {/* ---- middle: search + card wall ---- */}
      <section className="dk-main">
        <div className="dk-topbar">
          <div className="dk-search">
            <span className="dk-search-i anno" aria-hidden="true">⌕</span>
            <input className="dk-search-in" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder={`Search ${activeName.toLowerCase()}…`} aria-label="Search cards" />
            {q && <button className="dk-search-x" onClick={() => setQ('')} aria-label="Clear search">×</button>}
          </div>
          <button className="btn btn-primary dk-add" onClick={() => { setComposerErr(null); setComposing(true) }}>
            ＋ Add
          </button>
        </div>

        <div className="dk-matchbar anno">
          <span className="dk-scope">{activeName}</span>
          <span className="dk-match">
            {q ? `${visible.length} of ${cards.length} match “${q}”` : `${cards.length} card${cards.length === 1 ? '' : 's'}`}
          </span>
        </div>

        {err && <p className="dk-inline-err anno" role="alert">{err}</p>}

        {visible.length ? (
          <div className="dk-wall">
            {visible.map((c) => (
              <DeckCard key={c.id} api={api} card={c} onOpen={openDetail} onView={setLightbox} />
            ))}
          </div>
        ) : (
          <div className="dk-wall-empty">
            <p className="dk-empty anno">
              {q ? `Nothing matches “${q}”.`
                : cards.length === 0 && decks.length === 0 ? 'Make a deck, then drop your first card.'
                : 'Drop your first card — a prompt, a link, a note, an image.'}
            </p>
          </div>
        )}
      </section>

      {composing && (
        <Composer decks={decks} activeDeck={activeDeck} err={composerErr}
          onClose={() => setComposing(false)} onCreate={createCard} onUpload={uploadCard} />
      )}
      {openCard && (
        <CardEditor api={api} card={openCard} decks={decks}
          onClose={() => setOpenCard(null)} onSaved={onCardSaved} onDeleted={onCardDeleted} />
      )}
      {lightbox && <Lightbox src={lightbox} onClose={() => setLightbox('')} />}
    </div>
  )
}
