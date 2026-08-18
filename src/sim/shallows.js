// The shallows: the productive fringe of the world, and the food chain that
// does not run through a rabbit.
//
// Until now the island had exactly one food source - apples on forest trees -
// so it also had exactly one story: rabbits eat apples, foxes eat rabbits,
// and a run where the rabbits go under is a run where the foxes follow them
// down a few minutes later. That is a chain, not an ecosystem. The water was
// scenery with a swim gene attached to it.
//
// So the water grows something. Algae in the sunlit shallows, weed and wrack
// along the tideline just above it: one resource, `forage`, feeding two new
// species (see ./fish.js and ./crab.js) who between them give a fox something
// to eat that is not a rabbit. Which is the whole point - a fox working the
// shore is a fox that survives an island with no rabbits left on it, and a
// fox that has to *choose* between a rabbit it might not catch and a crab it
// almost certainly will.
//
// Three facts about a tile live here, and nothing else does:
//
//  - **shallows**: lake, or the shallow shelf hugging a coast (see
//    islands.js). Sunlit, and the only water that grows anything - the deep
//    is as barren to a fish as it is impassable to a rabbit.
//  - **shore distance**: how many steps of dry land a tile is from the
//    nearest water, which is what "the tideline" means and what a crab's
//    boldness gene is measured in.
//  - **forage**: which tiles can bear algae/wrack at all, on the same
//    can-have/has-it-now pattern the apples use (see mapgen's canHaveApple
//    and sim.hasApple), so regrowth is a walk of what was eaten rather than
//    a sweep of the world.

import { TILE } from '../worldgen/mapgen.js'
import { isShallowOcean, isWaterTile } from './water.js'

/** How long an eaten patch of algae/wrack takes to come back. Much faster
 * than an apple tree (45s): a fish is small, eats often, and the shallows are
 * meant to be a *renewable* larder rather than a windfall - the thing that
 * makes the bottom of this food chain reliable enough for a fox to live off
 * the top of it. */
export const FORAGE_REGROW_MS = 26000

// What share of eligible tiles actually bear anything. Under the water is
// richer than above it: algae grows on every sunlit stone, where the tideline
// only collects what the sea leaves behind. Both are well under 1 so that
// forage is a thing to *find*, and so that a boom in either species runs into
// a real carrying capacity rather than an endless buffet.
const SHALLOWS_FORAGE_DENSITY = 0.34
const SHORE_FORAGE_DENSITY = 0.22

/** How far inland the wrack line reaches. Two tiles: enough that a crab has
 * somewhere to go that a fish cannot follow, small enough that the choice to
 * leave the water is always a choice to be within a fox's reach. */
export const LAND_FORAGE_REACH = 2

// BFS cap for shoreDistances below. Nothing in the sim asks about ground
// further from water than a bold crab would ever walk, so the flood stops
// early rather than measuring the middle of a continent.
const SHORE_DIST_MAX = 4
/** What shoreDistances stores for anything further inland than SHORE_DIST_MAX
 * (and for tiles the flood never reached). Comparisons are all `<=`, so one
 * big number reads as "inland" everywhere. */
export const INLAND = 99

/**
 * Sunlit water: a lake, or the shallow shelf around a coast. The only water
 * that grows food, and - not coincidentally - the only water anything can
 * cross (see water.js), so the productive part of the sea is also the
 * contested part.
 */
export function isShallows(map, x, y) {
  if (x < 0 || y < 0 || x >= map.size || y >= map.size) return false
  return map.tileType[y * map.size + x] === TILE.LAKE || isShallowOcean(map, x, y)
}

const NEIGHBORS = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
]

/**
 * Water with a bank on it: a tile something standing on dry land can reach
 * into. It is what makes fishing possible for the overwhelming majority of
 * foxes, who cannot swim a stroke (see FOUNDER_MEAN in fox.js) - a fox works
 * the edge of the water, not the middle of it, until its lineage learns
 * otherwise.
 */
export function isBankside(map, x, y) {
  if (!isWaterTile(map, x, y)) return false
  for (const [dx, dy] of NEIGHBORS) {
    const nx = x + dx
    const ny = y + dy
    if (nx < 0 || ny < 0 || nx >= map.size || ny >= map.size) continue
    if (!isWaterTile(map, nx, ny)) return true
  }
  return false
}

/**
 * The tideline: dry land with water against it. The strip a crab can reach
 * without any boldness at all, and the only part of the shore a placement
 * check can identify without the shore-distance flood below - which is why it
 * exists separately from it (the spawn palette has a map and no simulation).
 */
export function isTideline(map, x, y) {
  if (x < 0 || y < 0 || x >= map.size || y >= map.size) return false
  if (isWaterTile(map, x, y)) return false
  for (const [dx, dy] of NEIGHBORS) {
    const nx = x + dx
    const ny = y + dy
    if (nx < 0 || ny < 0 || nx >= map.size || ny >= map.size) continue
    if (isWaterTile(map, nx, ny)) return true
  }
  return false
}

/**
 * Steps of dry land between each tile and the nearest water: 0 in the water
 * itself, 1 along the tideline, INLAND for anything beyond SHORE_DIST_MAX.
 *
 * Computed once per simulation rather than per tick - the map never changes -
 * and it is the one number the crabs' whole trade-off is expressed in: how
 * far from the water a lineage is prepared to feed.
 */
export function shoreDistances(map) {
  const n = map.size * map.size
  const dist = new Int16Array(n).fill(INLAND)
  let frontier = []
  for (let y = 0; y < map.size; y++) {
    for (let x = 0; x < map.size; x++) {
      if (!isWaterTile(map, x, y)) continue
      const idx = y * map.size + x
      dist[idx] = 0
      frontier.push(idx)
    }
  }
  for (let step = 1; step <= SHORE_DIST_MAX && frontier.length; step++) {
    const next = []
    for (const idx of frontier) {
      const x = idx % map.size
      const y = (idx - x) / map.size
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= map.size || ny >= map.size) continue
        const ni = ny * map.size + nx
        if (dist[ni] !== INLAND) continue
        dist[ni] = step
        next.push(ni)
      }
    }
    frontier = next
  }
  return dist
}

// A hash rather than a random draw, for one specific reason: the layout of
// the larder is a property of the *map*, the way the apple trees are, so it
// has to be the same every time a simulation is created on the same world -
// and it must not consume the global rng to do it. Everything in this project
// that reproduces a run (the ecosystem harness, every seeded test) leans on
// Math.random being drawn in exactly the same order each time, and taking
// size^2 numbers out of it at sim-creation time would shift every decision
// downstream of it.
function hash01(x, y, salt) {
  let h = (x * 374761393 + y * 668265263 + salt * 1274126177) | 0
  h = Math.imul(h ^ (h >>> 13), 1274126177)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

/**
 * Which tiles may bear forage at all: the shallows and the strip of shore
 * just above them, thinned to a fraction so that finding food is a thing a
 * fish or a crab actually does.
 *
 * The same can-have/has-it-now split the apples use (see mapgen's
 * canHaveApple): this array never changes, and sim.hasForage tracks what is
 * currently grown on it.
 */
export function forageTiles(map, shoreDist) {
  const canHaveForage = new Uint8Array(map.size * map.size)
  const salt = (map.seed ?? 0) | 0
  for (let y = 0; y < map.size; y++) {
    for (let x = 0; x < map.size; x++) {
      const idx = y * map.size + x
      if (isShallows(map, x, y)) {
        if (hash01(x, y, salt) < SHALLOWS_FORAGE_DENSITY) canHaveForage[idx] = 1
      } else if (!isWaterTile(map, x, y) && shoreDist[idx] <= LAND_FORAGE_REACH) {
        if (hash01(x, y, salt + 1) < SHORE_FORAGE_DENSITY) canHaveForage[idx] = 1
      }
    }
  }
  return canHaveForage
}
