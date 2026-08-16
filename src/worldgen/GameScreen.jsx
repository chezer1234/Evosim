import { useCallback, useEffect, useRef, useState } from 'react'
import { drawMap } from './mapgen.js'
import { createSimulation, isPlaceable, selectCreature, spawnFox, spawnRabbit, stepSimulation } from '../sim/simulation.js'
import { drawSimulation } from '../sim/render.js'
import { computeTraits, describeEnergyEffects, describeTraits } from '../sim/brainInsight.js'
import { describeRabbitSenses } from '../sim/rabbit.js'
import RabbitInsights from './RabbitInsights.jsx'
import FoxInsights from './FoxInsights.jsx'
import PopulationPanel from './PopulationPanel.jsx'
import SpawnPalette from './SpawnPalette.jsx'
import { useIsCompact, useIsTouch, usePanelPlacement } from './useIsCompact.js'
import {
  clampOriginAxis,
  clickSlopPx,
  pannedView,
  pinchStart,
  pinchedView,
  selectRadiusTiles,
  tileAt,
  zoomedView,
} from './viewport.js'

// Discrete speed multipliers rather than a free slider - a handful of
// one-click steps is easier to reach for and to "return to normal" from
// (see issue #10) than dragging a range back to exactly 1x.
const SPEED_OPTIONS = [1, 2, 4, 8]

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
        genes: rabbit.genes,
        senseNotes: describeRabbitSenses(rabbit.genes),
        sheltered: rabbit.burrowId != null,
        calling: rabbit.alarmUntil > sim.clock,
        alarmHeard: rabbit.alarmHeard,
        heardOnly: rabbit.heardOnly,
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
    burrows: sim.burrows.length,
    sheltered: rabbits.filter((r) => r.burrowId != null).length,
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

const TOOLBAR_BUTTON = 'rounded-sm border border-neutral-700 bg-neutral-950 px-4 py-2 text-sm font-semibold transition hover:border-emerald-500 hover:text-emerald-400'
const TOOLBAR_BUTTON_ON = 'rounded-sm border border-emerald-500 bg-emerald-500/20 px-4 py-2 text-sm font-semibold text-emerald-400 transition'
const ICON_BUTTON = 'flex h-7 w-7 items-center justify-center rounded-sm border border-neutral-700 bg-neutral-950 font-semibold text-neutral-200 transition hover:border-emerald-500 hover:text-emerald-400'
const ICON_BUTTON_ON = 'flex h-7 w-7 items-center justify-center rounded-sm border border-emerald-500 bg-emerald-500/20 font-semibold text-emerald-400 transition'

// Compact chrome. Every tappable thing is at least 44px on its short edge
// (the standard finger target); the top row is icon-only and the labelled
// controls live in a bottom bar, where a thumb can actually reach them.
const TOUCH_ICON = 'flex h-11 w-11 shrink-0 items-center justify-center rounded-md border border-neutral-800 bg-neutral-950 text-base text-neutral-200 transition active:border-emerald-500 active:text-emerald-400'
const TAB_BUTTON = 'flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 rounded-md border px-1 py-1.5 text-[10px] font-semibold transition'
const TAB_IDLE = 'border-neutral-800 bg-neutral-950 text-neutral-300'
const TAB_ON = 'border-emerald-500 bg-emerald-500/20 text-emerald-300'

// Slots the panels are dropped into. Each one pins *both* edges along its
// long axis (rather than one edge plus a percentage max-height): a panel's
// own `max-h-full` only means anything when its parent's height is definite,
// and an absolutely positioned box with one edge pinned has an auto height,
// against which a percentage resolves to nothing and the panel spills past
// the map. Pinning both edges plus `flex-col` gives each panel "as tall as
// its content, up to the space available, then scroll".
const SLOTS = {
  // Desktop: one panel per corner, each independent of the others.
  corner: {
    population: 'pointer-events-none absolute top-3 bottom-3 left-3 flex w-64 flex-col',
    inspector: 'pointer-events-none absolute top-3 right-3 bottom-3 flex w-80 flex-col',
    // Stops above the hint line at the bottom of the map rather than over it.
    spawn: 'pointer-events-none absolute top-3 bottom-10 left-3 flex w-72 flex-col justify-end',
  },
  // Phone upright: a bottom sheet. `top-[30%]` both leaves the top third of
  // the map visible behind an open panel and caps how tall it can grow; the
  // spawn palette leaves more, since with it open the map is something you
  // have to be able to aim at.
  sheet: {
    population: 'pointer-events-none absolute inset-x-1.5 top-[30%] bottom-1.5 flex flex-col justify-end',
    inspector: 'pointer-events-none absolute inset-x-1.5 top-[30%] bottom-1.5 flex flex-col justify-end',
    spawn: 'pointer-events-none absolute inset-x-1.5 top-[38%] bottom-1.5 flex flex-col justify-end',
  },
  // Phone sideways: down the right edge, because the map area there is only
  // a couple of hundred pixels tall but plenty wide. The hint moves out of
  // the centre to match (see HINT_CLASS) - centred, it would end up behind
  // the panel.
  side: {
    population: 'pointer-events-none absolute top-1.5 right-1.5 bottom-1.5 flex w-[min(20rem,45%)] flex-col',
    inspector: 'pointer-events-none absolute top-1.5 right-1.5 bottom-1.5 flex w-[min(20rem,45%)] flex-col',
    spawn: 'pointer-events-none absolute top-1.5 right-1.5 bottom-1.5 flex w-[min(18rem,42%)] flex-col',
  },
}

// The one-line "how do I drive this" note over the map. On a compact screen
// it gets a background, because it sits over the island rather than in the
// margin below it.
const HINT_PILL = 'pointer-events-none absolute top-2 max-w-[95%] rounded-full bg-neutral-950/80 px-3 py-1 text-center text-[11px] whitespace-nowrap text-neutral-300'
const HINT_CLASS = {
  corner: 'pointer-events-none absolute bottom-3 left-1/2 max-w-[95%] -translate-x-1/2 text-center text-[11px] text-neutral-500',
  sheet: `${HINT_PILL} left-1/2 -translate-x-1/2`,
  side: `${HINT_PILL} left-2`,
}

export default function GameScreen({ map, onBack, onNewMap, onOpenSettings }) {
  const canvasRef = useRef(null)
  const wrapRef = useRef(null)
  const viewRef = useRef({ tilePx: 1, originX: 0, originY: 0, minTilePx: 1, maxTilePx: 1 })
  const sizeRef = useRef({ cssW: 0, cssH: 0 })
  const dragRef = useRef(null)
  // Every pointer currently down on the canvas, keyed by pointerId - one
  // entry is a pan drag, two are a pinch. Kept in a ref (not state) because
  // the handlers below run outside React's render cycle.
  const pointersRef = useRef(new Map())
  const pinchRef = useRef(null)
  const [zoomPct, setZoomPct] = useState(100)

  const compact = useIsCompact()
  const touch = useIsTouch()
  const placement = usePanelPlacement()
  const slots = SLOTS[placement]
  // The panel toggles below are bound once inside the render-loop effect and
  // in callbacks that shouldn't churn on every layout change, so the compact
  // flag is mirrored into a ref the same way the sim state is.
  const compactRef = useRef(compact)
  compactRef.current = compact

  // Simulation speed: multiplies the dt handed to stepSimulation each frame,
  // so "2x" just means "advance the sim twice as far this frame" rather than
  // running the render loop itself any faster. Paused stops stepping
  // entirely (rendering - and the coastline wave animation - keeps going).
  // Lives in a ref for the same reason the sim does: read every frame by the
  // loop below without re-render churn.
  const speedRef = useRef(1)
  const [speed, setSpeed] = useState(1)
  const pausedRef = useRef(false)
  const [paused, setPaused] = useState(false)

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
  // plain-language traits/trends (see sim/brainInsight.js). On a roomy
  // screen both are independent floating overlays (see render below) rather
  // than layout siblings of the map, and either can be open on its own. On a
  // compact screen they become bottom sheets, where there isn't room for two
  // at once, so opening one closes the others (see closeOthers). Both share
  // one snapshot - built on a throttle from the sim ref rather than every
  // frame, since it's cheap but there's no reason to recompute 60x/sec for a
  // text panel - taken whenever either one is open.
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
    pausedRef.current = false
    setPaused(false)
  }, [map])

  const setSpawnOpen = useCallback((open) => {
    spawnRef.current = { ...spawnRef.current, open }
    setSpawn(spawnRef.current)
  }, [])

  const setInsightsOpen = useCallback((open) => {
    showInsightsRef.current = open
    setShowInsights(open)
  }, [])

  const setPopulationOpen = useCallback((open) => {
    showPopulationRef.current = open
    setShowPopulation(open)
  }, [])

  /** On a compact screen the panels are full-width bottom sheets that would
   * stack on top of each other, so only one may be open at a time. On a
   * roomy screen they're corner overlays and stay independent. */
  const closeOthers = useCallback(
    (keep) => {
      if (!compactRef.current) return
      if (keep !== 'spawn') setSpawnOpen(false)
      if (keep !== 'insights') setInsightsOpen(false)
      if (keep !== 'population') setPopulationOpen(false)
    },
    [setSpawnOpen, setInsightsOpen, setPopulationOpen],
  )

  const updateSpawn = useCallback((patch) => {
    spawnRef.current = { ...spawnRef.current, ...patch }
    setSpawn(spawnRef.current)
  }, [])

  const toggleSpawnPalette = useCallback(() => {
    const open = !spawnRef.current.open
    if (open) closeOthers('spawn')
    setSpawnOpen(open)
  }, [closeOthers, setSpawnOpen])

  const scatterSpawn = useCallback(() => {
    const sim = simRef.current
    if (!sim || !map) return
    const { species, count } = spawnRef.current
    spawnAt(sim, species, scatterTiles(map, count))
  }, [map])

  const toggleInsights = useCallback(() => {
    const open = !showInsightsRef.current
    if (open) closeOthers('insights')
    setInsightsOpen(open)
  }, [closeOthers, setInsightsOpen])

  const togglePopulation = useCallback(() => {
    const open = !showPopulationRef.current
    if (open) closeOthers('population')
    setPopulationOpen(open)
  }, [closeOthers, setPopulationOpen])

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

  const changeSpeed = useCallback((mult) => {
    speedRef.current = mult
    setSpeed(mult)
  }, [])

  // The compact bar has no room for four speed buttons, so one button cycles
  // through them and wears the current multiplier as its label.
  const cycleSpeed = useCallback(() => {
    const next = SPEED_OPTIONS[(SPEED_OPTIONS.indexOf(speedRef.current) + 1) % SPEED_OPTIONS.length]
    speedRef.current = next
    setSpeed(next)
  }, [])

  const togglePaused = useCallback(() => {
    pausedRef.current = !pausedRef.current
    setPaused(pausedRef.current)
  }, [])

  const reportZoom = useCallback(() => {
    const v = viewRef.current
    setZoomPct(Math.round((v.tilePx / v.minTilePx) * 100))
  }, [])

  // Zoom so the map point under (anchorCssX, anchorCssY) stays put on screen.
  const applyZoom = useCallback(
    (newTilePx, anchorCssX, anchorCssY) => {
      if (!map) return
      viewRef.current = zoomedView(viewRef.current, sizeRef.current, map.size, newTilePx, anchorCssX, anchorCssY)
      reportZoom()
    },
    [map, reportZoom],
  )

  useEffect(() => {
    const canvas = canvasRef.current
    const wrap = wrapRef.current
    if (!canvas || !map) return

    function measureAndResize(resetView) {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const wrapRect = wrap.getBoundingClientRect()
      // Read the padding rather than hardcoding it: the wrapper's padding is
      // tighter on a phone than on a desktop, and a stale constant here
      // would leave the canvas's backing store out of sync with its CSS box.
      const style = window.getComputedStyle(wrap)
      const padX = parseFloat(style.paddingLeft) + parseFloat(style.paddingRight)
      const padY = parseFloat(style.paddingTop) + parseFloat(style.paddingBottom)
      const cssW = Math.max(160, Math.floor(wrapRect.width - padX))
      const cssH = Math.max(160, Math.floor(wrapRect.height - padY))
      const prevSize = sizeRef.current
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
        // Keep the map point at the center of the canvas centered across the
        // resize, so rotating a phone (or opening the on-screen keyboard)
        // doesn't fling the view off to a corner.
        const v = viewRef.current
        const [centerTileX, centerTileY] = tileAt(v, prevSize.cssW / 2, prevSize.cssH / 2)
        const tilePx = Math.min(maxTilePx, Math.max(minTilePx, v.tilePx))
        viewRef.current = {
          tilePx,
          originX: clampOriginAxis(centerTileX - cssW / 2 / tilePx, cssW / tilePx, map.size),
          originY: clampOriginAxis(centerTileY - cssH / 2 / tilePx, cssH / tilePx, map.size),
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
        if (!pausedRef.current) {
          // Cap the per-frame sim step so a stalled tab/slow frame (dt spikes
          // after e.g. an alt-tab) can't suddenly dump minutes of simulated
          // time into one step - clamp first, then apply the speed multiplier
          // on top of the clamped value.
          stepSimulation(sim, Math.min(dt, 250) * speedRef.current)
        }
        // Outside the pause check: pausing to set a scenario up is exactly
        // when you spawn creatures and tap one to read it, and neither the
        // counters nor the panels should sit stale until you press play.
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

    function canvasPoint(e) {
      const rect = canvas.getBoundingClientRect()
      return { x: e.clientX - rect.left, y: e.clientY - rect.top, clientX: e.clientX, clientY: e.clientY }
    }

    function onWheel(e) {
      e.preventDefault()
      const p = canvasPoint(e)
      const factor = Math.exp(-e.deltaY * 0.0015)
      applyZoom(viewRef.current.tilePx * factor, p.x, p.y)
    }

    function beginDrag(pointerId, point) {
      dragRef.current = {
        pointerId,
        startX: point.clientX,
        startY: point.clientY,
        originX: viewRef.current.originX,
        originY: viewRef.current.originY,
        moved: false,
      }
    }

    // One finger pans (and, if it barely moves, taps to select/place); a
    // second finger turns the gesture into a pinch, which zooms and pans
    // together until a finger lifts. Issue #7: there was no way to zoom at
    // all on a touch device before this - the canvas only listened to wheel
    // events.
    function onPointerDown(e) {
      canvas.setPointerCapture(e.pointerId)
      const point = canvasPoint(e)
      pointersRef.current.set(e.pointerId, point)

      const points = [...pointersRef.current.values()]
      if (points.length >= 2) {
        // Promoting to a pinch cancels the drag: whatever the first finger
        // was doing, this gesture is no longer a tap.
        dragRef.current = null
        pinchRef.current = pinchStart(viewRef.current, points[0], points[1])
      } else {
        beginDrag(e.pointerId, point)
      }
      canvas.style.cursor = 'grabbing'
    }

    function onPointerMove(e) {
      const tracked = pointersRef.current.get(e.pointerId)
      if (tracked) pointersRef.current.set(e.pointerId, canvasPoint(e))

      const points = [...pointersRef.current.values()]
      if (pinchRef.current && points.length >= 2) {
        viewRef.current = pinchedView(viewRef.current, sizeRef.current, map.size, pinchRef.current, points[0], points[1])
        reportZoom()
        return
      }

      const d = dragRef.current
      if (!d || d.pointerId !== e.pointerId) return
      const dxCss = e.clientX - d.startX
      const dyCss = e.clientY - d.startY
      const slop = clickSlopPx(e.pointerType)
      if (Math.abs(dxCss) > slop || Math.abs(dyCss) > slop) d.moved = true
      viewRef.current = pannedView(viewRef.current, sizeRef.current, map.size, d.originX, d.originY, dxCss, dyCss)
    }

    function onCanvasClick(e) {
      const sim = simRef.current
      if (!sim) return
      const p = canvasPoint(e)
      const v = viewRef.current
      const [tileX, tileY] = tileAt(v, p.x, p.y)

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
      // Must tap reasonably close to something to select it - a fingertip
      // gets a wider radius than a mouse pointer (see selectRadiusTiles).
      let bestDist = selectRadiusTiles(e.pointerType, v.tilePx)
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
      // On touch there's no hover, so a tap that lands on a creature should
      // also *show* you what it selected rather than silently highlighting
      // something behind a closed panel.
      if (best && compactRef.current && !showInsightsRef.current) {
        closeOthers('insights')
        setInsightsOpen(true)
        setInsightsData(buildInsightsData(sim))
      }
    }

    function onPointerUp(e) {
      pointersRef.current.delete(e.pointerId)
      try {
        canvas.releasePointerCapture(e.pointerId)
      } catch {
        // pointer capture already released - safe to ignore
      }

      if (pinchRef.current) {
        pinchRef.current = null
        const rest = [...pointersRef.current.entries()]
        if (rest.length === 1) {
          // One finger left after a pinch: carry on panning from where it
          // currently is, but pre-marked as moved so lifting it doesn't
          // register as a tap on whatever it happens to be resting over.
          const [id, point] = rest[0]
          beginDrag(id, point)
          dragRef.current.moved = true
        } else if (rest.length >= 2) {
          pinchRef.current = pinchStart(viewRef.current, rest[0][1], rest[1][1])
        }
        canvas.style.cursor = pointersRef.current.size ? 'grabbing' : 'grab'
        return
      }

      const d = dragRef.current
      if (!d || d.pointerId !== e.pointerId) return
      dragRef.current = null
      canvas.style.cursor = 'grab'
      if (!d.moved) onCanvasClick(e)
    }

    // iOS Safari still runs its own page-level pinch zoom on two fingers even
    // where `touch-action: none` stops the standard path, which would zoom
    // the whole UI instead of the map. These non-standard events are the
    // only way to opt out of it.
    const preventGesture = (e) => e.preventDefault()

    canvas.addEventListener('wheel', onWheel, { passive: false })
    canvas.addEventListener('pointerdown', onPointerDown)
    canvas.addEventListener('pointermove', onPointerMove)
    canvas.addEventListener('pointerup', onPointerUp)
    canvas.addEventListener('pointercancel', onPointerUp)
    canvas.addEventListener('gesturestart', preventGesture)
    canvas.addEventListener('gesturechange', preventGesture)
    canvas.addEventListener('gestureend', preventGesture)
    // A ResizeObserver on the wrapper (rather than a window 'resize'
    // listener) also catches the wrap shrinking/growing from layout
    // changes that aren't a window resize (e.g. the toolbar wrapping to a
    // second line on a narrow viewport, or switching to the compact
    // layout), which a window-only listener would miss, leaving the
    // canvas's internal size out of sync with its new CSS size. The
    // brains/population panels are floating overlays (absolutely positioned
    // over the canvas, not layout siblings of it) specifically so
    // opening/closing them never triggers this at all - the map stays put
    // and doesn't jump or re-clamp its pan/zoom.
    const ro = new ResizeObserver(onResize)
    ro.observe(wrap)
    canvas.style.cursor = 'grab'

    const pointers = pointersRef.current
    return () => {
      ro.disconnect()
      canvas.removeEventListener('wheel', onWheel)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      canvas.removeEventListener('gesturestart', preventGesture)
      canvas.removeEventListener('gesturechange', preventGesture)
      canvas.removeEventListener('gestureend', preventGesture)
      clearTimeout(resizeTimer)
      cancelAnimationFrame(raf)
      pointers.clear()
      pinchRef.current = null
      dragRef.current = null
    }
  }, [map, applyZoom, draw, reportZoom, closeOthers, setInsightsOpen])

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

  const hint = spawn.open
    ? `${touch ? 'Tap' : 'Click'} a tile to place ${spawn.count} ${spawn.species}${spawn.count === 1 ? '' : spawn.species === 'fox' ? 'es' : 's'}`
    : touch
      ? 'Pinch to zoom · Tap a creature'
      : 'Scroll to zoom · Drag to pan · Click a creature to inspect it'

  // On a compact screen the hint sits over the map itself, so it retires
  // after a few seconds rather than permanently covering a strip of island.
  // It comes back whenever it has something new to say (a new map, or spawn
  // mode turning the map into a placement surface).
  const [hintVisible, setHintVisible] = useState(true)
  useEffect(() => {
    setHintVisible(true)
    if (!compact) return
    const timer = setTimeout(() => setHintVisible(false), 6000)
    return () => clearTimeout(timer)
  }, [compact, map, spawn.open])

  const stats = map ? (
    <>
      <span>
        🐇 <b className="font-mono text-neutral-100 tabular-nums">{counts.rabbits}</b>
      </span>
      <span>
        🦊 <b className="font-mono text-neutral-100 tabular-nums">{counts.foxes}</b>
      </span>
      <span>
        {compact ? '🍽' : 'Caught'} <b className="font-mono text-red-400 tabular-nums">{counts.kills}</b>
      </span>
    </>
  ) : null

  // Two chrome layouts over one shared map area. The compact one splits its
  // controls between a slim icon row at the top and a thumb-height tab bar at
  // the bottom, because a phone can't fit the desktop toolbar without the
  // island disappearing underneath it (issue #7).
  return (
    <main className="flex min-h-svh flex-col overscroll-none bg-neutral-950 text-neutral-100">
      {compact ? (
        <div className="safe-x flex items-center gap-2 border-b border-neutral-800 bg-neutral-900 px-2 py-2">
          <button type="button" onClick={onBack} aria-label="Menu" className={TOUCH_ICON}>
            ←
          </button>
          <button type="button" onClick={onNewMap} aria-label="New map" className={TOUCH_ICON}>
            ⟳
          </button>
          <button type="button" onClick={onOpenSettings} aria-label="Settings" className={TOUCH_ICON}>
            ⚙
          </button>
          <div className="ml-auto flex items-center gap-3 overflow-x-auto text-xs whitespace-nowrap text-neutral-400">
            {stats}
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap items-center justify-between gap-4 border-b border-neutral-800 bg-neutral-900 px-4 py-3">
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={onBack} className={TOOLBAR_BUTTON}>
              ← Menu
            </button>
            <button type="button" onClick={onNewMap} className={TOOLBAR_BUTTON}>
              ⟳ New map
            </button>
            <button type="button" onClick={onOpenSettings} className={TOOLBAR_BUTTON}>
              ⚙ Settings
            </button>
            {map ? (
              <button type="button" onClick={toggleSpawnPalette} className={spawn.open ? TOOLBAR_BUTTON_ON : TOOLBAR_BUTTON}>
                🐾 {spawn.open ? 'Click a tile to place…' : 'Spawn creatures'}
              </button>
            ) : null}
            {map ? (
              <button type="button" onClick={toggleInsights} className={showInsights ? TOOLBAR_BUTTON_ON : TOOLBAR_BUTTON}>
                🔍 Inspect
              </button>
            ) : null}
            {map ? (
              <button type="button" onClick={togglePopulation} className={showPopulation ? TOOLBAR_BUTTON_ON : TOOLBAR_BUTTON}>
                📈 Population
              </button>
            ) : null}
          </div>
          {map ? (
            <div className="flex flex-wrap items-center gap-4 text-xs text-neutral-400">
              {stats}
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
                  onClick={togglePaused}
                  aria-label={paused ? 'Resume' : 'Pause'}
                  className={paused ? ICON_BUTTON_ON : ICON_BUTTON}
                >
                  {paused ? '▶' : '⏸'}
                </button>
                {SPEED_OPTIONS.map((mult) => (
                  <button
                    key={mult}
                    type="button"
                    onClick={() => changeSpeed(mult)}
                    aria-label={`${mult}x speed`}
                    className={
                      speed === mult
                        ? 'h-7 min-w-7 rounded-sm border border-emerald-500 bg-emerald-500/20 px-1.5 font-mono text-xs font-semibold text-emerald-400 transition'
                        : 'h-7 min-w-7 rounded-sm border border-neutral-700 bg-neutral-950 px-1.5 font-mono text-xs font-semibold text-neutral-200 transition hover:border-emerald-500 hover:text-emerald-400'
                    }
                  >
                    {mult}×
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-1 border-l border-neutral-800 pl-4">
                <button type="button" onClick={() => zoomStep(1 / 1.4)} aria-label="Zoom out" className={ICON_BUTTON}>
                  −
                </button>
                <span className="w-12 text-center font-mono text-neutral-100 tabular-nums">{zoomPct}%</span>
                <button type="button" onClick={() => zoomStep(1.4)} aria-label="Zoom in" className={ICON_BUTTON}>
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
      )}

      <div
        ref={wrapRef}
        className={`relative flex min-h-0 flex-1 items-center justify-center ${compact ? 'p-1.5' : 'p-5'}`}
      >
        <canvas ref={canvasRef} className="touch-none rounded-sm bg-[#16324a] shadow-2xl shadow-black/40" />
        {hintVisible ? <p className={HINT_CLASS[placement]}>{hint}</p> : null}
        {/* Overlaid on top of the map (not laid out beside it) so opening
            any panel never resizes or shifts the canvas underneath. On a
            compact screen they span the width as a bottom sheet instead of
            sitting in a corner, and only one is ever open at a time. */}
        {showPopulation ? (
          <div className={slots.population}>
            <PopulationPanel
              population={insightsData?.population ?? counts.rabbits}
              foxPopulation={insightsData?.foxPopulation ?? counts.foxes}
              kills={insightsData?.kills ?? counts.kills}
              burrows={insightsData?.burrows ?? 0}
              sheltered={insightsData?.sheltered ?? 0}
              history={insightsData?.history ?? []}
              generationRange={insightsData?.generationRange ?? null}
              foxGenerationRange={insightsData?.foxGenerationRange ?? null}
              mapInfo={compact && map ? { size: map.size, lakeCount: map.lakeCount, seed: map.seed } : null}
              onClose={togglePopulation}
            />
          </div>
        ) : null}
        {/* One inspector slot, whose contents follow whatever is selected -
            a fox's genome and a rabbit's neural net need genuinely
            different panels (see FoxInsights.jsx). */}
        {showInsights ? (
          <div className={slots.inspector}>
            {insightsData?.selected?.kind === 'fox' ? (
              <FoxInsights selected={insightsData.selected} onClose={toggleInsights} />
            ) : (
              <RabbitInsights selected={insightsData?.selected ?? null} onClose={toggleInsights} />
            )}
          </div>
        ) : null}
        {/* Capped shorter than the read-only sheets: with the palette open
            the map is a placement surface, so it has to stay tappable. */}
        {spawn.open ? (
          <div className={slots.spawn}>
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

      {compact && map ? (
        <div className="safe-x safe-b flex items-stretch gap-1.5 border-t border-neutral-800 bg-neutral-900 px-1.5 pt-1.5">
          <button
            type="button"
            onClick={toggleSpawnPalette}
            aria-pressed={spawn.open}
            className={`${TAB_BUTTON} ${spawn.open ? TAB_ON : TAB_IDLE}`}
          >
            <span className="text-lg leading-none">🐾</span>
            Spawn
          </button>
          <button
            type="button"
            onClick={toggleInsights}
            aria-pressed={showInsights}
            className={`${TAB_BUTTON} ${showInsights ? TAB_ON : TAB_IDLE}`}
          >
            <span className="text-lg leading-none">🔍</span>
            Inspect
          </button>
          <button
            type="button"
            onClick={togglePopulation}
            aria-pressed={showPopulation}
            className={`${TAB_BUTTON} ${showPopulation ? TAB_ON : TAB_IDLE}`}
          >
            <span className="text-lg leading-none">📈</span>
            Trends
          </button>
          <button
            type="button"
            onClick={togglePaused}
            aria-label={paused ? 'Resume' : 'Pause'}
            className={`${TAB_BUTTON} ${paused ? TAB_ON : TAB_IDLE}`}
          >
            <span className="text-lg leading-none">{paused ? '▶' : '⏸'}</span>
            {paused ? 'Play' : 'Pause'}
          </button>
          <button type="button" onClick={cycleSpeed} aria-label={`Speed ${speed}x, tap to change`} className={`${TAB_BUTTON} ${TAB_IDLE}`}>
            <span className="font-mono text-lg leading-none">{speed}×</span>
            Speed
          </button>
          <button type="button" onClick={zoomReset} aria-label="Fit map to screen" className={`${TAB_BUTTON} ${TAB_IDLE}`}>
            <span className="font-mono text-lg leading-none">⤢</span>
            {zoomPct}%
          </button>
        </div>
      ) : null}
    </main>
  )
}
