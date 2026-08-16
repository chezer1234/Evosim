import { describe, it, expect } from 'vitest'
import { BIOME, TILE, classifyLand, fruitFraction, hasCover, isWaterType, temperatureAt } from './biomes.js'

// Altitude, moisture and temperature in, one tile type out. These are the
// rules that decide what a world looks like, so they are pinned here rather
// than inferred from a generated map, where every threshold is tangled up
// with the noise that produced it.

describe('classifyLand', () => {
  const TEMPERATE = 0.5

  it('reads the temperate band off moisture alone, as the one-climate world always did', () => {
    expect(classifyLand(0.3, 0.8, TEMPERATE)).toBe(TILE.FOREST)
    expect(classifyLand(0.3, 0.45, TEMPERATE)).toBe(TILE.SHRUB)
    expect(classifyLand(0.3, 0.2, TEMPERATE)).toBe(TILE.GRASS)
  })

  it('turns the cold end of the world into pine and tundra', () => {
    expect(classifyLand(0.3, 0.8, 0.15)).toBe(TILE.TAIGA)
    expect(classifyLand(0.3, 0.2, 0.15)).toBe(TILE.TUNDRA)
  })

  it('turns the hot end into rainforest, savanna and desert as it dries out', () => {
    expect(classifyLand(0.3, 0.9, 0.85)).toBe(TILE.FOREST)
    expect(classifyLand(0.3, 0.5, 0.85)).toBe(TILE.SAVANNA)
    expect(classifyLand(0.3, 0.1, 0.85)).toBe(TILE.DESERT)
  })

  it('puts bare rock above the treeline and snow on the cold peaks', () => {
    expect(classifyLand(0.95, 0.8, 0.2)).toBe(TILE.SNOW)
    expect(classifyLand(0.95, 0.8, 0.9)).toBe(TILE.ROCK)
    expect(classifyLand(0.8, 0.2, TEMPERATE)).toBe(TILE.ROCK)
  })

  it('only forms marsh on wet ground just above the tideline', () => {
    expect(classifyLand(0.05, 0.8, TEMPERATE)).toBe(TILE.MARSH)
    // Same wetness, higher ground: ordinary woodland, not a reedbed.
    expect(classifyLand(0.4, 0.8, TEMPERATE)).toBe(TILE.FOREST)
  })

  it('always returns a known tile type', () => {
    const known = new Set(Object.values(TILE))
    for (let alt = 0; alt <= 1.001; alt += 0.1) {
      for (let m = 0; m <= 1.001; m += 0.1) {
        for (let t = 0; t <= 1.001; t += 0.1) {
          expect(known.has(classifyLand(alt, m, t))).toBe(true)
        }
      }
    }
  })
})

describe('temperatureAt', () => {
  it('is flat across the world at climate 0 - the old single-climate map', () => {
    const north = temperatureAt(0, 0.5, 0.3, 0)
    const south = temperatureAt(1, 0.5, 0.3, 0)
    expect(north).toBeCloseTo(south, 10)
  })

  it('runs cold in the north and hot in the south as the climate range opens up', () => {
    expect(temperatureAt(0, 0.5, 0.3, 1)).toBeLessThan(temperatureAt(1, 0.5, 0.3, 1))
    // and further apart the wider the range
    const narrow = temperatureAt(1, 0.5, 0.3, 0.4) - temperatureAt(0, 0.5, 0.3, 0.4)
    const wide = temperatureAt(1, 0.5, 0.3, 1) - temperatureAt(0, 0.5, 0.3, 1)
    expect(wide).toBeGreaterThan(narrow)
  })

  it('cools with altitude at every latitude', () => {
    for (const lat of [0, 0.5, 1]) {
      expect(temperatureAt(lat, 0.5, 0.9, 0.6)).toBeLessThan(temperatureAt(lat, 0.5, 0.1, 0.6))
    }
  })

  it('leaves the lowlands at the temperature their latitude implies', () => {
    // The lapse is measured against mid-altitude, so a temperate coast stays
    // temperate rather than being dragged cold by the mountains inland.
    expect(temperatureAt(0.5, 0.5, 0.35, 0.6)).toBeCloseTo(0.5, 6)
  })
})

describe('biome traits', () => {
  it('marks every biome the sim asks about', () => {
    for (const tile of Object.values(TILE)) {
      expect(BIOME[tile]).toBeDefined()
      expect(typeof hasCover(tile)).toBe('boolean')
      expect(fruitFraction(tile)).toBeGreaterThanOrEqual(0)
    }
  })

  it('gives cover in the wooded biomes and none in the open ones', () => {
    expect(hasCover(TILE.FOREST)).toBe(true)
    expect(hasCover(TILE.TAIGA)).toBe(true)
    expect(hasCover(TILE.MARSH)).toBe(true)
    expect(hasCover(TILE.GRASS)).toBe(false)
    expect(hasCover(TILE.DESERT)).toBe(false)
  })

  it('keeps the broadleaf forest the richest feeding, and the barren biomes barren', () => {
    for (const tile of [TILE.TAIGA, TILE.SAVANNA, TILE.MARSH, TILE.SHRUB]) {
      expect(fruitFraction(tile)).toBeLessThan(fruitFraction(TILE.FOREST))
    }
    for (const tile of [TILE.DESERT, TILE.TUNDRA, TILE.ROCK, TILE.SNOW, TILE.BEACH]) {
      expect(fruitFraction(tile)).toBe(0)
    }
  })

  it('counts both kinds of water as water', () => {
    expect(isWaterType(TILE.OCEAN)).toBe(true)
    expect(isWaterType(TILE.LAKE)).toBe(true)
    expect(isWaterType(TILE.BEACH)).toBe(false)
  })
})
