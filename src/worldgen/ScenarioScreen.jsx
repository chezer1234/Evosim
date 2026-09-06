// Scenario setup: what the world you are about to play is *stocked* with,
// where the Settings screen is what it is made of. Issue #18 - starting
// conditions decide a lot about how a run goes, and until now the only lever
// a player had was how many of each species they scattered.
//
// The screen is driven off the dial table in sim/scenario.js rather than
// spelling out thirty sliders here: a dial's label, range and plain-English
// hint belong next to the number it moves, and a dial that exists in the sim
// but not on this page would be a dial nobody can reach.
//
// Presets first, and deliberately so. Twenty raw sliders mostly produce dead
// islands; four one-tap worlds get someone to an interesting run and leave
// the dials there to take apart afterwards.

import Slider from './Slider.jsx'
import Group from './SettingsGroup.jsx'
import { SCENARIO_GROUPS, SCENARIO_PRESETS, matchingScenarioPreset } from '../sim/scenario.js'

function ScenarioPresets({ scenario, onChange }) {
  const active = matchingScenarioPreset(scenario)
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {SCENARIO_PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            onClick={() => onChange(preset.scenario)}
            aria-pressed={active === preset.key}
            className={`flex min-h-11 flex-col items-start gap-0.5 rounded-sm border px-3 py-2 text-left transition ${
              active === preset.key
                ? 'border-amber-500 bg-amber-500/15 text-amber-300'
                : 'border-neutral-700 bg-neutral-950 text-neutral-200 hover:border-amber-500 hover:text-amber-400'
            }`}
          >
            <span className="text-sm font-semibold">{preset.label}</span>
            <span className="text-xs text-neutral-500">{preset.hint}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-neutral-500">
        Every preset is checked headlessly against a batch of islands before it ships, so each one is a world both
        species can actually live in. Move a single dial and you are off the preset and on your own - which is the
        interesting part.
      </p>
    </div>
  )
}

function Dials({ group, scenario, onChange }) {
  return (
    <>
      <p className="text-xs leading-relaxed text-neutral-500">{group.blurb}</p>
      {group.dials.map((dial) => (
        <Slider
          key={dial.key}
          label={dial.label}
          hint={dial.hint}
          value={scenario[dial.key]}
          min={dial.min}
          max={dial.max}
          step={dial.step}
          format={dial.format}
          onChange={(v) => onChange(dial.key, v)}
        />
      ))}
    </>
  )
}

export default function ScenarioScreen({ scenario, onChange, onChangeMany, onReset, onBack, onPlay }) {
  return (
    <main className="safe-x safe-b min-h-svh bg-neutral-950 px-4 py-6 text-neutral-100 sm:px-6 sm:py-10">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 sm:gap-8">
        {/* Sticky, like Settings: this page is several screens long on a
            phone and "Back" has to stay reachable from anywhere in it. */}
        <div className="sticky top-0 z-10 -mx-4 flex items-baseline justify-between gap-4 border-b border-neutral-800 bg-neutral-950/95 px-4 pt-2 pb-3 backdrop-blur-sm sm:-mx-6 sm:px-6 sm:pb-4">
          <h2 className="font-serif text-2xl font-semibold sm:text-3xl">Scenario</h2>
          <button
            type="button"
            onClick={onBack}
            className="min-h-11 rounded-sm border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-semibold transition hover:border-emerald-500 hover:text-emerald-400"
          >
            ← Back
          </button>
        </div>

        <p className="-mt-2 text-sm leading-relaxed text-neutral-400">
          Where evolution starts, not where it ends. Nothing here is fixed for the run: these are the priors a founder
          population is built from, and the economy it has to make a living in - mutation and selection take it
          wherever the island leads from there.
        </p>

        <Group title="Presets">
          <ScenarioPresets scenario={scenario} onChange={onChangeMany} />
        </Group>

        {SCENARIO_GROUPS.filter((group) => !group.advanced).map((group) => (
          <Group key={group.key} title={group.title}>
            <Dials group={group} scenario={scenario} onChange={onChange} />
          </Group>
        ))}

        {/* The instinct biases are real dials, but they are the least
            load-bearing ones on the page and there are nine of them - folded
            away so the groups that decide a run are not buried under them. */}
        {SCENARIO_GROUPS.filter((group) => group.advanced).map((group) => (
          <details
            key={group.key}
            className="rounded-md border border-neutral-800 bg-neutral-900 p-4 sm:p-5 [&[open]>summary]:mb-4 sm:[&[open]>summary]:mb-5"
          >
            <summary className="cursor-pointer text-xs font-bold tracking-[0.14em] text-emerald-400 uppercase">
              {group.title}
            </summary>
            <div className="flex flex-col gap-4 sm:gap-5">
              <Dials group={group} scenario={scenario} onChange={onChange} />
            </div>
          </details>
        ))}

        {/* Reversed on a phone so the primary action is nearest the thumb,
            matching Settings. */}
        <div className="flex flex-col-reverse gap-3 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between sm:gap-4">
          <button
            type="button"
            onClick={onReset}
            className="min-h-11 rounded-sm border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-semibold transition hover:border-emerald-500 hover:text-emerald-400"
          >
            Reset to defaults
          </button>
          <button
            type="button"
            onClick={onPlay}
            className="min-h-12 rounded-sm bg-amber-500 px-8 py-3 font-semibold text-neutral-950 shadow-lg shadow-amber-900/30 transition hover:bg-amber-400 active:translate-y-px"
          >
            Play this scenario
          </button>
        </div>
      </div>
    </main>
  )
}
