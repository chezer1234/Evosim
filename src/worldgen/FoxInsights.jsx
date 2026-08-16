// Floating overlay for a selected fox. The rabbit version of this panel
// (RabbitInsights.jsx) has to work hard to make an opaque neural net
// legible; a fox's genome is already a list of named dials, so this one just
// shows them honestly - the bars *are* the genome - plus what those numbers
// work out to in sim units (see describeFoxStats in sim/fox.js).

import { FOX_GENE_META, describeFox, describeFoxStats, foxMenace } from '../sim/fox.js'
import { CloseButton, PANEL_SHELL } from './panelChrome.jsx'
import { useIsTouch } from './useIsCompact.js'

function GeneBar({ label, value, color }) {
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
  if (fox.hunting) return fox.sprinting ? 'chasing' : 'hunting'
  return 'prowling'
}

export default function FoxInsights({ selected, onClose }) {
  const touch = useIsTouch()
  const menace = selected ? foxMenace(selected.genes) : 0

  return (
    <div className={`${PANEL_SHELL} gap-4 border-orange-900/60 p-4`}>
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-neutral-100">🦊 Fox genes</h2>
        <CloseButton onClose={onClose} />
      </div>

      {selected ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-xs font-semibold tracking-wide text-neutral-500 uppercase">
            Fox #{selected.id} · gen {selected.generation}
          </h3>
          <p className="text-xs text-neutral-400">
            {selected.alive ? `Energy ${Math.round(selected.energy)}/120` : 'Deceased'} · {selected.kills} kill
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

          <div className="flex flex-col gap-1.5 rounded-sm border border-neutral-800 bg-neutral-950 p-2">
            {FOX_GENE_META.map((m) => (
              <GeneBar key={m.key} label={m.label} value={selected.genes[m.key]} color={m.color} />
            ))}
          </div>

          <p className="text-xs leading-relaxed text-neutral-300">{describeFox(selected.genes)}</p>

          <ul className="flex list-disc flex-col gap-1 pl-4 text-[11px] leading-relaxed text-neutral-500">
            {describeFoxStats(selected.genes).map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>

          <p className="border-t border-neutral-800 pt-2 text-[10px] leading-relaxed text-neutral-600">
            Cubs inherit these genes with small random mutations, so a lineage's dials drift under whatever the island
            actually rewards - watch the averages in the Population panel.
          </p>
        </section>
      ) : (
        <p className="text-[11px] text-neutral-600">{touch ? 'Tap' : 'Click'} a fox on the map to see its genes.</p>
      )}
    </div>
  )
}
