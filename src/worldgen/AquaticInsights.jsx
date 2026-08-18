// Floating overlay for a selected fish or crab.
//
// One panel for both, where the rabbits and foxes get one each, because the
// shoreline species are the same *shape* of animal: a gene vector and no
// neural net (see sim/fish.js for why). There is no brain to interpret, no
// wiring diagram to draw and no instincts to read off the weights - what
// there is instead is four bars, what they buy in sim units, and the one
// sentence about what this individual is doing with them.
//
// That is the panel making a point rather than cutting a corner. Opening a
// crab and finding four numbers where a fox has two whole halves is the
// clearest way to say that not everything alive here thinks.

import { CRAB_ENERGY_MAX, CRAB_GENE_META, describeCrab, describeCrabStats } from '../sim/crab.js'
import { FISH_ENERGY_MAX, FISH_GENE_META, describeFish, describeFishStats } from '../sim/fish.js'
import { CloseButton, PANEL_SHELL } from './panelChrome.jsx'
import { useIsTouch } from './useIsCompact.js'

const SPECIES = {
  fish: {
    title: '🐟 Fish',
    border: 'border-sky-900/60',
    accent: 'text-sky-400/80',
    energyMax: FISH_ENERGY_MAX,
    meta: FISH_GENE_META,
    describe: describeFish,
    notes: describeFishStats,
    idle: 'holding station',
    fleeing: 'bolting',
    footer:
      'Fry inherit their parent\'s genes with small random mutations, and nothing else - a fish has no brain to pass on. Everything a shoal learns, it learns by the slow ones being eaten.',
  },
  crab: {
    title: '🦀 Crab',
    border: 'border-rose-900/60',
    accent: 'text-rose-400/80',
    energyMax: CRAB_ENERGY_MAX,
    meta: CRAB_GENE_META,
    describe: describeCrab,
    notes: describeCrabStats,
    idle: 'working the weed',
    fleeing: 'scuttling for the water',
    footer:
      'Hatchlings inherit their parent\'s genes with small random mutations. Watch boldness in the Population panel: it is the average distance this population is willing to put between itself and the water, and the foxes are the ones deciding it.',
  },
}

function Bar({ label, value, color }) {
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

export default function AquaticInsights({ selected, onClose }) {
  const touch = useIsTouch()
  const species = SPECIES[selected?.kind] ?? SPECIES.fish

  return (
    <div className={`${PANEL_SHELL} gap-4 ${species.border} p-4`}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-100">{species.title}</h2>
        <CloseButton onClose={onClose} />
      </div>

      {selected ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            #{selected.id} · gen {selected.generation}
          </h3>
          <p className="text-xs text-neutral-400">
            {selected.alive ? `Energy ${Math.round(selected.energy)}/${species.energyMax}` : 'Deceased'} ·{' '}
            {selected.fleeing ? species.fleeing : species.idle}
            {selected.shoaling ? ' · in a shoal' : ''}
            {selected.ashore ? ' · out of the water' : ''}
          </p>

          <div className="flex flex-col gap-1.5 rounded-sm border border-neutral-800 bg-neutral-950 p-2">
            <h4 className={`text-[10px] font-semibold tracking-wide uppercase ${species.accent}`}>Genes</h4>
            {species.meta.map((m) => (
              <Bar key={m.key} label={m.label} value={selected.genes[m.key]} color={m.color} />
            ))}
          </div>

          <p className="text-xs leading-relaxed text-neutral-300">{species.describe(selected.genes)}</p>

          <ul className="flex list-disc flex-col gap-1 pl-4 text-[11px] leading-relaxed text-neutral-500">
            {species.notes(selected.genes).map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>

          <p className="border-t border-neutral-800 pt-2 text-[10px] leading-relaxed text-neutral-600">{species.footer}</p>
        </section>
      ) : (
        <p className="text-[11px] text-neutral-600">{touch ? 'Tap' : 'Click'} a fish or a crab on the map to read its genes.</p>
      )}
    </div>
  )
}
