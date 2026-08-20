import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import rough from 'roughjs'

// SHEET 06 · ARCS — the hand-drawn "Surveyor's Route".
// Every arc type is inked with rough.js so it reads like an architect's
// route survey, not a dashboard. Colours are resolved from the live REDLINE
// tokens through a probe element (rough needs real colour strings, not vars),
// and the wobble is seeded from each arc's id so it never jitters on redraw.

const NS = 'http://www.w3.org/2000/svg'

/* ---------- resolve a CSS var/expr to a concrete colour (theme-aware) ---------- */
// No cache: the token values flip between Day and Night print, so we must
// re-read them on every draw rather than memoise a stale colour.
function resolveColor(expr, fallback) {
  try {
    const probe = document.createElement('span')
    probe.style.color = expr
    probe.style.display = 'none'
    document.body.appendChild(probe)
    const c = getComputedStyle(probe).color
    document.body.removeChild(probe)
    return c || fallback
  } catch {
    return fallback
  }
}

function palette(domain) {
  return {
    ink: resolveColor('var(--text)', '#26272b'),
    inkMut: resolveColor('var(--text-muted)', '#5a5c62'),
    inkFaint: resolveColor('var(--text-faint)', '#6d6f75'),
    line: resolveColor('var(--line-ink)', '#b6b7bb'),
    paper: resolveColor('var(--bg)', '#f4f2ec'),
    red: resolveColor('var(--accent)', '#c0392b'),
    dom: resolveColor(`var(--m-${domain || 'reward'})`, '#5a7a8c'),
  }
}

/* ---------- stable seed from an id ---------- */
function seedOf(id) {
  let h = 0
  const s = String(id)
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h) % 100000
}

/* ---------- small primitives ---------- */
function txt(svg, x, y, s, o = {}) {
  const { fill = '#000', size = 11, anchor = 'middle', mono = true, weight = 400, op = 1, letter } = o
  const t = document.createElementNS(NS, 'text')
  t.setAttribute('x', x); t.setAttribute('y', y)
  t.setAttribute('text-anchor', anchor)
  t.setAttribute('dominant-baseline', 'middle')
  t.setAttribute('font-family', mono
    ? "'IBM Plex Mono', ui-monospace, monospace"
    : "'Archivo Variable', system-ui, sans-serif")
  t.setAttribute('font-size', size)
  t.setAttribute('fill', fill)
  t.setAttribute('font-weight', weight)
  if (letter) t.setAttribute('letter-spacing', letter)
  if (op !== 1) t.setAttribute('opacity', op)
  t.textContent = s
  svg.appendChild(t)
  return t
}

function hotspot(svg, x, y, r, onClick, label) {
  const c = document.createElementNS(NS, 'circle')
  c.setAttribute('cx', x); c.setAttribute('cy', y); c.setAttribute('r', r)
  c.setAttribute('fill', 'transparent')
  c.style.cursor = 'pointer'
  if (label) {
    c.setAttribute('role', 'button')
    c.setAttribute('tabindex', '0')
    c.setAttribute('aria-label', label)
    c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onClick(e) } })
  }
  c.addEventListener('click', onClick)
  svg.appendChild(c)
  return c
}

const fmtTime = (m) => {
  if (!m) return ''
  if (m < 60) return `${m}m`
  return m % 60 === 0 ? `${m / 60}h` : `${(m / 60).toFixed(1)}h`
}
const clip = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s)

/* ---------- road geometry ---------- */
function roadPoints(W, H, pad, baseY, n = 40) {
  const amp = Math.min(H * 0.13, 20)
  const pts = []
  for (let i = 0; i <= n; i++) {
    const t = i / n
    const x = pad + t * (W - 2 * pad)
    const y = baseY + amp * Math.sin(t * Math.PI * 2.2 + 0.5)
    pts.push([x, y])
  }
  return pts
}
function pointAt(pts, frac) {
  const idx = clampNum(frac, 0, 1) * (pts.length - 1)
  const i = Math.floor(idx)
  const f = idx - i
  const a = pts[i]
  const b = pts[Math.min(i + 1, pts.length - 1)]
  return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]
}
const clampNum = (n, lo, hi) => Math.max(lo, Math.min(hi, n))

/* ---------- a tick-rail (recent activity for a keep step) ---------- */
function drawTickRail(svg, rc, x0, y, w, step, P, seed, today) {
  const N = 9
  const gap = w / N
  // recency → how many of the rightmost ticks are inked
  let filled = 0
  if (step.last_done) {
    const g = daysBetween(step.last_done, today)
    filled = g <= 1 ? 3 : g <= 3 ? 2 : g <= 7 ? 1 : 0
  }
  for (let i = 0; i < N; i++) {
    const x = x0 + i * gap + gap / 2
    const inked = i >= N - filled
    svg.appendChild(rc.line(x, y - 7, x, y + 7, {
      stroke: inked ? P.dom : P.line,
      strokeWidth: inked ? 2.4 : 1.1,
      roughness: 1.2, seed: seed + i * 7,
    }))
  }
}
const DAY = 86400000
const daysBetween = (a, b) =>
  Math.round((new Date(b + 'T00:00:00') - new Date(a + 'T00:00:00')) / DAY)

/* ---------- PROJECT / UMBRELLA road ---------- */
function drawRoad(svg, rc, node, W, H, P, today, handlers) {
  const pad = 34
  const isUmbrella = node.type === 'umbrella'
  const baseY = isUmbrella ? H * 0.40 : H * 0.52
  const pts = roadPoints(W, H, pad, baseY)
  const seed = seedOf(node.id)
  const p = clampNum((node.progress ?? 0) / 100, 0, 1)

  // faint hatched road (the whole route)
  svg.appendChild(rc.curve(pts, {
    stroke: P.line, strokeWidth: 1.3, roughness: 1.35, seed,
    strokeLineDash: [1, 7],
  }))
  // solid inked road up to the progress point
  const cut = Math.max(1, Math.round(p * (pts.length - 1)))
  const solid = pts.slice(0, cut + 1)
  if (solid.length >= 2) {
    svg.appendChild(rc.curve(solid, {
      stroke: P.ink, strokeWidth: 2.6, roughness: 1.05, seed,
    }))
  }

  // stations along the road
  const stations = isUmbrella
    ? [...node.children.map((c) => ({ kind: 'child', ref: c })),
       ...node.steps.filter((s) => s.kind === 'checkpoint').map((s) => ({ kind: 'checkpoint', ref: s }))]
    : node.steps.filter((s) => s.kind === 'do' || s.kind === 'checkpoint')
        .map((s) => ({ kind: s.kind, ref: s }))

  const n = stations.length
  stations.forEach((st, k) => {
    const frac = n > 1 ? 0.10 + (0.72 * k) / (n - 1) : 0.42
    const [x, y] = pointAt(pts, frac)

    if (st.kind === 'child') {
      const c = st.ref
      svg.appendChild(rc.circle(x, y, 32, { stroke: P.ink, strokeWidth: 2, roughness: 1.1, seed: seed + k }))
      svg.appendChild(rc.circle(x, y, 20, { stroke: P.dom, strokeWidth: 2, roughness: 1.15, seed: seed + k * 3 }))
      txt(svg, x, y, `${c.progress ?? 0}`, { fill: P.ink, size: 12, weight: 600 })
      txt(svg, x, y - 30, clip(c.title, 16), { fill: P.inkMut, size: 11, mono: false, weight: 500 })
      txt(svg, x, y + 30, `${c.progress ?? 0}%`, { fill: P.dom, size: 10 })
      hotspot(svg, x, y, 18, () => handlers.onOpenChild(c.id), `Open ${c.title}`)
    } else if (st.kind === 'do') {
      const s = st.ref
      svg.appendChild(rc.circle(x, y, 22, {
        stroke: s.done ? P.ink : P.dom, strokeWidth: 2, roughness: 1.1, seed: seed + k * 5,
        fill: s.done ? P.ink : undefined, fillStyle: 'solid',
      }))
      txt(svg, x, y - 26, clip(s.title, 18), { fill: P.inkMut, size: 11, mono: false, weight: 500 })
      if (s.est_minutes) txt(svg, x, y + 26, fmtTime(s.est_minutes), { fill: P.inkFaint, size: 10 })
      hotspot(svg, x, y, 16, () => handlers.onStepClick(s), s.title)
    } else {
      // checkpoint — a small flagged diamond
      const s = st.ref
      const dash = s.waiting_on ? [4, 4] : undefined
      svg.appendChild(rc.polygon([[x, y - 10], [x + 10, y], [x, y + 10], [x - 10, y]], {
        stroke: s.done ? P.ink : P.inkMut, strokeWidth: 1.8, roughness: 1.1, seed: seed + k * 9,
        strokeLineDash: dash, fill: s.done ? P.red : undefined, fillStyle: 'solid',
      }))
      txt(svg, x, y - 24, clip(s.title, 16), { fill: P.inkMut, size: 10.5, mono: false })
      if (s.waiting_on) txt(svg, x, y + 24, `waiting: ${clip(s.waiting_on, 12)}`, { fill: P.red, size: 9.5 })
      hotspot(svg, x, y, 15, () => handlers.onStepClick(s), s.title)
    }
  })

  // "you are here" — red survey mark at the progress point
  if (node.progress != null && node.progress > 0 && node.progress < 100) {
    const [hx, hy] = pointAt(pts, p)
    svg.appendChild(rc.circle(hx, hy, 15, { stroke: P.red, strokeWidth: 2.4, roughness: 1.2, seed: seed + 999 }))
    txt(svg, hx, hy - 22, 'here', { fill: P.red, size: 9.5, weight: 600, letter: '0.08em' })
  }

  // the destination flag
  const end = pts[pts.length - 1]
  const [ex, ey] = end
  svg.appendChild(rc.line(ex, ey, ex, ey - 40, { stroke: P.ink, strokeWidth: 2, roughness: 1, seed: seed + 21 }))
  svg.appendChild(rc.polygon([[ex, ey - 40], [ex + 28, ey - 33], [ex, ey - 26]], {
    stroke: P.ink, strokeWidth: 1.6, roughness: 1.05, seed: seed + 33, fill: P.red, fillStyle: 'solid',
  }))
  if (node.days_left != null) {
    const late = node.days_left < 0
    txt(svg, ex, ey + 14, late ? `${Math.abs(node.days_left)}d over` : `${node.days_left} days`,
      { fill: late ? P.red : P.ink, size: 11, weight: 600 })
    if (node.deadline) txt(svg, ex, ey + 28, node.deadline.slice(5), { fill: P.inkFaint, size: 9.5 })
  }

  // umbrella keep-steps → tick rails below the road
  if (isUmbrella) {
    const keeps = node.steps.filter((s) => s.kind === 'keep')
    keeps.forEach((s, i) => {
      const ry = H - 40 + i * 22
      txt(svg, pad, ry, clip(s.title, 22), { fill: P.inkMut, size: 10.5, mono: false, anchor: 'start' })
      drawTickRail(svg, rc, W - pad - 150, ry, 150, s, P, seedOf(s.id), today)
    })
  }
}

/* ---------- TARGET gauge ---------- */
function drawGauge(svg, rc, node, W, H, P) {
  const pad = 34
  const t = node.target || { pct: 0, pace_pct: 0, on_pace: true }
  const seed = seedOf(node.id)
  const x = pad
  const w = W - 2 * pad
  const barH = 34
  const y = H * 0.46
  const top = y - barH / 2

  // filled portion (hachured domain colour)
  const fillW = Math.max((w * (t.pct || 0)) / 100, 1)
  if (t.pct > 0) {
    svg.appendChild(rc.rectangle(x, top, fillW, barH, {
      stroke: 'none', fill: P.dom, fillStyle: 'hachure', hachureGap: 5, fillWeight: 2,
      roughness: 1.3, seed,
    }))
  }
  // outline
  svg.appendChild(rc.rectangle(x, top, w, barH, { stroke: P.ink, strokeWidth: 2, roughness: 1.15, seed: seed + 3 }))

  // pace marker — where you SHOULD be by now
  const paceX = x + (w * (t.pace_pct || 0)) / 100
  svg.appendChild(rc.line(paceX, top - 12, paceX, top + barH + 12, {
    stroke: t.on_pace ? P.ink : P.red, strokeWidth: 2, roughness: 0.8, seed: seed + 7,
    strokeLineDash: [4, 4],
  }))
  txt(svg, paceX, top - 20, 'pace', { fill: t.on_pace ? P.inkFaint : P.red, size: 9.5, letter: '0.06em' })
  txt(svg, x, top + barH + 24, `${t.pct || 0}%`, { fill: P.dom, size: 11, anchor: 'start', weight: 600 })
}

/* ---------- component ---------- */
export default function ArcRoute({ node, today, onOpenChild, onStepClick, onTick }) {
  const day = today || todayIso()
  const wrapRef = useRef(null)
  const svgRef = useRef(null)
  const [w, setW] = useState(680)
  const [themeVer, setThemeVer] = useState(0)

  // keep the latest handlers without re-running the draw effect on every render
  const hRef = useRef({ onOpenChild, onStepClick })
  hRef.current = { onOpenChild, onStepClick }

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setW(Math.max(el.clientWidth, 320))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // redraw when the ink colours flip between Day and Night print
  useEffect(() => {
    const obs = new MutationObserver(() => setThemeVer((v) => v + 1))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  const isOngoing = node.type === 'ongoing'
  const H = node.type === 'umbrella' ? 210 : node.type === 'target' ? 132 : 176

  useEffect(() => {
    if (isOngoing) return
    const svg = svgRef.current
    if (!svg) return
    try {
      while (svg.firstChild) svg.removeChild(svg.firstChild)
      svg.setAttribute('viewBox', `0 0 ${w} ${H}`)
      svg.setAttribute('width', '100%')
      svg.setAttribute('height', H)
      const rc = rough.svg(svg)
      const P = palette(node.domain)
      if (node.type === 'target') drawGauge(svg, rc, node, w, H, P)
      else drawRoad(svg, rc, node, w, H, P, day, hRef.current)
    } catch {
      // a drawing failure must never take the sheet down
      while (svg.firstChild) svg.removeChild(svg.firstChild)
    }
  }, [node, w, themeVer, H, isOngoing])

  if (isOngoing) {
    const keeps = node.steps.filter((s) => s.kind === 'keep')
    return (
      <div className="rt-ongoing">
        {keeps.map((s) => (
          <OngoingRow key={s.id} step={s} domain={node.domain} today={day}
            onTick={() => onTick && onTick(s)} onEdit={() => onStepClick && onStepClick(s)} />
        ))}
        {!keeps.length && <p className="rt-empty anno">No rhythms yet — add a keep-going step.</p>}
      </div>
    )
  }

  return (
    <div className="rt-wrap" ref={wrapRef}>
      <svg ref={svgRef} className="rt-svg" role="img"
        aria-label={`${node.title} — surveyor's route`} />
    </div>
  )
}

/* ---------- one ongoing rhythm row (mini rough tick-rail + tick button) ---------- */
function OngoingRow({ step, domain, today, onTick, onEdit }) {
  const svgRef = useRef(null)
  const wrapRef = useRef(null)
  const [w, setW] = useState(220)
  const [themeVer, setThemeVer] = useState(0)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setW(Math.max(el.clientWidth, 120))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    const obs = new MutationObserver(() => setThemeVer((v) => v + 1))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    try {
      while (svg.firstChild) svg.removeChild(svg.firstChild)
      const H = 26
      svg.setAttribute('viewBox', `0 0 ${w} ${H}`)
      svg.setAttribute('width', '100%')
      svg.setAttribute('height', H)
      const rc = rough.svg(svg)
      const P = palette(domain)
      drawTickRail(svg, rc, 4, H / 2, w - 8, step, P, seedOf(step.id), today)
    } catch {
      while (svg.firstChild) svg.removeChild(svg.firstChild)
    }
  }, [step, w, themeVer, domain, today])

  const doneToday = step.last_done && daysBetween(step.last_done, today) <= 0
  return (
    <div className="rt-row">
      <button className="rt-row-label" onClick={onEdit} title="Edit this rhythm">
        <span className="rt-row-title">{step.title}</span>
        <span className="rt-row-cad anno">{step.cadence || 'anytime'}</span>
      </button>
      <div className="rt-row-rail" ref={wrapRef}>
        <svg ref={svgRef} aria-hidden="true" />
      </div>
      <button className={`rt-tick ${doneToday ? 'on' : ''}`} onClick={onTick}
        title="Did it today" aria-label={`Mark ${step.title} done today`}>
        {doneToday ? '✓ today' : 'did it ✓'}
      </button>
    </div>
  )
}

const todayIso = () => new Date().toISOString().slice(0, 10)
