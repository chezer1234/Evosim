import Slider from './Slider.jsx'

function Group({ title, children }) {
  return (
    <div className="flex flex-col gap-4 rounded-md border border-neutral-800 bg-neutral-900 p-4 sm:gap-5 sm:p-5">
      <p className="text-xs font-bold tracking-[0.14em] text-emerald-400 uppercase">{title}</p>
      {children}
    </div>
  )
}

export default function SettingsScreen({ settings, onChange, onReset, onBack, onPlay }) {
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

        <Group title="Terrain">
          <Slider
            label="Map size"
            hint="Number of tiles along each edge of the island."
            value={settings.size}
            min={24}
            max={140}
            step={2}
            format={(v) => `${v}×${v}`}
            onChange={(v) => onChange('size', v)}
          />
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
          <p className="text-xs text-neutral-500">Each new map rolls a random lake count in this range.</p>
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
