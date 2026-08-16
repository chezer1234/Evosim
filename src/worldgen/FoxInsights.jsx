// Floating overlay for a selected fox. A fox has the same two halves a
// rabbit does now, so this panel shows both: the *body*, which is an
// explicit gene vector you can read straight off the bars (sim/fox.js), and
// the *brain*, an opaque net that has to be interpreted the same way the
// rabbit panel interprets its own (sim/foxInsight.js) - trait bars, a
// plain-English blurb, then the literal wiring.

import { FOX_ENERGY_MAX, FOX_GENE_META, describeFox, describeFoxStats, foxMenace } from '../sim/fox.js'
import { FOX_BRAIN_SHAPE } from '../sim/foxBrain.js'
import { FOX_INPUT_LABELS, FOX_OUTPUT_LABELS, FOX_TRAIT_META } from '../sim/foxInsight.js'
import BrainNetworkDiagram from './BrainNetworkDiagram.jsx'
import { CloseButton, PANEL_SHELL } from './panelChrome.jsx'
import { useIsTouch } from './useIsCompact.js'

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

function statusLine(fox) {
  if (!fox.alive) return 'Deceased'
  if (fox.floundering) return '🌊 out of its depth'
  if (fox.swimming) return '🌊 swimming'
  if (fox.feeding) return 'feeding'
  if (fox.hunting) return fox.sprinting ? 'chasing' : 'stalking'
  if (fox.tracking) return '👃 following a scent'
  if (fox.resting) return 'lying up'
  return 'prowling'
}

export default function FoxInsights({ selected, onClose }) {
  const touch = useIsTouch()
  const menace = selected ? foxMenace(selected.genes) : 0

  return (
    <div className={`${PANEL_SHELL} gap-4 border-orange-900/60 p-4`}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-100">🦊 Fox brains &amp; genes</h2>
        <CloseButton onClose={onClose} />
      </div>

      {selected ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            Fox #{selected.id} · gen {selected.generation}
          </h3>
          <p className="text-xs text-neutral-400">
            {selected.alive ? `Energy ${Math.round(selected.energy)}/${FOX_ENERGY_MAX}` : 'Deceased'} · {selected.kills} kill
            {selected.kills === 1 ? '' : 's'}
            {selected.gestating ? ' · expecting' : ''} · {statusLine(selected)}
            {selected.packing ? ' · with the pack' : ''}
          </p>

          <div className="flex items-center gap-2 rounded-sm border border-orange-900/60 bg-orange-950/30 px-2 py-1.5 text-xs">
            <span className="shrink-0 text-orange-300">Menace</span>
            <div className="h-2 flex-1 overflow-hidden rounded-full bg-neutral-800">
              <div className="h-full rounded-full bg-red-500" style={{ width: `${Math.round(menace * 100)}%` }} />
            </div>
            <span className="w-9 shrink-0 text-right font-mono tabular-nums text-orange-200">{Math.round(menace * 100)}%</span>
          </div>

          {/* Body first: the genes are what its brain has to work with. */}
          <div className="flex flex-col gap-1.5 rounded-sm border border-neutral-800 bg-neutral-950 p-2">
            <h4 className="text-[10px] font-semibold tracking-wide text-orange-400/80 uppercase">Body</h4>
            {FOX_GENE_META.map((m) => (
              <Bar key={m.key} label={m.label} value={selected.genes[m.key]} color={m.color} />
            ))}
          </div>

          <p className="text-xs leading-relaxed text-neutral-300">{describeFox(selected.genes)}</p>

          <ul className="flex list-disc flex-col gap-1 pl-4 text-[11px] leading-relaxed text-neutral-500">
            {describeFoxStats(selected.genes).map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>

          {/* Brain second: what it chooses to do with that body. */}
          <div className="mt-1 flex flex-col gap-1.5 rounded-sm border border-neutral-800 bg-neutral-950 p-2">
            <h4 className="text-[10px] font-semibold tracking-wide text-red-400/80 uppercase">Instincts</h4>
            {FOX_TRAIT_META.map((m) => (
              <Bar key={m.key} label={m.label} value={selected.traits[m.key]} color={m.color} />
            ))}
          </div>
          <p className="text-xs leading-relaxed text-neutral-300">{selected.blurb}</p>
          <ul className="flex flex-col gap-1 text-[11px] text-neutral-500">
            <li>🐇 {selected.drives.chase}</li>
            <li>💤 {selected.drives.rest}</li>
            <li>🏃 {selected.drives.prey}</li>
          </ul>

          <div className="flex flex-col gap-1 border-t border-neutral-800 pt-3">
            <h4 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Neural net</h4>
            <p className="text-[10px] text-neutral-600">Green = pulls toward, red = pulls away. Brighter/thicker = stronger.</p>
            <div className="rounded-sm border border-neutral-800 bg-neutral-950 p-1">
              <BrainNetworkDiagram
                brain={selected.brain}
                shape={FOX_BRAIN_SHAPE}
                inputLabels={FOX_INPUT_LABELS}
                outputLabels={FOX_OUTPUT_LABELS}
              />
            </div>
          </div>

          <p className="border-t border-neutral-800 pt-2 text-[10px] leading-relaxed text-neutral-600">
            Cubs inherit both halves - genes and brain weights - with small random mutations, so a lineage's body and its
            instincts drift under whatever the island actually rewards. Watch the averages in the Population panel.
          </p>
        </section>
      ) : (
        <p className="text-[11px] text-neutral-600">{touch ? 'Tap' : 'Click'} a fox on the map to see its brain and genes.</p>
      )}
    </div>
  )
}
