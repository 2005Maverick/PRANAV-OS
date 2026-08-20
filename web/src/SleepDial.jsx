import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import rough from 'roughjs'
import { arc as d3arc } from 'd3-shape'
import { scaleLinear } from 'd3-scale'
import { parseHM, sharpness, peakHour, SLEEP_TARGET } from './sleepApi.js'

// SHEET 07 · SLEEP — the hand-inked 24-hour dial and its two quiet companions
// (the debt ledger strip, the payoff marks). Every stroke is rough.js so this
// sheet reads as one drawing set with the Arcs survey. Colours resolve from the
// live REDLINE tokens through a probe (rough needs concrete colour strings), and
// the wobble is seeded so nothing jitters on redraw. A draw failure is caught so
// it can never take the sheet down.

const NS = 'http://www.w3.org/2000/svg'

/* ---------- resolve a CSS var/expr to a concrete colour (theme-aware) ---------- */
// No cache: the tokens flip between Day and Night print, so re-read every draw.
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

function palette() {
  return {
    ink: resolveColor('var(--text)', '#26272b'),
    inkMut: resolveColor('var(--text-muted)', '#5a5c62'),
    inkFaint: resolveColor('var(--text-faint)', '#6d6f75'),
    line: resolveColor('var(--line-ink)', '#b6b7bb'),
    paper: resolveColor('var(--bg)', '#f4f2ec'),
    red: resolveColor('var(--accent)', '#c0392b'),
  }
}

function seedOf(id) {
  let h = 0
  const s = String(id)
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0
  return Math.abs(h) % 100000
}

/* ---------- text primitive ---------- */
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

/* small helper to run a redraw whenever the theme flips + width changes */
function useDrawSurface(draw, deps) {
  const wrapRef = useRef(null)
  const svgRef = useRef(null)
  const [w, setW] = useState(360)
  const [themeVer, setThemeVer] = useState(0)

  useLayoutEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const measure = () => setW(Math.max(el.clientWidth, 220))
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
      const rc = rough.svg(svg)
      draw(svg, rc, w, palette())
    } catch {
      // a drawing failure must never take the sheet down
      while (svg.firstChild) svg.removeChild(svg.firstChild)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [w, themeVer, ...deps])

  return { wrapRef, svgRef }
}

/* ============================================================
   THE HERO — 24-HOUR DIAL
   Midnight at top, clockwise (6:00 right, 12:00 bottom, 18:00 left).
   ============================================================ */
// polar → cartesian for hour h (0-24, fractional ok), radius r.
// d3.arc measures angles clockwise from 12 o'clock, matching this exactly.
const angleOf = (h) => (h / 24) * Math.PI * 2
const ptAt = (cx, cy, h, r) => {
  const a = angleOf(h)
  return [cx + r * Math.sin(a), cy - r * Math.cos(a)]
}

function drawDial(svg, rc, w, P, { usual, topology, debt }) {
  const H = Math.round(Math.min(Math.max(w, 300), 460))
  svg.setAttribute('viewBox', `0 0 ${w} ${H}`)
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', H)

  const cx = w / 2
  const cy = H / 2
  const R = Math.min(w, H) / 2 - 46
  const seed = 4207

  // 1 · rim
  svg.appendChild(rc.circle(cx, cy, R * 2, {
    stroke: P.ink, strokeWidth: 2, roughness: 1.15, seed,
  }))

  // 2 · hour ticks every 3h, cardinal labels 0/6/12/18
  for (let h = 0; h < 24; h += 3) {
    const [x1, y1] = ptAt(cx, cy, h, R)
    const cardinal = h % 6 === 0
    const [x2, y2] = ptAt(cx, cy, h, R - (cardinal ? 15 : 9))
    svg.appendChild(rc.line(x1, y1, x2, y2, {
      stroke: cardinal ? P.ink : P.line, strokeWidth: cardinal ? 2 : 1.2,
      roughness: 1, seed: seed + h,
    }))
    if (cardinal) {
      const [lx, ly] = ptAt(cx, cy, h, R + 16)
      txt(svg, lx, ly, String(h).padStart(2, '0'), { fill: P.inkMut, size: 12, weight: 600 })
    }
  }

  // 3 · sleep window — an inked hachured band from sleep → wake (wraps midnight).
  // No label on it: the band IS the window, and the times sit in the controls below.
  const sH = parseHM(usual?.sleep)
  const wH = parseHM(usual?.wake)
  if (sH != null && wH != null) {
    const start = angleOf(sH)
    const end = angleOf(wH <= sH ? wH + 24 : wH)
    const path = d3arc()({
      innerRadius: R * 0.74, outerRadius: R * 0.92,
      startAngle: start, endAngle: end,
    })
    const g = document.createElementNS(NS, 'g')
    g.setAttribute('transform', `translate(${cx},${cy})`)
    svg.appendChild(g)
    g.appendChild(rc.path(path, {
      fill: P.ink, fillStyle: 'hachure', hachureGap: 5, fillWeight: 1.5,
      stroke: P.ink, strokeWidth: 2, roughness: 1.25, seed: seed + 71,
    }))
  }

  // 4 · energy spokes — hang INWARD from the rim so the centre stays clear.
  // length = sharpness that hour, peak spoke in red.
  const maxSharp = Math.max(1, ...(topology || []).map(sharpness))
  const peak = peakHour(topology)
  const rimIn = R * 0.94
  const lenScale = scaleLinear().domain([0, maxSharp]).range([0, R * 0.34])
  const byHour = new Map((topology || []).map((t) => [t.hour, t]))
  for (let h = 0; h < 24; h++) {
    const t = byHour.get(h)
    const s = t ? sharpness(t) : 0
    if (!t || s <= 0) {
      const [ax, ay] = ptAt(cx, cy, h, rimIn)
      const [bx, by] = ptAt(cx, cy, h, rimIn - 5)
      svg.appendChild(rc.line(ax, ay, bx, by, { stroke: P.line, strokeWidth: 1, roughness: 1.1, seed: seed + 300 + h }))
      continue
    }
    const len = lenScale(s)
    const [ax, ay] = ptAt(cx, cy, h, rimIn)
    const [bx, by] = ptAt(cx, cy, h, rimIn - len)
    const isPeak = peak && peak.hour === h
    svg.appendChild(rc.line(ax, ay, bx, by, {
      stroke: isPeak ? P.red : P.inkMut, strokeWidth: isPeak ? 3 : 2.1,
      roughness: 1.2, seed: seed + 400 + h,
    }))
    svg.appendChild(rc.circle(bx, by, isPeak ? 5 : 3, {
      stroke: isPeak ? P.red : P.inkMut, strokeWidth: isPeak ? 2.4 : 1.4,
      fill: isPeak ? P.red : undefined, fillStyle: 'solid', roughness: 1.1, seed: seed + 500 + h,
    }))
  }
  // peak label — outside the rim by the peak spoke, never near the centre
  if (peak) {
    const [px, py] = ptAt(cx, cy, peak.hour, R + 28)
    txt(svg, px, py, `peak ${String(peak.hour).padStart(2, '0')}:00`,
      { fill: P.red, size: 10, weight: 600, letter: '0.04em' })
  }

  // 5 · centre — the debt, alone and legible
  if (debt != null) {
    const owed = debt < 0
    const mag = Math.abs(debt).toFixed(1)
    txt(svg, cx, cy - 7, `${owed ? '−' : '+'}${mag}h`, {
      fill: owed ? P.red : P.ink, size: 32, weight: 700, mono: true,
    })
    txt(svg, cx, cy + 18, owed ? 'sleep owed' : 'banked', {
      fill: owed ? P.red : P.inkMut, size: 10.5, letter: '0.10em',
    })
  } else {
    txt(svg, cx, cy - 4, 'log a night', { fill: P.inkFaint, size: 13, mono: false })
    txt(svg, cx, cy + 16, 'to start the ledger', { fill: P.inkFaint, size: 10 })
  }

  if (!topology || !topology.length) {
    txt(svg, cx, H - 10, 'no energy map yet — the spokes fill as you log deep-work blocks', {
      fill: P.inkFaint, size: 10, mono: false,
    })
  }
}

export default function SleepDial({ usual, topology, debt }) {
  const { wrapRef, svgRef } = useDrawSurface(
    (svg, rc, w, P) => drawDial(svg, rc, w, P, { usual, topology, debt }),
    [usual?.sleep, usual?.wake, JSON.stringify(topology || []), debt],
  )
  return (
    <div className="slp-dial-wrap" ref={wrapRef}>
      <svg ref={svgRef} className="slp-dial-svg" role="img"
        aria-label="24-hour sleep and energy dial" />
    </div>
  )
}

/* ============================================================
   DEBT LEDGER STRIP — last ~14 nights, hand-ruled
   ============================================================ */
function drawLedger(svg, rc, w, P, { logs }) {
  const H = 108
  svg.setAttribute('viewBox', `0 0 ${w} ${H}`)
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', H)

  const nights = [...(logs || [])].slice(0, 14).reverse() // oldest → newest, left → right
  const padL = 30
  const padR = 10
  const baseY = H * 0.42 // the 7.5h target baseline
  const innerW = w - padL - padR

  // baseline (target)
  svg.appendChild(rc.line(padL, baseY, w - padR, baseY, {
    stroke: P.line, strokeWidth: 1.4, roughness: 0.9, seed: 900, strokeLineDash: [2, 4],
  }))
  txt(svg, 4, baseY, '7.5', { fill: P.inkFaint, size: 9, anchor: 'start' })

  if (!nights.length) {
    txt(svg, w / 2, H / 2, 'log a night below — the ledger starts', {
      fill: P.inkFaint, size: 11, mono: false,
    })
    return
  }

  const n = nights.length
  const step = innerW / Math.max(n, 1)
  const hScale = scaleLinear().domain([4, 9]).range([0, H * 0.36]).clamp(true)

  // running debt line (below baseline dips when owed)
  const debtScale = scaleLinear().domain([-6, 3]).range([H - 12, 12]).clamp(true)
  const debtPts = nights.map((l, i) => [padL + step * (i + 0.5), debtScale(l.debt_after ?? 0)])
  if (debtPts.length >= 2) {
    svg.appendChild(rc.curve(debtPts, { stroke: P.red, strokeWidth: 1.6, roughness: 1.1, seed: 950 }))
  }

  // each night: a mark above/below the target baseline
  nights.forEach((l, i) => {
    const x = padL + step * (i + 0.5)
    const h = l.hours || 0
    const dev = hScale(h) // distance from a 4h floor
    const barTop = baseY - (h - SLEEP_TARGET) * (H * 0.055) // above baseline when over target
    const y2 = Math.max(6, Math.min(H - 6, barTop))
    const short = h < 6.5
    svg.appendChild(rc.line(x, baseY, x, y2, {
      stroke: short ? P.red : P.inkMut, strokeWidth: short ? 2.4 : 2,
      roughness: 1.15, seed: 1000 + i * 7,
    }))
    svg.appendChild(rc.circle(x, y2, 3, {
      stroke: short ? P.red : P.ink, strokeWidth: 1.3, fill: short ? P.red : P.ink,
      fillStyle: 'solid', roughness: 1, seed: 1100 + i * 5,
    }))
    if (i === n - 1 || i === 0 || n <= 8) {
      txt(svg, x, H - 3, l.date.slice(8), { fill: P.inkFaint, size: 8 })
    }
    void dev
  })
}

export function LedgerStrip({ logs }) {
  const { wrapRef, svgRef } = useDrawSurface(
    (svg, rc, w, P) => drawLedger(svg, rc, w, P, { logs }),
    [JSON.stringify(logs || [])],
  )
  return (
    <div className="slp-ledger-wrap" ref={wrapRef}>
      <svg ref={svgRef} className="slp-ledger-svg" role="img" aria-label="Sleep debt ledger, last nights" />
    </div>
  )
}

/* ============================================================
   PAYOFF MARKS — with vs without wind-down, two inked marks
   ============================================================ */
function drawPayoff(svg, rc, w, P, { withV, withoutV }) {
  const H = 96
  svg.setAttribute('viewBox', `0 0 ${w} ${H}`)
  svg.setAttribute('width', '100%')
  svg.setAttribute('height', H)

  if (withV == null || withoutV == null) {
    txt(svg, w / 2, H / 2, 'a couple of weeks of data and the payoff shows here', {
      fill: P.inkFaint, size: 11, mono: false,
    })
    return
  }

  const maxV = Math.max(withV, withoutV, 1)
  const padL = 16
  const padR = 16
  const baseY = H - 26
  const barW = 46
  const gap = 54
  const scale = scaleLinear().domain([0, maxV]).range([0, H - 46])

  const bars = [
    { label: 'with', v: withV, red: true, x: padL + barW / 2 },
    { label: 'without', v: withoutV, red: false, x: padL + barW / 2 + gap + barW },
  ]
  void padR
  bars.forEach((b, i) => {
    const h = scale(b.v)
    const top = baseY - h
    svg.appendChild(rc.rectangle(b.x - barW / 2, top, barW, h, {
      stroke: b.red ? P.red : P.inkMut, strokeWidth: 2,
      fill: b.red ? P.red : P.inkMut, fillStyle: 'hachure', hachureGap: 4, fillWeight: 1.4,
      roughness: 1.2, seed: 1300 + i * 11,
    }))
    txt(svg, b.x, top - 10, `${b.v}h`, { fill: b.red ? P.red : P.ink, size: 13, weight: 700 })
    txt(svg, b.x, baseY + 12, b.label, { fill: P.inkMut, size: 10, letter: '0.04em' })
  })
  // baseline
  svg.appendChild(rc.line(padL - 4, baseY, bars[1].x + barW / 2 + 4, baseY, {
    stroke: P.line, strokeWidth: 1.2, roughness: 0.8, seed: 1350,
  }))
}

export function PayoffMarks({ withV, withoutV }) {
  const { wrapRef, svgRef } = useDrawSurface(
    (svg, rc, w, P) => drawPayoff(svg, rc, w, P, { withV, withoutV }),
    [withV, withoutV],
  )
  return (
    <div className="slp-payoff-wrap" ref={wrapRef}>
      <svg ref={svgRef} className="slp-payoff-svg" role="img" aria-label="Deep-work with vs without the wind-down" />
    </div>
  )
}
