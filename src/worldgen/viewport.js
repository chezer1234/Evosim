// The map view's pan/zoom maths, kept free of React and the DOM so the
// gesture handling in GameScreen.jsx stays a thin layer of event plumbing
// over functions that can actually be tested (see viewport.test.js).
//
// A "view" is `{ tilePx, originX, originY, minTilePx, maxTilePx }`: how many
// CSS pixels a tile occupies, and which map tile sits at the canvas's
// top-left corner. Everything else is derived from those three numbers.

export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v))

// If the viewport (in tile units) is wider/taller than the map, center the
// map instead of pinning it to an edge. Otherwise clamp so you can't pan
// past the map's edges.
export function clampOriginAxis(origin, viewLenTiles, mapSize) {
  if (viewLenTiles >= mapSize) return -(viewLenTiles - mapSize) / 2
  return clamp(origin, 0, mapSize - viewLenTiles)
}

/** The map tile under a point on the canvas, in fractional tile coordinates. */
export function tileAt(view, cssX, cssY) {
  return [view.originX + cssX / view.tilePx, view.originY + cssY / view.tilePx]
}

/** Re-zoom so that map tile (tileX, tileY) sits under the canvas point
 * (cssX, cssY), clamping both the zoom level and the resulting pan. This is
 * the single primitive behind wheel zoom, the +/- buttons and pinch: they
 * only differ in where the anchor point comes from. */
export function viewAnchoredAt(view, size, mapSize, tilePx, tileX, tileY, cssX, cssY) {
  const clamped = clamp(tilePx, view.minTilePx, view.maxTilePx)
  return {
    ...view,
    tilePx: clamped,
    originX: clampOriginAxis(tileX - cssX / clamped, size.cssW / clamped, mapSize),
    originY: clampOriginAxis(tileY - cssY / clamped, size.cssH / clamped, mapSize),
  }
}

/** Zoom to `tilePx` keeping whatever is under (cssX, cssY) pinned in place. */
export function zoomedView(view, size, mapSize, tilePx, cssX, cssY) {
  const [tileX, tileY] = tileAt(view, cssX, cssY)
  return viewAnchoredAt(view, size, mapSize, tilePx, tileX, tileY, cssX, cssY)
}

/** Pan by a drag delta in CSS pixels, from the origin the drag started at. */
export function pannedView(view, size, mapSize, startOriginX, startOriginY, dxCss, dyCss) {
  return {
    ...view,
    originX: clampOriginAxis(startOriginX - dxCss / view.tilePx, size.cssW / view.tilePx, mapSize),
    originY: clampOriginAxis(startOriginY - dyCss / view.tilePx, size.cssH / view.tilePx, mapSize),
  }
}

/** The midpoint and separation of two touch points, in canvas CSS pixels. */
export function pinchMetrics(a, b) {
  return {
    cx: (a.x + b.x) / 2,
    cy: (a.y + b.y) / 2,
    // Never zero: it divides the scale factor below.
    dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)),
  }
}

/** What to remember when two fingers land: the map point between them and how
 * far apart they started, which is all `pinchedView` needs afterwards. */
export function pinchStart(view, a, b) {
  const { cx, cy, dist } = pinchMetrics(a, b)
  const [tileX, tileY] = tileAt(view, cx, cy)
  return { startDist: dist, startTilePx: view.tilePx, tileX, tileY }
}

/** The view for a pinch in progress. Zoom follows the fingers' separation and
 * pan follows their midpoint, both at once - so the map point you grabbed
 * stays under your fingers, and a two-finger drag pans even without
 * spreading. Zoom clamping is what makes the two separable: past the limits
 * the scale stops but the pan keeps tracking. */
export function pinchedView(view, size, mapSize, start, a, b) {
  const { cx, cy, dist } = pinchMetrics(a, b)
  const tilePx = start.startTilePx * (dist / start.startDist)
  return viewAnchoredAt(view, size, mapSize, tilePx, start.tileX, start.tileY, cx, cy)
}

// Movement past this counts as a pan drag rather than a tap/click. A fingertip
// wobbles far more than a mouse does between press and release, so touch gets
// a looser threshold - otherwise half of all taps register as tiny pans and
// select nothing.
export function clickSlopPx(pointerType) {
  return pointerType === 'touch' ? 12 : 4
}

// How close a tap has to land to select a creature. A mouse pointer is
// precise, so it keeps the original sub-tile radius; a finger covers roughly
// 20 CSS px of screen no matter how far you're zoomed out, so on touch the
// radius is whatever that works out to in tiles (never *less* precise than a
// mouse when zoomed right in).
const TOUCH_TARGET_PX = 20

export function selectRadiusTiles(pointerType, tilePx) {
  const base = 0.7
  if (pointerType !== 'touch') return base
  return Math.max(base, TOUCH_TARGET_PX / tilePx)
}
