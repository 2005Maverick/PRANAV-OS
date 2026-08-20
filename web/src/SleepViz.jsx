import { useLayoutEffect, useRef, useState } from 'react'
import { scaleLinear } from 'd3-scale'
import { line, area, curveCatmullRom } from 'd3-shape'
import { sharpness, parseHM, SLEEP_TARGET } from './sleepApi.js'

// SHEET 07 · SLEEP — product-grade, crisp SVG only (NO rough.js, NO wobble).
// Colours come straight from the REDLINE tokens via CSS classes (fill/stroke:
// var(--token)), so Day / Night print just work with zero getComputedStyle
// probing. Every SVG measures its own width so text stays legible at any size.
// All inputs are untrusted and defended with fallbacks.

/* ---------- measure own width so text never shrinks below legibility ---------- */
function useWidth(fallback = 900) {
  const ref = useRef(null)
  const [w, setW] = useState(fallback)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => setW(Math.max(Math.round(el.clientWidth), 240))
    measure()
    let ro
    try {
      ro = new ResizeObserver(measure)
      ro.observe(el)
    } catch {
      /* ResizeObserver unavailable — fixed fallback width is fine */
    }
    return () => { if (ro) ro.disconnect() }
  }, [])
  return [ref, w]
}

const pad2 = (n) => String(n).padStart(2, '0')

/* ============================================================
   ENERGY MODEL — a smooth waking-day curve from the topology
   Axis runs 05:00 → 01:00 next day (hours 5..25; 0/1 wrap to 24/25).
   ============================================================ */
const DAY_START = 5
const DAY_END = 25

// clock hour → short meridiem label, e.g. 10→"10am", 14→"2pm", 0→"12am"
function ampm(h) {
  const hr = ((Math.round(h) % 24) + 24) % 24
  const mer = hr < 12 ? 'am' : 'pm'
  let d = hr % 12
  if (d === 0) d = 12
  return `${d}${mer}`
}

// linear-interpolate nulls in a numeric array so the curve flows through gaps
function fillGaps(arr) {
  const out = arr.slice()
  const n = out.length
  for (let i = 0; i < n; i++) {
    if (out[i] != null) continue
    let p = i - 1
    while (p >= 0 && out[p] == null) p--
    let q = i + 1
    while (q < n && arr[q] == null) q++
    const pv = p >= 0 ? out[p] : null
    const qv = q < n ? arr[q] : null
    if (pv == null && qv == null) out[i] = 0
    else if (pv == null) out[i] = qv
    else if (qv == null) out[i] = pv
    else out[i] = pv + (qv - pv) * ((i - p) / (q - p))
  }
  return out
}

function buildSentence(peak, dip, zones) {
  const z = zones.find(([s, e]) => peak.axis >= s && peak.axis <= e)
  const range = z && z[1] > z[0] ? `${ampm(z[0])}–${ampm(z[1] + 1)}` : ampm(peak.hour)
  let s = `Sharpest ${range}. Guard it.`
  if (dip) s += ` Slump around ${ampm(dip.hour)}.`
  return s
}

// The full energy model, shared by the hero curve and the title sentence.
export function buildEnergyModel(topology) {
  const rows = (topology || []).filter((t) => t && typeof t.hour === 'number')
  if (rows.length === 0) return { hasData: false }
  const byHour = new Map(rows.map((t) => [t.hour, sharpness(t)]))

  const axes = []
  for (let a = DAY_START; a <= DAY_END; a++) axes.push(a)
  const raw = axes.map((a) => (byHour.has(a % 24) ? byHour.get(a % 24) : null))
  const filled = fillGaps(raw)
  const max = Math.max(1e-6, ...filled)
  const points = axes.map((a, i) => ({ axis: a, hour: a % 24, energy: filled[i] / max }))

  // peak = highest-energy sample
  let peakI = 0
  points.forEach((p, i) => { if (p.energy > points[peakI].energy) peakI = i })
  const peak = points[peakI]

  // peak zones: contiguous samples ≥ 70% of max
  const zones = []
  let start = null
  points.forEach((p, i) => {
    const hot = p.energy >= 0.7
    if (hot && start == null) start = p.axis
    if ((!hot || i === points.length - 1) && start != null) {
      zones.push([start, hot ? p.axis : points[i - 1].axis])
      start = null
    }
  })

  // dip = lowest-energy daytime sample (09:00–20:00)
  let dip = null
  points.forEach((p) => {
    if (p.axis >= 9 && p.axis <= 20 && (!dip || p.energy < dip.energy)) dip = p
  })

  return { hasData: true, points, max, peak, dip, zones, sentence: buildSentence(peak, dip, zones) }
}

// One-line summary for the hero title block (null when there is no data yet)
export function energySentence(topology) {
  const m = buildEnergyModel(topology)
  return m.hasData ? m.sentence : null
}

// usual sleep time → axis position (null when unset)
function usualSleepAxis(usual) {
  const s = parseHM(usual && usual.sleep)
  if (s == null) return null
  return s < DAY_START ? s + 24 : s
}

// the live coaching state for the NOW marker
function liveState(model, nowAxis, usual) {
  const inZone = model.zones.some(([s, e]) => nowAxis >= s - 0.001 && nowAxis <= e + 1)
  if (inZone) return 'You’re in a peak — go deep'

  const upcoming = model.zones
    .map((z) => z[0])
    .filter((s) => s > nowAxis)
    .sort((a, b) => a - b)[0]
  if (upcoming != null && upcoming - nowAxis <= 1.5) {
    return `Peak in ${Math.round((upcoming - nowAxis) * 60)} min`
  }

  if (model.dip && Math.abs(nowAxis - model.dip.axis) <= 0.75) return 'Dip — light tasks / walk'

  const sleepAxis = usualSleepAxis(usual)
  if (sleepAxis != null && sleepAxis - nowAxis <= 1.5 && sleepAxis - nowAxis >= -0.5) return 'Wind-down soon'
  if (nowAxis >= 22.5) return 'Wind-down soon'
  return 'Steady — keep moving'
}

/* ============================================================
   ENERGY CURVE — the hero. Large, smooth, one red accent.
   ============================================================ */
export function EnergyCurve({ topology, usual }) {
  const [ref, w] = useWidth(1000)
  const model = buildEnergyModel(topology)

  const H = 320
  const pad = { l: 18, r: 18, t: 56, b: 30 }
  const x = scaleLinear().domain([DAY_START, DAY_END]).range([pad.l, w - pad.r])
  const baseY = H - pad.b
  const y = scaleLinear().domain([0, 1.08]).range([baseY, pad.t])
  const ticks = [5, 8, 11, 14, 17, 20, 23, 25]

  if (!model.hasData) {
    return (
      <div ref={ref} className="slp-viz">
        <svg className="slp-svg" width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img"
          aria-label="Your day's energy — no data yet">
          <line className="ec-baseline" x1={pad.l} x2={w - pad.r} y1={baseY} y2={baseY} />
          <text className="slp-empty-svg" x={w / 2} y={H / 2} textAnchor="middle" dominantBaseline="middle">
            log deep-work blocks and your energy curve draws itself
          </text>
          {ticks.map((t) => (
            <text key={t} className="ec-axis-lbl" x={x(t)} y={H - 8} textAnchor="middle">{ampm(t)}</text>
          ))}
        </svg>
      </div>
    )
  }

  const lineGen = line().x((p) => x(p.axis)).y((p) => y(p.energy)).curve(curveCatmullRom.alpha(0.5))
  const areaGen = area().x((p) => x(p.axis)).y0(baseY).y1((p) => y(p.energy)).curve(curveCatmullRom.alpha(0.5))
  const dLine = lineGen(model.points)
  const dArea = areaGen(model.points)

  const { peak, dip, zones } = model
  const peakX = x(peak.axis)
  const peakY = y(peak.energy)
  const clampLbl = (cx, half) => Math.max(pad.l + half, Math.min(w - pad.r - half, cx))

  // NOW marker
  const now = new Date()
  const nowH = now.getHours() + now.getMinutes() / 60
  const nowAxis = nowH < DAY_START ? nowH + 24 : nowH
  const nowVisible = nowAxis >= DAY_START && nowAxis <= DAY_END
  const nowX = nowVisible ? x(nowAxis) : 0
  const nowLabel = nowVisible ? liveState(model, nowAxis, usual) : null
  const pillW = nowLabel ? nowLabel.length * 6.6 + 20 : 0
  const pillX = clampLbl(nowX, pillW / 2) - pillW / 2

  return (
    <div ref={ref} className="slp-viz">
      <svg className="slp-svg" width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img"
        aria-label="Your day's energy across the waking day">
        {/* peak zone bands (behind everything) */}
        {zones.map(([s, e], i) => (
          <rect key={i} className="ec-zone" x={x(s)} y={pad.t} width={Math.max(2, x(e + 1) - x(s))} height={baseY - pad.t} />
        ))}

        {/* faint baseline */}
        <line className="ec-baseline" x1={pad.l} x2={w - pad.r} y1={baseY} y2={baseY} />

        {/* area + line */}
        <path className="ec-area" d={dArea} />
        <path className="ec-line" d={dLine} />

        {/* dip marker (drawn before peak so peak reads on top) */}
        {dip && (
          <text className="ec-dip-lbl" x={clampLbl(x(dip.axis), 32)} y={baseY - 8} textAnchor="middle">
            DIP {pad2(dip.hour)}:00
          </text>
        )}

        {/* peak marker */}
        <circle className="ec-peak-dot" cx={peakX} cy={peakY} r="4.5" />
        <text className="ec-peak-lbl" x={clampLbl(peakX, 40)} y={peakY - 12} textAnchor="middle">
          PEAK {pad2(peak.hour)}:00
        </text>

        {/* NOW marker + live-state pill */}
        {nowVisible && (
          <g>
            <line className="ec-now" x1={nowX} x2={nowX} y1={pad.t - 4} y2={baseY} />
            <rect className="ec-now-pill" x={pillX} y="8" width={pillW} height="24" rx="12" />
            <text className="ec-now-txt" x={pillX + pillW / 2} y="24" textAnchor="middle">{nowLabel}</text>
          </g>
        )}

        {/* x-axis labels every 3h */}
        {ticks.map((t) => (
          <text key={t} className="ec-axis-lbl" x={x(t)} y={H - 8} textAnchor="middle">{ampm(t)}</text>
        ))}
      </svg>
    </div>
  )
}

/* ============================================================
   DEBT SPARKLINE — running debt_after over the last ~14 nights
   ============================================================ */
export function DebtSpark({ logs }) {
  const [ref, w] = useWidth(280)
  const pts = [...(logs || [])]
    .filter((l) => l && typeof l.debt_after === 'number')
    .slice(0, 14)
    .reverse()

  const H = 64
  const pad = { l: 4, r: 4, t: 10, b: 10 }
  const x = scaleLinear().domain([0, Math.max(1, pts.length - 1)]).range([pad.l, w - pad.r])
  const y = scaleLinear().domain([-6, 3]).range([H - pad.b, pad.t])
  const zeroY = y(0)

  if (pts.length < 2) {
    return (
      <div ref={ref} className="slp-viz slp-spark-wrap">
        <svg className="slp-svg" width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img" aria-label="Debt trend, not enough nights">
          <line className="slp-spark-zero" x1={pad.l} x2={w - pad.r} y1={zeroY} y2={zeroY} strokeDasharray="3 3" />
        </svg>
      </div>
    )
  }

  const gen = line().x((d, i) => x(i)).y((d) => y(d.debt_after)).curve(curveCatmullRom.alpha(0.5))
  const last = pts[pts.length - 1]

  return (
    <div ref={ref} className="slp-viz slp-spark-wrap">
      <svg className="slp-svg" width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img"
        aria-label="Sleep debt trend over the last 14 nights">
        <line className="slp-spark-zero" x1={pad.l} x2={w - pad.r} y1={zeroY} y2={zeroY} strokeDasharray="3 3" />
        <path className="slp-spark" d={gen(pts)} />
        <circle className={`slp-spark-dot${last.debt_after < 0 ? ' owed' : ''}`} cx={x(pts.length - 1)} cy={y(last.debt_after)} r="3.2" />
      </svg>
    </div>
  )
}

/* ============================================================
   SLEEP HISTORY — last ~14 nights as a clean, tall bar chart
   ============================================================ */
export function History({ logs }) {
  const [ref, w] = useWidth(720)
  const nights = [...(logs || [])]
    .filter((l) => l && typeof l.hours === 'number')
    .slice(0, 14)
    .reverse() // oldest → newest, left → right

  const H = 240
  const pad = { l: 34, r: 14, t: 18, b: 30 }
  const innerH = H - pad.t - pad.b
  const y = scaleLinear().domain([0, 10]).range([pad.t + innerH, pad.t])
  const targetY = y(SLEEP_TARGET)

  return (
    <div ref={ref} className="slp-viz">
      <svg className="slp-svg" width={w} height={H} viewBox={`0 0 ${w} ${H}`}
        role="img" aria-label="Sleep hours over the last 14 nights">
        {[0, 5, 10].map((v) => (
          <g key={v}>
            <line className="slp-grid-line" x1={pad.l} x2={w - pad.r} y1={y(v)} y2={y(v)} />
            <text className="slp-tick-lbl" x={pad.l - 6} y={y(v)} textAnchor="end" dominantBaseline="middle">{v}</text>
          </g>
        ))}

        {nights.length === 0 ? (
          <text className="slp-empty-svg" x={w / 2} y={H / 2} textAnchor="middle" dominantBaseline="middle">
            log last night to start the history
          </text>
        ) : (() => {
          const n = nights.length
          const band = (w - pad.l - pad.r) / n
          const bw = Math.min(band * 0.6, 40)
          const thin = n > 10
          return nights.map((l, i) => {
            const cx = pad.l + band * (i + 0.5)
            const hrs = Math.max(0, Math.min(l.hours || 0, 10))
            const top = y(hrs)
            const bh = Math.max(2, y(0) - top)
            const short = (l.hours || 0) < 6.5
            const day = (l.date || '').slice(8)
            return (
              <g key={l.date || i}>
                <rect className={`slp-bar${short ? ' short' : ''}`}
                  x={cx - bw / 2} y={top} width={bw} height={bh} rx="2" />
                {(!thin || i % 2 === 0 || i === n - 1) && (
                  <text className="slp-x-lbl" x={cx} y={H - 10} textAnchor="middle">{day}</text>
                )}
              </g>
            )
          })
        })()}

        {/* target line + label drawn last so it sits above the bars */}
        <line className="slp-target" x1={pad.l} x2={w - pad.r} y1={targetY} y2={targetY} strokeDasharray="4 4" />
        <text className="slp-target-lbl" x={w - pad.r} y={targetY - 5} textAnchor="end">7.5h target</text>
      </svg>
    </div>
  )
}

/* ============================================================
   PAYOFF BARS — deep work with vs without the wind-down
   ============================================================ */
export function PayoffBars({ withV, withoutV }) {
  const [ref, w] = useWidth(420)
  const has = withV != null && withoutV != null
  const H = 150
  const pad = { t: 26, b: 28 }
  const baseY = H - pad.b
  const max = Math.max(withV || 0, withoutV || 0, 1)
  const scale = scaleLinear().domain([0, max]).range([0, H - pad.t - pad.b])

  if (!has) {
    return (
      <div ref={ref} className="slp-viz">
        <svg className="slp-svg" width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img"
          aria-label="Deep-work payoff, not enough data">
          <text className="slp-empty-svg" x={w / 2} y={H / 2} textAnchor="middle" dominantBaseline="middle">
            needs a couple of weeks of both kinds of nights
          </text>
        </svg>
      </div>
    )
  }

  const barW = 78
  const gap = 54
  const groupW = barW * 2 + gap
  const startX = Math.max(8, (w - groupW) / 2)
  const bars = [
    { key: 'with', label: 'with wind-down', v: withV, cls: 'with', x: startX },
    { key: 'without', label: 'without', v: withoutV, cls: 'without', x: startX + barW + gap },
  ]

  return (
    <div ref={ref} className="slp-viz">
      <svg className="slp-svg" width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img"
        aria-label="Deep-work hours with vs without the wind-down routine">
        <line className="slp-grid-line" x1={startX - 8} x2={startX + groupW + 8} y1={baseY} y2={baseY} />
        {bars.map((b) => {
          const bh = Math.max(2, scale(b.v))
          const top = baseY - bh
          return (
            <g key={b.key}>
              <rect className={`slp-pay-bar ${b.cls}`} x={b.x} y={top} width={barW} height={bh} rx="2" />
              <text className={`slp-pay-val ${b.cls}`} x={b.x + barW / 2} y={top - 8} textAnchor="middle">{b.v}h</text>
              <text className="slp-pay-lbl" x={b.x + barW / 2} y={baseY + 16} textAnchor="middle">{b.label}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
