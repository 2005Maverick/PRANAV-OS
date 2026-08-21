import { useEffect, useRef, useState } from 'react'

// One index card on the wall. Adapts to `kind`: prompt / note / link / image.
// Image cards load their thumbnail through the keyed-fetch → object-URL path
// (an <img src> can't carry the X-API-Key header); the URL is revoked on unmount.

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url || ''
  }
}

const KIND_LABEL = { prompt: 'Prompt', note: 'Note', link: 'Link', image: 'Image' }

function Tags({ tags }) {
  if (!tags || !tags.length) return null
  return (
    <div className="dk-tags">
      {tags.map((t) => <span key={t} className="dk-tag">#{t}</span>)}
    </div>
  )
}

function CardFoot({ card }) {
  return (
    <div className="dk-foot">
      <span className="dk-kind anno">{KIND_LABEL[card.kind] || card.kind}</span>
      <span className="dk-updated anno">{card.updated}</span>
    </div>
  )
}

function ImageThumb({ api, card, onView }) {
  const [src, setSrc] = useState('')
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    let live = true
    let toRevoke = null
    api.getCardImage(card.id)
      .then(({ url, revoke }) => {
        if (!live) { if (revoke && url) URL.revokeObjectURL(url); return }
        setSrc(url)
        if (revoke) toRevoke = url
      })
      .catch(() => { if (live) setFailed(true) })
    return () => { live = false; if (toRevoke) URL.revokeObjectURL(toRevoke) }
  }, [api, card.id])

  return (
    <div className="dk dk-image">
      <button className="dk-thumb" onClick={() => src && onView(src)}
        aria-label={`View ${card.title} larger`}>
        {failed ? (
          <span className="dk-thumb-fail anno">image unavailable</span>
        ) : src ? (
          <img src={src} alt={card.title} loading="lazy" />
        ) : (
          <span className="dk-thumb-load anno">loading…</span>
        )}
      </button>
      <div className="dk-body">
        <span className="dk-title">{card.title}</span>
        <Tags tags={card.tags} />
        <CardFoot card={card} />
      </div>
    </div>
  )
}

function PromptCard({ api, card, onOpen }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef(null)

  const copy = async (e) => {
    e.stopPropagation()
    try {
      // the list item carries only an excerpt — pull the full body to copy
      const full = await api.getCard(card.id)
      await navigator.clipboard.writeText(full.body || card.excerpt)
      setCopied(true)
      if (timer.current) clearTimeout(timer.current)
      timer.current = setTimeout(() => setCopied(false), 1400)
    } catch {
      setCopied(false)
    }
  }

  useEffect(() => () => { if (timer.current) clearTimeout(timer.current) }, [])

  return (
    <div className="dk dk-prompt" onClick={() => onOpen(card.id)} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(card.id) }}>
      <div className="dk-body">
        <span className="dk-title">{card.title}</span>
        <pre className="dk-pre">{card.excerpt}</pre>
        <div className="dk-actions">
          <button className={`dk-copy ${copied ? 'ok' : ''}`} onClick={copy}>
            {copied ? 'copied ✓' : 'Copy'}
          </button>
        </div>
        <Tags tags={card.tags} />
        <CardFoot card={card} />
      </div>
    </div>
  )
}

function NoteCard({ card, onOpen }) {
  return (
    <div className="dk dk-note" onClick={() => onOpen(card.id)} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(card.id) }}>
      <div className="dk-body">
        <span className="dk-title">{card.title}</span>
        <p className="dk-text">{card.excerpt}</p>
        <Tags tags={card.tags} />
        <CardFoot card={card} />
      </div>
    </div>
  )
}

function LinkCard({ card, onOpen }) {
  return (
    <div className="dk dk-link" onClick={() => onOpen(card.id)} role="button" tabIndex={0}
      onKeyDown={(e) => { if (e.key === 'Enter') onOpen(card.id) }}>
      <div className="dk-body">
        <span className="dk-title">{card.title}</span>
        <span className="dk-host anno">{hostOf(card.url)}</span>
        <div className="dk-actions">
          <a className="dk-open" href={card.url} target="_blank" rel="noreferrer"
            onClick={(e) => e.stopPropagation()}>Open ↗</a>
        </div>
        <Tags tags={card.tags} />
        <CardFoot card={card} />
      </div>
    </div>
  )
}

export default function DeckCard({ api, card, onOpen, onView }) {
  if (card.kind === 'image') return <ImageThumb api={api} card={card} onView={onView} />
  if (card.kind === 'prompt') return <PromptCard api={api} card={card} onOpen={onOpen} />
  if (card.kind === 'link') return <LinkCard card={card} onOpen={onOpen} />
  return <NoteCard card={card} onOpen={onOpen} />
}

export { hostOf }
