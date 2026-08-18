import { describe, it, expect } from 'vitest'
import { TILE } from '../worldgen/mapgen.js'
import { INLAND, LAND_FORAGE_REACH, forageTiles, isBankside, isShallows, isTideline, shoreDistances } from './shallows.js'

/**
 * A hand-built coast: the left six columns are deep ocean, the next two are
 * ocean flagged as shelf, and the rest is grass with a one-tile lake at
 * (12, 4). Enough to ask every question this module answers without going
 * near generateMap's randomness.
 */
function makeCoast(size = 16) {
  const tileType = new Uint8Array(size * size).fill(TILE.GRASS)
  const shallow = new Uint8Array(size * size)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < 8; x++) {
      tileType[y * size + x] = TILE.OCEAN
      if (x >= 6) shallow[y * size + x] = 1
    }
  }
  tileType[4 * size + 12] = TILE.LAKE
  return { size, tileType, shallow, seed: 7 }
}

describe('isShallows', () => {
  const map = makeCoast()

  it('counts a lake and the shelf, but never the deep', () => {
    expect(isShallows(map, 12, 4)).toBe(true) // lake
    expect(isShallows(map, 7, 4)).toBe(true) // shelf
    expect(isShallows(map, 2, 4)).toBe(false) // deep ocean: grows nothing, holds nothing
    expect(isShallows(map, 10, 4)).toBe(false) // dry land
  })

  it('is false off the edge of the map', () => {
    expect(isShallows(map, -1, 4)).toBe(false)
    expect(isShallows(map, 4, 99)).toBe(false)
  })
})

describe('isTideline', () => {
  const map = makeCoast()

  it('is the dry land with water against it, and nothing else', () => {
    expect(isTideline(map, 8, 4)).toBe(true) // first dry column, ocean to its west
    expect(isTideline(map, 9, 4)).toBe(false) // one step further inland
    expect(isTideline(map, 11, 4)).toBe(true) // beside the lake
    expect(isTideline(map, 7, 4)).toBe(false) // in the water, not on the shore
  })
})

describe('isBankside', () => {
  const map = makeCoast()

  it('marks the water something standing on land can reach into', () => {
    // The check that stops a landlocked fox from stalking a fish in the
    // middle of a lake it will never enter (see findNearestShorePrey).
    expect(isBankside(map, 7, 4)).toBe(true) // shelf, with the beach beside it
    expect(isBankside(map, 12, 4)).toBe(true) // a one-tile lake is all bank
    expect(isBankside(map, 2, 4)).toBe(false) // open sea
    expect(isBankside(map, 9, 4)).toBe(false) // not water at all
  })
})

describe('shoreDistances', () => {
  const map = makeCoast()
  const dist = shoreDistances(map)
  const at = (x, y) => dist[y * map.size + x]

  it('is zero in the water and counts dry steps outward from it', () => {
    // Row 10, well clear of the lake at (12,4), so the only water in reach is
    // the sea off to the west.
    expect(at(2, 10)).toBe(0)
    expect(at(8, 10)).toBe(1)
    expect(at(9, 10)).toBe(2)
    expect(at(10, 10)).toBe(3)
  })

  it('measures from the nearest water of any kind, lakes included', () => {
    // (11,4) is three tiles from the sea but right beside the lake.
    expect(at(11, 4)).toBe(1)
  })

  it('gives up on genuinely inland ground rather than flooding the whole map', () => {
    expect(at(15, 15)).toBe(INLAND)
  })
})

describe('forageTiles', () => {
  const map = makeCoast()
  const dist = shoreDistances(map)

  it('only grows anything in the shallows or just above the tideline', () => {
    const forage = forageTiles(map, dist)
    for (let y = 0; y < map.size; y++) {
      for (let x = 0; x < map.size; x++) {
        if (!forage[y * map.size + x]) continue
        const inShallows = isShallows(map, x, y)
        const nearShore = map.tileType[y * map.size + x] !== TILE.OCEAN && dist[y * map.size + x] <= LAND_FORAGE_REACH
        expect(inShallows || nearShore).toBe(true)
      }
    }
  })

  it('never puts food in the deep', () => {
    const forage = forageTiles(map, dist)
    for (let y = 0; y < map.size; y++) {
      expect(forage[y * map.size + 2]).toBe(0)
    }
  })

  it('is a property of the map rather than a roll of the dice', () => {
    // Two simulations on one world have to lay out the same larder, and
    // building it must not consume the global rng - every reproducible run in
    // this project depends on Math.random being drawn in the same order (see
    // the hash01 comment in shallows.js).
    const a = forageTiles(map, dist)
    const before = Math.random()
    const b = forageTiles(map, dist)
    const after = Math.random()
    expect(Array.from(a)).toEqual(Array.from(b))
    expect(typeof before).toBe('number')
    expect(typeof after).toBe('number')
  })

  it('lays out different worlds differently', () => {
    const other = { ...makeCoast(), seed: 99 }
    const a = forageTiles(map, dist)
    const b = forageTiles(other, shoreDistances(other))
    expect(Array.from(a)).not.toEqual(Array.from(b))
  })

  it('leaves plenty of empty water, so food is something to find', () => {
    const forage = forageTiles(map, dist)
    let shallowsTiles = 0
    let grown = 0
    for (let y = 0; y < map.size; y++) {
      for (let x = 0; x < map.size; x++) {
        if (!isShallows(map, x, y)) continue
        shallowsTiles += 1
        grown += forage[y * map.size + x]
      }
    }
    expect(grown).toBeGreaterThan(0)
    expect(grown).toBeLessThan(shallowsTiles * 0.6)
  })
})
