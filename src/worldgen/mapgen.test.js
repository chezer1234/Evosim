import { describe, it, expect } from 'vitest'
import { mulberry32, makePerlin, fbm, generateMap, DEFAULT_SETTINGS, TILE } from './mapgen.js'

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

      it('only FOREST tiles can ever be flagged as apple-bearing', () => {
        for (let i = 0; i < map.canHaveApple.length; i++) {
          if (map.canHaveApple[i]) expect(map.tileType[i]).toBe(TILE.FOREST)
        }
      })
    })
  }

  it('respects a custom lake range', () => {
    const map = generateMap({ ...DEFAULT_SETTINGS, size: 48, minLakes: 2, maxLakes: 2 })
    // Carving can fall short (each candidate is reverted if it would leak
    // into the ocean) but never overshoot the requested count.
    expect(map.lakeCount).toBeLessThanOrEqual(2)
  })
})
