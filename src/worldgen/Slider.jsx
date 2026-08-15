/** A labeled range input with a live value readout, styled to match the app. */
export default function Slider({ label, hint, value, min, max, step, format, onChange }) {
  const display = format ? format(value) : String(value)
  return (
    <label className="flex flex-col gap-1.5">
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
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="h-1 w-full cursor-pointer appearance-none rounded-full bg-neutral-800 accent-emerald-500"
      />
      {hint ? <span className="text-xs text-neutral-500">{hint}</span> : null}
    </label>
  )
}
