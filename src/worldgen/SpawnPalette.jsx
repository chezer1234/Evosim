// The spawn palette: pick a species, pick how many land per click, then
// click the map (or scatter them across the island). Issue #11 asked for "a
// better interface to allow spawning one of these creatures" - with two
// species and rising counts, the old single "🐇 Spawn rabbit" toggle button
// doesn't scale, and there was no way to seed a predator/prey scenario
// without clicking thirty times.

import { CloseButton, PANEL_SHELL } from './panelChrome.jsx'
import { useIsTouch } from './useIsCompact.js'

const SPAWN_SPECIES = [
  {
    key: 'rabbit',
    label: 'Rabbit',
    emoji: '🐇',
    blurb: 'Prey. Forages, breeds, and evolves a neural-net brain.',
    accent: 'emerald',
  },
  {
    key: 'fox',
    label: 'Fox',
    emoji: '🦊',
    blurb: 'Predator. A heritable body (speed, vision, camouflage, metabolism…) driven by a heritable neural-net brain.',
    accent: 'orange',
  },
]

const COUNTS = [1, 3, 5, 10]

// Tailwind can't build class names from a variable at runtime, so the two
// accents are spelled out rather than interpolated.
const CARD_CLASS = {
  selected: {
    emerald: 'border-emerald-500 bg-emerald-500/15 text-emerald-300',
    orange: 'border-orange-500 bg-orange-500/15 text-orange-300',
  },
  idle: 'border-neutral-800 bg-neutral-950 text-neutral-300 hover:border-neutral-600',
}

export default function SpawnPalette({ species, count, onSpeciesChange, onCountChange, onScatter, onClose }) {
  const active = SPAWN_SPECIES.find((s) => s.key === species) ?? SPAWN_SPECIES[0]
  const touch = useIsTouch()

  return (
    <div className={`${PANEL_SHELL} gap-3 border-neutral-800 p-3`}>
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-semibold tracking-wide text-neutral-100 uppercase">🐾 Spawn creatures</h2>
        <CloseButton onClose={onClose} />
      </div>

      <div className="grid grid-cols-2 gap-2">
        {SPAWN_SPECIES.map((s) => (
          <button
            key={s.key}
            type="button"
            onClick={() => onSpeciesChange(s.key)}
            aria-pressed={s.key === species}
            className={`flex flex-col items-center gap-1 rounded-md border px-2 py-3 text-xs font-semibold transition ${s.key === species ? CARD_CLASS.selected[s.accent] : CARD_CLASS.idle}`}
          >
            <span className="text-2xl leading-none">{s.emoji}</span>
            {s.label}
          </button>
        ))}
      </div>

      <p className="text-[11px] leading-relaxed text-neutral-500">{active.blurb}</p>

      <div className="flex flex-col gap-1">
        <span className="text-[11px] text-neutral-400">Per {touch ? 'tap' : 'click'}</span>
        <div className="flex gap-1">
          {COUNTS.map((n) => (
            <button
              key={n}
              type="button"
              onClick={() => onCountChange(n)}
              aria-pressed={n === count}
              className={
                n === count
                  ? 'h-10 flex-1 rounded-sm border border-neutral-500 bg-neutral-800 font-mono text-xs font-semibold text-neutral-100 tabular-nums'
                  : 'h-10 flex-1 rounded-sm border border-neutral-800 bg-neutral-950 font-mono text-xs text-neutral-400 tabular-nums transition hover:border-neutral-600'
              }
            >
              ×{n}
            </button>
          ))}
        </div>
      </div>

      <button
        type="button"
        onClick={onScatter}
        className="min-h-11 rounded-sm border border-neutral-700 bg-neutral-950 px-3 py-2 text-xs font-semibold transition hover:border-neutral-500 hover:text-neutral-100"
      >
        🎲 Scatter {count} across the island
      </button>

      {/* Where to drop them is already said on the map itself, so this only
          has to cover what *closing* the palette does. */}
      <p className="text-[10px] leading-relaxed text-neutral-600">
        Close this panel to go back to inspecting creatures.
      </p>
    </div>
  )
}
