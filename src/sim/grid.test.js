import { describe, it, expect } from 'vitest'
import { createGrid, forEachWithin, gridInsert, gridMoved, gridRebuild, gridRemove, someWithin } from './grid.js'

/** A stand-in creature: the grid only ever touches id/x/y and the two
 * bookkeeping fields it stamps on itself. */
function at(id, x, y) {
  return { id, x, y }
}

/** Everything the grid offers up for a query, in ascending id - the order
 * buckets are packed in is deliberately not part of the contract, so every
 * assertion here sorts before comparing. */
function found(grid, x, y, radius) {
  const seen = []
  forEachWithin(grid, x, y, radius, (e) => seen.push(e.id))
  return seen.sort((a, b) => a - b)
}

describe('forEachWithin', () => {
  it('offers up everything in range', () => {
    const grid = createGrid(64)
    const near = at(1, 10, 10)
    const alsoNear = at(2, 13, 8)
    gridInsert(grid, near)
    gridInsert(grid, alsoNear)
    gridInsert(grid, at(3, 60, 60))
    expect(found(grid, 10, 10, 5)).toEqual([1, 2])
  })

  it('offers up a superset, never a subset - the caller does the real test', () => {
    // The point of the whole structure: it may hand back a creature that is
    // outside the radius (it shares a bucket with one that isn't), but it
    // must never withhold one that is inside it. Every caller re-tests the
    // distance itself, so the first is free and the second is a bug.
    const grid = createGrid(64)
    const inside = []
    let id = 1
    for (let y = 0; y < 64; y++) {
      for (let x = 0; x < 64; x++) {
        const e = at(id++, x, y)
        gridInsert(grid, e)
        if (Math.hypot(x - 30, y - 20) <= 7) inside.push(e.id)
      }
    }
    const offered = found(grid, 30, 20, 7)
    expect(offered).toEqual(expect.arrayContaining(inside))
    expect(offered.length).toBeGreaterThan(inside.length) // a superset, as advertised
  })

  it('does not run off the edges of the map', () => {
    const grid = createGrid(32)
    gridInsert(grid, at(1, 0, 0))
    gridInsert(grid, at(2, 31, 31))
    expect(found(grid, 0, 0, 40)).toEqual([1, 2])
    expect(found(grid, 31, 31, 3)).toEqual([2])
  })

  it('finds a creature after it moves, and stops finding it where it was', () => {
    const grid = createGrid(64)
    const wanderer = at(1, 5, 5)
    gridInsert(grid, wanderer)
    wanderer.x = 50
    wanderer.y = 50
    gridMoved(grid, wanderer)
    expect(found(grid, 5, 5, 3)).toEqual([])
    expect(found(grid, 50, 50, 3)).toEqual([1])
  })

  it('survives a step that stays inside the same bucket', () => {
    const grid = createGrid(64)
    const shuffler = at(1, 8, 8)
    gridInsert(grid, shuffler)
    const cell = shuffler.gridCell
    shuffler.x = 9
    gridMoved(grid, shuffler)
    expect(shuffler.gridCell).toBe(cell) // the cheap path: no bucket churn
    expect(found(grid, 9, 8, 1)).toEqual([1])
  })

  it('keeps the other occupants of a bucket when one is removed', () => {
    // Removal swaps the last entry into the hole, so the entry that moved
    // has to be told where it went or the next removal corrupts the bucket.
    const grid = createGrid(64)
    const a = at(1, 1, 1)
    const b = at(2, 2, 2)
    const c = at(3, 3, 3)
    for (const e of [a, b, c]) gridInsert(grid, e)
    gridRemove(grid, a)
    expect(found(grid, 2, 2, 4)).toEqual([2, 3])
    gridRemove(grid, b)
    expect(found(grid, 2, 2, 4)).toEqual([3])
    gridRemove(grid, c)
    expect(found(grid, 2, 2, 4)).toEqual([])
  })

  it('ignores a second removal of the same creature', () => {
    const grid = createGrid(64)
    const gone = at(1, 4, 4)
    gridInsert(grid, gone)
    gridRemove(grid, gone)
    expect(() => gridRemove(grid, gone)).not.toThrow()
    expect(found(grid, 4, 4, 2)).toEqual([])
  })
})

describe('gridRebuild', () => {
  it('replaces the contents wholesale', () => {
    const grid = createGrid(64)
    const survivor = at(1, 10, 10)
    gridInsert(grid, survivor)
    gridInsert(grid, at(2, 11, 11))
    gridRebuild(grid, [survivor])
    expect(found(grid, 10, 10, 5)).toEqual([1])
  })

  it('leaves the survivors movable again afterwards', () => {
    // A rebuilt entry needs fresh bookkeeping, or its next step writes into
    // the bucket it used to be in.
    const grid = createGrid(64)
    const survivor = at(1, 10, 10)
    gridInsert(grid, survivor)
    gridRebuild(grid, [survivor])
    survivor.x = 40
    gridMoved(grid, survivor)
    expect(found(grid, 10, 10, 3)).toEqual([])
    expect(found(grid, 40, 10, 3)).toEqual([1])
  })
})

describe('someWithin', () => {
  it('answers yes or no without walking the rest', () => {
    const grid = createGrid(64)
    gridInsert(grid, at(1, 20, 20))
    expect(someWithin(grid, 21, 20, 4, (e) => e.id === 1)).toBe(true)
    expect(someWithin(grid, 60, 60, 4, () => true)).toBe(false)
  })

  it('lets the test reject a candidate the box offered', () => {
    const grid = createGrid(64)
    gridInsert(grid, at(1, 20, 20))
    expect(someWithin(grid, 20, 20, 8, (e) => Math.hypot(e.x - 20, e.y - 20) <= 0.5)).toBe(true)
    expect(someWithin(grid, 27, 20, 8, (e) => Math.hypot(e.x - 27, e.y - 20) <= 0.5)).toBe(false)
  })
})
