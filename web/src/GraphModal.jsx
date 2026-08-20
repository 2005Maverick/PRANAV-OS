import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'

// Canvas needs real color strings, not CSS vars — resolve through a probe
// element and normalise via a scratch canvas so any color space is accepted.
const cache = new Map()
let scratch = null
function resolve(expr, fallback = '#8a8f98') {
  if (cache.has(expr)) return cache.get(expr)
  let out = fallback
  try {
    const probe = document.createElement('span')
    probe.style.color = expr
    document.body.appendChild(probe)
    const computed = getComputedStyle(probe).color
    document.body.removeChild(probe)
    if (!scratch) scratch = document.createElement('canvas').getContext('2d')
    scratch.fillStyle = '#000'
    scratch.fillStyle = computed
    out = scratch.fillStyle || computed || fallback
  } catch { /* keep fallback */ }
  cache.set(expr, out)
  return out
}
const tagColor = (tag) => resolve(`var(--m-${tag}, var(--_p-graph))`)

export default function GraphModal({ api, onClose, onOpenNote, currentId }) {
  const [graph, setGraph] = useState(null)
  const [err, setErr] = useState(false)
  const [hoverId, setHoverId] = useState(null)
  const boxRef = useRef(null)
  const fgRef = useRef(null)
  const [size, setSize] = useState({ w: 760, h: 520 })

  useEffect(() => {
    let live = true
    api.getGraph()
      .then((d) => { if (live) setGraph({ nodes: d.nodes || [], edges: d.edges || [] }) })
      .catch(() => { if (live) setErr(true) })
    return () => { live = false }
  }, [api])

  useEffect(() => {
    const el = boxRef.current
    if (!el) return
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight })
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [graph])

  // degree (for node size) + adjacency (for hover focus), keyed by id so they
  // survive the simulation turning link endpoints into node objects.
  const { data, adj, deg } = useMemo(() => {
    const g = graph || { nodes: [], edges: [] }
    const deg = new Map()
    const adj = new Map()
    g.nodes.forEach((n) => { deg.set(n.id, 0); adj.set(n.id, new Set()) })
    g.edges.forEach((e) => {
      if (!adj.has(e.source) || !adj.has(e.target)) return
      deg.set(e.source, (deg.get(e.source) || 0) + 1)
      deg.set(e.target, (deg.get(e.target) || 0) + 1)
      adj.get(e.source).add(e.target)
      adj.get(e.target).add(e.source)
    })
    return {
      deg, adj,
      data: {
        nodes: g.nodes.map((n) => ({ ...n, val: 1 + (deg.get(n.id) || 0) })),
        links: g.edges.map((e) => ({ ...e })),
      },
    }
  }, [graph])

  // spread the layout out a little — calmer than the default crush
  useEffect(() => {
    const fg = fgRef.current
    if (!fg || !data.nodes.length) return
    fg.d3Force('charge').strength(-170)
    const link = fg.d3Force('link')
    if (link) link.distance(64)
  }, [data])

  const MAP_INK = resolve('var(--map-ink)', '#e6e6e6')
  const MAP_FAINT = resolve('var(--map-faint)', '#8a8f98')
  const MAP_LINE = resolve('var(--map-line)', '#555')
  const MAP_BG = resolve('var(--map-bg)', '#161616')
  const ACCENT = resolve('var(--accent)', '#c0392b')

  const highlight = hoverId != null
    ? new Set([hoverId, ...(adj.get(hoverId) || [])])
    : null

  const onHover = (n) => {
    setHoverId(n ? n.id : null)
    if (boxRef.current) boxRef.current.style.cursor = n ? 'pointer' : 'grab'
  }

  const drawNode = (n, ctx, scale) => {
    const on = !highlight || highlight.has(n.id)
    const r = 3 + Math.sqrt(n.val) * 2.2
    ctx.globalAlpha = on ? 1 : 0.22
    const col = tagColor(n.tag)
    // glow
    ctx.shadowColor = col
    ctx.shadowBlur = on ? (n.id === hoverId ? 18 : 9) : 0
    ctx.beginPath()
    ctx.arc(n.x, n.y, r, 0, 2 * Math.PI)
    ctx.fillStyle = col
    ctx.fill()
    ctx.shadowBlur = 0
    // lit highlight for depth
    ctx.beginPath()
    ctx.arc(n.x - r * 0.28, n.y - r * 0.28, r * 0.42, 0, 2 * Math.PI)
    ctx.fillStyle = 'rgba(255,255,255,0.22)'
    ctx.fill()
    // "you are here" ring
    if (n.id === currentId) {
      ctx.beginPath()
      ctx.arc(n.x, n.y, r + 3.5, 0, 2 * Math.PI)
      ctx.strokeStyle = ACCENT
      ctx.lineWidth = 1.6 / scale
      ctx.stroke()
    }
    // label — declutter: only hubs / zoomed-in / the focused cluster / current
    const showLabel = highlight ? highlight.has(n.id)
      : (scale > 1.15 || n.val >= 3 || n.id === currentId)
    if (showLabel) {
      const fs = Math.max(11 / scale, 3)
      ctx.font = `500 ${fs}px "Archivo Variable", Archivo, sans-serif`
      ctx.textAlign = 'center'
      ctx.textBaseline = 'top'
      ctx.fillStyle = on ? MAP_INK : MAP_FAINT
      ctx.fillText(n.title, n.x, n.y + r + 2)
    }
    ctx.globalAlpha = 1
  }

  const hitPaint = (n, color, ctx) => {
    const r = 3 + Math.sqrt(n.val) * 2.2
    ctx.beginPath(); ctx.arc(n.x, n.y, r + 2, 0, 2 * Math.PI)
    ctx.fillStyle = color; ctx.fill()
  }

  const linkOn = (l) => {
    if (hoverId == null) return null
    const s = typeof l.source === 'object' ? l.source.id : l.source
    const t = typeof l.target === 'object' ? l.target.id : l.target
    return s === hoverId || t === hoverId
  }

  const counts = graph ? `${graph.nodes.length} notes · ${graph.edges.length} threads` : ''

  return (
    <div className="mv-overlay" onClick={onClose}>
      <div className="mv-panel lb-graph-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mv-head">
          <span className="mv-title">The map</span>
          <span className="dd-meta anno">{counts || 'every note, every thread'} · hover to trace · click to open</span>
          <button className="mv-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="lb-graph-canvas" ref={boxRef} style={{ background: MAP_BG }}>
          {err ? (
            <p className="lb-graph-note anno">Couldn’t load the map — check the connection.</p>
          ) : !graph ? (
            <p className="lb-graph-note anno">Drawing the threads…</p>
          ) : !data.nodes.length ? (
            <p className="lb-graph-note anno">The map fills in as your notes link to each other.</p>
          ) : (
            <ForceGraph2D
              ref={fgRef}
              graphData={data}
              width={size.w}
              height={size.h}
              backgroundColor={MAP_BG}
              autoPauseRedraw={false}
              cooldownTicks={90}
              onEngineStop={() => fgRef.current && fgRef.current.zoomToFit(500, 36)}
              nodeVal={(n) => n.val}
              nodeCanvasObjectMode={() => 'replace'}
              nodeCanvasObject={drawNode}
              nodePointerAreaPaint={hitPaint}
              onNodeHover={onHover}
              onNodeClick={(n) => onOpenNote(n.id)}
              linkCurvature={0.12}
              linkColor={(l) => {
                const inc = linkOn(l)
                if (inc === null) return MAP_LINE
                return inc ? ACCENT : MAP_LINE
              }}
              linkWidth={(l) => (linkOn(l) ? 1.8 : 0.7)}
              linkDirectionalParticles={(l) => (linkOn(l) ? 3 : 0)}
              linkDirectionalParticleWidth={2}
              linkDirectionalParticleColor={() => ACCENT}
            />
          )}
        </div>
        <div className="lb-graph-foot anno">Drag a point to pull the web · scroll to zoom · the red ring is the note you’re in</div>
      </div>
    </div>
  )
}
