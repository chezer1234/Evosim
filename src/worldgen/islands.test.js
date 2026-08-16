import { describe, it, expect } from 'vitest'
import { TILE } from './biomes.js'
import { analyseWaters, labelIslands, SHALLOW_TILES } from './islands.js'

// Hand-drawn worlds, so "these two islands are close enough to swim between"
// is checked against a channel of a known width rather than against whatever
// the noise happened to produce.
//
//   . = ocean   # = land   ~ = lake
// Padded out to a square, because a map is square and both functions here
// index one as size x size.
function parse(rows) {
  const size = Math.max(rows[0].length, rows.length)
  const tileType = new Uint8Array(size * size).fill(TILE.OCEAN)
  rows.forEach((row, y) => {
    for (let x = 0; x < row.length; x++) {
      const ch = row[x]
      tileType[y * size + x] = ch === '#' ? TILE.GRASS : ch === '~' ? TILE.LAKE : TILE.OCEAN
    }
  })
  return { tileType, size }
}

function analyse(rows) {
  const { tileType, size } = parse(rows)
  const { landId, islands } = labelIslands(tileType, size)
  const waters = analyseWaters(tileType, landId, size, SHALLOW_TILES, islands.length)
  return { tileType, size, landId, islands, ...waters }
}

describe('labelIslands', () => {
  it('gives every separate landmass its own id and leaves water at -1', () => {
    const { landId, islands, size } = analyse([
      '..........',
      '.##....##.',
      '.##....##.',
      '..........',
    ])
    expect(islands.length).toBe(2)
    expect(landId[1 * size + 1]).toBe(0)
    expect(landId[1 * size + 7]).toBe(1)
    expect(landId[0]).toBe(-1)
    expect(islands[0].area).toBe(4)
  })

  it('joins land that only touches diagonally - a diagonal step is a step', () => {
    const { islands } = analyse([
      '.....',
      '.#...',
      '..#..',
      '.....',
    ])
    expect(islands.length).toBe(1)
    expect(islands[0].area).toBe(2)
  })

  it('reports a centroid inside the landmass', () => {
    const { islands } = analyse([
      '.....',
      '.###.',
      '.###.',
      '.....',
    ])
    expect(islands[0].cx).toBeCloseTo(2, 5)
    expect(islands[0].cy).toBeCloseTo(1.5, 5)
  })
})

describe('analyseWaters', () => {
  it('marks the shelf out to SHALLOW_TILES from a coast and no further', () => {
    const { shallow, oceanDist, size } = analyse([
      '..........',
      '.#........',
      '..........',
    ])
    // Distance is measured in steps out from the land tile at (1,1).
    expect(oceanDist[1 * size + 2]).toBe(1)
    expect(oceanDist[1 * size + 1 + SHALLOW_TILES]).toBe(SHALLOW_TILES)
    expect(shallow[1 * size + 1 + SHALLOW_TILES]).toBe(1)
    expect(shallow[1 * size + 2 + SHALLOW_TILES]).toBe(0)
  })

  it('never marks land or lakes as shelf - the shelf is sea only', () => {
    const { shallow, tileType } = analyse([
      '..........',
      '.###~###..',
      '.#######..',
      '..........',
    ])
    for (let i = 0; i < shallow.length; i++) {
      if (shallow[i]) expect(tileType[i]).toBe(TILE.OCEAN)
    }
  })

  it('joins two islands whose shelves meet, and records how wide the channel is', () => {
    // Four tiles of water between the coasts: within 2 x SHALLOW_TILES, so
    // the shelves touch and a strong swimmer can get across.
    const { straits, group, groupCount } = analyse([
      '............',
      '.##....##...',
      '.##....##...',
      '............',
    ])
    expect(groupCount).toBe(1)
    expect(group[0]).toBe(group[1])
    expect(straits.length).toBe(1)
    expect(straits[0]).toMatchObject({ a: 0, b: 1 })
    expect(straits[0].gap).toBe(4)
  })

  it('leaves islands separated by open sea in their own groups', () => {
    // Ten tiles of water: both islands have a shelf, but there is deep water
    // in the middle that nothing may enter.
    const { straits, group, groupCount } = analyse([
      '..................',
      '.##..........##...',
      '.##..........##...',
      '..................',
    ])
    expect(groupCount).toBe(2)
    expect(group[0]).not.toBe(group[1])
    expect(straits).toEqual([])
  })

  it('treats an island in the middle as a stepping stone between two others', () => {
    // A is out of reach of C, but both are in reach of B, so all three are
    // one group: a lineage can island-hop even where it could not cross
    // directly.
    const { groupCount, group, straits } = analyse([
      '.....................',
      '.##....##.....##.....',
      '.##....##.....##.....',
      '.....................',
    ])
    expect(groupCount).toBe(1)
    expect(new Set([group[0], group[1], group[2]]).size).toBe(1)
    // Only the neighbouring pairs actually meet; A and C never do.
    expect(straits.map((s) => `${s.a}${s.b}`).sort()).toEqual(['01', '12'])
  })

  it('reports the narrowest point of a ragged channel, measured the way a creature moves', () => {
    const { straits } = analyse([
      '............',
      '.##...###...',
      '.###...##...',
      '.##...###...',
      '............',
    ])
    expect(straits.length).toBe(1)
    // Two steps at the pinch on the middle row - the headlands there are a
    // diagonal apart, and a diagonal step is a step (see NEIGHBORS).
    expect(straits[0].gap).toBe(2)
  })

  it('is unbothered by a world with no land at all', () => {
    const { islands, straits, groupCount } = analyse(['....', '....'])
    expect(islands).toEqual([])
    expect(straits).toEqual([])
    expect(groupCount).toBe(0)
  })
})
