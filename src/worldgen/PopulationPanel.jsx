// Small floating overlay showing both populations over time - rabbits and
// the foxes eating them - plus how each species' genes are drifting.
// Deliberately independent of the inspector panels (see RabbitInsights.jsx /
// FoxInsights.jsx): you can watch the ecosystem without selecting anything,
// and toggling this doesn't affect those panels or vice versa.

import { TRAIT_META } from '../sim/brainInsight.js'
import { FOX_GENE_META } from '../sim/fox.js'
import { RABBIT_GENE_META } from '../sim/rabbit.js'
import { CloseButton, PANEL_SHELL } from './panelChrome.jsx'

/** A 0..1 trend line. `valueOf` pulls the number out of a sample so this
 * works for both flat rabbit traits and the nested fox gene averages. */
function Sparkline({ history, valueOf, color }) {
  if (history.length < 2) return null
  const w = 200
  const h = 30
  const points = history
    .map((s, i) => {
      const x = (i / (history.length - 1)) * w
      const y = h - (valueOf(s) ?? 0) * h
      return `${x.toFixed(1)},${y.toFixed(1)}`
    })
    .join(' ')
  return (
    <svg viewBox={`0 0 ${w} ${h}`} width="100%" height={h} preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  )
}

function TrendRow({ label, history, valueOf, color }) {
  const latest = valueOf(history[history.length - 1])
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px] text-neutral-400">
        <span>{label} (avg)</span>
        <span className="font-mono tabular-nums">{latest == null ? '—' : `${Math.round(latest * 100)}%`}</span>
      </div>
      <Sparkline history={history} valueOf={valueOf} color={color} />
    </div>
  )
}

const TREND_KEYS = ['foodDrive', 'searchDrive', 'broodiness', 'skittishness', 'burrowInstinct', 'heedsAlarm']
// The fox genes worth watching drift: the ones that decide whether the
// rabbits get away.
const FOX_TREND_KEYS = ['speed', 'vision', 'camouflage', 'bloodlust', 'packTendency']

const POP_CHART_W = 220
const POP_CHART_H = 46

/** Both populations over time on one axis, scaled to their shared running
 * max (not 0..1 like the trait sparklines) so a crash down to 0 is as
 * visible as the peak - and so the classic predator/prey lag between the two
 * curves is actually readable. */
function PopulationChart({ history }) {
  if (history.length < 2) return null
  const max = Math.max(1, ...history.map((s) => Math.max(s.population, s.foxPopulation ?? 0)))
  const seriesPoints = (key) =>
    history
      .map((s, i) => {
        const x = (i / (history.length - 1)) * POP_CHART_W
        const y = POP_CHART_H - ((s[key] ?? 0) / max) * POP_CHART_H
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  const rabbitPoints = seriesPoints('population')
  const foxPoints = seriesPoints('foxPopulation')
  const latest = history[history.length - 1]
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px] text-neutral-400">
        <span>Populations over time</span>
        <span className="font-mono tabular-nums">
          <span className="text-emerald-400">{latest.population}</span>
          <span className="text-neutral-600"> / </span>
          <span className="text-orange-400">{latest.foxPopulation ?? 0}</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${POP_CHART_W} ${POP_CHART_H}`} width="100%" height={POP_CHART_H} preserveAspectRatio="none">
        <polyline points={`0,${POP_CHART_H} ${rabbitPoints} ${POP_CHART_W},${POP_CHART_H}`} fill="rgba(120,214,110,0.15)" stroke="none" />
        <polyline points={rabbitPoints} fill="none" stroke="rgb(120,214,110)" strokeWidth="1.5" />
        <polyline points={foxPoints} fill="none" stroke="rgb(251,146,60)" strokeWidth="1.5" />
      </svg>
      <div className="flex justify-between text-[9px] text-neutral-600">
        <span>🐇 rabbits · 🦊 foxes</span>
        <span>peak {max}</span>
      </div>
    </div>
  )
}

/** `mapInfo` carries the map's size/lakes/seed - shown here only when the
 * caller has nowhere else to put them, which on a compact screen is the case:
 * the phone toolbar has room for the live counts and nothing more. */
export default function PopulationPanel({ population, foxPopulation, kills, burrows, sheltered, swimmers, drownings, history, generationRange, foxGenerationRange, mapInfo, onClose }) {
  const latest = history[history.length - 1]
  const hasFoxTrend = history.some((s) => s.foxGenes)
  const hasSenseTrend = history.some((s) => s.rabbitGenes)

  return (
    <div className={`${PANEL_SHELL} gap-2 border-neutral-800 p-3`}>
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-neutral-100 uppercase">📈 Population</h2>
        <CloseButton onClose={onClose} />
      </div>
      <p className="text-xs text-neutral-400">
        🐇 {population} rabbit{population === 1 ? '' : 's'}
        {generationRange ? ` · gen ${generationRange[0]}–${generationRange[1]}` : ''}
      </p>
      <p className="text-xs text-neutral-400">
        🦊 {foxPopulation} fox{foxPopulation === 1 ? '' : 'es'}
        {foxGenerationRange ? ` · gen ${foxGenerationRange[0]}–${foxGenerationRange[1]}` : ''}
        {kills ? ` · ${kills} caught` : ''}
      </p>
      {/* The warren the rabbits have dug for themselves - shown even at zero,
          so "they haven't dug anything yet" is distinguishable from "this
          panel doesn't track that". */}
      <p className="text-xs text-neutral-400">
        🕳 {burrows} burrow{burrows === 1 ? '' : 's'}
        {sheltered ? ` · ${sheltered} underground` : ''}
      </p>
      {/* The water, as a population statistic: how much of the island's life
          can currently use it, who is out there right now, and what that has
          cost. Swimming is a gene a lineage has to arrive at (see
          sim/water.js), so this line is where you watch it arrive. */}
      <p className="text-xs text-neutral-400">
        🌊 {swimmers} can swim
        {drownings ? ` · ${drownings} drowned` : ''}
      </p>
      {latest ? (
        <div className="flex flex-col gap-2 rounded-sm border border-neutral-800 bg-neutral-950 p-2">
          <PopulationChart history={history} />
          {TRAIT_META.filter((m) => TREND_KEYS.includes(m.key)).map((m) => (
            <TrendRow key={m.key} label={m.label} history={history} valueOf={(s) => s[m.key]} color={m.color} />
          ))}
          <p className="text-[10px] text-neutral-600">Averaged across every living rabbit, sampled every ~5s of sim time.</p>
          {/* Ears and voices are genes, not brain weights (see sim/rabbit.js),
              so they drift on their own track - and watching hearing creep up
              under fox pressure is the clearest read on selection there is. */}
          {hasSenseTrend ? (
            <div className="flex flex-col gap-2 border-t border-neutral-800 pt-2">
              <h3 className="text-[10px] font-semibold tracking-wide text-blue-300/80 uppercase">Rabbit senses</h3>
              {RABBIT_GENE_META.map((m) => (
                <TrendRow key={m.key} label={m.label} history={history} valueOf={(s) => s.rabbitGenes?.[m.key] ?? null} color={m.color} />
              ))}
            </div>
          ) : null}
          {hasFoxTrend ? (
            <div className="flex flex-col gap-2 border-t border-neutral-800 pt-2">
              <h3 className="text-[10px] font-semibold tracking-wide text-orange-400/80 uppercase">Fox genes</h3>
              {FOX_GENE_META.filter((m) => FOX_TREND_KEYS.includes(m.key)).map((m) => (
                <TrendRow key={m.key} label={m.label} history={history} valueOf={(s) => s.foxGenes?.[m.key] ?? null} color={m.color} />
              ))}
            </div>
          ) : null}
        </div>
      ) : (
        <p className="text-[11px] text-neutral-600">A trend line appears once creatures have been alive a little while.</p>
      )}
      {mapInfo ? (
        <p className="flex flex-wrap gap-x-3 border-t border-neutral-800 pt-2 text-[10px] text-neutral-500">
          <span>
            Size <b className="font-mono text-neutral-300 tabular-nums">{mapInfo.size}×{mapInfo.size}</b>
          </span>
          <span>
            Lakes <b className="font-mono text-neutral-300 tabular-nums">{mapInfo.lakeCount}</b>
          </span>
          <span>
            Seed <b className="font-mono text-neutral-300 tabular-nums">{mapInfo.seed}</b>
          </span>
        </p>
      ) : null}
    </div>
  )
}
