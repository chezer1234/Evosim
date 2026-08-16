import { describe, it, expect } from 'vitest'
import { mulberry32, makePerlin, fbm, generateMap, matchingPreset, DEFAULT_SETTINGS, SHALLOW_TILES, TILE, WORLD_PRESETS } from './mapgen.js'
import { fruitFraction } from './biomes.js'

describe('mulberry32', () => {
  it('is deterministic for a given seed', () => {
    const a = mulberry32(42)
    const b = mulberry32(42)
    const seqA = Array.from({ length: 10 }, () => a())
    const seqB = Array.from({ length: 10 }, () => b())
    expect(seqA).toEqual(seqB)
  })

  it('produces values in [0, 1)', () => {
    const rng = mulberry32(1234)
    for (let i = 0; i < 1000; i++) {
      const v = rng()
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
    }
  })

  it('different seeds produce different sequences', () => {
    const a = mulberry32(1)
    const b = mulberry32(2)
    expect(a()).not.toBe(b())
  })
})

describe('makePerlin / fbm', () => {
  it('perlin2 stays roughly within -1..1', () => {
    const perlin = makePerlin(7)
    for (let x = 0; x < 20; x++) {
      for (let y = 0; y < 20; y++) {
        const v = perlin(x * 0.37, y * 0.61)
        expect(v).toBeGreaterThanOrEqual(-1.01)
        expect(v).toBeLessThanOrEqual(1.01)
      }
    }
  })

  it('fbm is deterministic for the same perlin instance and inputs', () => {
    const perlin = makePerlin(99)
    const a = fbm(perlin, 3.2, 4.8, 5, 0.55, 1 / 24)
    const b = fbm(perlin, 3.2, 4.8, 5, 0.55, 1 / 24)
    expect(a).toBe(b)
  })
})

describe('generateMap', () => {
  // generateMap seeds itself internally (Math.random), so assertions here
  // are on invariants that must hold for every run, not on exact output.
  const runs = [generateMap(DEFAULT_SETTINGS), generateMap({ ...DEFAULT_SETTINGS, size: 32 })]

  for (const map of runs) {
    describe(`size ${map.size}`, () => {
      it('returns arrays sized to size*size', () => {
        const n = map.size * map.size
        expect(map.tileType.length).toBe(n)
        expect(map.elevation.length).toBe(n)
        expect(map.canHaveApple.length).toBe(n)
      })

      it('every tile has a known tile type', () => {
        const known = new Set(Object.values(TILE))
        for (let i = 0; i < map.tileType.length; i++) {
          expect(known.has(map.tileType[i])).toBe(true)
        }
      })

      it('elevation is normalized to [0, 1]', () => {
        let min = Infinity
        let max = -Infinity
        for (let i = 0; i < map.elevation.length; i++) {
          min = Math.min(min, map.elevation[i])
          max = Math.max(max, map.elevation[i])
        }
        // Float32 rounding from the min-max stretch can land a hair outside
        // the exact bounds, so allow a tiny epsilon.
        expect(min).toBeGreaterThanOrEqual(-1e-5)
        expect(max).toBeLessThanOrEqual(1 + 1e-5)
      })

      it('the four corners are ocean (island falloff is strongest there)', () => {
        const { size, tileType } = map
        expect(tileType[0]).toBe(TILE.OCEAN)
        expect(tileType[size - 1]).toBe(TILE.OCEAN)
        expect(tileType[(size - 1) * size]).toBe(TILE.OCEAN)
        expect(tileType[size * size - 1]).toBe(TILE.OCEAN)
      })

      it('contains at least some ocean (it is an island, not a full landmass)', () => {
        expect(Array.from(map.tileType)).toContain(TILE.OCEAN)
      })

      it('placed lake count never exceeds the requested max and is non-negative', () => {
        expect(map.lakeCount).toBeGreaterThanOrEqual(0)
        expect(map.lakeCount).toBeLessThanOrEqual(DEFAULT_SETTINGS.maxLakes)
      })

      it('only biomes that bear fruit can be flagged as apple-bearing', () => {
        for (let i = 0; i < map.canHaveApple.length; i++) {
          if (map.canHaveApple[i]) expect(fruitFraction(map.tileType[i])).toBeGreaterThan(0)
        }
      })
    })
  }

  it('respects a custom lake range', () => {
    const map = generateMap({ ...DEFAULT_SETTINGS, size: 48, minLakes: 2, maxLakes: 2 })
    // Carving can fall short (each candidate needs dry land all round it, or
    // it would be a bay rather than a lake) but never overshoot - and the
    // count is of the lakes actually on the finished map, not of the carves
    // attempted.
    expect(map.lakeCount).toBeLessThanOrEqual(2)
  })

  it('defaults to the one island the game has always had', () => {
    const map = generateMap(DEFAULT_SETTINGS)
    expect(DEFAULT_SETTINGS.minIslands).toBe(1)
    expect(map.islandCount).toBe(1)
    expect(map.groupCount).toBe(1)
    // Offshore rocks are still landmasses, and one close in can still be
    // "reachable" - but there is no second island to migrate to.
    expect(map.straits.filter((s) => map.islands[s.a].notable && map.islands[s.b].notable)).toEqual([])
  })
})

/** A map from a known seed. generateMap draws from Math.random, so this is
 *  the only way to make assertions about a world's *shape* - as opposed to
 *  its invariants - repeatable (the ecosystem harness does the same). */
function seededMap(seed, settings) {
  const rng = mulberry32(seed)
  const real = Math.random
  Math.random = rng
  try {
    return generateMap(settings)
  } finally {
    Math.random = real
  }
}

describe('generateMap: archipelagos', () => {
  const settings = { ...DEFAULT_SETTINGS, size: 160, minIslands: 4, maxIslands: 6, noiseScale: 30 }
  const maps = [seededMap(11, settings), seededMap(2026, settings)]

  for (const [n, map] of maps.entries()) {
    describe(`world ${n + 1}`, () => {
      it('makes several separate landmasses', () => {
        expect(map.islandCount).toBeGreaterThan(1)
        expect(map.islands.length).toBeGreaterThanOrEqual(map.islandCount)
      })

      it('agrees with itself about which tile belongs to which island', () => {
        for (let i = 0; i < map.tileType.length; i++) {
          const water = map.tileType[i] === TILE.OCEAN || map.tileType[i] === TILE.LAKE
          expect(map.landId[i] >= 0).toBe(!water)
          if (!water) expect(map.islands[map.landId[i]]).toBeDefined()
        }
      })

      it('only ever marks open sea as the swimmable shelf', () => {
        let shelf = 0
        for (let i = 0; i < map.shallow.length; i++) {
          if (!map.shallow[i]) continue
          shelf++
          expect(map.tileType[i]).toBe(TILE.OCEAN)
        }
        expect(shelf).toBeGreaterThan(0) // every coast has one
      })

      it('never claims more separate island groups than it has islands', () => {
        expect(map.groupCount).toBeGreaterThanOrEqual(1)
        expect(map.groupCount).toBeLessThanOrEqual(map.islandCount)
      })

      it('only records a strait between two real islands, and never a wide one', () => {
        for (const strait of map.straits) {
          expect(map.islands[strait.a]).toBeDefined()
          expect(map.islands[strait.b]).toBeDefined()
          expect(strait.a).not.toBe(strait.b)
          // Two shelves of SHALLOW_TILES each is as far as a channel can be
          // crossed; anything wider has deep water in the middle of it.
          expect(strait.gap).toBeLessThanOrEqual(SHALLOW_TILES * 2)
          // Islands either side of a crossable channel are in one group.
          expect(map.islandGroup[strait.a]).toBe(map.islandGroup[strait.b])
        }
      })

      it('gives every island of any size its own biomes rather than a flat sheet of beach', () => {
        // Biomes are read off each island's own relief, so a small island is
        // a small island rather than the bottom of the tallest one's range
        // (which is what used to leave every minor island bare sand).
        const kinds = new Set()
        for (const island of map.islands) {
          if (island.area < 200) continue
          const tiles = new Set()
          for (let i = 0; i < map.landId.length; i++) {
            if (map.landId[i] === island.id) tiles.add(map.tileType[i])
          }
          expect(tiles.size).toBeGreaterThan(2)
          expect(tiles.has(TILE.BEACH) && tiles.size === 1).toBe(false)
          for (const t of tiles) kinds.add(t)
        }
        expect(kinds.size).toBeGreaterThan(3)
      })
    })
  }

  it('numbers the islands worth talking about, and ignores the rocks', () => {
    const map = maps[0]
    const labels = map.islands.filter((i) => i.notable).map((i) => i.label)
    expect(labels).toEqual(labels.map((_, i) => i + 1))
    for (const island of map.islands) {
      if (!island.notable) expect(island.label).toBe(0)
    }
  })

  it('scales the world without slowing to a crawl', () => {
    const started = Date.now()
    generateMap({ ...DEFAULT_SETTINGS, size: 224, minIslands: 6, maxIslands: 9 })
    expect(Date.now() - started).toBeLessThan(4000)
  })
})

describe('climate', () => {
  it('produces a temperature field that falls from the south of the map to the north', () => {
    const map = generateMap({ ...DEFAULT_SETTINGS, size: 96, climate: 1 })
    const rowMean = (y) => {
      let sum = 0
      for (let x = 0; x < map.size; x++) sum += map.temperature[y * map.size + x]
      return sum / map.size
    }
    expect(rowMean(map.size - 2)).toBeGreaterThan(rowMean(1))
  })

  it('is one flat climate at zero, where biomes come from moisture alone', () => {
    const map = generateMap({ ...DEFAULT_SETTINGS, size: 64, climate: 0 })
    const cold = [TILE.TAIGA, TILE.TUNDRA]
    const hot = [TILE.SAVANNA, TILE.DESERT]
    const has = (list) => list.some((t) => map.tileType.includes(t))
    // Nothing arctic and nothing tropical: the altitude lapse can still put
    // rock or snow on a summit, but the latitude bands are switched off.
    expect(has(cold) && has(hot)).toBe(false)
  })
})

describe('WORLD_PRESETS', () => {
  it('are all recognised by matchingPreset', () => {
    for (const preset of WORLD_PRESETS) {
      expect(matchingPreset({ ...DEFAULT_SETTINGS, ...preset.settings })).toBe(preset.key)
    }
  })

  it('does not claim a preset for settings that match none of them', () => {
    expect(matchingPreset({ ...DEFAULT_SETTINGS, size: 37, minIslands: 2, maxIslands: 7 })).toBe(null)
  })

  it('keeps the default settings on the single-island preset', () => {
    expect(matchingPreset(DEFAULT_SETTINGS)).toBe('island')
  })
})
