import { describe, expect, it } from 'vitest'
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

const MAP_SIZE = 100
const SIZE = { cssW: 800, cssH: 600 }

/** A view where a tile is 10px, so the 800x600 canvas shows 80x60 tiles of a
 * 100x100 map - i.e. zoomed in far enough that panning is clamped, not
 * centered. */
function baseView(overrides = {}) {
  return { tilePx: 10, originX: 10, originY: 10, minTilePx: 4, maxTilePx: 80, ...overrides }
}

describe('clampOriginAxis', () => {
  it('keeps the pan inside the map', () => {
    expect(clampOriginAxis(-5, 80, MAP_SIZE)).toBe(0)
    expect(clampOriginAxis(999, 80, MAP_SIZE)).toBe(20)
    expect(clampOriginAxis(7, 80, MAP_SIZE)).toBe(7)
  })

  it('centers the map when the viewport is larger than it', () => {
    expect(clampOriginAxis(0, 120, MAP_SIZE)).toBe(-10)
    expect(clampOriginAxis(50, 120, MAP_SIZE)).toBe(-10)
  })
})

describe('zoomedView', () => {
  it('keeps the map point under the anchor fixed', () => {
    const view = baseView()
    const [tx, ty] = tileAt(view, 300, 200)
    const next = zoomedView(view, SIZE, MAP_SIZE, 20, 300, 200)
    const [tx2, ty2] = tileAt(next, 300, 200)
    expect(tx2).toBeCloseTo(tx, 6)
    expect(ty2).toBeCloseTo(ty, 6)
  })

  it('clamps to the zoom limits', () => {
    const view = baseView()
    expect(zoomedView(view, SIZE, MAP_SIZE, 1000, 0, 0).tilePx).toBe(view.maxTilePx)
    expect(zoomedView(view, SIZE, MAP_SIZE, 0.01, 0, 0).tilePx).toBe(view.minTilePx)
  })

  it('never pans outside the map', () => {
    const next = zoomedView(baseView(), SIZE, MAP_SIZE, 40, 0, 0)
    expect(next.originX).toBeGreaterThanOrEqual(0)
    expect(next.originY).toBeGreaterThanOrEqual(0)
    expect(next.originX + SIZE.cssW / next.tilePx).toBeLessThanOrEqual(MAP_SIZE)
  })
})

describe('pannedView', () => {
  it('moves the map with the drag', () => {
    const view = baseView()
    const next = pannedView(view, SIZE, MAP_SIZE, view.originX, view.originY, 50, -30)
    expect(next.originX).toBeCloseTo(10 - 5, 6)
    expect(next.originY).toBeCloseTo(10 + 3, 6)
  })

  it('stops at the map edge', () => {
    const view = baseView()
    const next = pannedView(view, SIZE, MAP_SIZE, view.originX, view.originY, 5000, 5000)
    expect(next.originX).toBe(0)
    expect(next.originY).toBe(0)
  })
})

describe('pinchedView', () => {
  const a = { x: 300, y: 300 }
  const b = { x: 500, y: 300 }

  it('is a no-op while the fingers have not moved', () => {
    const view = baseView()
    const start = pinchStart(view, a, b)
    const next = pinchedView(view, SIZE, MAP_SIZE, start, a, b)
    expect(next.tilePx).toBeCloseTo(view.tilePx, 6)
    expect(next.originX).toBeCloseTo(view.originX, 6)
    expect(next.originY).toBeCloseTo(view.originY, 6)
  })

  it('zooms in proportionally as the fingers spread', () => {
    const view = baseView()
    const start = pinchStart(view, a, b)
    // Same midpoint, twice the separation.
    const next = pinchedView(view, SIZE, MAP_SIZE, start, { x: 200, y: 300 }, { x: 600, y: 300 })
    expect(next.tilePx).toBeCloseTo(20, 6)
  })

  it('zooms out as the fingers close', () => {
    const view = baseView()
    const start = pinchStart(view, a, b)
    const next = pinchedView(view, SIZE, MAP_SIZE, start, { x: 350, y: 300 }, { x: 450, y: 300 })
    expect(next.tilePx).toBeCloseTo(5, 6)
  })

  it('keeps the pinched map point under the fingers', () => {
    const view = baseView()
    const start = pinchStart(view, a, b)
    const next = pinchedView(view, SIZE, MAP_SIZE, start, { x: 150, y: 250 }, { x: 550, y: 250 })
    const [tx, ty] = tileAt(next, 350, 250) // the new midpoint
    expect(tx).toBeCloseTo(start.tileX, 6)
    expect(ty).toBeCloseTo(start.tileY, 6)
  })

  it('pans on a two-finger drag with no change in separation', () => {
    const view = baseView()
    const start = pinchStart(view, a, b)
    const next = pinchedView(view, SIZE, MAP_SIZE, start, { x: 200, y: 300 }, { x: 400, y: 300 })
    expect(next.tilePx).toBeCloseTo(view.tilePx, 6)
    expect(next.originX).toBeCloseTo(view.originX + 10, 6) // dragged 100px left at 10px/tile
  })

  it('respects the zoom limits and stays on the map', () => {
    const view = baseView()
    const start = pinchStart(view, a, b)
    const next = pinchedView(view, SIZE, MAP_SIZE, start, { x: 0, y: 300 }, { x: 4000, y: 300 })
    expect(next.tilePx).toBe(view.maxTilePx)
    expect(next.originX).toBeGreaterThanOrEqual(0)
    expect(next.originX + SIZE.cssW / next.tilePx).toBeLessThanOrEqual(MAP_SIZE + 1e-9)
  })
})

describe('touch tolerances', () => {
  it('gives fingers more slop than a mouse before a tap becomes a pan', () => {
    expect(clickSlopPx('touch')).toBeGreaterThan(clickSlopPx('mouse'))
  })

  it('grows the tap target as the map zooms out, but never below the mouse radius', () => {
    const zoomedOut = selectRadiusTiles('touch', 4)
    const zoomedIn = selectRadiusTiles('touch', 80)
    expect(zoomedOut).toBeGreaterThan(zoomedIn)
    expect(zoomedIn).toBe(selectRadiusTiles('mouse', 80))
    expect(selectRadiusTiles('mouse', 4)).toBe(0.7)
  })
})
