import { useCallback, useEffect, useRef, useState } from 'react'
import { drawMap } from './mapgen.js'
import { createSimulation, isPlaceable, selectCreature, spawnFox, spawnRabbit, stepSimulation } from '../sim/simulation.js'
import { drawSimulation } from '../sim/render.js'
import { computeTraits, describeEnergyEffects, describeTraits } from '../sim/brainInsight.js'
import RabbitInsights from './RabbitInsights.jsx'
import FoxInsights from './FoxInsights.jsx'
import PopulationPanel from './PopulationPanel.jsx'
import SpawnPalette from './SpawnPalette.jsx'

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

function generationRangeOf(creatures) {
  if (!creatures.length) return null
  let minGen = Infinity
  let maxGen = -Infinity
  for (const c of creatures) {
    if (c.generation < minGen) minGen = c.generation
    if (c.generation > maxGen) maxGen = c.generation
  }
  return [minGen, maxGen]
}

/** Snapshot the sim into plain data for the inspector/population panels: the
 * selected creature (rabbit *or* fox) plus both populations' trend history.
 * Plain data rather than live entity refs, so React re-renders off a stable
 * value instead of an object the sim loop keeps mutating underneath it. */
function buildInsightsData(sim) {
  const rabbits = sim.rabbits
  const foxes = sim.foxes

  let selected = null
  if (sim.selectedId != null && sim.selectedKind === 'rabbit') {
    const rabbit = rabbits.find((r) => r.id === sim.selectedId)
    if (rabbit) {
      const traits = computeTraits(rabbit.brain)
      selected = {
        kind: 'rabbit',
        id: rabbit.id,
        generation: rabbit.generation,
        energy: rabbit.energy,
        alive: rabbit.alive,
        running: rabbit.running,
        resting: rabbit.resting,
        searching: rabbit.searching,
        fleeing: rabbit.fleeing,
        gestating: rabbit.gestating,
        brain: rabbit.brain,
        traits,
        blurb: describeTraits(traits),
        energyEffects: describeEnergyEffects(traits),
      }
    }
  } else if (sim.selectedId != null && sim.selectedKind === 'fox') {
    const fox = foxes.find((f) => f.id === sim.selectedId)
    if (fox) {
      selected = {
        kind: 'fox',
        id: fox.id,
        generation: fox.generation,
        energy: fox.energy,
        alive: fox.alive,
        genes: fox.genes,
        hunting: fox.hunting,
        sprinting: fox.sprinting,
        packing: fox.packing,
        feeding: fox.feedingRemaining > 0,
        gestating: fox.gestating,
        kills: fox.kills,
      }
    }
  }

  return {
    selected,
    history: sim.traitHistory,
    population: rabbits.length,
    foxPopulation: foxes.length,
    kills: sim.kills,
    generationRange: generationRangeOf(rabbits),
    foxGenerationRange: generationRangeOf(foxes),
  }
}

const SPAWN_SEARCH_RADIUS = 6

/** Up to `count` placeable tiles, ring by ring outward from (tx, ty) - so a
 * x10 drop lands as a little colony rather than ten creatures stacked on one
 * square. Falls short (or returns nothing) if the area really is all water. */
function placeableTilesNear(map, tx, ty, count) {
  const tiles = []
  for (let radius = 0; radius <= SPAWN_SEARCH_RADIUS && tiles.length < count; radius++) {
    for (let dy = -radius; dy <= radius && tiles.length < count; dy++) {
      for (let dx = -radius; dx <= radius && tiles.length < count; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue
        if (isPlaceable(map, tx + dx, ty + dy)) tiles.push([tx + dx, ty + dy])
      }
    }
  }
  return tiles
}

/** Random placeable tiles anywhere on the island, for the palette's scatter
 * button. Rejection sampling with a bounded attempt count, since the ratio of
 * land to ocean varies wildly between generated maps. */
function scatterTiles(map, count) {
  const tiles = []
  for (let attempts = 0; attempts < count * 200 && tiles.length < count; attempts++) {
    const x = Math.floor(Math.random() * map.size)
    const y = Math.floor(Math.random() * map.size)
    if (isPlaceable(map, x, y)) tiles.push([x, y])
  }
  return tiles
}

function spawnAt(sim, species, tiles) {
  for (const [x, y] of tiles) {
    if (species === 'fox') spawnFox(sim, x, y)
    else spawnRabbit(sim, x, y)
  }
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
  // Spawn palette state. The ref mirrors it because the canvas pointer
  // handlers are bound once inside the render-loop effect and would
  // otherwise close over a stale species/count.
  const spawnRef = useRef({ open: false, species: 'rabbit', count: 1 })
  const [spawn, setSpawn] = useState({ open: false, species: 'rabbit', count: 1 })
  const [counts, setCounts] = useState({ rabbits: 0, foxes: 0, kills: 0 })
  const lastReportedCountsRef = useRef({ rabbits: 0, foxes: 0, kills: 0 })

  // "Brains" and "Population" panels: translate the sim's raw state into
  // plain-language traits/trends (see sim/brainInsight.js). Both are
  // independent floating overlays (see render below) rather than layout
  // siblings of the map, and both share one snapshot - built on a throttle
  // from the sim ref rather than every frame, since it's cheap but there's
  // no reason to recompute 60x/sec for a text panel - taken whenever either
  // one is open.
  const showInsightsRef = useRef(false)
  const [showInsights, setShowInsights] = useState(false)
  const showPopulationRef = useRef(false)
  const [showPopulation, setShowPopulation] = useState(false)
  const [insightsData, setInsightsData] = useState(null)
  const lastInsightsUpdateRef = useRef(0)
  const INSIGHTS_UPDATE_MS = 400

  useEffect(() => {
    simRef.current = map ? createSimulation(map) : null
    lastReportedCountsRef.current = { rabbits: 0, foxes: 0, kills: 0 }
    setCounts({ rabbits: 0, foxes: 0, kills: 0 })
    setInsightsData(null)
  }, [map])

  const updateSpawn = useCallback((patch) => {
    spawnRef.current = { ...spawnRef.current, ...patch }
    setSpawn(spawnRef.current)
  }, [])

  const toggleSpawnPalette = useCallback(() => {
    updateSpawn({ open: !spawnRef.current.open })
  }, [updateSpawn])

  const scatterSpawn = useCallback(() => {
    const sim = simRef.current
    if (!sim || !map) return
    const { species, count } = spawnRef.current
    spawnAt(sim, species, scatterTiles(map, count))
  }, [map])

  const toggleInsights = useCallback(() => {
    showInsightsRef.current = !showInsightsRef.current
    setShowInsights(showInsightsRef.current)
  }, [])

  const togglePopulation = useCallback(() => {
    showPopulationRef.current = !showPopulationRef.current
    setShowPopulation(showPopulationRef.current)
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
        const last = lastReportedCountsRef.current
        if (sim.rabbits.length !== last.rabbits || sim.foxes.length !== last.foxes || sim.kills !== last.kills) {
          lastReportedCountsRef.current = { rabbits: sim.rabbits.length, foxes: sim.foxes.length, kills: sim.kills }
          setCounts(lastReportedCountsRef.current)
        }
        if ((showInsightsRef.current || showPopulationRef.current) && now - lastInsightsUpdateRef.current >= INSIGHTS_UPDATE_MS) {
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

      // With the spawn palette open the map is a placement surface; closed,
      // clicks select a creature to inspect.
      if (spawnRef.current.open) {
        const tx = Math.floor(tileX)
        const ty = Math.floor(tileY)
        const { species, count } = spawnRef.current
        spawnAt(sim, species, placeableTilesNear(map, tx, ty, count))
        return
      }

      let best = null
      let bestKind = null
      let bestDist = 0.7 // tiles - must click reasonably close to something to select it
      for (const [kind, list] of [['rabbit', sim.rabbits], ['fox', sim.foxes]]) {
        for (const c of list) {
          if (!c.alive) continue
          const d = Math.hypot(c.x + 0.5 - tileX, c.y + 0.5 - tileY)
          if (d < bestDist) {
            bestDist = d
            best = c
            bestKind = kind
          }
        }
      }
      selectCreature(sim, bestKind, best ? best.id : null)
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
    // changes that aren't a window resize (e.g. the toolbar wrapping to a
    // second line on a narrow viewport), which a window-only listener
    // would miss, leaving the canvas's internal size out of sync with its
    // new CSS size. The brains/population panels are floating overlays
    // (absolutely positioned over the canvas, not layout siblings of it)
    // specifically so opening/closing them never triggers this at all -
    // the map stays put and doesn't jump or re-clamp its pan/zoom.
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
              onClick={toggleSpawnPalette}
              className={
                spawn.open
                  ? 'rounded-sm border border-emerald-500 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-400 transition'
                  : 'rounded-sm border border-neutral-700 bg-neutral-950 px-4 py-2 text-sm font-semibold transition hover:border-emerald-500 hover:text-emerald-400'
              }
            >
              🐾 {spawn.open ? 'Click a tile to place…' : 'Spawn creatures'}
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
              🔍 Inspect
            </button>
          ) : null}
          {map ? (
            <button
              type="button"
              onClick={togglePopulation}
              className={
                showPopulation
                  ? 'rounded-sm border border-emerald-500 bg-emerald-500/20 px-3 py-1.5 text-xs font-semibold text-emerald-400 transition'
                  : 'rounded-sm border border-neutral-700 bg-neutral-950 px-3 py-1.5 text-xs font-semibold transition hover:border-emerald-500 hover:text-emerald-400'
              }
            >
              📈 Population
            </button>
          ) : null}
        </div>
        {map ? (
          <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-400">
            <span>
              🐇 <b className="font-mono text-neutral-100 tabular-nums">{counts.rabbits}</b>
            </span>
            <span>
              🦊 <b className="font-mono text-neutral-100 tabular-nums">{counts.foxes}</b>
            </span>
            <span>
              Caught <b className="font-mono text-red-400 tabular-nums">{counts.kills}</b>
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
      <div ref={wrapRef} className="relative flex min-h-0 flex-1 items-center justify-center p-5">
        <canvas ref={canvasRef} className="touch-none rounded-sm bg-[#16324a] shadow-2xl shadow-black/40" />
        <p className="pointer-events-none absolute bottom-3 left-1/2 -translate-x-1/2 text-[11px] text-neutral-500">
          {spawn.open
            ? `Click a tile to place ${spawn.count} ${spawn.species}${spawn.count === 1 ? '' : spawn.species === 'fox' ? 'es' : 's'}`
            : 'Scroll to zoom · Drag to pan · Click a creature to inspect it'}
        </p>
        {/* Overlaid on top of the map (not laid out beside it) so opening
            either panel never resizes or shifts the canvas underneath. */}
        {showPopulation ? (
          <div className="pointer-events-none absolute top-3 left-3 max-h-[calc(100%-1.5rem)]">
            <PopulationPanel
              population={insightsData?.population ?? counts.rabbits}
              foxPopulation={insightsData?.foxPopulation ?? counts.foxes}
              kills={insightsData?.kills ?? counts.kills}
              history={insightsData?.history ?? []}
              generationRange={insightsData?.generationRange ?? null}
              foxGenerationRange={insightsData?.foxGenerationRange ?? null}
              onClose={togglePopulation}
            />
          </div>
        ) : null}
        {/* One inspector slot, whose contents follow whatever is selected -
            a fox's genome and a rabbit's neural net need genuinely
            different panels (see FoxInsights.jsx). */}
        {showInsights ? (
          <div className="pointer-events-none absolute top-3 right-3 max-h-[calc(100%-1.5rem)]">
            {insightsData?.selected?.kind === 'fox' ? (
              <FoxInsights selected={insightsData.selected} onClose={toggleInsights} />
            ) : (
              <RabbitInsights selected={insightsData?.selected ?? null} onClose={toggleInsights} />
            )}
          </div>
        ) : null}
        {spawn.open ? (
          <div className="pointer-events-none absolute bottom-10 left-3 max-h-[calc(100%-1.5rem)]">
            <SpawnPalette
              species={spawn.species}
              count={spawn.count}
              onSpeciesChange={(species) => updateSpawn({ species })}
              onCountChange={(count) => updateSpawn({ count })}
              onScatter={scatterSpawn}
              onClose={toggleSpawnPalette}
            />
          </div>
        ) : null}
      </div>
    </main>
  )
}
