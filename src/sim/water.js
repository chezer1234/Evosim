// Water, as something a creature can be *bad at*.
//
// Before this, a lake was just slow ground: anything could wade across it at
// a flat penalty, so water never decided anything. Now getting wet needs a
// skill - a heritable `swimming` gene both species carry (see rabbit.js and
// fox.js) - and below a threshold the shoreline is simply a wall. That single
// change gives the map two new facts: a lake is a barrier to whoever can't
// swim, and a refuge for whoever can, which is the first terrain feature that
// means different things to a rabbit and to the fox chasing it.
//
// Everything here is in *factors* rather than sim units, because the two
// species measure their pace differently (rabbits step on a tick cadence,
// foxes bank a fractional tiles-per-tick budget). Each species' stats
// function turns these into its own units, so the mapping from gene to
// "how well does this thing swim" lives in exactly one place.

import { TILE } from '../worldgen/mapgen.js'

/**
 * The waterline. Below this, a creature cannot make itself enter water at
 * all; at or above it, it can swim - badly at first, and pays for every tile
 * in pace and energy.
 *
 * Deliberately above the founder mean of both species (0.28 for rabbits,
 * 0.22 for foxes, see their FOUNDER_MEANs): most of the creatures you drop on
 * the island can't swim, so swimming is something a lineage arrives at rather
 * than something it starts with. Whether it ever does is up to the island -
 * an inland warren with no reason to get wet will never select for it.
 */
export const SWIM_MIN_SKILL = 0.35

// A barely-competent swimmer moves at just over a quarter of its overland
// pace; a strong one is nearly as quick in the water as out of it. The bottom
// of the range is deliberately punishing: crossing a five-tile lake as a poor
// swimmer takes long enough for the energy cost below to matter.
const SPEED_FACTOR = [0.28, 0.95] // at skill SWIM_MIN_SKILL -> 1
// Swimming burns energy faster than walking by this multiple. A weak swimmer
// spends over three times as much per second in the water as on land, which
// is what stops "just live in the lake" from being a free way to dodge foxes.
const DRAIN_FACTOR = [3.2, 1.3] // at skill SWIM_MIN_SKILL -> 1

// A creature that is *in* water it cannot swim - dropped there by the spawn
// palette, essentially - is floundering rather than swimming: it can only
// splash toward the nearest shore, and it burns energy faster than the worst
// swimmer does. Left long enough it drowns, which is the honest outcome.
export const FLOUNDER_SPEED_FACTOR = 0.2
export const FLOUNDER_DRAIN_FACTOR = 4.2

function lerp(a, b, t) {
  return a + (b - a) * t
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v))
}

/** Is this tile water? Lakes are swimmable; the open ocean is the edge of
 * the world and stays impassable to everything (see isPlaceable). */
export function isWaterTile(map, x, y) {
  const t = map.tileType[y * map.size + x]
  return t === TILE.OCEAN || t === TILE.LAKE
}

/** Can a creature with this swim gene choose to enter water at all? */
export function canSwim(skill) {
  return skill >= SWIM_MIN_SKILL
}

// Skill is re-scaled across the *usable* part of the range (threshold -> 1)
// rather than 0 -> 1, so a creature that has only just learned to swim is at
// the bottom of the ability curve rather than a third of the way up it.
function usableSkill(skill) {
  return clamp01((skill - SWIM_MIN_SKILL) / (1 - SWIM_MIN_SKILL))
}

/** Fraction of its normal overland pace a swimmer manages in water. */
export function swimSpeedFactor(skill) {
  return lerp(SPEED_FACTOR[0], SPEED_FACTOR[1], usableSkill(skill))
}

/** How much faster energy drains while swimming, as a multiple of the
 * creature's normal burn rate. */
export function swimDrainFactor(skill) {
  return lerp(DRAIN_FACTOR[0], DRAIN_FACTOR[1], usableSkill(skill))
}

/** A plain-English read on what this swim gene buys, for the inspector. */
export function describeSwimming(skill) {
  if (!canSwim(skill)) {
    return `Cannot swim (${Math.round(skill * 100)}%, needs ${Math.round(SWIM_MIN_SKILL * 100)}%) - open water is a wall it will not cross, and it drowns if it ends up out there anyway.`
  }
  return `Swims at ${Math.round(swimSpeedFactor(skill) * 100)}% of its overland pace and burns ${swimDrainFactor(skill).toFixed(1)}x the energy doing it.`
}

// Rings outward from the creature's own tile. Ordered nearest-first so the
// scan below can stop at the first ring that contains dry land.
const RING_LIMIT = 5

/**
 * A unit vector toward the nearest dry tile, for something stuck in water it
 * can't handle. Null when there is no land within RING_LIMIT tiles - out in
 * the middle of a big lake there is nothing useful to point at, so the caller
 * keeps whatever heading it already had rather than dithering on the spot.
 */
export function towardNearestLand(map, x, y) {
  let bestX = 0
  let bestY = 0
  let bestDist = Infinity
  for (let radius = 1; radius <= RING_LIMIT; radius++) {
    for (let dy = -radius; dy <= radius; dy++) {
      for (let dx = -radius; dx <= radius; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== radius) continue
        const tx = x + dx
        const ty = y + dy
        if (tx < 0 || ty < 0 || tx >= map.size || ty >= map.size) continue
        if (isWaterTile(map, tx, ty)) continue
        const dist = Math.hypot(dx, dy)
        if (dist >= bestDist) continue
        bestDist = dist
        bestX = dx
        bestY = dy
      }
    }
    // A closer ring always wins outright, so stop as soon as one has land.
    if (bestDist < Infinity) break
  }
  if (bestDist === Infinity) return null
  const len = Math.hypot(bestX, bestY) || 1
  return { x: bestX / len, y: bestY / len }
}
