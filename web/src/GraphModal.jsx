import { useEffect, useMemo, useRef, useState } from 'react'
import ForceGraph2D from 'react-force-graph-2d'

// Canvas needs a real color string, not a CSS var — resolve `--m-<tag>` through a
// probe element (and normalise via a scratch canvas so any color space is accepted).
const colorCache = new Map()
let scratch = null
function colorForTag(tag) {
  if (colorCache.has(tag)) return colorCache.get(tag)
  let out = '#8a8f98'
  try {
    const probe = document.createElement('span')
    probe.style.color = `var(--m-${tag}, var(--_p-graph))`
    document.body.appendChild(probe)
    const computed = getComputedStyle(probe).color
    document.body.removeChild(probe)
    if (!scratch) scratch = document.createElement('canvas').getContext('2d')
    scratch.fillStyle = '#000'
    scratch.fillStyle = computed
    out = scratch.fillStyle || computed || out
  } catch { /* keep fallback */ }
  colorCache.set(tag, out)
  return out
}

export default function GraphModal({ api, onClose, onOpenNote }) {
  const [graph, setGraph] = useState(null)
  const [err, setErr] = useState(false)
  const boxRef = useRef(null)
  const [size, setSize] = useState({ w: 520, h: 420 })

  useEffect(() => {
    let live = true
    api.getGraph()
      .then((d) => { if (live) setGraph({ nodes: d.nodes || [], links: (d.edges || []).map((e) => ({ ...e })) }) })
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
  }, [])

  const data = useMemo(() => graph || { nodes: [], links: [] }, [graph])
  const line = useMemo(() => colorForTag('__line'), []) // resolves to graph grey fallback

  return (
    <div className="mv-overlay" onClick={onClose}>
      <div className="mv-panel lb-graph-panel" onClick={(e) => e.stopPropagation()}>
        <div className="mv-head">
          <span className="mv-title">The map</span>
          <span className="dd-meta anno">every note, every thread — click a point to open it</span>
          <button className="mv-close" onClick={onClose} aria-label="Close">×</button>
        </div>
        <div className="lb-graph-canvas" ref={boxRef}>
          {err ? (
            <p className="lb-graph-note anno">Couldn’t load the map — check the connection.</p>
          ) : !graph ? (
            <p className="lb-graph-note anno">Drawing the threads…</p>
          ) : !data.nodes.length ? (
            <p className="lb-graph-note anno">The map fills in as notes link to each other.</p>
          ) : (
            <ForceGraph2D
              graphData={data}
              width={size.w}
              height={size.h}
              backgroundColor="rgba(0,0,0,0)"
              nodeRelSize={5}
              nodeColor={(n) => colorForTag(n.tag)}
              linkColor={() => line}
              linkWidth={1}
              nodeLabel={(n) => n.title}
              cooldownTicks={80}
              onNodeClick={(n) => onOpenNote(n.id)}
              nodeCanvasObjectMode={() => 'after'}
              nodeCanvasObject={(n, ctx, scale) => {
                if (scale < 1.4) return
                ctx.font = `${11 / scale}px sans-serif`
                ctx.fillStyle = colorForTag('__line')
                ctx.textAlign = 'center'
                ctx.fillText(n.title, n.x, n.y + 10 / scale)
              }}
            />
          )}
        </div>
      </div>
    </div>
  )
}
