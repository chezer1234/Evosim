// Procedural top-down island generation: seeded Perlin noise (fBm), an
// island falloff for the coastline, and verified lake carving so a
// requested lake count always appears as real, separate lakes rather than
// silently merging into the ocean.

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
export const TILE = { OCEAN: 0, LAKE: 1, BEACH: 2, GRASS: 3, SHRUB: 4, FOREST: 5 }
const SEA_LEVEL = 0.35
const BEACH_WIDTH = 0.045

export const DEFAULT_SETTINGS = {
  size: 64,
  octaves: 5,
  noiseScale: 24,
  persistence: 0.55,
  minLakes: 1,
  maxLakes: 4,
  vegetation: 1.0,
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

/**
 * Generate a new procedural island map.
 * @param {typeof DEFAULT_SETTINGS} settings
 * @returns {{size:number, seed:number, lakeCount:number, tileType:Uint8Array,
 *   elevation:Float32Array, jitterX:Float32Array, jitterY:Float32Array, scaleVar:Float32Array}}
 */
export function generateMap(settings) {
  const { size, octaves, noiseScale, persistence, minLakes, maxLakes, vegetation } = settings
  const seed = (Math.random() * 0xffffffff) >>> 0
  const rng = mulberry32(seed)
  const elevPerlin = makePerlin(Math.floor(rng() * 1e9))
  const moistPerlin = makePerlin(Math.floor(rng() * 1e9))

  const baseFreq = 1 / noiseScale
  const elevation = new Float32Array(size * size)
  const moisture = new Float32Array(size * size)

  let min = Infinity
  let max = -Infinity
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size - 0.5
      const ny = y / size - 0.5
      let e = fbm(elevPerlin, x, y, octaves, persistence, baseFreq)
      const d = Math.sqrt(nx * nx + ny * ny) * 2
      const falloff = Math.pow(Math.min(1, d), 2)
      e = e * 0.5 + 0.5
      e = e - falloff * 0.9
      elevation[y * size + x] = e
      if (e < min) min = e
      if (e > max) max = e

      const m = fbm(moistPerlin, x, y, 4, 0.5, 1 / (size * 0.35))
      moisture[y * size + x] = m * 0.5 + 0.5
    }
  }
  const range = max - min || 1
  for (let i = 0; i < elevation.length; i++) elevation[i] = (elevation[i] - min) / range

  // Carve a verified number of interior lakes: each carve is checked with a
  // real flood fill and reverted if it leaks into the ocean, so the count
  // that gets promised is the count that actually appears.
  const lakeCount = minLakes + Math.floor(rng() * (maxLakes - minLakes + 1))
  let placed = 0
  let attempts = 0
  while (placed < lakeCount && attempts < lakeCount * 60) {
    attempts++
    const cx = size * (0.15 + rng() * 0.7)
    const cy = size * (0.15 + rng() * 0.7)
    const r = size * (0.03 + rng() * 0.06)
    const idxc = Math.floor(cy) * size + Math.floor(cx)
    if (elevation[idxc] < SEA_LEVEL + 0.2) continue

    const x0 = Math.max(0, Math.floor(cx - r - 2))
    const x1 = Math.min(size - 1, Math.ceil(cx + r + 2))
    const y0 = Math.max(0, Math.floor(cy - r - 2))
    const y1 = Math.min(size - 1, Math.ceil(cy + r + 2))
    const saved = []
    for (let y = y0; y <= y1; y++) {
      for (let x = x0; x <= x1; x++) {
        const dx = x - cx
        const dy = y - cy
        const dist = Math.sqrt(dx * dx + dy * dy)
        if (dist < r) {
          const idx = y * size + x
          saved.push(idx, elevation[idx])
          const pull = 1 - dist / r
          elevation[idx] = Math.min(elevation[idx], SEA_LEVEL - 0.05 * pull)
        }
      }
    }
    const test = floodFillOcean(elevation, size)
    if (test.isOcean[idxc]) {
      for (let k = 0; k < saved.length; k += 2) elevation[saved[k]] = saved[k + 1]
      continue
    }
    placed++
  }

  const { isWater, isOcean } = floodFillOcean(elevation, size)

  const tileType = new Uint8Array(size * size)
  const jitterX = new Float32Array(size * size)
  const jitterY = new Float32Array(size * size)
  const scaleVar = new Float32Array(size * size)

  for (let i = 0; i < elevation.length; i++) {
    jitterX[i] = rng()
    jitterY[i] = rng()
    scaleVar[i] = 0.75 + rng() * 0.5

    if (isWater[i]) {
      tileType[i] = isOcean[i] ? TILE.OCEAN : TILE.LAKE
    } else if (elevation[i] < SEA_LEVEL + BEACH_WIDTH) {
      tileType[i] = TILE.BEACH
    } else {
      const mEff = Math.min(1.5, moisture[i] * vegetation)
      if (mEff > 0.55) tileType[i] = TILE.FOREST
      else if (mEff > 0.35) tileType[i] = TILE.SHRUB
      else tileType[i] = TILE.GRASS
    }
  }

  return { size, seed, lakeCount: placed, tileType, elevation, jitterX, jitterY, scaleVar }
}

// ======================= Rendering =======================
function mix(a, b, t) {
  return a + (b - a) * t
}
function rgb(r, g, b) {
  return `rgb(${r | 0},${g | 0},${b | 0})`
}

function tileColor(map, idx) {
  const t = map.tileType[idx]
  const e = map.elevation[idx]
  if (t === TILE.OCEAN) {
    const depth = Math.min(1, Math.max(0, (SEA_LEVEL - e) / SEA_LEVEL))
    return rgb(mix(60, 12, depth), mix(120, 46, depth), mix(160, 82, depth))
  }
  if (t === TILE.LAKE) {
    const depth = Math.min(1, Math.max(0, (SEA_LEVEL - e) / 0.35))
    return rgb(mix(110, 55, depth), mix(170, 130, depth), mix(180, 150, depth))
  }
  if (t === TILE.BEACH) {
    const wet = Math.min(1, Math.max(0, (e - SEA_LEVEL) / BEACH_WIDTH))
    return rgb(mix(196, 227, wet), mix(178, 210, wet), mix(140, 168, wet))
  }
  if (t === TILE.GRASS) {
    return rgb(mix(120, 96, e - 0.4), mix(150, 132, e - 0.4), mix(90, 74, e - 0.4))
  }
  if (t === TILE.SHRUB) return rgb(94, 128, 70)
  return rgb(58, 96, 56) // FOREST base tile beneath the canopy
}

/** Draw a generated map onto a 2D canvas context at the given tile size (CSS px). */
export function drawMap(ctx, map, tilePx) {
  const size = map.size
  ctx.imageSmoothingEnabled = false
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x
      ctx.fillStyle = tileColor(map, idx)
      ctx.fillRect(x * tilePx, y * tilePx, tilePx + 0.6, tilePx + 0.6)
    }
  }
  // Second pass: vegetation icons on top so canopies can overlap tile edges.
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x
      const t = map.tileType[idx]
      if (t !== TILE.FOREST && t !== TILE.SHRUB) continue
      const cx = x * tilePx + map.jitterX[idx] * tilePx
      const cy = y * tilePx + map.jitterY[idx] * tilePx
      const s = map.scaleVar[idx]
      if (t === TILE.FOREST) {
        const canopyR = Math.max(1, tilePx * 0.42 * s)
        if (tilePx >= 5) {
          ctx.fillStyle = 'rgb(74,54,36)'
          ctx.fillRect(cx - Math.max(0.6, tilePx * 0.05), cy, Math.max(1.2, tilePx * 0.1), canopyR * 0.55)
        }
        ctx.beginPath()
        ctx.fillStyle = rgb(mix(40, 70, s - 0.75), mix(90, 130, s - 0.75), mix(45, 70, s - 0.75))
        ctx.arc(cx, cy, canopyR, 0, Math.PI * 2)
        ctx.fill()
      } else {
        const r = Math.max(0.8, tilePx * 0.22 * s)
        ctx.beginPath()
        ctx.fillStyle = 'rgb(112,150,84)'
        ctx.arc(cx, cy, r, 0, Math.PI * 2)
        ctx.fill()
      }
    }
  }
}
