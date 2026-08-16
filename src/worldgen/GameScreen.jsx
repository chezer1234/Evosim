import { useCallback, useEffect, useRef, useState } from 'react'
import { drawMap } from './mapgen.js'
import { createSimulation, isPlaceable, spawnRabbit, stepSimulation } from '../sim/simulation.js'
import { drawSimulation } from '../sim/render.js'
import { computeTraits, describeEnergyEffects, describeTraits } from '../sim/brainInsight.js'
import RabbitInsights from './RabbitInsights.jsx'

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

/** Snapshot the sim into plain data for the "Brains" panel: the selected
 * rabbit's traits/blurb (if any) plus the population trend history. */
function buildInsightsData(sim) {
  const rabbits = sim.rabbits
  let generationRange = null
  if (rabbits.length) {
    let minGen = Infinity
    let maxGen = -Infinity
    for (const r of rabbits) {
      if (r.generation < minGen) minGen = r.generation
      if (r.generation > maxGen) maxGen = r.generation
    }
    generationRange = [minGen, maxGen]
  }

  let selected = null
  if (sim.selectedId != null) {
    const rabbit = rabbits.find((r) => r.id === sim.selectedId)
    if (rabbit) {
      const traits = computeTraits(rabbit.brain)
      selected = {
        id: rabbit.id,
        generation: rabbit.generation,
        energy: rabbit.energy,
        alive: rabbit.alive,
        running: rabbit.running,
        resting: rabbit.resting,
        searching: rabbit.searching,
        gestating: rabbit.gestating,
        brain: rabbit.brain,
        traits,
        blurb: describeTraits(traits),
        energyEffects: describeEnergyEffects(traits),
      }
    }
  }

  return { selected, history: sim.traitHistory, population: rabbits.length, generationRange }
}

// If the viewport (in tile units) is wider/taller than the map, center the
// map instead of pinning it to an edge. Otherwise clamp so you can't pan
// past the map's edges.
function clampOriginAxis(origin, viewLenTiles, mapSize) {
  if (viewLenTiles >= mapSize) return -(viewLenTiles - mapSize) / 2
  return clamp(origin, 0, mapSize - viewLenTiles)
}

export default function GameScreen({ map, onBack, onNewMap, onOpenSettings }) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const viewRef = useRef({ tilePx: 1, originX: 0, originY: 0, minTilePx: 1, maxTilePx: 1 })
  const sizeRef = useRef({ cssW: 0, cssH: 0 })
  const dragRef = useRef(null)
  const [zoomPct, setZoomPct] = useState(100)

  // Rabbit population sim: lives in a ref (mutated every frame outside
  // React) so the render loop can step it without triggering re-renders.
  // Recreated whenever a new map is generated.
  const simRef = useRef(null)
  const placingRef = useRef(false)
  const [placing, setPlacing] = useState(false)
  const [rabbitCount, setRabbitCount] = useState(0)
  const lastReportedCountRef = useRef(0)

  // "Brains" insights panel: translates a rabbit's raw weights into
  // plain-language traits (see sim/brainInsight.js). Snapshotted on a
  // throttle from the sim ref rather than every frame, since it's cheap
  // but there's no reason to recompute 60x/sec for a text panel.
  const showInsightsRef = useRef(false)
  const [showInsights, setShowInsights] = useState(false)
  const [insightsData, setInsightsData] = useState(null)
  const lastInsightsUpdateRef = useRef(0)
  const INSIGHTS_UPDATE_MS = 400

  useEffect(() => {
    simRef.current = map ? createSimulation(map) : null
    lastReportedCountRef.current = 0
    setRabbitCount(0)
    setPlacing(false)
    placingRef.current = false
    setInsightsData(null)
  }, [map])

  const toggleInsights = useCallback(() => {
    showInsightsRef.current = !showInsightsRef.current
    setShowInsights(showInsightsRef.current)
  }, [])

  // Draws whatever the current view/pan/zoom is, at the given elapsed time
  // (drives the wave animation along the coast). Called continuously from
  // a render loop below rather than re-scheduled per input event, since the
  // waves need to keep animating even when the view itself is still.
  const draw = useCallback(
    (time) => {
      const canvas = canvasRef.current
      if (!canvas || !map) return
      const ctx = canvas.getContext('2d')
      const v = viewRef.current
      const { cssW, cssH } = sizeRef.current
      const viewport = { originX: v.originX, originY: v.originY, width: cssW, height: cssH }
      drawMap(ctx, map, v.tilePx, viewport, time)
      if (simRef.current) drawSimulation(ctx, map, simRef.current, v.tilePx, viewport)
    },
    [map],
  )

  const togglePlacing = useCallback(() => {
    placingRef.current = !placingRef.current
    setPlacing(placingRef.current)
  }, [])

  const reportZoom = useCallback(() => {
    const v = viewRef.current
    setZoomPct(Math.round((v.tilePx / v.minTilePx) * 100))
  }, [])

  // Zoom so the map point under (anchorCssX, anchorCssY) stays put on screen.
  const applyZoom = useCallback(
    (newTilePx, anchorCssX, anchorCssY) => {
      if (!map) return
      const v = viewRef.current
      const { cssW, cssH } = sizeRef.current
      newTilePx = clamp(newTilePx, v.minTilePx, v.maxTilePx)
      const tx = v.originX + anchorCssX / v.tilePx
      const ty = v.originY + anchorCssY / v.tilePx
      let originX = tx - anchorCssX / newTilePx
      let originY = ty - anchorCssY / newTilePx
      originX = clampOriginAxis(originX, cssW / newTilePx, map.size)
      originY = clampOriginAxis(originY, cssH / newTilePx, map.size)
      viewRef.current = { ...v, tilePx: newTilePx, originX, originY }
      reportZoom()
    },
    [map, reportZoom],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !wrap || !map) return

    function measureAndResize(resetView) {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const wrapRect = wrap.getBoundingClientRect()
      const cssW = Math.max(200, Math.floor(wrapRect.width - 40))
      const cssH = Math.max(200, Math.floor(wrapRect.height - 40))
      sizeRef.current = { cssW, cssH }
      canvas.style.width = `${cssW}px`
      canvas.style.height = `${cssH}px`
      canvas.width = Math.round(cssW * dpr)
      canvas.height = Math.round(cssH * dpr)
      const ctx = canvas.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)

      const minTilePx = Math.min(cssW / map.size, cssH / map.size)
      const maxTilePx = Math.min(140, Math.max(minTilePx * 10, 48))

      if (resetView) {
        viewRef.current = {
          tilePx: minTilePx,
          originX: clampOriginAxis(0, cssW / minTilePx, map.size),
          originY: clampOriginAxis(0, cssH / minTilePx, map.size),
          minTilePx,
          maxTilePx,
        }
      } else {
        const v = viewRef.current
        const tilePx = clamp(v.tilePx, minTilePx, maxTilePx)
        viewRef.current = {
          tilePx,
          originX: clampOriginAxis(v.originX, cssW / tilePx, map.size),
          originY: clampOriginAxis(v.originY, cssH / tilePx, map.size),
          minTilePx,
          maxTilePx,
        }
      }
      reportZoom()
    }

    measureAndResize(true)

    // Continuous render loop: redraws every frame using whatever the view
    // refs currently hold, so pan/zoom (mutated directly by the handlers
    // below) show up immediately and the coastline's wave dashes keep
    // flowing even when nothing else is changing.
    let raf = 0
    const startTime = performance.now()
    let lastTime = startTime
    const tick = (now) => {
      const dt = now - lastTime
      lastTime = now
      const sim = simRef.current
      if (sim) {
        stepSimulation(sim, dt)
        if (sim.rabbits.length !== lastReportedCountRef.current) {
          lastReportedCountRef.current = sim.rabbits.length
          setRabbitCount(sim.rabbits.length)
        }
        if (showInsightsRef.current && now - lastInsightsUpdateRef.current >= INSIGHTS_UPDATE_MS) {
          lastInsightsUpdateRef.current = now
          setInsightsData(buildInsightsData(sim))
        }
      }
      draw(now - startTime)
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)

    let resizeTimer = null
    const onResize = () => {
      clearTimeout(resizeTimer)
      resizeTimer = setTimeout(() => measureAndResize(false), 80)
    }

    function onWheel(e) {
      e.preventDefault()
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const factor = Math.exp(-e.deltaY * 0.0015)
      applyZoom(viewRef.current.tilePx * factor, mx, my)
    }

    // A click (place a rabbit / select one) is a pointer down+up with
    // negligible movement in between; anything past CLICK_SLOP_PX counts as
    // a pan drag instead, same gesture either way until release decides.
    const CLICK_SLOP_PX = 4

    function onPointerDown(e) {
      canvas.setPointerCapture(e.pointerId)
      dragRef.current = {
        pointerId: e.pointerId,
        startX: e.clientX,
        startY: e.clientY,
        originX: viewRef.current.originX,
        originY: viewRef.current.originY,
        moved: false,
      }
      canvas.style.cursor = 'grabbing'
    }
    function onPointerMove(e) {
      const d = dragRef.current
      if (!d || d.pointerId !== e.pointerId) return
      const v = viewRef.current
      const { cssW, cssH } = sizeRef.current
      const dxCss = e.clientX - d.startX
      const dyCss = e.clientY - d.startY
      if (Math.abs(dxCss) > CLICK_SLOP_PX || Math.abs(dyCss) > CLICK_SLOP_PX) d.moved = true
      const originX = clampOriginAxis(d.originX - dxCss / v.tilePx, cssW / v.tilePx, map.size)
      const originY = clampOriginAxis(d.originY - dyCss / v.tilePx, cssH / v.tilePx, map.size)
      viewRef.current = { ...v, originX, originY }
    }
    function onCanvasClick(e) {
      const sim = simRef.current
      if (!sim) return
      const rect = canvas.getBoundingClientRect()
      const mx = e.clientX - rect.left
      const my = e.clientY - rect.top
      const v = viewRef.current
      const tileX = v.originX + mx / v.tilePx
      const tileY = v.originY + my / v.tilePx

      if (placingRef.current) {
        const tx = Math.floor(tileX)
        const ty = Math.floor(tileY)
        if (isPlaceable(map, tx, ty)) spawnRabbit(sim, tx, ty)
        return
      }

      let best = null
      let bestDist = 0.6 // tiles - must click reasonably close to a rabbit to select it
      for (const r of sim.rabbits) {
        if (!r.alive) continue
        const d = Math.hypot(r.x + 0.5 - tileX, r.y + 0.5 - tileY)
        if (d < bestDist) {
          bestDist = d
          best = r
        }
      }
      sim.selectedId = best ? best.id : null
    }
    function onPointerUp(e) {
      const d = dragRef.current
      if (!d || d.pointerId !== e.pointerId) return
      dragRef.current = null
      canvas.style.cursor = 'grab'
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch {
        // pointer capture already released - safe to ignore
      }
      if (!d.moved) onCanvasClick(e)
    }

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    // A ResizeObserver on the wrapper (rather than a window 'resize'
    // listener) also catches the wrap shrinking/growing from layout
    // changes that aren't a window resize - e.g. the brains side panel
    // opening/closing - which a window-only listener would miss, leaving
    // the canvas's internal size out of sync with its new CSS size.
    const ro = new ResizeObserver(onResize)
    ro.observe(wrap)
    canvas.style.cursor = 'grab'

    return () => {
      ro.disconnect()
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      clearTimeout(resizeTimer)
      cancelAnimationFrame(raf)
    }
  }, [map, applyZoom, draw, reportZoom])

  const zoomStep = (mult) => {
    const { cssW, cssH } = sizeRef.current
    applyZoom(viewRef.current.tilePx * mult, cssW / 2, cssH / 2)
  }

  const zoomReset = () => {
    if (!map) return
    const v = viewRef.current
    const { cssW, cssH } = sizeRef.current
    viewRef.current = {
      ...v,
      tilePx: v.minTilePx,
      originX: clampOriginAxis(0, cssW / v.minTilePx, map.size),
      originY: clampOriginAxis(0, cssH / v.minTilePx, map.size),
    }
    reportZoom()
  }

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
          {map ? (
            <button
              type="button"
              onClick={togglePlacing}
              className={
                placing
                  ? 'rounded-sm border border-emerald-500 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-400 transition'
                  : 'rounded-sm border border-neutral-700 bg-neutral-950 px-4 py-2 text-sm font-semibold transition hover:border-emerald-500 hover:text-emerald-400'
              }
            >
              🐇 {placing ? 'Click a tile to place…' : 'Spawn rabbit'}
            </button>
          ) : null}
          {map ? (
            <button
              type="button"
              onClick={toggleInsights}
              className={
                showInsights
                  ? 'rounded-sm border border-emerald-500 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-400 transition'
                  : 'rounded-sm border border-neutral-700 bg-neutral-950 px-4 py-2 text-sm font-semibold transition hover:border-emerald-500 hover:text-emerald-400'
              }
            >
              🧠 Brains
            </button>
          ) : null}
        </div>
        {map ? (
          <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-400">
            <span>
              Rabbits <b className="font-mono text-neutral-100 tabular-nums">{rabbitCount}</b>
            </span>
            <span>
              Size <b className="font-mono text-neutral-100 tabular-nums">{map.size}×{map.size}</b>
            </span>
            <span>
              Lakes <b className="font-mono text-neutral-100 tabular-nums">{map.lakeCount}</b>
            </span>
            <span>
              Seed <b className="font-mono text-neutral-100 tabular-nums">{map.seed}</b>
            </span>
            <div className="flex items-center gap-1 border-l border-neutral-800 pl-4">
              <button
                type="button"
                onClick={() => zoomStep(1 / 1.4)}
                aria-label="Zoom out"
                className="flex h-7 w-7 items-center justify-center rounded-sm border border-neutral-700 bg-neutral-950 font-semibold text-neutral-200 transition hover:border-emerald-500 hover:text-emerald-400"
              >
                −
              </button>
              <span className="w-12 text-center font-mono text-neutral-100 tabular-nums">{zoomPct}%</span>
              <button
                type="button"
                onClick={() => zoomStep(1.4)}
                aria-label="Zoom in"
                className="flex h-7 w-7 items-center justify-center rounded-sm border border-neutral-700 bg-neutral-950 font-semibold text-neutral-200 transition hover:border-emerald-500 hover:text-emerald-400"
              >
                +
              </button>
              <button
                type="button"
                onClick={zoomReset}
                className="ml-1 rounded-sm border border-neutral-700 bg-neutral-950 px-3 py-1 text-xs font-semibold transition hover:border-emerald-500 hover:text-emerald-400"
              >
                Fit
              </button>
            </div>
          </div>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1">
        <div ref={wrapRef} className="relative flex min-h-0 flex-1 items-center justify-center p-5">
          <canvas ref={canvasRef} className="touch-none rounded-sm bg-[#16324a] shadow-2xl shadow-black/40" />
          <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] text-neutral-500">
            {placing ? 'Click a tile to place a rabbit' : 'Scroll to zoom · Drag to pan · Click a rabbit to inspect it'}
          </p>
        </div>
        {showInsights ? (
          <RabbitInsights
            selected={insightsData?.selected ?? null}
            history={insightsData?.history ?? []}
            population={insightsData?.population ?? rabbitCount}
            generationRange={insightsData?.generationRange ?? null}
            onClose={toggleInsights}
          />
        ) : null}
      </div>
    </main>
  )
}
