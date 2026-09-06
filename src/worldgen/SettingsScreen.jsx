import Slider from './Slider.jsx'
import Group from './SettingsGroup.jsx'
import { WORLD_PRESETS, matchingPreset } from './mapgen.js'

/** The four worlds worth having as one tap. Size and island count are one
 *  decision, not two: a 64-tile map has nowhere to put a second island, and a
 *  224-tile map with one island on it is mostly sea. */
function WorldPresets({ settings, onChange }) {
  const active = matchingPreset(settings)
  return (
    <div className="flex flex-col gap-2">
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        {WORLD_PRESETS.map((preset) => (
          <button
            key={preset.key}
            type="button"
            onClick={() => onChange(preset.settings)}
            aria-pressed={active === preset.key}
            className={`flex min-h-11 flex-col items-start gap-0.5 rounded-sm border px-3 py-2 text-left transition ${
              active === preset.key
                ? 'border-emerald-500 bg-emerald-500/15 text-emerald-300'
                : 'border-neutral-700 bg-neutral-950 text-neutral-200 hover:border-emerald-500 hover:text-emerald-400'
            }`}
          >
            <span className="text-sm font-semibold">
              {preset.label}{' '}
              <span className="font-mono text-xs text-neutral-500">
                {preset.settings.size}×{preset.settings.size}
              </span>
            </span>
            <span className="text-xs text-neutral-500">{preset.hint}</span>
          </button>
        ))}
      </div>
      <p className="text-xs text-neutral-500">
        Bigger worlds put real water between populations. Only a creature whose swim gene has evolved near the top of
        its range can cross a narrow channel to the next island - everything else stays where it was born.
      </p>
    </div>
  )
}

export default function SettingsScreen({ settings, onChange, onChangeMany, onReset, onBack, onPlay }) {
  return (
    <main className="safe-x safe-b min-h-svh bg-neutral-950 px-4 py-6 text-neutral-100 sm:px-6 sm:py-10">
      <div className="mx-auto flex max-w-2xl flex-col gap-6 sm:gap-8">
        {/* Sticky so "Back" stays reachable on a phone, where the settings
            list is several screens long. */}
        <div className="sticky top-0 z-10 -mx-4 flex items-baseline justify-between gap-4 border-b border-neutral-800 bg-neutral-950/95 px-4 pt-2 pb-3 backdrop-blur-sm sm:-mx-6 sm:px-6 sm:pb-4">
          <h2 className="font-serif text-2xl font-semibold sm:text-3xl">Settings</h2>
          <button
            type="button"
            onClick={onBack}
            className="min-h-11 rounded-sm border border-neutral-700 bg-neutral-900 px-4 py-2 text-sm font-semibold transition hover:border-emerald-500 hover:text-emerald-400"
          >
            ← Back
          </button>
        </div>

        <Group title="World">
          <WorldPresets settings={settings} onChange={onChangeMany} />
          <Slider
            label="Map size"
            hint="Number of tiles along each edge of the world."
            value={settings.size}
            min={24}
            max={256}
            step={8}
            format={(v) => `${v}×${v}`}
            onChange={(v) => onChange('size', v)}
          />
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Slider
              label="Min islands"
              value={settings.minIslands}
              min={1}
              max={12}
              step={1}
              onChange={(v) => onChange('minIslands', v)}
            />
            <Slider
              label="Max islands"
              value={settings.maxIslands}
              min={1}
              max={12}
              step={1}
              onChange={(v) => onChange('maxIslands', v)}
            />
          </div>
          <p className="text-xs text-neutral-500">
            Each world rolls an island count in this range. They come out smaller the more there are, and some pairs
            land close enough to swim between.
          </p>
          <Slider
            label="Climate range"
            hint="How far the world runs from arctic at the top of the map to desert at the bottom. At zero it is one temperate climate everywhere."
            value={settings.climate}
            min={0}
            max={1}
            step={0.05}
            format={(v) => `${Math.round(v * 100)}%`}
            onChange={(v) => onChange('climate', v)}
          />
        </Group>

        <Group title="Terrain">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Slider
              label="Detail levels"
              hint="Layers of noise stacked together. More levels add finer coastline detail."
              value={settings.octaves}
              min={1}
              max={8}
              step={1}
              onChange={(v) => onChange('octaves', v)}
            />
            <Slider
              label="Feature size"
              hint="Low is jagged islets, high is broad, smooth landmasses."
              value={settings.noiseScale}
              min={6}
              max={90}
              step={1}
              onChange={(v) => onChange('noiseScale', v)}
            />
          </div>
          <Slider
            label="Roughness"
            hint="How strongly the finer detail levels distort the base shape."
            value={settings.persistence}
            min={0.15}
            max={0.85}
            step={0.05}
            format={(v) => v.toFixed(2)}
            onChange={(v) => onChange('persistence', v)}
          />
        </Group>

        <Group title="Waters">
          <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
            <Slider
              label="Min lakes"
              value={settings.minLakes}
              min={0}
              max={10}
              step={1}
              onChange={(v) => onChange('minLakes', v)}
            />
            <Slider
              label="Max lakes"
              value={settings.maxLakes}
              min={0}
              max={10}
              step={1}
              onChange={(v) => onChange('maxLakes', v)}
            />
          </div>
          <p className="text-xs text-neutral-500">
            Every island rolls its own lake count in this range, so a world of six islands has six sets of lakes rather
            than sharing one.
          </p>
        </Group>

        <Group title="Life">
          <Slider
            label="Vegetation density"
            hint="How much of the land grows forest and shrub versus open grass."
            value={settings.vegetation}
            min={0.4}
            max={1.8}
            step={0.05}
            format={(v) => `${v.toFixed(2)}×`}
            onChange={(v) => onChange('vegetation', v)}
          />
        </Group>

        {/* Reversed on a phone so the primary action is the one nearest the
            thumb, and both go full width rather than shrinking to a tap-
            sized gamble. */}
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
            Play with these settings
          </button>
        </div>
      </div>
    </main>
  )
}
