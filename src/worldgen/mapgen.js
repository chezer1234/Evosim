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
// Fraction of FOREST tiles that can ever bear an apple (see species sim,
// src/sim/). Fixed at map-gen time from the map's own seed so it's stable
// for a given seed; whether a flagged tile *currently* has an apple is
// dynamic runtime state owned by the simulation, not the map.
const APPLE_TILE_FRACTION = 0.1

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
 *   elevation:Float32Array, jitterX:Float32Array, jitterY:Float32Array, scaleVar:Float32Array,
 *   canHaveApple:Uint8Array}}
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
  const canHaveApple = new Uint8Array(size * size)

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
    if (tileType[i] === TILE.FOREST) canHaveApple[i] = rng() < APPLE_TILE_FRACTION ? 1 : 0
  }

  // Mark water tiles that sit right next to a beach, so rendering can tint
  // them as a sandbank visible through shallow water.
  const nearShallow = new Uint8Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const idx = y * size + x
      if (tileType[idx] !== TILE.OCEAN && tileType[idx] !== TILE.LAKE) continue
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

  return { size, seed, lakeCount: placed, tileType, elevation, jitterX, jitterY, scaleVar, nearShallow, canHaveApple }
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
  if (t === TILE.GRASS) {
    return rgb(mix(120, 96, e - 0.4), mix(150, 132, e - 0.4), mix(90, 74, e - 0.4))
  }
  if (t === TILE.SHRUB) return rgb(94, 128, 70)
  return rgb(58, 96, 56) // FOREST base tile beneath the canopy
}

function drawForestTile(ctx, map, idx, sx, sy, tilePx, count) {
  const baseS = map.scaleVar[idx]
  const spread = count > 1 ? 0.74 : 1
  for (let k = 0; k < count; k++) {
    const jx = k === 0 ? map.jitterX[idx] : hash01(idx, k * 7 + 1)
    const jy = k === 0 ? map.jitterY[idx] : hash01(idx, k * 7 + 2)
    const s = (k === 0 ? baseS : 0.55 + hash01(idx, k * 7 + 3) * 0.55) * spread
    const cx = sx + jx * tilePx
    const cy = sy + jy * tilePx
    const canopyR = Math.max(1, tilePx * 0.46 * s)
    if (tilePx >= 5) {
      ctx.fillStyle = 'rgb(74,54,36)'
      ctx.fillRect(cx - Math.max(0.6, tilePx * 0.05), cy, Math.max(1.2, tilePx * 0.1), canopyR * 0.6)
    }
    const shade = hash01(idx, k * 7 + 4)
    ctx.beginPath()
    ctx.fillStyle = rgb(mix(32, 68, shade), mix(92, 138, shade), mix(40, 68, shade))
    ctx.arc(cx, cy, canopyR, 0, Math.PI * 2)
    ctx.fill()
    if (tilePx >= 7) {
      ctx.lineWidth = Math.max(0.5, tilePx * 0.03)
      ctx.strokeStyle = 'rgba(18,36,20,0.45)'
      ctx.stroke()
    }
    if (tilePx >= 10) {
      ctx.beginPath()
      ctx.fillStyle = 'rgba(255,255,255,0.12)'
      ctx.arc(cx - canopyR * 0.32, cy - canopyR * 0.32, canopyR * 0.4, 0, Math.PI * 2)
      ctx.fill()
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
 */
export function drawMap(ctx, map, tilePx, viewport, time = 0) {
  const size = map.size
  const view = viewport || { originX: 0, originY: 0, width: size * tilePx, height: size * tilePx }
  const ox = view.originX * tilePx
  const oy = view.originY * tilePx

  ctx.imageSmoothingEnabled = false
  ctx.clearRect(0, 0, view.width, view.height)

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
  const treeCount = tilePx >= 20 ? 3 : tilePx >= 10 ? 2 : 1
  const shrubCount = tilePx >= 14 ? 2 : 1
  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) {
      const idx = y * size + x
      const t = map.tileType[idx]
      if (t !== TILE.FOREST && t !== TILE.SHRUB && t !== TILE.GRASS && t !== TILE.BEACH) continue
      const sx = x * tilePx - ox
      const sy = y * tilePx - oy
      if (t === TILE.FOREST) drawForestTile(ctx, map, idx, sx, sy, tilePx, treeCount)
      else if (t === TILE.SHRUB) drawShrubTile(ctx, map, idx, sx, sy, tilePx, shrubCount)
      else if (t === TILE.GRASS && tilePx >= 14) drawGrassDetail(ctx, idx, sx, sy, tilePx)
      else if (t === TILE.BEACH && tilePx >= 12) drawBeachDetail(ctx, idx, sx, sy, tilePx)
    }
  }
}
