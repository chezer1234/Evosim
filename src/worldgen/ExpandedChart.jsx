// Full-screen "detailed view" for a single chart from the Population panel -
// either paired-population chart (rabbits/foxes, fish/crabs), or one of the
// trait/gene sparklines (rabbit traits, rabbit senses, fox bodies, fox
// instincts, shoreline genes). Opened by clicking that chart (see the
// Expandable wrapper in PopulationPanel.jsx);
// GameScreen pauses the sim for the duration so the frozen data on screen
// matches what's being read off the axes.
//
// Unlike the compact panel's charts (which read from sim.traitHistory, a
// rolling window capped at TRAIT_HISTORY_LIMIT samples), this reads from
// sim.fullHistory - the same samples, uncapped - so the line always spans
// the whole run from t=0, not just the last ~20 minutes of it.

import { useEffect, useMemo } from 'react'
import { CloseButton } from './panelChrome.jsx'

const CHART_W = 1000
const CHART_H = 380

// A full run can rack up thousands of samples (one every ~5 sim-seconds for
// however long the sim has been running). Plotting all of them as an SVG
// polyline works but gets pointlessly heavy, and a straight decimation (just
// dropping points) can smooth away exactly the crashes/spikes the "detailed
// view" exists to still show. Min/max bucketing keeps both ends of each
// bucket's range instead, so a sudden crash or spike inside a bucket still
// shows up as a hard edge rather than getting averaged out.
function downsample(history, valueOf, maxBuckets) {
  if (history.length <= maxBuckets * 2) return history
  const bucketSize = history.length / maxBuckets
  const out = []
  for (let i = 0; i < maxBuckets; i++) {
    const start = Math.floor(i * bucketSize)
    const end = Math.min(history.length, Math.max(start + 1, Math.floor((i + 1) * bucketSize)))
    let minS = history[start]
    let maxS = history[start]
    let minV = valueOf(minS) ?? 0
    let maxV = minV
    for (let j = start + 1; j < end; j++) {
      const s = history[j]
      const v = valueOf(s) ?? 0
      if (v < minV) {
        minV = v
        minS = s
      }
      if (v > maxV) {
        maxV = v
        maxS = s
      }
    }
    if (minS === maxS) out.push(minS)
    else if (minS.tSec <= maxS.tSec) out.push(minS, maxS)
    else out.push(maxS, minS)
  }
  return out
}

function formatDuration(totalSec) {
  const s = Math.floor(totalSec % 60)
  const m = Math.floor(totalSec / 60) % 60
  const h = Math.floor(totalSec / 3600)
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${m}:${ss}`
}

/** One series' polyline + fill, mapped onto a shared [tStart, tStart+tSpan]
 * x-domain (so two independently-downsampled series - e.g. rabbits/foxes -
 * still line up on the same time axis) and a given y-domain. */
function seriesPaths(history, valueOf, tStart, tSpan, domainMax) {
  const pts = history
    .map((s) => {
      const x = ((s.tSec - tStart) / tSpan) * CHART_W
      const y = CHART_H - ((valueOf(s) ?? 0) / domainMax) * CHART_H
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return { line: pts, fill: `0,${CHART_H} ${pts} ${CHART_W},${CHART_H}` }
}

function alpha(rgb, a) {
  return rgb.replace('rgb(', 'rgba(').replace(')', `,${a})`)
}

const GRID_FRACTIONS = [0, 0.25, 0.5, 0.75, 1]

function AxisChart({ yTicks, xTicks, children }) {
  return (
    <div className="flex min-h-0 flex-1 gap-2">
      <div className="flex flex-col justify-between py-1 text-right font-mono text-[10px] text-neutral-600 tabular-nums">
        {yTicks.map((t, i) => (
          <span key={i}>{t}</span>
        ))}
      </div>
      <div className="flex min-h-[40vh] flex-1 flex-col gap-1">
        <div className="min-h-0 flex-1 rounded-sm border border-neutral-800 bg-neutral-950 p-2">
          <svg viewBox={`0 0 ${CHART_W} ${CHART_H}`} width="100%" height="100%" preserveAspectRatio="none">
            {GRID_FRACTIONS.map((f) => (
              <line key={f} x1={0} x2={CHART_W} y1={f * CHART_H} y2={f * CHART_H} stroke="rgba(255,255,255,0.06)" strokeWidth="1" />
            ))}
            {children}
          </svg>
        </div>
        <div className="flex justify-between font-mono text-[10px] text-neutral-600 tabular-nums">
          {xTicks.map((t, i) => (
            <span key={i}>{t}</span>
          ))}
        </div>
      </div>
    </div>
  )
}

function Stat({ label, value }) {
  return (
    <span>
      {label} <b className="font-mono text-sm text-neutral-100 tabular-nums">{value}</b>
    </span>
  )
}

/** The two headline charts - rabbits/foxes, and fish/crabs - are the same
 * chart with different series on it: two raw counts sharing one axis scaled
 * to their own running max. `spec` is that difference (see PAIR_SPECS). */
function PairDetail({ fullHistory, spec }) {
  const [a, b] = spec.series
  const hasData = fullHistory.length >= 2

  const chart = useMemo(() => {
    if (!hasData) return null
    const tStart = fullHistory[0].tSec
    const tEnd = fullHistory[fullHistory.length - 1].tSec
    const tSpan = Math.max(1, tEnd - tStart)
    const domainMax = Math.max(1, ...fullHistory.map((s) => Math.max(a.valueOf(s), b.valueOf(s))))
    const xTicks = GRID_FRACTIONS.map((f) => formatDuration(tStart + f * tSpan))
    const yTicks = GRID_FRACTIONS.slice()
      .reverse()
      .map((f) => Math.round(f * domainMax))
    return {
      aPaths: seriesPaths(downsample(fullHistory, a.valueOf, 300), a.valueOf, tStart, tSpan, domainMax),
      bPaths: seriesPaths(downsample(fullHistory, b.valueOf, 300), b.valueOf, tStart, tSpan, domainMax),
      xTicks,
      yTicks,
      domainMax,
    }
  }, [fullHistory, hasData, a, b])

  if (!hasData) return <p className="py-12 text-center text-sm text-neutral-500">Not enough data yet - let the simulation run a little longer.</p>

  const latest = fullHistory[fullHistory.length - 1]

  return (
    <>
      <div className="flex flex-wrap gap-x-6 gap-y-1 text-xs text-neutral-400">
        <Stat label={`${a.label} now`} value={a.valueOf(latest)} />
        <Stat label={`${a.label} peak`} value={Math.max(...fullHistory.map(a.valueOf))} />
        <Stat label={`${b.label} now`} value={b.valueOf(latest)} />
        <Stat label={`${b.label} peak`} value={Math.max(...fullHistory.map(b.valueOf))} />
        <Stat label="Elapsed" value={formatDuration(latest.tSec)} />
        <Stat label="Samples" value={fullHistory.length} />
      </div>
      <AxisChart yTicks={chart.yTicks} xTicks={chart.xTicks}>
        <polyline points={chart.aPaths.fill} fill={alpha(a.color, 0.15)} stroke="none" />
        <polyline points={chart.aPaths.line} fill="none" stroke={a.color} strokeWidth="2" />
        <polyline points={chart.bPaths.line} fill="none" stroke={b.color} strokeWidth="2" />
      </AxisChart>
      <p className="text-center text-[11px] text-neutral-500">
        {a.label} {a.name} · {b.label} {b.name}
      </p>
    </>
  )
}

// Keyed by descriptor.kind. The shoreline gets its own axis rather than a
// third and fourth line on the population chart, for the same reason it does
// in the compact panel: a lake holds hundreds of fish where an island holds
// twenty rabbits, and one shared scale would flatten the predator/prey curves
// into a line along the bottom.
const PAIR_SPECS = {
  population: {
    title: 'Populations',
    series: [
      { label: '🐇', name: 'rabbits', color: 'rgb(120,214,110)', valueOf: (s) => s.population ?? 0 },
      { label: '🦊', name: 'foxes', color: 'rgb(251,146,60)', valueOf: (s) => s.foxPopulation ?? 0 },
    ],
  },
  shoreline: {
    title: 'The shallows',
    series: [
      { label: '🐟', name: 'fish', color: 'rgb(94,197,214)', valueOf: (s) => s.fishPopulation ?? 0 },
      { label: '🦀', name: 'crabs', color: 'rgb(222,110,92)', valueOf: (s) => s.crabPopulation ?? 0 },
    ],
  },
}

/** Any single 0..1 trend line (a rabbit trait, a rabbit sense gene, a fox
 * body gene, or a fox instinct), expanded. */
function TrendDetail({ valueOf, color, fullHistory }) {
  const plotted = useMemo(() => downsample(fullHistory, valueOf, 300), [fullHistory, valueOf])
  const hasData = plotted.length >= 2
  if (!hasData) return <p className="py-12 text-center text-sm text-neutral-500">Not enough data yet - let the simulation run a little longer.</p>

  const tStart = plotted[0].tSec
  const tEnd = plotted[plotted.length - 1].tSec
  const tSpan = Math.max(1, tEnd - tStart)
  const paths = seriesPaths(plotted, valueOf, tStart, tSpan, 1)
  const xTicks = GRID_FRACTIONS.map((f) => formatDuration(tStart + f * tSpan))
  const yTicks = ['100%', '75%', '50%', '25%', '0%']

  const latest = valueOf(fullHistory[fullHistory.length - 1])
  const values = fullHistory.map(valueOf).filter((v) => v != null)
  const peak = values.length ? Math.max(...values) : null

  return (
    <>
      <div className="flex flex-wrap gap-6 text-xs text-neutral-400">
        <Stat label="Current" value={latest == null ? '—' : `${Math.round(latest * 100)}%`} />
        <Stat label="Peak" value={peak == null ? '—' : `${Math.round(peak * 100)}%`} />
        <Stat label="Elapsed" value={formatDuration(fullHistory[fullHistory.length - 1].tSec)} />
        <Stat label="Samples" value={fullHistory.length} />
      </div>
      <AxisChart yTicks={yTicks} xTicks={xTicks}>
        <polyline points={paths.fill} fill={alpha(color, 0.15)} stroke="none" />
        <polyline points={paths.line} fill="none" stroke={color} strokeWidth="2" />
      </AxisChart>
    </>
  )
}

export default function ExpandedChart({ descriptor, fullHistory, onClose }) {
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const pair = PAIR_SPECS[descriptor.kind]
  const title = `${pair ? pair.title : descriptor.label} - full simulation history`

  return (
    <div
      className="safe-x safe-b pointer-events-auto fixed inset-0 z-50 flex items-center justify-center bg-black/80 p-3 backdrop-blur-sm sm:p-6"
      onClick={onClose}
    >
      <div
        className="flex max-h-full w-full max-w-5xl flex-col gap-3 rounded-lg border border-neutral-800 bg-neutral-900 p-4 text-neutral-200 shadow-2xl shadow-black/60 sm:gap-4 sm:p-6"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 className="text-base font-semibold text-neutral-100 sm:text-lg">{title}</h2>
            <p className="text-xs text-neutral-500">Sim paused for this detailed view · press Esc or tap outside to close</p>
          </div>
          <CloseButton onClose={onClose} />
        </div>

        {pair ? (
          <PairDetail fullHistory={fullHistory} spec={pair} />
        ) : (
          <TrendDetail valueOf={descriptor.valueOf} color={descriptor.color} fullHistory={fullHistory} />
        )}
      </div>
    </div>
  )
}
