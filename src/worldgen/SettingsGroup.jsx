/** One titled block of settings. Shared by the two setup screens so they
 *  read as the same page furniture: the world you generate and the starting
 *  conditions you generate it for are one decision in two parts. */
export default function SettingsGroup({ title, children }) {
  return (
    <div className="flex flex-col gap-4 rounded-md border border-neutral-800 bg-neutral-900 p-4 sm:gap-5 sm:p-5">
      <p className="text-xs font-bold tracking-[0.14em] text-emerald-400 uppercase">{title}</p>
      {children}
    </div>
  )
}
