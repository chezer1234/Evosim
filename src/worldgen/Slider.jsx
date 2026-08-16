/** A labeled range input with a live value readout, styled to match the app.
 * The track/thumb styling lives in index.css (`.evo-slider`), where the grab
 * area can be made thumb-sized on touch without fattening the visible track. */
export default function Slider({ label, hint, value, min, max, step, format, onChange }) {
  const display = format ? format(value) : String(value)
  return (
    <label className="flex flex-col gap-0.5">
      <span className="flex items-baseline justify-between gap-3 text-sm text-neutral-200">
        <span>{label}</span>
        <span className="font-mono text-xs text-neutral-400 tabular-nums">{display}</span>
      </span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="evo-slider"
      />
      {hint ? <span className="text-xs text-neutral-500">{hint}</span> : null}
    </label>
  )
}
