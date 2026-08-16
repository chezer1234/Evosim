// Floating overlay translating a rabbit's raw neural-net weights (see
// sim/brainInsight.js) into something an average person can read: trait
// bars, a plain-English blurb, and the literal network diagram. Population-
// level stats live in their own panel (see PopulationPanel.jsx) so this one
// stays focused on whichever rabbit is selected.

import { TRAIT_META } from '../sim/brainInsight.js'
import { RABBIT_GENE_META } from '../sim/rabbit.js'
import BrainNetworkDiagram from './BrainNetworkDiagram.jsx'
import { CloseButton, PANEL_SHELL } from './panelChrome.jsx'
import { useIsTouch } from './useIsCompact.js'

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

export default function RabbitInsights({ selected, onClose }) {
  const touch = useIsTouch()
  return (
    <div className={`${PANEL_SHELL} gap-4 border-neutral-800 p-4`}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-100">🧠 Rabbit brains</h2>
        <CloseButton onClose={onClose} />
      </div>

      {selected ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            Rabbit #{selected.id} · gen {selected.generation}
          </h3>
          <p className="text-xs text-neutral-400">
            {selected.alive ? `Energy ${selected.energy}/100` : 'Deceased'}
            {selected.gestating ? ' · expecting' : ''}
            {selected.sheltered
              ? ' · 🕳 underground'
              : selected.floundering
                ? ' · 🌊 out of its depth'
                : selected.swimming
                  ? ' · 🌊 swimming'
                  : selected.fleeing
                    ? ' · 🦊 fleeing'
                    : selected.searching
                      ? ' · searching'
                      : selected.running
                        ? ' · running'
                        : selected.resting
                          ? ' · resting'
                          : ''}
            {selected.heardOnly ? ' · 👂 heard a fox it cannot see' : ''}
            {selected.calling ? ' · 📣 calling' : selected.alarmHeard > 0 ? ` · 👂 hears an alarm (${Math.round(selected.alarmHeard * 100)}%)` : ''}
          </p>
          {/* Senses first: they're an explicit gene vector (see sim/rabbit.js),
              unlike the neural-net traits below, and they're what decides
              whether this rabbit ever learns a fox is coming. */}
          <div className="flex flex-col gap-1.5 rounded-sm border border-neutral-800 bg-neutral-950 p-2">
            <h4 className="text-[10px] font-semibold tracking-wide text-blue-300/80 uppercase">Senses</h4>
            {RABBIT_GENE_META.map((m) => (
              <TraitBar key={m.key} label={m.label} value={selected.genes[m.key]} color={m.color} />
            ))}
            <ul className="flex flex-col gap-1 text-[10px] text-neutral-500">
              {selected.senseNotes.map((note) => (
                <li key={note}>👂 {note}</li>
              ))}
            </ul>
          </div>
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
          <div className="flex flex-col gap-1 border-t border-neutral-800 pt-3">
            <h4 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">Neural net</h4>
            <p className="text-[10px] text-neutral-600">Green = pulls toward, red = pulls away. Brighter/thicker = stronger.</p>
            <div className="rounded-sm border border-neutral-800 bg-neutral-950 p-1">
              <BrainNetworkDiagram brain={selected.brain} />
            </div>
          </div>
        </section>
      ) : (
        <p className="text-[11px] text-neutral-600">{touch ? 'Tap' : 'Click'} a rabbit on the map to see its brain.</p>
      )}
    </div>
  )
}
