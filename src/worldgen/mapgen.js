// Procedural top-down world generation: seeded Perlin noise (fBm), one
// falloff per island for the coastlines, verified lake carving so a requested
// lake count always appears as real, separate lakes rather than silently
// merging into the ocean, and a climate model that gives the ground biomes
// instead of one global grass-to-forest gradient (see biomes.js).
//
// A world is one island or many. One island at 64 tiles is the game as it has
// always played; several islands at 128-256 tiles is a world big enough for
// populations to be separated by water, where the only way across is a very
// developed swim gene and a channel narrow enough to use it on (see
// islands.js and sim/water.js). Both come out of the same generator - the
// only difference is how many falloffs get placed and how far apart.

// ======================= Seeded RNG + Perlin noise =======================
export function mulberry32(seed) {
  let s = seed >>> 0
  return function () {
    s |= 0
    s = (s + 0x6d2b79f5) | 0
    let t = Math.imul(s ^ (s >>> 15), 1 | s)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function buildPerm(rng) {
  const p = new Uint8Array(256)
  for (let i = 0; i < 256; i++) p[i] = i
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = p[i]
    p[i] = p[j]
    p[j] = tmp
  }
  const perm = new Uint8Array(512)
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255]
  return perm
}

const GRAD2 = [
  [1, 1],
  [-1, 1],
  [1, -1],
  [-1, -1],
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
]
function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10)
}
function lerp(t, a, b) {
  return a + (b - a) * t
}
function grad(hash, x, y) {
  const g = GRAD2[hash & 7]
  return g[0] * x + g[1] * y
}

export function makePerlin(seed) {
  const rng = mulberry32(seed)
  const perm = buildPerm(rng)
  return function perlin2(x, y) {
    const X = Math.floor(x) & 255
    const Y = Math.floor(y) & 255
    const xf = x - Math.floor(x)
    const yf = y - Math.floor(y)
    const u = fade(xf)
    const v = fade(yf)
    const aa = perm[perm[X] + Y]
    const ab = perm[perm[X] + Y + 1]
    const ba = perm[perm[X + 1] + Y]
    const bb = perm[perm[X + 1] + Y + 1]
    const x1 = lerp(u, grad(aa, xf, yf), grad(ba, xf - 1, yf))
    const x2 = lerp(u, grad(ab, xf, yf - 1), grad(bb, xf - 1, yf - 1))
    return lerp(v, x1, x2) // ~ -1..1
  }
}

export function fbm(perlin, x, y, octaves, persistence, baseFreq) {
  let total = 0
  let amp = 1
  let freq = baseFreq
  let maxAmp = 0
  for (let i = 0; i < octaves; i++) {
    total += perlin(x * freq, y * freq) * amp
    maxAmp += amp
    amp *= persistence
    freq *= 2
  }
  return total / maxAmp
}

// ======================= Map generation =======================
// The tile vocabulary, the climate model and what each biome means to a
// creature all live in biomes.js; this file only decides *where* each set of
// conditions occurs.
export { TILE, BIOME, BIOME_ORDER, SEA_LEVEL, hasCover, isWaterType } from './biomes.js'
import { BEACH_WIDTH, BIOME, SEA_LEVEL, TILE, classifyLand, fruitFraction, isWaterType, temperatureAt } from './biomes.js'
import { analyseWaters, labelIslands, SHALLOW_TILES } from './islands.js'

export { SHALLOW_TILES }

export const DEFAULT_SETTINGS = {
  size: 64,
  octaves: 5,
  noiseScale: 24,
  persistence: 0.55,
  minLakes: 1,
  maxLakes: 4,
  vegetation: 1.0,
  // How many separate landmasses to aim for. 1..1 is the original single
  // island, and the default, so a fresh install still plays exactly as it
  // did; anything more is an archipelago, which only really works once the
  // world is big enough to put real water between them (see WORLD_PRESETS).
  minIslands: 1,
  maxIslands: 1,
  // Strength of the north-south temperature gradient: 0 is one temperate
  // climate everywhere (grass/shrub/forest by moisture alone, i.e. the old
  // world), 1 runs from arctic at the top of the map to desert at the bottom.
  climate: 0.6,
}

/**
 * The sizes worth offering as one tap, and what each is *for*. A world only
 * separates populations if there is room for several islands and a boat-less
 * gap between them, and a 64-tile map has room for neither - so size and
 * island count move together rather than being two sliders to reconcile.
 */
export const WORLD_PRESETS = [
  { key: 'island', label: 'Single island', hint: 'The classic map: one island, one population.', settings: { size: 64, minIslands: 1, maxIslands: 1, noiseScale: 24 } },
  { key: 'large', label: 'Large island', hint: 'The same island with room to roam, and space for real biome bands.', settings: { size: 112, minIslands: 1, maxIslands: 2, noiseScale: 34 } },
  { key: 'archipelago', label: 'Archipelago', hint: 'A handful of islands. Some pairs end up close enough to swim between.', settings: { size: 160, minIslands: 3, maxIslands: 5, noiseScale: 30 } },
  { key: 'wide', label: 'Wide world', hint: 'Arctic north, desert south, and populations that drift apart for good.', settings: { size: 224, minIslands: 5, maxIslands: 9, noiseScale: 28 } },
]

/** The preset a settings object matches, if any (for highlighting the UI). */
export function matchingPreset(settings) {
  return (
    WORLD_PRESETS.find((p) => Object.entries(p.settings).every(([k, v]) => settings[k] === v))?.key ?? null
  )
}

function floodFillOcean(elevation, size) {
  const isWater = new Uint8Array(size * size)
  for (let i = 0; i < elevation.length; i++) isWater[i] = elevation[i] < SEA_LEVEL ? 1 : 0

  const visited = new Uint8Array(size * size)
  const stack = []
  for (let x = 0; x < size; x++) {
    if (isWater[x]) stack.push(x)
    if (isWater[(size - 1) * size + x]) stack.push((size - 1) * size + x)
  }
  for (let y = 0; y < size; y++) {
    if (isWater[y * size]) stack.push(y * size)
    if (isWater[y * size + size - 1]) stack.push(y * size + size - 1)
  }

  const isOcean = new Uint8Array(size * size)
  while (stack.length) {
    const idx = stack.pop()
    if (visited[idx]) continue
    visited[idx] = 1
    isOcean[idx] = 1
    const x = idx % size
    const y = (idx / size) | 0
    if (x > 0) {
      const n = idx - 1
      if (!visited[n] && isWater[n]) stack.push(n)
    }
    if (x < size - 1) {
      const n = idx + 1
      if (!visited[n] && isWater[n]) stack.push(n)
    }
    if (y > 0) {
      const n = idx - size
      if (!visited[n] && isWater[n]) stack.push(n)
    }
    if (y < size - 1) {
      const n = idx + size
      if (!visited[n] && isWater[n]) stack.push(n)
    }
  }
  return { isWater, isOcean }
}

// ------------------------------------------------------------- island shapes
// One falloff per island, warped so nothing comes out a circle. A single
// island centred on the map with a radius of half the map is exactly the old
// behaviour; several smaller ones scattered about is an archipelago.

const EDGE_MARGIN = 0.1 // islands stay this far (as a fraction of the map) from the border
/** Tiles of guaranteed ocean around the frame of the world. */
const BORDER_OCEAN = 2
// A falloff of radius R puts its coastline at roughly 0.9R (that is where the
// R^2 falloff pulls average noise below sea level), so separations are priced
// against COAST_RATIO * (Ra + Rb) rather than against the radii themselves -
// otherwise "just far enough apart not to overlap" produces one merged
// landmass instead of two.
const COAST_RATIO = 0.9
// How often a new island is deliberately placed against a neighbour, close
// enough that the two shelves meet and a strong swimmer can get across (see
// islands.js). Left to chance, near-misses in open water are rare, and
// migration between islands would be a mechanic almost nothing ever meets.
const NEIGHBOUR_CHANCE = 0.55
const NEIGHBOUR_GAP = [1, 6] // tiles of open water between the two coasts

/**
 * Centres and radii for `count` islands, in tile units.
 *
 * A single island is centred with a radius of half the map - the original
 * one-island world, unchanged. Beyond that, islands are sized against
 * 1/sqrt(count) so a world of nine is nine real islands rather than nine
 * continents fighting for the same water, and each new one is either dropped
 * somewhere clear or deliberately set a few tiles off an existing coast.
 */
export function pickIslandCenters(rng, size, count) {
  if (count <= 1) return [{ x: size / 2, y: size / 2, r: size / 2 }]
  const centers = []
  const base = (size * 0.34) / Math.sqrt(count)
  const lo = size * EDGE_MARGIN
  const hi = size * (1 - EDGE_MARGIN)
  const fits = (x, y, r, gap) =>
    x - r * COAST_RATIO > lo * 0.2 &&
    y - r * COAST_RATIO > lo * 0.2 &&
    x + r * COAST_RATIO < size - lo * 0.2 &&
    y + r * COAST_RATIO < size - lo * 0.2 &&
    centers.every((c) => Math.hypot(c.x - x, c.y - y) >= (c.r + r) * COAST_RATIO + gap)

  for (let i = 0; i < count; i++) {
    const r = base * (0.72 + rng() * 0.56)
    let placed = null
    // A near neighbour: same coast-to-coast maths, but aiming for a channel
    // only a few tiles wide instead of clear water.
    if (centers.length && rng() < NEIGHBOUR_CHANCE) {
      const host = centers[Math.floor(rng() * centers.length)]
      const gap = NEIGHBOUR_GAP[0] + rng() * (NEIGHBOUR_GAP[1] - NEIGHBOUR_GAP[0])
      const dist = (host.r + r) * COAST_RATIO + gap
      for (let attempt = 0; attempt < 24 && !placed; attempt++) {
        const angle = rng() * Math.PI * 2
        const x = host.x + Math.cos(angle) * dist
        const y = host.y + Math.sin(angle) * dist
        // Checked against every *other* island at the usual clearance, so a
        // deliberate near miss with one neighbour never quietly merges into a
        // third.
        if (fitsExcept(centers, host, x, y, r, size, lo)) placed = { x, y, r }
      }
    }
    for (let attempt = 0; attempt < 200 && !placed; attempt++) {
      const x = lo + rng() * (hi - lo)
      const y = lo + rng() * (hi - lo)
      if (fits(x, y, r, size * 0.02)) placed = { x, y, r }
    }
    // Falling short is fine and is reported honestly: map.islandCount is
    // counted off the finished terrain, never off what was asked for.
    if (placed) centers.push(placed)
  }
  return centers
}

/** The clearance test for a deliberate near neighbour: normal spacing from
 *  everything except the island it is being tucked against. */
function fitsExcept(centers, host, x, y, r, size, lo) {
  if (x - r * COAST_RATIO < lo * 0.2 || y - r * COAST_RATIO < lo * 0.2) return false
  if (x + r * COAST_RATIO > size - lo * 0.2 || y + r * COAST_RATIO > size - lo * 0.2) return false
  return centers.every((c) => c === host || Math.hypot(c.x - x, c.y - y) >= (c.r + r) * COAST_RATIO + size * 0.02)
}

/** How far outside the islands a point is: 0 at a centre, 1 in open sea.
 *  The warp is a low-frequency noise on the *distance*, which is what stops
 *  every island coming out as a disc. */
function islandMask(centers, x, y, warp) {
  let best = 1
  for (const c of centers) {
    const d = (Math.hypot(x - c.x, y - c.y) / c.r) * warp
    if (d < best) best = d
  }
  return Math.min(1, best)
}

/** Ocean border: whatever the islands do, the outer frame of the map is sea,
 *  so the world always has an edge you cannot walk off. */
function edgeMask(x, y, size) {
  const nx = Math.abs(x / (size - 1) - 0.5) * 2
  const ny = Math.abs(y / (size - 1) - 0.5) * 2
  const m = Math.max(nx, ny)
  return Math.min(1, Math.max(0, (m - 0.8) / 0.2))
}

// ------------------------------------------------------------------- lakes
// A lake is carved as a disc pulled below sea level. The old check ran a
// whole-map flood fill per attempt and reverted anything that leaked into the
// sea; on a 256-tile world with lakes on every island that is thousands of
// flood fills. The local check below is the same guarantee for a fraction of
// the work: if every tile in the ring around the disc is already dry land,
// the water inside it cannot possibly reach the ocean.

/** How far the moisture field is stretched away from its mean before the
 *  biome thresholds see it. */
const MOISTURE_CONTRAST = 1.5
/** The least relief (in normalized elevation) an island's biomes are read
 *  against. Below this it really is just a sandbar. */
const MIN_ISLAND_RELIEF = 0.14

const LAKE_MIN_ISLAND_AREA = 120 // don't try to put a lake on a sandbar
/** Tiles of land before a landmass counts as an island rather than a rock. */
export const NOTABLE_ISLAND_AREA = 24

function ringIsLand(elevation, size, cx, cy, r) {
  const pad = r + 1.5
  const x0 = Math.floor(cx - pad)
  const x1 = Math.ceil(cx + pad)
  const y0 = Math.floor(cy - pad)
  const y1 = Math.ceil(cy + pad)
  if (x0 < 1 || y0 < 1 || x1 >= size - 1 || y1 >= size - 1) return false
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      if (elevation[y * size + x] < SEA_LEVEL) return false
    }
  }
  return true
}

function carveLake(elevation, size, cx, cy, r, carvedMask) {
  const x0 = Math.max(0, Math.floor(cx - r))
  const x1 = Math.min(size - 1, Math.ceil(cx + r))
  const y0 = Math.max(0, Math.floor(cy - r))
  const y1 = Math.min(size - 1, Math.ceil(cy + r))
  for (let y = y0; y <= y1; y++) {
    for (let x = x0; x <= x1; x++) {
      const dist = Math.hypot(x - cx, y - cy)
      if (dist >= r) continue
      const idx = y * size + x
      elevation[idx] = Math.min(elevation[idx], SEA_LEVEL - 0.05 * (1 - dist / r))
      carvedMask[idx] = 1
    }
  }
}

/** Number of separate bodies of a given tile type - used to report the lake
 *  count off the finished map rather than off the number of carves attempted,
 *  so two carves that ran into each other are honestly one lake. */
function countBodies(tileType, size, type) {
  const seen = new Uint8Array(size * size)
  const stack = []
  let bodies = 0
  for (let start = 0; start < tileType.length; start++) {
    if (seen[start] || tileType[start] !== type) continue
    bodies++
    seen[start] = 1
    stack.push(start)
    while (stack.length) {
      const idx = stack.pop()
      const x = idx % size
      const y = (idx / size) | 0
      if (x > 0 && !seen[idx - 1] && tileType[idx - 1] === type) { seen[idx - 1] = 1; stack.push(idx - 1) }
      if (x < size - 1 && !seen[idx + 1] && tileType[idx + 1] === type) { seen[idx + 1] = 1; stack.push(idx + 1) }
      if (y > 0 && !seen[idx - size] && tileType[idx - size] === type) { seen[idx - size] = 1; stack.push(idx - size) }
      if (y < size - 1 && !seen[idx + size] && tileType[idx + size] === type) { seen[idx + size] = 1; stack.push(idx + size) }
    }
  }
  return bodies
}

/**
 * Generate a new procedural world: one island, or an archipelago of them.
 *
 * @param {typeof DEFAULT_SETTINGS} settings
 * @returns {{size:number, seed:number, lakeCount:number, islandCount:number,
 *   tileType:Uint8Array, elevation:Float32Array, temperature:Float32Array,
 *   jitterX:Float32Array, jitterY:Float32Array, scaleVar:Float32Array,
 *   nearShallow:Uint8Array, shallow:Uint8Array, landId:Int32Array,
 *   islands:Array, straits:Array, islandGroup:Int32Array, groupCount:number,
 *   canHaveApple:Uint8Array}}
 */
export function generateMap(settings) {
  const cfg = { ...DEFAULT_SETTINGS, ...settings }
  const { size, octaves, noiseScale, persistence, minLakes, maxLakes, vegetation, climate } = cfg
  const seed = (Math.random() * 0xffffffff) >>> 0
  const rng = mulberry32(seed)
  const elevPerlin = makePerlin(Math.floor(rng() * 1e9))
  const moistPerlin = makePerlin(Math.floor(rng() * 1e9))
  const tempPerlin = makePerlin(Math.floor(rng() * 1e9))
  const warpPerlin = makePerlin(Math.floor(rng() * 1e9))

  const minIslands = Math.max(1, Math.round(cfg.minIslands))
  const maxIslands = Math.max(minIslands, Math.round(cfg.maxIslands))
  const wanted = minIslands + Math.floor(rng() * (maxIslands - minIslands + 1))
  const centers = pickIslandCenters(rng, size, wanted)

  const baseFreq = 1 / noiseScale
  const elevation = new Float32Array(size * size)
  const moisture = new Float32Array(size * size)
  const tempNoise = new Float32Array(size * size)

  let min = Infinity
  let max = -Infinity
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x
      let e = fbm(elevPerlin, x, y, octaves, persistence, baseFreq)
      const warp = 1 + fbm(warpPerlin, x, y, 4, 0.5, 1 / (size * 0.3)) * 0.34
      const falloff = Math.pow(Math.max(islandMask(centers, x, y, warp), edgeMask(x, y, size)), 2)
      e = e * 0.5 + 0.5
      e = e - falloff * 0.9
      elevation[idx] = e
      if (e < min) min = e
      if (e > max) max = e

      // Moisture and the regional temperature wobble are sampled at a scale
      // relative to the world, so a big world gets bigger biome regions
      // rather than the same speckle stretched over more tiles. Moisture also
      // gets its contrast stretched: raw fBm clusters around 0.5, which used
      // to leave most of the land in the one band between the grass and
      // forest thresholds - i.e. scrub everywhere.
      const m = fbm(moistPerlin, x, y, 4, 0.5, 1 / (size * 0.35)) * 0.5 + 0.5
      moisture[idx] = Math.min(1, Math.max(0, 0.5 + (m - 0.5) * MOISTURE_CONTRAST))
      tempNoise[idx] = fbm(tempPerlin, x, y, 3, 0.5, 1 / (size * 0.45)) * 0.5 + 0.5
    }
  }
  const range = max - min || 1
  for (let i = 0; i < elevation.length; i++) elevation[i] = (elevation[i] - min) / range

  // The outermost tiles are drowned outright. The edge falloff alone only
  // *pushes* the border down, and the stretch that follows is relative to
  // whatever the lowest point on the map turned out to be - so a lucky peak
  // of noise in a corner could still come out as dry land, i.e. an island
  // running off the edge of the world. Doing it here rather than in the
  // falloff is deliberate: this is the frame of the map, and the frame is
  // rectangular however organic the coastlines inside it are.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (x >= BORDER_OCEAN && y >= BORDER_OCEAN && x < size - BORDER_OCEAN && y < size - BORDER_OCEAN) continue
      const idx = y * size + x
      elevation[idx] = Math.min(elevation[idx], SEA_LEVEL - 0.08)
    }
  }

  // Lakes are rolled per island rather than per world, so a bigger world
  // genuinely has more fresh water rather than the same four lakes spread
  // thinner. Candidate centres are sampled from that island's own land, which
  // is also why this needs the pre-lake landmasses.
  const preWater = floodFillOcean(elevation, size)
  const preType = new Uint8Array(size * size)
  for (let i = 0; i < preType.length; i++) preType[i] = preWater.isWater[i] ? TILE.OCEAN : TILE.GRASS
  const pre = labelIslands(preType, size)
  const landByIsland = new Map()
  for (let i = 0; i < pre.landId.length; i++) {
    const id = pre.landId[i]
    if (id < 0) continue
    if (!landByIsland.has(id)) landByIsland.set(id, [])
    landByIsland.get(id).push(i)
  }
  // Tracks exactly which tiles were lowered by carveLake below, so the pass
  // right after this loop can tell an intentional lake apart from a natural
  // dip in the elevation noise that happens to sit below sea level without
  // draining to the ocean (see there for why that distinction matters).
  const carvedMask = new Uint8Array(size * size)
  for (const island of pre.islands) {
    if (island.area < LAKE_MIN_ISLAND_AREA) continue
    const tiles = landByIsland.get(island.id)
    const want = minLakes + Math.floor(rng() * (maxLakes - minLakes + 1))
    // Lake size is absolute rather than a fraction of the world: a lake is a
    // few tiles of water a rabbit might drown in, at 64 tiles and at 256.
    const maxR = Math.min(7, Math.max(2, Math.sqrt(island.area) * 0.16))
    let placed = 0
    for (let attempt = 0; attempt < want * 24 && placed < want; attempt++) {
      const idx = tiles[Math.floor(rng() * tiles.length)]
      const cx = idx % size
      const cy = (idx / size) | 0
      const r = 2 + rng() * (maxR - 2)
      if (!ringIsLand(elevation, size, cx, cy, r)) continue
      carveLake(elevation, size, cx, cy, r, carvedMask)
      placed++
    }
  }

  // The elevation noise can, on its own, dip below sea level somewhere that
  // never reaches the map edge - an accidental puddle nobody asked for,
  // indistinguishable from a real lake once it's just "water below sea level
  // that isn't ocean". Left alone, that silently inflates lakeCount past
  // whatever minLakes/maxLakes actually requested (and can add a "lake"
  // even when maxLakes is 0). Anything below sea level that carveLake didn't
  // put there gets nudged back above it - just past the beach band, so it
  // reads as ordinary land rather than a suspiciously flat sliver at exactly
  // sea level.
  const postCarve = floodFillOcean(elevation, size)
  for (let i = 0; i < elevation.length; i++) {
    if (postCarve.isWater[i] && !postCarve.isOcean[i] && !carvedMask[i]) {
      elevation[i] = SEA_LEVEL + BEACH_WIDTH
    }
  }

  // Biomes are read off each island's *own* relief rather than the world's.
  // Elevation is normalized across the whole map, so on an archipelago every
  // island but the tallest sat in the bottom of that range - and came out as
  // one flat sheet of beach with nothing living on it. Measuring altitude
  // against the island's own summit gives a low island its own lowlands and
  // uplands. The floor keeps a genuine sandbar a sandbar: something barely
  // above the tide does not get a treeline.
  const islandRelief = new Map()
  for (let i = 0; i < pre.landId.length; i++) {
    const id = pre.landId[i]
    if (id < 0) continue
    const e = elevation[i]
    if (!(islandRelief.get(id) >= e)) islandRelief.set(id, e)
  }
  for (const [id, peak] of islandRelief) islandRelief.set(id, Math.max(MIN_ISLAND_RELIEF, peak - SEA_LEVEL))

  const { isWater, isOcean } = floodFillOcean(elevation, size)

  const tileType = new Uint8Array(size * size)
  const temperature = new Float32Array(size * size)
  const jitterX = new Float32Array(size * size)
  const jitterY = new Float32Array(size * size)
  const scaleVar = new Float32Array(size * size)
  const canHaveApple = new Uint8Array(size * size)

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = y * size + x
      jitterX[i] = rng()
      jitterY[i] = rng()
      scaleVar[i] = 0.75 + rng() * 0.5

      const relief = islandRelief.get(pre.landId[i]) ?? 1 - SEA_LEVEL
      const alt = Math.min(1, Math.max(0, (elevation[i] - SEA_LEVEL) / relief))
      // Latitude runs 0 (top of the map, cold) to 1 (bottom, hot).
      const t = temperatureAt(y / (size - 1), tempNoise[i], alt, climate)
      temperature[i] = t

      if (isWater[i]) {
        tileType[i] = isOcean[i] ? TILE.OCEAN : TILE.LAKE
      } else if (elevation[i] < SEA_LEVEL + BEACH_WIDTH) {
        tileType[i] = TILE.BEACH
      } else {
        tileType[i] = classifyLand(alt, Math.min(1.5, moisture[i] * vegetation), t)
      }
      // Which tiles may ever bear fruit is fixed here from the map's own
      // seed (whether one *currently* has an apple is the simulation's
      // business). Forest carries the crop; the pines and the reedbeds carry
      // a fraction of it, which is what makes a cold or wet island a harder
      // place to make a living than a temperate one.
      const fruit = fruitFraction(tileType[i])
      canHaveApple[i] = fruit > 0 && rng() < fruit ? 1 : 0
    }
  }

  // Who is on which landmass, and which landmasses are close enough to swim
  // between (see islands.js).
  const { landId, islands } = labelIslands(tileType, size)
  // Every scrap of land above the waterline is an "island" to the flood fill,
  // including one-tile rocks. Only the ones big enough to actually hold a
  // population are counted for the player, and those get a small sequential
  // number to be known by - the flood fill's own ids run over the rocks too,
  // so "island 17 of 12" is the alternative.
  let labelled = 0
  for (const island of islands) {
    island.notable = island.area >= NOTABLE_ISLAND_AREA
    island.label = island.notable ? ++labelled : 0
  }
  const waters = analyseWaters(tileType, landId, size, SHALLOW_TILES, islands.length)

  // Mark water tiles that sit right next to a beach, so rendering can tint
  // them as a sandbank visible through shallow water.
  const nearShallow = new Uint8Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x
      if (!isWaterType(tileType[idx])) continue
      let near = false
      for (let dy = -1; dy <= 1 && !near; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue
          const nx = x + dx
          const ny = y + dy
          if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue
          if (tileType[ny * size + nx] === TILE.BEACH) {
            near = true
            break
          }
        }
      }
      nearShallow[idx] = near ? 1 : 0
    }
  }

  return {
    size,
    seed,
    climate,
    lakeCount: countBodies(tileType, size, TILE.LAKE),
    islandCount: islands.filter((i) => i.notable).length,
    tileType,
    elevation,
    temperature,
    jitterX,
    jitterY,
    scaleVar,
    nearShallow,
    canHaveApple,
    // Islands and the water between them.
    landId,
    islands,
    shallow: waters.shallow,
    straits: waters.straits,
    islandGroup: waters.group,
    // How many *separate* worlds this is, as far as a population is
    // concerned: islands one strong swimmer could get between count once.
    // Counted over notable islands only - a rock in a channel is not a place
    // anything lives, and shouldn't inflate the number.
    groupCount: new Set(islands.filter((i) => i.notable).map((i) => waters.group[i.id])).size,
  }
}

// ======================= Rendering =======================
function mix(a, b, t) {
  return a + (b - a) * t
}
function rgb(r, g, b) {
  return `rgb(${r | 0},${g | 0},${b | 0})`
}

// Cheap deterministic hash -> [0,1). Used to scatter extra foliage (extra
// trees, undergrowth, grass tufts) per tile without storing large arrays
// for every possible sub-feature - just a tile index and a small "which
// feature" key.
function hash01(i, k) {
  let h = (i * 374761393 + k * 2654435761) | 0
  h = Math.imul(h ^ (h >>> 15), 2246822519)
  h ^= h >>> 13
  h = Math.imul(h, 3266489917)
  h ^= h >>> 16
  return (h >>> 0) / 4294967296
}

function tileColor(map, idx) {
  const t = map.tileType[idx]
  const e = map.elevation[idx]
  if (t === TILE.OCEAN) {
    const depth = Math.min(1, Math.max(0, (SEA_LEVEL - e) / SEA_LEVEL))
    let r = mix(60, 12, depth)
    let g = mix(120, 46, depth)
    let b = mix(160, 82, depth)
    if (map.nearShallow[idx]) {
      r = mix(r, 200, 0.4)
      g = mix(g, 188, 0.4)
      b = mix(b, 148, 0.4)
    }
    return rgb(r, g, b)
  }
  if (t === TILE.LAKE) {
    const depth = Math.min(1, Math.max(0, (SEA_LEVEL - e) / 0.35))
    let r = mix(110, 55, depth)
    let g = mix(170, 130, depth)
    let b = mix(180, 150, depth)
    if (map.nearShallow[idx]) {
      r = mix(r, 195, 0.35)
      g = mix(g, 182, 0.35)
      b = mix(b, 146, 0.35)
    }
    return rgb(r, g, b)
  }
  if (t === TILE.BEACH) {
    const wet = Math.min(1, Math.max(0, (e - SEA_LEVEL) / BEACH_WIDTH))
    return rgb(mix(196, 227, wet), mix(178, 210, wet), mix(140, 168, wet))
  }
  const [r, g, b] = landTone(t, e)
  return rgb(r, g, b)
}

/** A land biome's base tone, darkened a little as the ground rises so a
 *  hillside reads as a hillside rather than a flat sheet of one colour. Snow
 *  and rock go the other way - the high ground is the *bright* part of a
 *  mountain, not the shaded part. */
function landTone(t, e) {
  const base = BIOME[t]?.color ?? [120, 150, 90]
  const alt = Math.max(0, (e - SEA_LEVEL) / (1 - SEA_LEVEL))
  const shift = t === TILE.SNOW || t === TILE.ROCK ? (alt - 0.5) * 26 : (0.5 - alt) * 26
  return [base[0] + shift, base[1] + shift, base[2] + shift]
}

function drawForestTile(ctx, map, idx, sx, sy, tilePx, count) {
  const baseS = map.scaleVar[idx]
  // Fewer, larger trees per tile than a flat per-tree scale would give -
  // dense overlapping canopies were the main source of the "cluttered flat
  // blobs" look, so trade count for per-tree detail instead.
  const spread = count > 1 ? 0.68 : 1
  for (let k = 0; k < count; k++) {
    const jx = k === 0 ? map.jitterX[idx] : hash01(idx, k * 7 + 1)
    const jy = k === 0 ? map.jitterY[idx] : hash01(idx, k * 7 + 2)
    const s = (k === 0 ? baseS : 0.55 + hash01(idx, k * 7 + 3) * 0.55) * spread
    const cx = sx + jx * tilePx
    const cy = sy + jy * tilePx
    const canopyR = Math.max(1, tilePx * 0.4 * s)
    const shade = hash01(idx, k * 7 + 4)

    // Ground shadow, for a little grounding/volume instead of a flat
    // sprite sitting directly on the tile fill.
    if (tilePx >= 6) {
      ctx.beginPath()
      ctx.fillStyle = 'rgba(10,20,10,0.25)'
      ctx.ellipse(cx + canopyR * 0.12, cy + canopyR * 0.9, canopyR * 0.75, canopyR * 0.28, 0, 0, Math.PI * 2)
      ctx.fill()
    }

    // Canopy: a shadowed underside plus an offset lit crown (two solid
    // tones instead of one flat circle) so each tree reads as a rounded
    // form rather than merging into a flat green mass with its neighbors.
    const canopyCx = cx
    const canopyCy = cy + canopyR * 0.12
    ctx.beginPath()
    ctx.fillStyle = rgb(mix(24, 54, shade), mix(78, 118, shade), mix(34, 58, shade))
    ctx.arc(canopyCx, canopyCy, canopyR, 0, Math.PI * 2)
    ctx.fill()
    if (tilePx >= 7) {
      ctx.lineWidth = Math.max(0.5, tilePx * 0.03)
      ctx.strokeStyle = 'rgba(16,32,18,0.4)'
      ctx.stroke()
    }
    ctx.beginPath()
    ctx.fillStyle = rgb(mix(46, 86, shade), mix(112, 158, shade), mix(52, 82, shade))
    ctx.arc(cx - canopyR * 0.22, cy - canopyR * 0.22, canopyR * 0.78, 0, Math.PI * 2)
    ctx.fill()
    if (tilePx >= 10) {
      ctx.beginPath()
      ctx.fillStyle = 'rgba(255,244,200,0.18)'
      ctx.arc(cx - canopyR * 0.4, cy - canopyR * 0.42, canopyR * 0.32, 0, Math.PI * 2)
      ctx.fill()
    }

    // Trunk, drawn last so it actually pokes out beneath the canopy -
    // previously it was drawn (and hidden) underneath the canopy fill,
    // which is why trees had no visible trunk at all.
    if (tilePx >= 5) {
      const trunkW = Math.max(1, tilePx * 0.12 * s)
      const trunkTop = cy + canopyR * 0.55
      const trunkBot = cy + canopyR * 1.15
      ctx.beginPath()
      ctx.moveTo(cx - trunkW * 0.5, trunkTop)
      ctx.lineTo(cx + trunkW * 0.5, trunkTop)
      ctx.lineTo(cx + trunkW * 0.3, trunkBot)
      ctx.lineTo(cx - trunkW * 0.3, trunkBot)
      ctx.closePath()
      ctx.fillStyle = 'rgb(68,50,32)'
      ctx.fill()
      if (tilePx >= 9) {
        ctx.fillStyle = 'rgba(255,224,180,0.18)'
        ctx.beginPath()
        ctx.moveTo(cx - trunkW * 0.12, trunkTop)
        ctx.lineTo(cx, trunkTop)
        ctx.lineTo(cx - trunkW * 0.05, trunkBot)
        ctx.lineTo(cx - trunkW * 0.16, trunkBot)
        ctx.closePath()
        ctx.fill()
      }
    }
  }
}

function drawShrubTile(ctx, map, idx, sx, sy, tilePx, clumps) {
  const spread = clumps > 1 ? 0.78 : 1
  for (let k = 0; k < clumps; k++) {
    const jx = k === 0 ? map.jitterX[idx] : hash01(idx, k * 11 + 5)
    const jy = k === 0 ? map.jitterY[idx] : hash01(idx, k * 11 + 6)
    const s = (k === 0 ? map.scaleVar[idx] : 0.6 + hash01(idx, k * 11 + 7) * 0.5) * spread
    const cx = sx + jx * tilePx
    const cy = sy + jy * tilePx
    const r = Math.max(0.8, tilePx * 0.26 * s)
    ctx.beginPath()
    ctx.fillStyle = rgb(100 + hash01(idx, k) * 24, 144 + hash01(idx, k + 1) * 24, 76 + hash01(idx, k + 2) * 16)
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    if (tilePx >= 8) {
      ctx.lineWidth = Math.max(0.4, tilePx * 0.025)
      ctx.strokeStyle = 'rgba(28,44,20,0.4)'
      ctx.stroke()
    }
  }
}

/** The cold forest: conifers, drawn as stacked triangles rather than the
 *  broadleaf blobs above, because "which forest am I in" should be readable
 *  at a glance and not just from the tile tint underneath. */
function drawConiferTile(ctx, map, idx, sx, sy, tilePx, count) {
  const spread = count > 1 ? 0.7 : 1
  for (let k = 0; k < count; k++) {
    const jx = k === 0 ? map.jitterX[idx] : hash01(idx, k * 13 + 1)
    const jy = k === 0 ? map.jitterY[idx] : hash01(idx, k * 13 + 2)
    const s = (k === 0 ? map.scaleVar[idx] : 0.6 + hash01(idx, k * 13 + 3) * 0.5) * spread
    const cx = sx + jx * tilePx
    const cy = sy + jy * tilePx
    const h = Math.max(2, tilePx * 0.85 * s)
    const w = h * 0.46
    const shade = hash01(idx, k * 13 + 4)

    if (tilePx >= 6) {
      ctx.beginPath()
      ctx.fillStyle = 'rgba(8,18,14,0.28)'
      ctx.ellipse(cx + w * 0.2, cy + h * 0.42, w * 0.6, h * 0.14, 0, 0, Math.PI * 2)
      ctx.fill()
    }
    if (tilePx >= 5) {
      ctx.fillStyle = 'rgb(62,46,34)'
      ctx.fillRect(cx - Math.max(0.6, w * 0.1), cy + h * 0.14, Math.max(1.2, w * 0.2), h * 0.3)
    }
    // Two skirts of needles, the lower one wider - a fir silhouette.
    for (let tier = 0; tier < 2; tier++) {
      const tw = w * (1 - tier * 0.3)
      const top = cy - h * (0.42 - tier * 0.26)
      const bottom = cy + h * (0.2 - tier * 0.3)
      ctx.beginPath()
      ctx.moveTo(cx, top)
      ctx.lineTo(cx + tw, bottom)
      ctx.lineTo(cx - tw, bottom)
      ctx.closePath()
      ctx.fillStyle = rgb(mix(28, 52, shade) + tier * 10, mix(74, 104, shade) + tier * 12, mix(56, 78, shade) + tier * 8)
      ctx.fill()
    }
  }
}

/** Reedbeds and standing water: a wet, dark tile with vertical strokes and
 *  the odd pool showing through. */
function drawMarshTile(ctx, map, idx, sx, sy, tilePx) {
  if (hash01(idx, 71) > 0.55) {
    ctx.beginPath()
    ctx.fillStyle = 'rgba(74,116,124,0.55)'
    ctx.ellipse(
      sx + (0.3 + map.jitterX[idx] * 0.4) * tilePx,
      sy + (0.3 + map.jitterY[idx] * 0.4) * tilePx,
      tilePx * 0.3,
      tilePx * 0.2,
      0,
      0,
      Math.PI * 2,
    )
    ctx.fill()
  }
  ctx.strokeStyle = 'rgba(126,146,86,0.75)'
  ctx.lineWidth = Math.max(0.5, tilePx * 0.045)
  ctx.beginPath()
  for (let k = 0; k < 5; k++) {
    const bx = sx + hash01(idx, k * 3 + 72) * tilePx
    const by = sy + (0.55 + hash01(idx, k * 3 + 73) * 0.45) * tilePx
    const h = tilePx * (0.3 + hash01(idx, k * 3 + 74) * 0.25)
    ctx.moveTo(bx, by)
    ctx.lineTo(bx + (hash01(idx, k * 3 + 75) - 0.5) * h * 0.5, by - h)
  }
  ctx.stroke()
}

/** Dry grass with the occasional flat-topped tree standing on its own. */
function drawSavannaTile(ctx, map, idx, sx, sy, tilePx) {
  ctx.strokeStyle = 'rgba(146,126,52,0.5)'
  ctx.lineWidth = Math.max(0.5, tilePx * 0.035)
  ctx.beginPath()
  for (let k = 0; k < 4; k++) {
    const bx = sx + hash01(idx, k * 3 + 80) * tilePx
    const by = sy + hash01(idx, k * 3 + 81) * tilePx
    const h = tilePx * (0.1 + hash01(idx, k * 3 + 82) * 0.1)
    ctx.moveTo(bx, by)
    ctx.lineTo(bx + (hash01(idx, k * 3 + 83) - 0.5) * h, by - h)
  }
  ctx.stroke()
  if (hash01(idx, 88) > 0.88 && tilePx >= 8) {
    const cx = sx + map.jitterX[idx] * tilePx
    const cy = sy + map.jitterY[idx] * tilePx
    const r = tilePx * 0.3 * map.scaleVar[idx]
    ctx.fillStyle = 'rgb(74,58,36)'
    ctx.fillRect(cx - r * 0.08, cy - r * 0.1, Math.max(1, r * 0.16), r * 0.8)
    ctx.beginPath()
    ctx.fillStyle = 'rgb(96,116,64)'
    ctx.ellipse(cx, cy - r * 0.25, r, r * 0.4, 0, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Frozen ground: moss cushions and frost-shattered stones. */
function drawTundraTile(ctx, map, idx, sx, sy, tilePx) {
  for (let k = 0; k < 3; k++) {
    const px = sx + hash01(idx, k * 2 + 90) * tilePx
    const py = sy + hash01(idx, k * 2 + 91) * tilePx
    const r = Math.max(0.6, tilePx * (0.05 + hash01(idx, k + 94) * 0.06))
    ctx.beginPath()
    ctx.fillStyle = hash01(idx, k + 96) > 0.55 ? 'rgba(112,124,104,0.75)' : 'rgba(158,166,140,0.6)'
    ctx.arc(px, py, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Wind-blown dunes: long ripples, no plants at all. */
function drawDesertDetail(ctx, idx, sx, sy, tilePx) {
  ctx.strokeStyle = 'rgba(178,146,88,0.4)'
  ctx.lineWidth = Math.max(0.5, tilePx * 0.035)
  for (let k = 0; k < 2; k++) {
    const ry = sy + (0.3 + k * 0.4 + hash01(idx, k + 100) * 0.12) * tilePx
    ctx.beginPath()
    ctx.moveTo(sx, ry)
    ctx.quadraticCurveTo(sx + tilePx * 0.5, ry - tilePx * 0.16, sx + tilePx, ry + tilePx * 0.04)
    ctx.stroke()
  }
}

/** Boulders on bare upland rock. */
function drawRockTile(ctx, map, idx, sx, sy, tilePx) {
  for (let k = 0; k < 2; k++) {
    const px = sx + hash01(idx, k * 2 + 110) * tilePx
    const py = sy + hash01(idx, k * 2 + 111) * tilePx
    const r = Math.max(0.8, tilePx * (0.1 + hash01(idx, k + 114) * 0.12) * map.scaleVar[idx])
    ctx.beginPath()
    ctx.fillStyle = 'rgba(96,92,88,0.85)'
    ctx.ellipse(px, py, r, r * 0.75, hash01(idx, k + 116) * Math.PI, 0, Math.PI * 2)
    ctx.fill()
    ctx.beginPath()
    ctx.fillStyle = 'rgba(176,172,166,0.5)'
    ctx.ellipse(px - r * 0.25, py - r * 0.3, r * 0.45, r * 0.32, 0, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Snowfield: drift shadows and a little glare, so it isn't a white void. */
function drawSnowTile(ctx, idx, sx, sy, tilePx) {
  ctx.strokeStyle = 'rgba(176,196,220,0.4)'
  ctx.lineWidth = Math.max(0.5, tilePx * 0.04)
  ctx.beginPath()
  const ry = sy + (0.35 + hash01(idx, 120) * 0.3) * tilePx
  ctx.moveTo(sx, ry)
  ctx.quadraticCurveTo(sx + tilePx * 0.5, ry - tilePx * 0.18, sx + tilePx, ry + tilePx * 0.06)
  ctx.stroke()
  if (hash01(idx, 122) > 0.75) {
    ctx.beginPath()
    ctx.fillStyle = 'rgba(255,255,255,0.9)'
    ctx.arc(sx + hash01(idx, 123) * tilePx, sy + hash01(idx, 124) * tilePx, Math.max(0.5, tilePx * 0.05), 0, Math.PI * 2)
    ctx.fill()
  }
}

/**
 * Ragged edges between two land biomes.
 *
 * The wooded biomes hide the tile grid behind their own scatter of canopies,
 * but a snowfield meeting bare rock is two flat fills against each other, and
 * that reads as a staircase of squares - the one place the map still looks
 * like a spreadsheet. Each tile spills a few blobs of its own colour over the
 * boundary; both sides do it, so the edge interlocks instead of stepping.
 */
const SOFT_EDGE_BIOMES = new Set([TILE.SNOW, TILE.ROCK, TILE.TUNDRA, TILE.DESERT, TILE.SAVANNA, TILE.GRASS, TILE.SHRUB, TILE.MARSH])

function drawBiomeEdge(ctx, map, idx, x, y, sx, sy, tilePx) {
  const size = map.size
  const t = map.tileType[idx]
  const r = tilePx * 0.3
  ctx.fillStyle = tileColor(map, idx)
  for (let k = 0; k < 4; k++) {
    const dx = k === 0 ? 1 : k === 1 ? -1 : 0
    const dy = k === 2 ? 1 : k === 3 ? -1 : 0
    const nx = x + dx
    const ny = y + dy
    if (nx < 0 || ny < 0 || nx >= size || ny >= size) continue
    const nt = map.tileType[ny * size + nx]
    if (nt === t || isWaterType(nt) || nt === TILE.BEACH) continue
    if (!SOFT_EDGE_BIOMES.has(t) && !SOFT_EDGE_BIOMES.has(nt)) continue
    // Two blobs per shared edge, jittered along it and pushed a little way
    // into the neighbour.
    for (let b = 0; b < 2; b++) {
      const along = 0.25 + hash01(idx, k * 5 + b + 130) * 0.5
      const over = 0.5 + hash01(idx, k * 5 + b + 140) * 0.32
      const cx = sx + (dx === 0 ? along : 0.5 + dx * over) * tilePx
      const cy = sy + (dy === 0 ? along : 0.5 + dy * over) * tilePx
      ctx.beginPath()
      ctx.arc(cx, cy, r * (0.7 + hash01(idx, k * 5 + b + 150) * 0.5), 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

/** Sparse grass tufts and the odd tiny flower - only worth the draw calls once
 *  tiles are large enough on screen to actually show them (i.e. zoomed in). */
function drawGrassDetail(ctx, idx, sx, sy, tilePx) {
  ctx.strokeStyle = 'rgba(64,54,18,0.4)'
  ctx.lineWidth = Math.max(0.5, tilePx * 0.035)
  ctx.beginPath()
  for (let k = 0; k < 3; k++) {
    const bx = sx + hash01(idx, k * 3 + 20) * tilePx
    const by = sy + hash01(idx, k * 3 + 21) * tilePx
    const h = tilePx * (0.14 + hash01(idx, k * 3 + 22) * 0.12)
    const lean = (hash01(idx, k * 3 + 23) - 0.5) * h
    ctx.moveTo(bx, by)
    ctx.lineTo(bx + lean, by - h)
  }
  ctx.stroke()
  if (hash01(idx, 40) > 0.8) {
    const fx = sx + hash01(idx, 41) * tilePx
    const fy = sy + hash01(idx, 42) * tilePx
    ctx.beginPath()
    ctx.fillStyle = hash01(idx, 43) > 0.5 ? 'rgba(255,226,120,0.85)' : 'rgba(255,255,255,0.75)'
    ctx.arc(fx, fy, Math.max(0.6, tilePx * 0.055), 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Sand ripples and scattered pebbles/shell fragments on a beach tile -
 *  only worth it once tiles are large enough on screen to read as texture
 *  rather than noise. */
function drawBeachDetail(ctx, idx, sx, sy, tilePx) {
  ctx.strokeStyle = 'rgba(150,118,70,0.28)'
  ctx.lineWidth = Math.max(0.5, tilePx * 0.03)
  for (let k = 0; k < 2; k++) {
    const ry = sy + (0.28 + k * 0.36 + hash01(idx, k + 50) * 0.14) * tilePx
    ctx.beginPath()
    ctx.moveTo(sx, ry)
    ctx.quadraticCurveTo(sx + tilePx * 0.5, ry - tilePx * 0.1, sx + tilePx, ry + tilePx * 0.02)
    ctx.stroke()
  }
  for (let k = 0; k < 3; k++) {
    const px = sx + hash01(idx, k * 2 + 60) * tilePx
    const py = sy + hash01(idx, k * 2 + 61) * tilePx
    const r = Math.max(0.5, tilePx * 0.035)
    ctx.beginPath()
    ctx.fillStyle = hash01(idx, k + 65) > 0.5 ? 'rgba(255,250,240,0.55)' : 'rgba(120,88,52,0.4)'
    ctx.arc(px, py, r, 0, Math.PI * 2)
    ctx.fill()
  }
}

/** Continuous (non-tile-snapped) water/beach color for a given elevation,
 *  used to actually smooth the coastline rather than just draw a line over
 *  the blocky tile edge. Returns null beyond the beach, where the flat
 *  grass/shrub/forest tile fill underneath is left showing. */
function shoreColor(e, isLake) {
  if (e < SEA_LEVEL) {
    if (isLake) {
      const depth = Math.min(1, Math.max(0, (SEA_LEVEL - e) / 0.35))
      return rgb(mix(110, 55, depth), mix(170, 130, depth), mix(180, 150, depth))
    }
    const depth = Math.min(1, Math.max(0, (SEA_LEVEL - e) / SEA_LEVEL))
    return rgb(mix(60, 12, depth), mix(120, 46, depth), mix(160, 82, depth))
  }
  if (e < SEA_LEVEL + BEACH_WIDTH) {
    const wet = Math.min(1, Math.max(0, (e - SEA_LEVEL) / BEACH_WIDTH))
    return rgb(mix(196, 227, wet), mix(178, 210, wet), mix(140, 168, wet))
  }
  return null
}

/**
 * Repaint the coast with a finely-subdivided, bilinearly-interpolated fill
 * instead of the flat per-tile squares. The blocky look comes from the base
 * pass giving every tile one flat color regardless of how elevation actually
 * crosses it - this covers both edges of the beach (water-to-sand and
 * sand-to-land), and only touches tiles either line actually cuts through,
 * so it stays cheap (proportional to coastline length, not map area).
 */
function drawShoreSmoothing(ctx, map, tilePx, ox, oy, startX, startY, endX, endY) {
  if (tilePx < 8) return
  const size = map.size
  const elevation = map.elevation
  const tileType = map.tileType
  const cx0 = Math.max(0, startX - 1)
  const cy0 = Math.max(0, startY - 1)
  const cx1 = Math.min(size - 2, endX)
  const cy1 = Math.min(size - 2, endY)
  if (cx0 > cx1 || cy0 > cy1) return

  const N = tilePx >= 24 ? 8 : 5
  const sub = tilePx / N

  for (let y = cy0; y <= cy1; y++) {
    for (let x = cx0; x <= cx1; x++) {
      const i00 = y * size + x
      const i10 = y * size + x + 1
      const i01 = (y + 1) * size + x
      const i11 = (y + 1) * size + x + 1
      const a = elevation[i00]
      const b = elevation[i10]
      const c = elevation[i01]
      const d = elevation[i11]
      const lo = Math.min(a, b, c, d)
      const hi = Math.max(a, b, c, d)
      // Skip cells that don't touch the coastal band at all (pure deep
      // water, or pure land past the beach) - only the water/beach/land
      // ring actually needs smoothing.
      if (hi < SEA_LEVEL || lo >= SEA_LEVEL + BEACH_WIDTH) continue

      const isLake =
        tileType[i00] === TILE.LAKE ||
        tileType[i10] === TILE.LAKE ||
        tileType[i01] === TILE.LAKE ||
        tileType[i11] === TILE.LAKE

      // Beyond the beach there's no continuous formula (land color depends
      // on moisture, not just elevation), so subpixels out there fall back
      // to a real corner's tile color. That fallback MUST be a corner that
      // is actually land: picking "nearest corner by u<0.5/v<0.5" ignored
      // elevation entirely, so a subpixel already past the beach (e.g.
      // u=0.45, pulled there by a high value at corner b) could still end
      // up nearest, in raw u/v terms, to a low WATER corner a - painting a
      // stray patch of water on what should already be dry land, which is
      // exactly what showed up as a sand ring with water on both sides.
      const aLand = a >= SEA_LEVEL + BEACH_WIDTH
      const bLand = b >= SEA_LEVEL + BEACH_WIDTH
      const cLand = c >= SEA_LEVEL + BEACH_WIDTH
      const dLand = d >= SEA_LEVEL + BEACH_WIDTH

      // elevation[x,y] represents the value at tile (x,y)'s own square, i.e.
      // effectively sampled at that square's CENTER (that's what the flat
      // per-tile fill treats it as). So the cell spanned by corners
      // (x,y)..(x+1,y+1) sits half a tile down-right of tile (x,y)'s own
      // square, not on top of it - paint there, or the interpolated colour
      // ends up a half-tile off from the real boundary.
      const baseX = (x + 0.5) * tilePx - ox
      const baseY = (y + 0.5) * tilePx - oy
      for (let j = 0; j < N; j++) {
        const v = (j + 0.5) / N
        for (let i = 0; i < N; i++) {
          const u = (i + 0.5) / N
          const top = a + (b - a) * u
          const bot = c + (d - c) * u
          const e = top + (bot - top) * v
          let col = shoreColor(e, isLake)
          if (!col) {
            let bestIdx = -1
            let bestDist = Infinity
            if (aLand) {
              const dist = u * u + v * v
              if (dist < bestDist) {
                bestDist = dist
                bestIdx = i00
              }
            }
            if (bLand) {
              const du = 1 - u
              const dist = du * du + v * v
              if (dist < bestDist) {
                bestDist = dist
                bestIdx = i10
              }
            }
            if (cLand) {
              const dv = 1 - v
              const dist = u * u + dv * dv
              if (dist < bestDist) {
                bestDist = dist
                bestIdx = i01
              }
            }
            if (dLand) {
              const du = 1 - u
              const dv = 1 - v
              const dist = du * du + dv * dv
              if (dist < bestDist) {
                bestDist = dist
                bestIdx = i11
              }
            }
            // hi >= SEA_LEVEL + BEACH_WIDTH (the cell-skip condition above)
            // guarantees at least one land corner exists, but fall back to
            // the beach tone defensively rather than leave a gap.
            col = bestIdx >= 0 ? tileColor(map, bestIdx) : shoreColor(SEA_LEVEL + BEACH_WIDTH - 1e-4, isLake)
          }
          ctx.fillStyle = col
          ctx.fillRect(baseX + i * sub, baseY + j * sub, sub + 0.6, sub + 0.6)
        }
      }
    }
  }
}

/**
 * Trace the smoothed shoreline with marching squares (same technique as the
 * menu's ContourBackdrop, but on real map data): a static waterline for
 * every coast and lake shore, plus - ocean coast only, lakes stay calm -
 * a couple of foam bands that roll in from open water and break right at
 * the sand, looping continuously, rather than just sliding along the shore.
 */
function drawCoastline(ctx, map, tilePx, ox, oy, startX, startY, endX, endY, time) {
  if (tilePx < 6) return
  const size = map.size
  const elevation = map.elevation
  const tileType = map.tileType
  const cx0 = Math.max(0, startX - 1)
  const cy0 = Math.max(0, startY - 1)
  const cx1 = Math.min(size - 2, endX)
  const cy1 = Math.min(size - 2, endY)
  if (cx0 > cx1 || cy0 > cy1) return

  const level = SEA_LEVEL
  // [x0, y0, x1, y1, waterDirX, waterDirY, isLake]
  const segments = []
  for (let y = cy0; y <= cy1; y++) {
    for (let x = cx0; x <= cx1; x++) {
      const i00 = y * size + x
      const i10 = y * size + x + 1
      const i01 = (y + 1) * size + x
      const i11 = (y + 1) * size + x + 1
      const a = elevation[i00]
      const b = elevation[i10]
      const c = elevation[i01]
      const d = elevation[i11]
      const lo = Math.min(a, b, c, d)
      const hi = Math.max(a, b, c, d)
      if (level < lo || level > hi) continue
      // Same half-tile shift as drawShoreSmoothing - these corners describe
      // the cell centered between tile (x,y) and tile (x+1,y+1), not tile
      // (x,y)'s own square.
      const sx0 = (x + 0.5) * tilePx - ox
      const sx1 = (x + 1.5) * tilePx - ox
      const sy0 = (y + 0.5) * tilePx - oy
      const sy1 = (y + 1.5) * tilePx - oy
      const pts = []
      const edge = (v0, v1, ex0, ey0, ex1, ey1) => {
        if ((v0 < level) !== (v1 < level)) {
          const t = (level - v0) / (v1 - v0 || 1e-6)
          pts.push([ex0 + (ex1 - ex0) * t, ey0 + (ey1 - ey0) * t])
        }
      }
      edge(a, b, sx0, sy0, sx1, sy0) // top
      edge(b, d, sx1, sy0, sx1, sy1) // right
      edge(d, c, sx1, sy1, sx0, sy1) // bottom
      edge(c, a, sx0, sy1, sx0, sy0) // left
      if (pts.length < 2) continue

      const isLake =
        tileType[i00] === TILE.LAKE ||
        tileType[i10] === TILE.LAKE ||
        tileType[i01] === TILE.LAKE ||
        tileType[i11] === TILE.LAKE
      // Elevation increases inland, so the negated gradient points out to
      // sea - the direction waves are drawn rolling in from.
      const gx = b + d - (a + c)
      const gy = c + d - (a + b)
      const glen = Math.hypot(gx, gy) || 1
      const wx = -gx / glen
      const wy = -gy / glen

      segments.push([pts[0][0], pts[0][1], pts[1][0], pts[1][1], wx, wy, isLake])
      // A saddle cell (opposite corners on opposite sides of sea level)
      // crosses all 4 edges - draw both resulting segments instead of
      // silently dropping the second one, which used to pinch the coast.
      if (pts.length === 4) {
        segments.push([pts[2][0], pts[2][1], pts[3][0], pts[3][1], wx, wy, isLake])
      }
    }
  }
  if (!segments.length) return

  ctx.save()
  ctx.lineCap = 'round'
  ctx.lineJoin = 'round'

  // Static waterline, present on every coast and lake shore alike.
  ctx.beginPath()
  for (let i = 0; i < segments.length; i++) {
    const [x0, y0, x1, y1] = segments[i]
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
  }
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'
  ctx.lineWidth = Math.max(1, tilePx * 0.06)
  ctx.stroke()

  // Waves rolling in and breaking, ocean coast only - lakes have no surf.
  if (tilePx >= 10) {
    const oceanSegs = segments.filter((s) => !s[6])
    if (oceanSegs.length) {
      const maxOffset = tilePx * 0.6
      const period = 2200 // ms per wave cycle
      const pulseCount = 3
      for (let p = 0; p < pulseCount; p++) {
        const phase = p / pulseCount
        const t = (((time / period + phase) % 1) + 1) % 1
        const ease = t * t // slower out at sea, accelerating in - reads more like a real swell
        const offset = maxOffset * (1 - ease) // far out at t=0, at the sand by t=1
        const alpha = Math.pow(Math.sin(t * Math.PI), 0.6) * 0.7 // builds, breaks bright, fades
        if (alpha <= 0.02) continue
        ctx.beginPath()
        for (let i = 0; i < oceanSegs.length; i++) {
          const [x0, y0, x1, y1, wx, wy] = oceanSegs[i]
          const dx = wx * offset
          const dy = wy * offset
          ctx.moveTo(x0 + dx, y0 + dy)
          ctx.lineTo(x1 + dx, y1 + dy)
        }
        ctx.strokeStyle = `rgba(255,255,255,${alpha.toFixed(3)})`
        ctx.lineWidth = Math.max(1, tilePx * (0.04 + 0.08 * t))
        ctx.stroke()
      }
    }
  }
  ctx.restore()
}

/**
 * Draw a (possibly scrolled/zoomed) view of a generated map onto a 2D
 * canvas context.
 *
 * `tilePx` is the current zoom level in CSS px per tile. `viewport` is
 * optional: `{ originX, originY, width, height }`, where originX/originY
 * are the tile coordinates (may be fractional) shown at the top-left
 * corner of the canvas, and width/height are the canvas's CSS px size.
 * Omitting `viewport` draws the whole map at (0,0), as before.
 *
 * Vegetation detail (how many trees/shrubs per tile, whether grass gets
 * tufts and flowers) scales up with `tilePx` so zoomed-out views stay
 * legible while zooming in reveals individual plants on the ground.
 *
 * `time` (ms elapsed, optional) animates the wave line along the coast;
 * pass an increasing value from a render loop for the waves to flow, or
 * omit it for a static (but still smoothed) coastline.
 *
 * Below ATLAS_TILE_PX - which is where a big world sits when it is zoomed out
 * far enough to see all of it at once - none of the per-tile detail is even
 * visible, and drawing 50,000 fillRects a frame to produce a blur is a waste.
 * That zoom level gets the atlas instead (see drawAtlas).
 */
export function drawMap(ctx, map, tilePx, viewport, time = 0) {
  const size = map.size
  const view = viewport || { originX: 0, originY: 0, width: size * tilePx, height: size * tilePx }
  const ox = view.originX * tilePx
  const oy = view.originY * tilePx

  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, view.width, view.height)

  if (usesAtlas(map, tilePx) && drawAtlas(ctx, map, tilePx, ox, oy)) return

  const startX = Math.max(0, Math.floor(view.originX))
  const startY = Math.max(0, Math.floor(view.originY))
  const endX = Math.min(size - 1, Math.ceil(view.originX + view.width / tilePx))
  const endY = Math.min(size - 1, Math.ceil(view.originY + view.height / tilePx))
  if (startX > endX || startY > endY) return

  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) {
      const idx = y * size + x
      ctx.fillStyle = tileColor(map, idx)
      ctx.fillRect(x * tilePx - ox, y * tilePx - oy, tilePx + 0.6, tilePx + 0.6)
    }
  }

  // Second pass: repaint the shoreline smoothly instead of tile-blocky,
  // then stroke a simple animated wave line along it.
  drawShoreSmoothing(ctx, map, tilePx, ox, oy, startX, startY, endX, endY)
  drawCoastline(ctx, map, tilePx, ox, oy, startX, startY, endX, endY, time)

  // Third pass: vegetation and beach texture on top so canopies can
  // overlap tile edges.
  // Capped at 2/tile (was 3) - fewer, more detailed trees read as an actual
  // forest instead of a wall of overlapping flat canopies.
  const treeCount = tilePx >= 14 ? 2 : 1
  const shrubCount = tilePx >= 14 ? 2 : 1
  // Break up the boundaries between the flat-filled biomes first, so anything
  // scattered on top of them still lands on top.
  if (tilePx >= 6) {
    for (let y = startY; y <= endY; y++) {
      for (let x = startX; x <= endX; x++) {
        const idx = y * size + x
        const t = map.tileType[idx]
        if (isWaterType(t) || t === TILE.BEACH) continue
        drawBiomeEdge(ctx, map, idx, x, y, x * tilePx - ox, y * tilePx - oy, tilePx)
      }
    }
  }
  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) {
      const idx = y * size + x
      const t = map.tileType[idx]
      const sx = x * tilePx - ox
      const sy = y * tilePx - oy
      // Each biome gets its own ground cover, and the fine textures (a
      // tundra's stones, a desert's ripples) only switch on once a tile is
      // big enough on screen for them to read as anything.
      if (t === TILE.FOREST) drawForestTile(ctx, map, idx, sx, sy, tilePx, treeCount)
      else if (t === TILE.TAIGA) drawConiferTile(ctx, map, idx, sx, sy, tilePx, treeCount)
      else if (t === TILE.SHRUB) drawShrubTile(ctx, map, idx, sx, sy, tilePx, shrubCount)
      else if (t === TILE.MARSH && tilePx >= 8) drawMarshTile(ctx, map, idx, sx, sy, tilePx)
      else if (t === TILE.SAVANNA && tilePx >= 10) drawSavannaTile(ctx, map, idx, sx, sy, tilePx)
      else if (t === TILE.GRASS && tilePx >= 14) drawGrassDetail(ctx, idx, sx, sy, tilePx)
      else if (t === TILE.BEACH && tilePx >= 12) drawBeachDetail(ctx, idx, sx, sy, tilePx)
      else if (t === TILE.DESERT && tilePx >= 12) drawDesertDetail(ctx, idx, sx, sy, tilePx)
      else if (t === TILE.TUNDRA && tilePx >= 10) drawTundraTile(ctx, map, idx, sx, sy, tilePx)
      else if (t === TILE.ROCK && tilePx >= 8) drawRockTile(ctx, map, idx, sx, sy, tilePx)
      else if (t === TILE.SNOW && tilePx >= 12) drawSnowTile(ctx, idx, sx, sy, tilePx)
    }
  }
}

// =========================== The zoomed-out atlas ==========================
// What you get when the whole world is on screen at once: not the same
// drawing shrunk, but a different map. Per-tile detail is meaningless at 3
// pixels a tile, and what actually matters at that zoom is the shape of the
// world - where the islands are, which biome bands they run through, and
// which channels between them are narrow enough to swim (see islands.js).
//
// The terrain half is painted once per map into an offscreen image at one
// pixel per tile and then scaled up, so panning around a 224-tile world at
// full zoom-out costs one blit a frame instead of fifty thousand fills. The
// straits are stroked on top afterwards, because they are the one thing worth
// picking out in a colour the terrain never uses.

/** Zoom (CSS px per tile) below which the atlas replaces the detailed draw. */
export const ATLAS_TILE_PX = 6
/** ...but only on a world big enough to need it. A 64-tile island fits on a
 *  phone at about 5px a tile, and that view has always shown real creatures on
 *  real terrain; swapping it for an overview would be a regression for the
 *  small maps rather than a feature. */
export const ATLAS_MIN_WORLD = 96

/** Whether this map at this zoom is drawn as the zoomed-out atlas. Shared with
 *  the simulation's renderer, which switches to dots and island tallies at the
 *  same moment (see sim/render.js). */
export function usesAtlas(map, tilePx) {
  return tilePx < ATLAS_TILE_PX && map.size >= ATLAS_MIN_WORLD
}

// Keyed by map so a regenerated world drops its old image, and weak so
// nothing is pinned in memory once the map itself is gone.
const atlasCache = new WeakMap()

function shadeAt(map, x, y) {
  const size = map.size
  const e = map.elevation
  const l = e[y * size + Math.max(0, x - 1)]
  const r = e[y * size + Math.min(size - 1, x + 1)]
  const u = e[Math.max(0, y - 1) * size + x]
  const d = e[Math.min(size - 1, y + 1) * size + x]
  // Light from the north-west, the convention every relief map uses.
  return Math.max(-1, Math.min(1, ((l - r) + (u - d)) * 9))
}

/** Build (once) the one-pixel-per-tile relief image behind the atlas view.
 *  Returns null where there is no canvas to draw into - Node, tests - so the
 *  caller can fall back to the per-tile path. */
function atlasImage(map) {
  const cached = atlasCache.get(map)
  if (cached !== undefined) return cached

  let canvas = null
  if (typeof OffscreenCanvas !== 'undefined') canvas = new OffscreenCanvas(map.size, map.size)
  else if (typeof document !== 'undefined') {
    canvas = document.createElement('canvas')
    canvas.width = map.size
    canvas.height = map.size
  }
  if (!canvas) {
    atlasCache.set(map, null)
    return null
  }

  const ctx = canvas.getContext('2d')
  const image = ctx.createImageData(map.size, map.size)
  const px = image.data
  const size = map.size
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x
      const t = map.tileType[idx]
      const e = map.elevation[idx]
      let r
      let g
      let b
      if (t === TILE.OCEAN) {
        const depth = Math.min(1, Math.max(0, (SEA_LEVEL - e) / SEA_LEVEL))
        r = mix(38, 8, depth)
        g = mix(92, 34, depth)
        b = mix(132, 66, depth)
        // The shelf, painted as a distinctly paler band: on a big world this
        // is the migration map. Where two islands' bands touch, something
        // with the gene can cross; where the dark water meets, nothing can.
        if (map.shallow?.[idx]) {
          r = mix(r, 120, 0.55)
          g = mix(g, 186, 0.55)
          b = mix(b, 196, 0.55)
        }
      } else if (t === TILE.LAKE) {
        r = 86
        g = 150
        b = 168
      } else {
        const tone = t === TILE.BEACH ? [214, 196, 156] : landTone(t, e)
        const shade = shadeAt(map, x, y)
        r = tone[0] + shade * 34
        g = tone[1] + shade * 34
        b = tone[2] + shade * 30
      }
      const o = idx * 4
      px[o] = Math.max(0, Math.min(255, r))
      px[o + 1] = Math.max(0, Math.min(255, g))
      px[o + 2] = Math.max(0, Math.min(255, b))
      px[o + 3] = 255
    }
  }
  ctx.putImageData(image, 0, 0)
  atlasCache.set(map, canvas)
  return canvas
}

/** The atlas pass. Returns false if there is no offscreen canvas available,
 *  so drawMap can fall back to drawing tiles. */
function drawAtlas(ctx, map, tilePx, ox, oy) {
  const image = atlasImage(map)
  if (!image) return false
  const size = map.size
  // Smoothed on the way up: at three pixels a tile the world should read as
  // coastline and biome band, not as a grid of squares.
  ctx.imageSmoothingEnabled = true
  ctx.drawImage(image, 0, 0, size, size, -ox, -oy, size * tilePx, size * tilePx)
  ctx.imageSmoothingEnabled = false
  drawStraitMarks(ctx, map, tilePx, ox, oy)
  return true
}

/** A dashed tick across every channel narrow enough to swim, drawn square to
 *  the crossing. This is the one thing the terrain colours cannot say by
 *  themselves: "these two islands are one gene apart, and those two are not". */
function drawStraitMarks(ctx, map, tilePx, ox, oy) {
  if (!map.straits?.length || !map.islands) return
  ctx.save()
  ctx.strokeStyle = 'rgba(255,208,104,0.9)'
  ctx.lineWidth = Math.max(1.6, tilePx * 0.6)
  ctx.lineCap = 'round'
  ctx.setLineDash([Math.max(2, tilePx), Math.max(2, tilePx * 0.9)])
  for (const strait of map.straits) {
    const a = map.islands[strait.a]
    const b = map.islands[strait.b]
    if (!a?.notable || !b?.notable) continue
    const dx = b.cx - a.cx
    const dy = b.cy - a.cy
    const len = Math.hypot(dx, dy) || 1
    // Long enough to be visible, short enough to stay in the channel.
    const reach = (strait.gap / 2 + 1.5) * tilePx
    const cx = (strait.x + 0.5) * tilePx - ox
    const cy = (strait.y + 0.5) * tilePx - oy
    ctx.beginPath()
    ctx.moveTo(cx - (dx / len) * reach, cy - (dy / len) * reach)
    ctx.lineTo(cx + (dx / len) * reach, cy + (dy / len) * reach)
    ctx.stroke()
  }
  ctx.restore()
}
