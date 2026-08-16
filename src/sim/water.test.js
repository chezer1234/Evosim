import { describe, it, expect } from 'vitest'
import { TILE } from '../worldgen/mapgen.js'
import {
  FLOUNDER_DRAIN_FACTOR,
  SWIM_MIN_SKILL,
  canSwim,
  describeSwimming,
  isWaterTile,
  swimDrainFactor,
  swimSpeedFactor,
  towardNearestLand,
} from './water.js'

/** A tiny map from a picture: '.' grass, '~' lake, 'O' ocean. */
function mapOf(rows) {
  const size = rows.length
  const tileType = new Uint8Array(size * size)
  rows.forEach((row, y) => {
    ;[...row].forEach((ch, x) => {
      tileType[y * size + x] = ch === '~' ? TILE.LAKE : ch === 'O' ? TILE.OCEAN : TILE.GRASS
    })
  })
  return { size, tileType }
}

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
