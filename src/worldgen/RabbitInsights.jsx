// Side panel translating a rabbit's raw neural-net weights (see
// sim/brainInsight.js) into something an average person can read: trait
// bars, a plain-English blurb, and - at the population level - a trend of
// how those traits are drifting across generations.

import { TRAIT_META } from '../sim/brainInsight.js'

function TraitBar({ label, value, color }) {
  const pct = Math.round(value * 100)
  return (
    <div className="flex items-center gap-2 text-xs">
      <span className="w-28 shrink-0 text-neutral-400">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-800">
        <div className="h-full rounded-full" style={{ width: `${pct}%`, backgroundColor: color }} />
      </div>
      <span className="w-9 shrink-0 text-right font-mono tabular-nums text-neutral-300">{pct}%</span>
    </div>
  )
}

const SPARK_W = 220
const SPARK_H = 34

function Sparkline({ history, traitKey, color }) {
  if (history.length < 2) return null
  const points = history
    .map((s, i) => {
      const x = (i / (history.length - 1)) * SPARK_W
      const y = SPARK_H - s[traitKey] * SPARK_H
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg viewBox={`0 0 ${SPARK_W} ${SPARK_H}`} width="100%" height={SPARK_H} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  )
}

const TREND_KEYS = ['foodDrive', 'boldness', 'broodiness']

export default function RabbitInsights({ selected, history, population, generationRange, onClose }) {
  const latest = history[history.length - 1]

  return (
    <div className="flex w-80 shrink-0 flex-col gap-4 overflow-y-auto border-l border-neutral-800 bg-neutral-900 p-4 text-neutral-200">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-100">🧠 Rabbit brains</h2>
        <button type="button" onClick={onClose} aria-label="Close" className="text-neutral-500 transition hover:text-neutral-200">
          ✕
        </button>
      </div>

      <section className="flex flex-col gap-2">
        <h3 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Population</h3>
        <p className="text-xs text-neutral-400">
          {population} rabbit{population === 1 ? '' : 's'} alive
          {generationRange ? ` · generation ${generationRange[0]}–${generationRange[1]}` : ''}
        </p>
        {latest ? (
          <div className="flex flex-col gap-2 rounded-sm border border-neutral-800 bg-neutral-950 p-2">
            {TRAIT_META.filter((m) => TREND_KEYS.includes(m.key)).map((m) => (
              <div key={m.key} className="flex flex-col gap-1">
                <div className="flex items-center justify-between text-[11px] text-neutral-400">
                  <span>{m.label} (population avg)</span>
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
      </section>

      {selected ? (
        <section className="flex flex-col gap-2 border-t border-neutral-800 pt-4">
          <h3 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            Rabbit #{selected.id} · gen {selected.generation}
          </h3>
          <p className="text-xs text-neutral-400">
            {selected.alive ? `Energy ${selected.energy}/100` : 'Deceased'}
            {selected.gestating ? ' · expecting' : ''}
            {selected.running ? ' · running' : selected.resting ? ' · resting' : ''}
          </p>
          <div className="flex flex-col gap-1.5 rounded-sm border border-neutral-800 bg-neutral-950 p-2">
            {TRAIT_META.map((m) => (
              <TraitBar key={m.key} label={m.label} value={selected.traits[m.key]} color={m.color} />
            ))}
          </div>
          <p className="text-xs leading-relaxed text-neutral-300">{selected.blurb}</p>
          <ul className="flex flex-col gap-1 text-[11px] text-neutral-500">
            <li>🏃 {selected.energyEffects.run}</li>
            <li>😴 {selected.energyEffects.rest}</li>
            <li>🐣 {selected.energyEffects.breed}</li>
          </ul>
        </section>
      ) : (
        <p className="border-t border-neutral-800 pt-4 text-[11px] text-neutral-600">Click a rabbit on the map to see its brain.</p>
      )}
    </div>
  )
}
