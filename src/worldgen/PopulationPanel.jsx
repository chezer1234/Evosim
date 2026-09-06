// Small floating overlay showing every population over time - rabbits, the
// foxes eating them, and the fish and crabs the foxes eat when there are no
// rabbits left - plus how each species' genes are drifting.
// Deliberately independent of the inspector panels (see RabbitInsights.jsx /
// FoxInsights.jsx): you can watch the ecosystem without selecting anything,
// and toggling this doesn't affect those panels or vice versa.

import { TRAIT_META } from '../sim/brainInsight.js'
import { CRAB_GENE_META } from '../sim/crab.js'
import { FISH_GENE_META } from '../sim/fish.js'
import { FOX_GENE_META } from '../sim/fox.js'
import { FOX_TRAIT_META } from '../sim/foxInsight.js'
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

/** Wraps a mini chart so clicking it opens the full "since the beginning"
 * view (see ExpandedChart.jsx) instead of just being inert decoration.
 * `onExpand` is omitted entirely (rather than passed a no-op) where a caller
 * has nowhere to send it, so this degrades to plain unclickable decoration. */
function Expandable({ onExpand, label, children }) {
  if (!onExpand) return children
  return (
    <button
      type="button"
      onClick={onExpand}
      aria-label={`Expand ${label} chart`}
      title="Click to see the full history"
      className="w-full cursor-zoom-in rounded-sm text-left transition hover:opacity-80 focus:opacity-80 focus:outline-none"
    >
      {children}
    </button>
  )
}

function TrendRow({ label, history, valueOf, color, onExpandChart }) {
  const latest = valueOf(history[history.length - 1])
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between text-[11px] text-neutral-400">
        <span>{label} (avg)</span>
        <span className="font-mono tabular-nums">{latest == null ? '—' : `${Math.round(latest * 100)}%`}</span>
      </div>
      <Expandable onExpand={onExpandChart && (() => onExpandChart({ kind: 'trend', label, valueOf, color }))} label={label}>
        <Sparkline history={history} valueOf={valueOf} color={color} />
      </Expandable>
    </div>
  )
}

const TREND_KEYS = ['foodDrive', 'searchDrive', 'broodiness', 'skittishness', 'burrowInstinct', 'heedsAlarm']
// The fox genes worth watching drift: the ones that decide whether the
// rabbits get away.
const FOX_TREND_KEYS = ['speed', 'vision', 'camouflage', 'metabolism', 'packTendency']
// And the instincts, off the fox's own neural net: what a lineage has
// *learned* to do with that body (see sim/foxInsight.js).
const FOX_INSTINCT_KEYS = ['aggression', 'tracking', 'idleness', 'broodiness', 'patience', 'beachcombing']
// The shoreline genes worth a trend line. Crab boldness above all: it is the
// average distance that population is willing to put between itself and the
// water, and every fox on the beach is voting on it (see sim/crab.js).
const CRAB_TREND_KEYS = ['boldness', 'armour']
const FISH_TREND_KEYS = ['speed', 'wariness', 'shoaling']

const POP_CHART_W = 220
const POP_CHART_H = 46

/** Both populations over time on one axis, scaled to their shared running
 * max (not 0..1 like the trait sparklines) so a crash down to 0 is as
 * visible as the peak - and so the classic predator/prey lag between the two
 * curves is actually readable. */
function PopulationChart({ history, onExpandChart }) {
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
      <Expandable onExpand={onExpandChart && (() => onExpandChart({ kind: 'population' }))} label="population">
        <svg viewBox={`0 0 ${POP_CHART_W} ${POP_CHART_H}`} width="100%" height={POP_CHART_H} preserveAspectRatio="none">
          <polyline points={`0,${POP_CHART_H} ${rabbitPoints} ${POP_CHART_W},${POP_CHART_H}`} fill="rgba(120,214,110,0.15)" stroke="none" />
          <polyline points={rabbitPoints} fill="none" stroke="rgb(120,214,110)" strokeWidth="1.5" />
          <polyline points={foxPoints} fill="none" stroke="rgb(251,146,60)" strokeWidth="1.5" />
        </svg>
      </Expandable>
      <div className="flex justify-between text-[9px] text-neutral-600">
        <span>🐇 rabbits · 🦊 foxes</span>
        <span>peak {max}</span>
      </div>
    </div>
  )
}

/**
 * The shoreline populations on their own axis rather than the chart above.
 *
 * A productive lake holds hundreds of fish where an island holds twenty
 * rabbits, so putting them on one scale would flatten the predator/prey
 * curves into a line along the bottom. What is worth reading here is the
 * *shape* - a shoal being eaten down and growing back - so it gets its own
 * running max, and the fox curve stays where it can be compared with the
 * rabbits it is or isn't catching.
 */
function ShorelineChart({ history, onExpandChart }) {
  if (history.length < 2) return null
  const max = Math.max(1, ...history.map((s) => Math.max(s.fishPopulation ?? 0, s.crabPopulation ?? 0)))
  const seriesPoints = (key) =>
    history
      .map((s, i) => {
        const x = (i / (history.length - 1)) * POP_CHART_W
        const y = POP_CHART_H - ((s[key] ?? 0) / max) * POP_CHART_H
        return `${x.toFixed(1)},${y.toFixed(1)}`
      })
      .join(' ')
  const latest = history[history.length - 1]
  return (
    <div className="flex flex-col gap-1 border-t border-neutral-800 pt-2">
      <div className="flex items-center justify-between text-[11px] text-neutral-400">
        <span>The shallows over time</span>
        <span className="font-mono tabular-nums">
          <span className="text-sky-400">{latest.fishPopulation ?? 0}</span>
          <span className="text-neutral-600"> / </span>
          <span className="text-rose-400">{latest.crabPopulation ?? 0}</span>
        </span>
      </div>
      <Expandable onExpand={onExpandChart && (() => onExpandChart({ kind: 'shoreline' }))} label="shoreline">
        <svg viewBox={`0 0 ${POP_CHART_W} ${POP_CHART_H}`} width="100%" height={POP_CHART_H} preserveAspectRatio="none">
          <polyline points={seriesPoints('fishPopulation')} fill="none" stroke="rgb(94,197,214)" strokeWidth="1.5" />
          <polyline points={seriesPoints('crabPopulation')} fill="none" stroke="rgb(222,110,92)" strokeWidth="1.5" />
        </svg>
      </Expandable>
      <div className="flex justify-between text-[9px] text-neutral-600">
        <span>🐟 fish · 🦀 crabs</span>
        <span>peak {max}</span>
      </div>
    </div>
  )
}

/** `mapInfo` carries the map's size/lakes/seed - shown here only when the
 * caller has nowhere else to put them, which on a compact screen is the case:
 * the phone toolbar has room for the live counts and nothing more. */
export default function PopulationPanel({ population, foxPopulation, fishPopulation = 0, crabPopulation = 0, kills, shoreCatches = 0, burrows, sheltered, swimmers, seafarers = 0, islands = 1, colonised = 0, atSea = 0, islandRows = [], drownings, history, generationRange, foxGenerationRange, mapInfo, scenarioLabel = null, onClose, onExpandChart }) {
  const latest = history[history.length - 1]
  const hasFoxTrend = history.some((s) => s.foxGenes)
  const hasFoxInstinctTrend = history.some((s) => s.foxTraits)
  const hasSenseTrend = history.some((s) => s.rabbitGenes)
  const hasShoreline = fishPopulation > 0 || crabPopulation > 0 || history.some((s) => s.fishPopulation || s.crabPopulation)
  const hasFishTrend = history.some((s) => s.fishGenes)
  const hasCrabTrend = history.some((s) => s.crabGenes)

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
        {shoreCatches ? ` · ${shoreCatches} off the shore` : ''}
      </p>
      {/* Which world this is, when it isn't the default one: a run started
          from a preset (or a hand-tuned scenario) behaves differently enough
          that "why are there so many rabbits" deserves an answer in the
          panel rather than in the player's memory. See sim/scenario.js. */}
      {scenarioLabel ? <p className="text-[11px] text-amber-400/90">🧬 {scenarioLabel} starting conditions</p> : null}
      {/* The second food chain, and the reason a fox population can outlive
          the rabbits entirely (see sim/shallows.js). Hidden until there is
          something in the water, since an island with a dry shoreline has
          nothing to say here. */}
      {hasShoreline ? (
        <p className="text-xs text-neutral-400">
          🐟 {fishPopulation} fish · 🦀 {crabPopulation} crab{crabPopulation === 1 ? '' : 's'}
        </p>
      ) : null}
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
        {seafarers ? ` · ${seafarers} can cross the sea` : ''}
        {drownings ? ` · ${drownings} drowned` : ''}
      </p>
      {/* On a world of several islands, the number that matters: how many of
          them anything actually lives on. Populations only diverge while they
          are apart, and a lineage crossing a channel is the moment two of
          them stop being separate (see sim/water.js). */}
      {islands > 1 ? (
        <div className="flex flex-col gap-1 rounded-sm border border-neutral-800 bg-neutral-950 p-2">
          <p className="text-xs text-neutral-400">
            🏝 {colonised} of {islands} islands settled
            {atSea ? ` · ${atSea} at sea` : ''}
          </p>
          <div className="flex flex-col gap-0.5">
            {islandRows.map((row) => (
              <div key={row.id} className="flex items-center justify-between font-mono text-[10px] text-neutral-500 tabular-nums">
                <span>island {row.label}</span>
                <span>
                  <span className="text-emerald-400">🐇 {row.rabbits}</span>
                  <span className="text-neutral-700"> · </span>
                  <span className={row.foxes ? 'text-orange-400' : 'text-neutral-700'}>🦊 {row.foxes}</span>
                </span>
              </div>
            ))}
          </div>
        </div>
      ) : null}
      {latest ? (
        <div className="flex flex-col gap-2 rounded-sm border border-neutral-800 bg-neutral-950 p-2">
          <PopulationChart history={history} onExpandChart={onExpandChart} />
          {hasShoreline ? <ShorelineChart history={history} onExpandChart={onExpandChart} /> : null}
          {TRAIT_META.filter((m) => TREND_KEYS.includes(m.key)).map((m) => (
            <TrendRow key={m.key} label={m.label} history={history} valueOf={(s) => s[m.key]} color={m.color} onExpandChart={onExpandChart} />
          ))}
          <p className="text-[10px] text-neutral-600">Averaged across every living rabbit, sampled every ~5s of sim time. Click a chart to see its full history.</p>
          {/* Ears and voices are genes, not brain weights (see sim/rabbit.js),
              so they drift on their own track - and watching hearing creep up
              under fox pressure is the clearest read on selection there is. */}
          {hasSenseTrend ? (
            <div className="flex flex-col gap-2 border-t border-neutral-800 pt-2">
              <h3 className="text-[10px] font-semibold tracking-wide text-blue-300/80 uppercase">Rabbit senses</h3>
              {RABBIT_GENE_META.map((m) => (
                <TrendRow key={m.key} label={m.label} history={history} valueOf={(s) => s.rabbitGenes?.[m.key] ?? null} color={m.color} onExpandChart={onExpandChart} />
              ))}
            </div>
          ) : null}
          {hasFoxTrend ? (
            <div className="flex flex-col gap-2 border-t border-neutral-800 pt-2">
              <h3 className="text-[10px] font-semibold tracking-wide text-orange-400/80 uppercase">Fox bodies</h3>
              {FOX_GENE_META.filter((m) => FOX_TREND_KEYS.includes(m.key)).map((m) => (
                <TrendRow key={m.key} label={m.label} history={history} valueOf={(s) => s.foxGenes?.[m.key] ?? null} color={m.color} onExpandChart={onExpandChart} />
              ))}
            </div>
          ) : null}
          {/* The other half of a fox: its brain. Bodies drift slowly and
              visibly; instincts can swing in a couple of generations, which
              is what makes a fox boom or a fox bust legible as something the
              pack *decided* rather than something that happened to it. */}
          {hasFoxInstinctTrend ? (
            <div className="flex flex-col gap-2 border-t border-neutral-800 pt-2">
              <h3 className="text-[10px] font-semibold tracking-wide text-red-400/80 uppercase">Fox instincts</h3>
              {FOX_TRAIT_META.filter((m) => FOX_INSTINCT_KEYS.includes(m.key)).map((m) => (
                <TrendRow key={m.key} label={m.label} history={history} valueOf={(s) => s.foxTraits?.[m.key] ?? null} color={m.color} onExpandChart={onExpandChart} />
              ))}
            </div>
          ) : null}
          {/* Neither shoreline species has a brain, so these bars *are* their
              evolution: a crab population retreating toward the water, or a
              shoal getting quicker, is a fox's work showing up in a gene. */}
          {hasCrabTrend ? (
            <div className="flex flex-col gap-2 border-t border-neutral-800 pt-2">
              <h3 className="text-[10px] font-semibold tracking-wide text-rose-400/80 uppercase">Crabs</h3>
              {CRAB_GENE_META.filter((m) => CRAB_TREND_KEYS.includes(m.key)).map((m) => (
                <TrendRow key={m.key} label={m.label} history={history} valueOf={(s) => s.crabGenes?.[m.key] ?? null} color={m.color} onExpandChart={onExpandChart} />
              ))}
            </div>
          ) : null}
          {hasFishTrend ? (
            <div className="flex flex-col gap-2 border-t border-neutral-800 pt-2">
              <h3 className="text-[10px] font-semibold tracking-wide text-sky-400/80 uppercase">Fish</h3>
              {FISH_GENE_META.filter((m) => FISH_TREND_KEYS.includes(m.key)).map((m) => (
                <TrendRow key={m.key} label={m.label} history={history} valueOf={(s) => s.fishGenes?.[m.key] ?? null} color={m.color} onExpandChart={onExpandChart} />
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
          {mapInfo.islandCount > 1 ? (
            <span>
              Islands <b className="font-mono text-neutral-300 tabular-nums">{mapInfo.islandCount}</b>
            </span>
          ) : null}
          <span>
            Seed <b className="font-mono text-neutral-300 tabular-nums">{mapInfo.seed}</b>
          </span>
        </p>
      ) : null}
    </div>
  )
}
