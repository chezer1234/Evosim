import { describe, it, expect } from 'vitest'
import {
  BURROW_CAPACITY,
  BURROW_LINK_RADIUS,
  burrowLinks,
  burrowNetworks,
  canDigAt,
  createBurrow,
  enterBurrow,
  hasSpace,
  leaveBurrow,
  linkedBurrows,
  nearestBurrow,
} from './burrow.js'

/** A stand-in rabbit: the burrow model only ever touches these fields. */
function rabbit(id) {
  return { id, x: 0, y: 0, burrowId: null }
}

describe('createBurrow', () => {
  it('starts empty, with its own id', () => {
    const a = createBurrow(3, 4, 7)
    const b = createBurrow(9, 9)
    expect(a.occupants).toEqual([])
    expect(a.diggerId).toBe(7)
    expect(a.id).not.toBe(b.id)
  })
})

describe('occupancy', () => {
  it('takes up to five rabbits and turns the sixth away', () => {
    // Issue #14: "Up to 5 rabbits can fit in one burrow."
    expect(BURROW_CAPACITY).toBe(5)
    const burrow = createBurrow(2, 2)
    for (let i = 1; i <= BURROW_CAPACITY; i++) {
      expect(enterBurrow(burrow, rabbit(i))).toBe(true)
    }
    expect(hasSpace(burrow)).toBe(false)
    const latecomer = rabbit(99)
    expect(enterBurrow(burrow, latecomer)).toBe(false)
    expect(latecomer.burrowId).toBeNull()
    expect(burrow.occupants).toHaveLength(BURROW_CAPACITY)
  })

  it('moves the rabbit onto the entrance tile and back out again', () => {
    const burrow = createBurrow(6, 8)
    const r = rabbit(1)
    enterBurrow(burrow, r)
    expect([r.x, r.y]).toEqual([6, 8])
    expect(r.burrowId).toBe(burrow.id)

    leaveBurrow([burrow], r)
    expect(r.burrowId).toBeNull()
    expect(burrow.occupants).toEqual([])
    expect(hasSpace(burrow)).toBe(true)
  })

  it('ignores leaving for a rabbit that was never underground', () => {
    const burrow = createBurrow(1, 1)
    const r = rabbit(1)
    expect(() => leaveBurrow([burrow], r)).not.toThrow()
    expect(burrow.occupants).toEqual([])
  })
})

describe('finding a burrow', () => {
  const burrows = [createBurrow(0, 0), createBurrow(5, 0), createBurrow(30, 30)]

  it('returns the closest one inside the radius, or nothing', () => {
    expect(nearestBurrow(burrows, 1, 0, 10)).toBe(burrows[0])
    expect(nearestBurrow(burrows, 4, 0, 10)).toBe(burrows[1])
    expect(nearestBurrow(burrows, 15, 15, 3)).toBeNull()
  })

  it('skips full burrows, since running to one is running nowhere', () => {
    const full = createBurrow(1, 0)
    for (let i = 1; i <= BURROW_CAPACITY; i++) enterBurrow(full, rabbit(i))
    const withFull = [full, ...burrows]
    expect(nearestBurrow(withFull, 1, 0, 10)).toBe(burrows[0])
    expect(nearestBurrow(withFull, 1, 0, 10, false)).toBe(full)
  })

  it('refuses to dig on top of an existing burrow but allows one further out', () => {
    expect(canDigAt(burrows, 1, 1)).toBe(false)
    expect(canDigAt(burrows, 12, 12)).toBe(true)
  })
})

describe('the tunnel network', () => {
  it('links burrows within the link radius and not beyond it', () => {
    const near = createBurrow(0, 0)
    const alongside = createBurrow(BURROW_LINK_RADIUS - 1, 0)
    const distant = createBurrow(BURROW_LINK_RADIUS * 3, 0)
    const burrows = [near, alongside, distant]

    expect(linkedBurrows(burrows, near)).toEqual([alongside])
    expect(linkedBurrows(burrows, distant)).toEqual([])
    expect(burrowLinks(burrows)).toEqual([[near, alongside]])
  })

  it('groups a chain of burrows into one warren, hop by hop', () => {
    // Two hops of BURROW_LINK_RADIUS: the ends are far apart but still one
    // network, which is what "burrow networks" has to mean for a rabbit to
    // be able to surface somewhere the fox is not.
    const a = createBurrow(0, 0)
    const b = createBurrow(BURROW_LINK_RADIUS, 0)
    const c = createBurrow(BURROW_LINK_RADIUS * 2, 0)
    const loner = createBurrow(0, 100)

    const networks = burrowNetworks([a, b, c, loner])
    expect(networks).toHaveLength(2)
    const warren = networks.find((n) => n.length > 1)
    expect(warren).toHaveLength(3)
    expect(networks.find((n) => n.length === 1)).toEqual([loner])
  })

  it('has no networks at all with no burrows dug', () => {
    expect(burrowNetworks([])).toEqual([])
    expect(burrowLinks([])).toEqual([])
  })
})
