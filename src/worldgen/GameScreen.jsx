import { useEffect, useRef } from 'react'
import { drawMap } from './mapgen.js'

export default function GameScreen({ map, onBack, onNewMap, onOpenSettings }) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || !map) return

    function render() {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const wrapRect = wrap.getBoundingClientRect()
      const display = Math.max(200, Math.floor(Math.min(wrapRect.width - 40, wrapRect.height - 40, 880)))
      const tilePx = Math.max(2, display / map.size)
      const pixelSize = Math.round(tilePx * map.size)

      canvas.style.width = `${pixelSize}px`
      canvas.style.height = `${pixelSize}px`
      canvas.width = Math.round(pixelSize * dpr)
      canvas.height = Math.round(pixelSize * dpr)
      const ctx = canvas.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      drawMap(ctx, map, tilePx)
    }

    render()
    let timer = null
    const onResize = () => {
      clearTimeout(timer)
      timer = setTimeout(render, 80)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      clearTimeout(timer)
    }
  }, [map])

  return (
    <main className="flex min-h-svh flex-col bg-neutral-950 text-neutral-100">
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-800 bg-neutral-900 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onBack}
            className="rounded-sm border border-neutral-700 bg-neutral-950 px-4 py-2 text-sm font-semibold transition hover:border-emerald-500 hover:text-emerald-400"
          >
            ← Menu
          </button>
          <button
            type="button"
            onClick={onNewMap}
            className="rounded-sm border border-neutral-700 bg-neutral-950 px-4 py-2 text-sm font-semibold transition hover:border-emerald-500 hover:text-emerald-400"
          >
            ⟳ New map
          </button>
          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded-sm border border-neutral-700 bg-neutral-950 px-4 py-2 text-sm font-semibold transition hover:border-emerald-500 hover:text-emerald-400"
          >
            ⚙ Settings
          </button>
        </div>
        {map ? (
          <div className="flex flex-wrap gap-4 text-xs text-neutral-400">
            <span>
              Size <b className="font-mono text-neutral-100 tabular-nums">{map.size}×{map.size}</b>
            </span>
            <span>
              Lakes <b className="font-mono text-neutral-100 tabular-nums">{map.lakeCount}</b>
            </span>
            <span>
              Seed <b className="font-mono text-neutral-100 tabular-nums">{map.seed}</b>
            </span>
          </div>
        ) : null}
      </div>
      <div ref={wrapRef} className="flex min-h-0 flex-1 items-center justify-center p-5">
        <canvas ref={canvasRef} className="rounded-sm bg-[#16324a] shadow-2xl shadow-black/40" />
      </div>
    </main>
  )
}
