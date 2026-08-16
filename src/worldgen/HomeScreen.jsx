import ContourBackdrop from './ContourBackdrop.jsx'

export default function HomeScreen({ onPlay, onOpenSettings }) {
  return (
    <main className="relative flex min-h-svh flex-col items-center justify-center gap-2 overflow-hidden bg-neutral-950 px-6 text-center text-neutral-100">
      <ContourBackdrop />
      <div className="relative z-10 flex max-w-lg flex-col items-center gap-2">
        <p className="text-xs tracking-[0.16em] text-neutral-500 uppercase">An evolution simulator</p>
        <h1 className="font-serif text-5xl font-semibold tracking-tight text-neutral-50 sm:text-6xl">Evosim</h1>
        <p className="mt-2 mb-8 max-w-md text-neutral-400">
          Chart a new island, drop in a population, and watch generations evolve to survive whatever the land throws
          at them.
        </p>
        <div className="flex flex-wrap justify-center gap-3">
          <button
            type="button"
            onClick={onPlay}
            className="rounded-sm bg-amber-500 px-8 py-3 font-semibold text-neutral-950 shadow-lg shadow-amber-900/30 transition hover:bg-amber-400 active:translate-y-px"
          >
            Play
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded-sm border border-neutral-700 bg-neutral-900 px-8 py-3 font-semibold text-neutral-100 transition hover:border-emerald-500 hover:text-emerald-400 active:translate-y-px"
          >
            Settings
          </button>
        </div>
      </div>
    </main>
  )
}
