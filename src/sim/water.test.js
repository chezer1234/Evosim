import { describe, it, expect } from 'vitest'
import { TILE } from '../worldgen/mapgen.js'
import {
  FLOUNDER_DRAIN_FACTOR,
  OCEAN_DRAIN_FACTOR,
  OPEN_WATER_MIN_SKILL,
  SWIM_MIN_SKILL,
  canCrossOpenWater,
  canEnterTile,
  canSwim,
  describeSwimming,
  isShallowOcean,
  isWaterTile,
  swimDrainFactor,
  swimSpeedFactor,
  towardNearestLand,
  waterDrainFactor,
} from './water.js'

/** A tiny map from a picture: '.' grass, '~' lake, 'O' deep ocean, 's' the
 * shallow shelf that hugs a coast (see worldgen/islands.js). */
function mapOf(rows) {
  const size = rows.length
  const tileType = new Uint8Array(size * size)
  const shallow = new Uint8Array(size * size)
  rows.forEach((row, y) => {
    ;[...row].forEach((ch, x) => {
      const idx = y * size + x
      tileType[idx] = ch === '~' ? TILE.LAKE : ch === 'O' || ch === 's' ? TILE.OCEAN : TILE.GRASS
      shallow[idx] = ch === 's' ? 1 : 0
    })
  })
  return { size, tileType, shallow }
}

const swimmer = (skill) => ({ canSwim: canSwim(skill), canCrossOpenWater: canCrossOpenWater(skill) })

describe('isWaterTile', () => {
  it('counts lakes and open ocean, and nothing else', () => {
    const map = mapOf(['.~O', '...', '...'])
    expect(isWaterTile(map, 0, 0)).toBe(false)
    expect(isWaterTile(map, 1, 0)).toBe(true)
    expect(isWaterTile(map, 2, 0)).toBe(true)
  })
})

describe('canSwim', () => {
  it('is a threshold, not a slope - below it, water is simply off-limits', () => {
    expect(canSwim(SWIM_MIN_SKILL - 0.01)).toBe(false)
    expect(canSwim(SWIM_MIN_SKILL)).toBe(true)
    expect(canSwim(1)).toBe(true)
  })
})

describe('canCrossOpenWater', () => {
  it('asks far more of the gene than a lake does', () => {
    expect(OPEN_WATER_MIN_SKILL).toBeGreaterThan(SWIM_MIN_SKILL)
    expect(canCrossOpenWater(SWIM_MIN_SKILL)).toBe(false)
    expect(canCrossOpenWater(OPEN_WATER_MIN_SKILL - 0.01)).toBe(false)
    expect(canCrossOpenWater(OPEN_WATER_MIN_SKILL)).toBe(true)
  })
})

describe('canEnterTile', () => {
  // A coast, its shelf, and deep water beyond it.
  const map = mapOf([
    '..ssOO',
    '..ssOO',
    '.~.sOO',
    '.~.sOO',
    '...sOO',
    '...sOO',
  ])
  const landlubber = swimmer(0)
  const laker = swimmer(SWIM_MIN_SKILL)
  const seafarer = swimmer(1)

  it('lets anything walk on land', () => {
    for (const ability of [landlubber, laker, seafarer]) {
      expect(canEnterTile(map, 0, 0, ability, false)).toBe(true)
    }
  })

  it('gates a lake on the swim gene', () => {
    expect(canEnterTile(map, 1, 2, landlubber, false)).toBe(false)
    expect(canEnterTile(map, 1, 2, laker, false)).toBe(true)
  })

  it('gates the shelf on the much higher open-water gene - a lake swimmer is not a sea swimmer', () => {
    expect(canEnterTile(map, 2, 0, laker, false)).toBe(false)
    expect(canEnterTile(map, 2, 0, seafarer, false)).toBe(true)
  })

  it('refuses deep water to everything, however good it is', () => {
    expect(canEnterTile(map, 5, 0, seafarer, false)).toBe(false)
    expect(canEnterTile(map, 5, 0, seafarer, true)).toBe(false)
  })

  it('never lets anything leave the map', () => {
    expect(canEnterTile(map, -1, 0, seafarer, false)).toBe(false)
    expect(canEnterTile(map, 0, map.size, seafarer, false)).toBe(false)
  })

  it('lets something already in the water move through water, so it can reach a bank', () => {
    expect(canEnterTile(map, 1, 2, landlubber, true)).toBe(true)
    expect(canEnterTile(map, 2, 0, laker, true)).toBe(true)
  })

  it('treats a map with no shelf at all as the old world: the sea is a wall', () => {
    const old = { size: map.size, tileType: map.tileType } // no `shallow` array
    expect(canEnterTile(old, 2, 0, seafarer, false)).toBe(false)
  })
})

describe('isShallowOcean / waterDrainFactor', () => {
  const map = mapOf(['..sO', '..sO', '.~sO', '..sO'])

  it('is the shelf, and only the shelf', () => {
    expect(isShallowOcean(map, 2, 0)).toBe(true)
    expect(isShallowOcean(map, 3, 0)).toBe(false) // deep
    expect(isShallowOcean(map, 1, 2)).toBe(false) // lake
    expect(isShallowOcean(map, 0, 0)).toBe(false) // land
  })

  it('makes the sea harder work than a lake, and land free', () => {
    expect(waterDrainFactor(map, 2, 0)).toBe(OCEAN_DRAIN_FACTOR)
    expect(waterDrainFactor(map, 1, 2)).toBe(1)
    expect(OCEAN_DRAIN_FACTOR).toBeGreaterThan(1)
  })
})

describe('swim stats', () => {
  it('starts a new swimmer slow and expensive, and rewards the gene from there', () => {
    const novice = SWIM_MIN_SKILL
    expect(swimSpeedFactor(novice)).toBeLessThan(0.35)
    expect(swimSpeedFactor(1)).toBeGreaterThan(0.9)
    expect(swimDrainFactor(novice)).toBeGreaterThan(3)
    expect(swimDrainFactor(1)).toBeLessThan(1.5)
  })

  it('is monotonic in the gene, so mutation always has a direction to climb', () => {
    for (let skill = SWIM_MIN_SKILL; skill < 1; skill += 0.05) {
      expect(swimSpeedFactor(skill + 0.05)).toBeGreaterThan(swimSpeedFactor(skill))
      expect(swimDrainFactor(skill + 0.05)).toBeLessThan(swimDrainFactor(skill))
    }
  })

  it('never makes swimming cheaper than being out of your depth', () => {
    expect(FLOUNDER_DRAIN_FACTOR).toBeGreaterThan(swimDrainFactor(0))
  })

  it('rescales the usable range, so a barely-able swimmer is at the bottom of it', () => {
    // Not (skill - 0) / 1: at exactly the threshold this is a creature that
    // has only just learned, and should swim like it.
    expect(swimSpeedFactor(SWIM_MIN_SKILL)).toBeCloseTo(swimSpeedFactor(0), 6)
  })
})

describe('describeSwimming', () => {
  it('says plainly that a non-swimmer will not enter water', () => {
    const note = describeSwimming(0.1)
    expect(note).toMatch(/[Cc]annot swim/)
    expect(note).not.toContain('NaN')
  })

  it('quotes the real numbers for one that can', () => {
    const note = describeSwimming(0.9)
    expect(note).toMatch(/\d+% of its overland pace/)
    expect(note).not.toContain('NaN')
  })
})

describe('towardNearestLand', () => {
  it('points at the closest dry tile', () => {
    const map = mapOf(['~~~~~', '~~~~~', '~~~~.', '~~~~~', '~~~~~'])
    const dir = towardNearestLand(map, 2, 2)
    expect(dir.x).toBeCloseTo(1, 6)
    expect(dir.y).toBeCloseTo(0, 6)
  })

  it('prefers a diagonal neighbour over a straight tile further out', () => {
    const map = mapOf(['~~~~~', '~.~~~', '~~~~~', '~~~~~', '~~~~.'])
    const dir = towardNearestLand(map, 2, 2)
    expect(dir.x).toBeLessThan(0)
    expect(dir.y).toBeLessThan(0)
  })

  it('gives up rather than guessing in the middle of open water', () => {
    const rows = Array.from({ length: 13 }, () => '~'.repeat(13))
    expect(towardNearestLand(mapOf(rows), 6, 6)).toBeNull()
  })

  it('returns a unit vector, so callers can use it as a heading directly', () => {
    const map = mapOf(['~~~', '~~~', '..~'])
    const dir = towardNearestLand(map, 1, 1)
    expect(Math.hypot(dir.x, dir.y)).toBeCloseTo(1, 6)
  })
})
