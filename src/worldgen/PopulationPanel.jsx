// Small floating overlay showing the rabbit population trend over time.
// Deliberately independent of the "Brains" panel (see RabbitInsights.jsx) -
// you can watch the population without selecting/inspecting a rabbit, and
// toggling this doesn't affect that panel or vice versa.

import { TRAIT_META } from '../sim/brainInsight.js'

function Sparkline({ history, traitKey, color }) {
  if (history.length < 2) return null
  const w = 200
  const h = 30
  const points = history
    .map((s, i) => {
      const x = (i / (history.length - 1)) * w
      const y = h - s[traitKey] * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  )
}

const TREND_KEYS = ['foodDrive', 'searchDrive', 'boldness', 'broodiness']

const POP_CHART_W = 220
const POP_CHART_H = 40

/** Population over time, scaled to its own running max (not 0..1 like the
 * trait sparklines) so a crash down to 0 is as visible as the peak. */
function PopulationChart({ history }) {
  if (history.length < 2) return null
  const values = history.map((s) => s.population)
  const max = Math.max(1, ...values)
  const last = values[values.length - 1]
  const points = history
    .map((s, i) => {
      const x = (i / (history.length - 1)) * POP_CHART_W
      const y = POP_CHART_H - (s.population / max) * POP_CHART_H
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  const fillPoints = `0,${POP_CHART_H} ${points} ${POP_CHART_W},${POP_CHART_H}`
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px] text-neutral-400">
        <span>Population over time</span>
        <span className="font-mono tabular-nums text-neutral-300">{last}</span>
      </div>
      <svg viewBox={`0 0 ${POP_CHART_W} ${POP_CHART_H}`} width="100%" height={POP_CHART_H} preserveAspectRatio="none">
        <polyline points={fillPoints} fill="rgba(120,214,110,0.15)" stroke="none" />
        <polyline points={points} fill="none" stroke="rgb(120,214,110)" strokeWidth="1.5" />
      </svg>
      <div className="flex justify-between text-[9px] text-neutral-600">
        <span>0</span>
        <span>peak {max}</span>
      </div>
    </div>
  )
}

export default function PopulationPanel({ population, history, generationRange, onClose }) {
  const latest = history[history.length - 1]

  return (
    <div className="pointer-events-auto flex w-64 flex-col gap-2 rounded-lg border border-neutral-800 bg-neutral-900/95 p-3 text-neutral-200 shadow-2xl shadow-black/40 backdrop-blur-sm">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-neutral-100 uppercase">📈 Population</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="text-neutral-500 transition hover:text-neutral-200">
          ✕
        </button>
      </div>
      <p className="text-xs text-neutral-400">
        {population} rabbit{population === 1 ? '' : 's'} alive
        {generationRange ? ` · gen ${generationRange[0]}–${generationRange[1]}` : ''}
      </p>
      {latest ? (
        <div className="flex flex-col gap-2 rounded-sm border border-neutral-800 bg-neutral-950 p-2">
          <PopulationChart history={history} />
          {TRAIT_META.filter((m) => TREND_KEYS.includes(m.key)).map((m) => (
            <div key={m.key} className="flex flex-col gap-1">
              <div className="flex items-center justify-between text-[11px] text-neutral-400">
                <span>{m.label} (avg)</span>
                <span className="font-mono tabular-nums">{Math.round(latest[m.key] * 100)}%</span>
              </div>
              <Sparkline history={history} traitKey={m.key} color={m.color} />
            </div>
          ))}
          <p className="text-[10px] text-neutral-600">Averaged across every living rabbit, sampled every ~5s of sim time.</p>
        </div>
      ) : (
        <p className="text-[11px] text-neutral-600">A trend line appears once rabbits have been alive a little while.</p>
      )}
    </div>
  )
}
