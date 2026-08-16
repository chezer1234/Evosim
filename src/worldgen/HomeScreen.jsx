import ContourBackdrop from './ContourBackdrop.jsx'

export default function HomeScreen({ onPlay, onOpenSettings }) {
  // min-h-svh + py so the whole thing still fits (and scrolls if it must) on
  // a phone held sideways, where the viewport is only ~350px tall.
  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center gap-2 overflow-hidden bg-neutral-950 px-5 py-10 text-center text-neutral-100 sm:px-6">
      <ContourBackdrop />
      <div className="relative z-10 flex max-w-lg flex-col items-center gap-2">
        <p className="text-[11px] tracking-[0.16em] text-neutral-500 uppercase sm:text-xs">An evolution simulator</p>
        <h1 className="font-serif text-4xl font-semibold tracking-tight text-neutral-50 sm:text-6xl">Evosim</h1>
        <p className="mt-2 mb-8 max-w-md text-sm text-neutral-400 sm:text-base">
          Chart a new world - one island, or an archipelago of them - drop in a population, and watch generations
          evolve to survive whatever the land throws at them.
        </p>
        <div className="flex w-full max-w-xs flex-col justify-center gap-3 sm:max-w-none sm:flex-row sm:flex-wrap">
          <button
            type="button"
            onClick={onPlay}
            className="min-h-12 rounded-sm bg-amber-500 px-8 py-3 font-semibold text-neutral-950 shadow-lg shadow-amber-900/30 transition hover:bg-amber-400 active:translate-y-px"
          >
            Play
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="min-h-12 rounded-sm border border-neutral-700 bg-neutral-900 px-8 py-3 font-semibold text-neutral-100 transition hover:border-emerald-500 hover:text-emerald-400 active:translate-y-px"
          >
            Settings
          </button>
        </div>
      </div>
    </main>
  )
}
