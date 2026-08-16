// Which landmass is which, and where the sea between two of them is narrow
// enough to swim.
//
// A one-island world never needed this: everything alive was on the same
// ground, and the ocean was simply the edge of the map. A world of several
// islands only means anything if the sim can answer two questions - "which
// island is this creature on?" (so populations can be seen to separate) and
// "can it get to that one?" (so they can occasionally stop being separate).
//
// The answer to the second is deliberately narrow. Ocean within
// SHALLOW_TILES of a coast is a shelf a strong swimmer can work along; deep
// water is impassable to everything, always. Two islands are therefore
// reachable from each other exactly when their shelves *touch* - i.e. when
// the channel between them is at most 2 x SHALLOW_TILES wide. That is the
// whole migration rule, and it falls out of the terrain rather than being a
// number someone tuned: a very developed swim gene lets a lineage cross to
// the next island over, and no gene lets anything cross the open sea.
//
// Pure array work, no React and no canvas - see islands.test.js.

import { isWaterType, TILE } from './biomes.js'

/** How far the swimmable shelf reaches out from any coast, in tiles. Two
 *  islands are connected when their shelves meet, so the widest crossable
 *  channel is twice this. */
export const SHALLOW_TILES = 3

// 8-connectivity throughout, because that is how creatures move (see
// NEIGHBOR_OFFSETS in sim/simulation.js): a diagonal step is a step, so a
// diagonal gap is a crossing.
const NEIGHBORS = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
]

/**
 * Label every landmass in a tile grid.
 *
 * @returns {{landId: Int32Array, islands: Array<{id:number, area:number, cx:number, cy:number}>}}
 *   `landId` is -1 for water and the island's index for land.
 */
export function labelIslands(tileType, size) {
  const landId = new Int32Array(size * size).fill(-1)
  const islands = []
  const stack = []
  for (let start = 0; start < landId.length; start++) {
    if (landId[start] !== -1 || isWaterType(tileType[start])) continue
    const id = islands.length
    let area = 0
    let sumX = 0
    let sumY = 0
    landId[start] = id
    stack.push(start)
    while (stack.length) {
      const idx = stack.pop()
      const x = idx % size
      const y = (idx / size) | 0
      area++
      sumX += x
      sumY += y
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue
        const n = ny * size + nx
        if (landId[n] !== -1 || isWaterType(tileType[n])) continue
        landId[n] = id
        stack.push(n)
      }
    }
    islands.push({ id, area, cx: sumX / area, cy: sumY / area })
  }
  return { landId, islands }
}

class UnionFind {
  constructor(n) {
    this.parent = Array.from({ length: n }, (_, i) => i)
  }
  find(a) {
    while (this.parent[a] !== a) {
      this.parent[a] = this.parent[this.parent[a]]
      a = this.parent[a]
    }
    return a
  }
  union(a, b) {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent[rb] = ra
  }
}

/**
 * Work out the swimmable shelf and what it connects.
 *
 * A multi-source BFS out from every coast gives each ocean tile its distance
 * to the nearest land and which island that land belongs to. Tiles within
 * SHALLOW_TILES are the shelf; a flood fill over the shelf then unions every
 * island that touches the same stretch of it, which is precisely "a swimmer
 * could get from here to there without crossing deep water".
 *
 * Lakes are left out of all of it - they are inland water with their own,
 * much lower, skill threshold (see sim/water.js), not a route anywhere.
 *
 * @returns {{shallow: Uint8Array, oceanDist: Int16Array, nearestIsland: Int32Array,
 *   straits: Array<{a:number, b:number, gap:number, x:number, y:number}>,
 *   group: Int32Array, groupCount: number}}
 */
export function analyseWaters(tileType, landId, size, shallowTiles = SHALLOW_TILES, islandCount = 0) {
  const n = size * size
  const oceanDist = new Int16Array(n).fill(-1)
  const nearestIsland = new Int32Array(n).fill(-1)
  const shallow = new Uint8Array(n)

  // Seed the BFS with the coast itself (dist 0, its own island) and walk out
  // over ocean only.
  let frontier = []
  for (let i = 0; i < n; i++) {
    if (landId[i] < 0) continue
    oceanDist[i] = 0
    nearestIsland[i] = landId[i]
    frontier.push(i)
  }
  while (frontier.length) {
    const next = []
    for (const idx of frontier) {
      const x = idx % size
      const y = (idx / size) | 0
      const d = oceanDist[idx] + 1
      if (d > shallowTiles) continue
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue
        const ni = ny * size + nx
        if (tileType[ni] !== TILE.OCEAN || oceanDist[ni] !== -1) continue
        oceanDist[ni] = d
        nearestIsland[ni] = nearestIsland[idx]
        shallow[ni] = 1
        next.push(ni)
      }
    }
    frontier = next
  }

  // Flood the shelf: every island touching one connected stretch of shallow
  // water is reachable from every other island touching it.
  const total = Math.max(islandCount, 0)
  const uf = new UnionFind(total)
  const straitByPair = new Map()
  const seen = new Uint8Array(n)
  const stack = []
  for (let start = 0; start < n; start++) {
    if (!shallow[start] || seen[start]) continue
    const touching = []
    seen[start] = 1
    stack.push(start)
    while (stack.length) {
      const idx = stack.pop()
      const x = idx % size
      const y = (idx / size) | 0
      for (const [dx, dy] of NEIGHBORS) {
        const nx = x + dx
        const ny = y + dy
        if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue
        const ni = ny * size + nx
        if (landId[ni] >= 0) {
          if (!touching.includes(landId[ni])) touching.push(landId[ni])
          continue
        }
        if (!shallow[ni]) continue
        // The narrowest point of a channel is where two shelves meet: both
        // tiles are shallow but they belong to different coasts, and their
        // distances add up to the width of the water between them. Checked
        // before the visited test, or the narrowest meeting would be missed
        // whenever the fill happened to reach that tile from the other side
        // first.
        const a = nearestIsland[idx]
        const b = nearestIsland[ni]
        if (a >= 0 && b >= 0 && a !== b) {
          const gap = oceanDist[idx] + oceanDist[ni]
          const key = a < b ? `${a}:${b}` : `${b}:${a}`
          const prev = straitByPair.get(key)
          if (!prev || gap < prev.gap) {
            straitByPair.set(key, {
              a: Math.min(a, b),
              b: Math.max(a, b),
              gap,
              x: (x + nx) / 2,
              y: (y + ny) / 2,
            })
          }
        }
        if (seen[ni]) continue
        seen[ni] = 1
        stack.push(ni)
      }
    }
    for (let i = 1; i < touching.length; i++) uf.union(touching[0], touching[i])
  }

  // Renumber the components so groups are 0..groupCount-1 in island order,
  // which is what the UI counts ("3 island groups").
  const group = new Int32Array(total).fill(-1)
  const rootToGroup = new Map()
  for (let i = 0; i < total; i++) {
    const root = uf.find(i)
    if (!rootToGroup.has(root)) rootToGroup.set(root, rootToGroup.size)
    group[i] = rootToGroup.get(root)
  }

  return {
    shallow,
    oceanDist,
    nearestIsland,
    straits: [...straitByPair.values()].sort((p, q) => p.gap - q.gap),
    group,
    groupCount: rootToGroup.size,
  }
}
