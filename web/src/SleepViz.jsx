import { useLayoutEffect, useRef, useState } from 'react'
import { scaleLinear } from 'd3-scale'
import { sharpness, peakHour, SLEEP_TARGET } from './sleepApi.js'

// SHEET 07 · SLEEP — clean, concrete health-tracker charts. Crisp <rect>/<line>/
// <text> only; NO rough.js, NO hand-drawn wobble. Colours come straight from the
// REDLINE tokens via CSS classes (fill: var(--token)), so Day / Night print just
// work with zero probing. Each SVG measures its own width so text stays legible
// at every size. All inputs are treated as untrusted and defended with fallbacks.

/* ---------- measure own width so text never shrinks below legibility ---------- */
function useWidth(fallback = 560) {
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
   SLEEP HISTORY — last ~14 nights as a clean bar chart
   ============================================================ */
export function History({ logs }) {
  const [ref, w] = useWidth()
  const nights = [...(logs || [])]
    .filter((l) => l && typeof l.hours === 'number')
    .slice(0, 14)
    .reverse() // oldest → newest, left → right

  const H = 190
  const pad = { l: 32, r: 10, t: 16, b: 24 }
  const innerH = H - pad.t - pad.b
  const y = scaleLinear().domain([0, 10]).range([pad.t + innerH, pad.t])
  const targetY = y(SLEEP_TARGET)

  return (
    <div ref={ref} className="slp-viz">
      <svg className="slp-svg" width={w} height={H} viewBox={`0 0 ${w} ${H}`}
        role="img" aria-label="Sleep hours over the last 14 nights">
        {/* y gridlines at 5h and 10h */}
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
          const bw = Math.min(band * 0.62, 30)
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
                  <text className="slp-x-lbl" x={cx} y={H - 8} textAnchor="middle">{day}</text>
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
   HEAT STRIP — when you're actually sharp, hour 0 → 23
   ============================================================ */
export function HeatStrip({ topology }) {
  const [ref, w] = useWidth()
  const data = (topology || []).filter((t) => t && typeof t.hour === 'number')
  const peak = peakHour(data)

  const H = 88
  const pad = { l: 6, r: 6, t: 22, b: 18 }
  const innerW = w - pad.l - pad.r
  const stripTop = pad.t
  const stripH = H - pad.t - pad.b
  const cellW = innerW / 24
  const gap = Math.min(2, cellW * 0.14)

  const byHour = new Map(data.map((t) => [t.hour, t]))
  const scores = Array.from({ length: 24 }, (_, h) => {
    const t = byHour.get(h)
    return { hour: h, s: t ? sharpness(t) : 0, present: !!t }
  })
  const max = Math.max(1, ...scores.map((x) => x.s))

  if (data.length === 0) {
    return (
      <div ref={ref} className="slp-viz">
        <svg className="slp-svg" width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img"
          aria-label="Hourly focus map, empty">
          <text className="slp-empty-svg" x={w / 2} y={H / 2} textAnchor="middle" dominantBaseline="middle">
            your focus map fills in as you log deep-work blocks
          </text>
        </svg>
      </div>
    )
  }

  return (
    <div ref={ref} className="slp-viz">
      <svg className="slp-svg" width={w} height={H} viewBox={`0 0 ${w} ${H}`} role="img"
        aria-label="Hourly focus map across the day">
        {scores.map((c) => {
          const x = pad.l + cellW * c.hour
          const isPeak = peak && peak.hour === c.hour
          const intensity = 0.08 + 0.9 * (c.s / max)
          return (
            <g key={c.hour}>
              <rect
                className={isPeak ? 'slp-heat-cell peak' : 'slp-heat-cell'}
                x={x + gap / 2} y={stripTop} width={Math.max(1, cellW - gap)} height={stripH}
                rx="1.5"
                fillOpacity={isPeak ? 1 : intensity} />
              {isPeak && (
                <text className="slp-peak-lbl" x={x + cellW / 2} y={stripTop - 7} textAnchor="middle">
                  peak {pad2(c.hour)}:00
                </text>
              )}
            </g>
          )
        })}
        {[0, 6, 12, 18, 23].map((h) => (
          <text key={h} className="slp-x-lbl" x={pad.l + cellW * (h + 0.5)} y={H - 5} textAnchor="middle">
            {pad2(h)}
          </text>
        ))}
      </svg>
    </div>
  )
}

/* ============================================================
   PAYOFF BARS — deep work with vs without the wind-down
   ============================================================ */
export function PayoffBars({ withV, withoutV }) {
  const [ref, w] = useWidth()
  const has = withV != null && withoutV != null
  const H = 128
  const pad = { t: 22, b: 26 }
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

  const barW = 64
  const gap = 40
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
        <line className="slp-grid-line" x1={startX - 6} x2={startX + groupW + 6} y1={baseY} y2={baseY} />
        {bars.map((b) => {
          const bh = Math.max(2, scale(b.v))
          const top = baseY - bh
          return (
            <g key={b.key}>
              <rect className={`slp-pay-bar ${b.cls}`} x={b.x} y={top} width={barW} height={bh} rx="2" />
              <text className={`slp-pay-val ${b.cls}`} x={b.x + barW / 2} y={top - 7} textAnchor="middle">{b.v}h</text>
              <text className="slp-pay-lbl" x={b.x + barW / 2} y={baseY + 15} textAnchor="middle">{b.label}</text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}
