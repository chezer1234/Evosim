// Burrows: the rabbits' answer to a fox (issue #14). A burrow is a hole in
// one tile that up to BURROW_CAPACITY rabbits can be inside at once. While a
// rabbit is in one it cannot be seen, chased or pounced on - and cannot eat,
// which is the whole tension: safety is free of risk but not free of time,
// and a sheltering rabbit is quietly starving.
//
// Burrows dug close together share tunnels and form a *network*: a rabbit
// that goes to ground with a fox sitting on its entrance can come up at a
// connected burrow instead of into the fox's jaws. That connectivity is the
// only reason to dig near an existing warren rather than anywhere else.
//
// Everything here is pure and framework-agnostic (same as fox.js/rabbit.js):
// it operates on plain burrow objects and arrays, so the sim owns the state
// and the tests can build a warren by hand.

/** How many rabbits fit in one burrow. */
export const BURROW_CAPACITY = 5
/** Energy a rabbit spends digging a new one. */
export const BURROW_BUILD_ENERGY = 7
/** Two burrows this close (euclidean tiles) share a tunnel. */
export const BURROW_LINK_RADIUS = 9
/** No digging closer than this to an existing burrow - a second hole in the
 * same spot would be capacity for nothing. */
export const BURROW_MIN_SPACING = 3
/** How far off a rabbit can pick out a burrow entrance unaided. Alarm calls
 * carry burrow locations beyond this (see simulation.js). */
export const BURROW_SENSE_RADIUS = 10

let nextBurrowId = 1

/** A fresh, empty burrow at a tile. `diggerId` is kept for the inspector -
 * "who dug this" is the kind of thing that makes a warren legible. */
export function createBurrow(x, y, diggerId = null) {
  return { id: nextBurrowId++, x, y, occupants: [], diggerId }
}

export function hasSpace(burrow) {
  return burrow.occupants.length < BURROW_CAPACITY
}

export function burrowAt(burrows, x, y) {
  return burrows.find((b) => b.x === x && b.y === y) || null
}

/** Distance from (x, y) to a burrow, in tiles. */
export function burrowDistance(burrow, x, y) {
  return Math.hypot(burrow.x - x, burrow.y - y)
}

/**
 * The nearest burrow to (x, y) within `radius`, or null. With
 * `requireSpace`, full burrows are skipped - a rabbit running for a hole
 * that has no room left is running to its death, so the sim always asks for
 * one it can actually get into.
 */
export function nearestBurrow(burrows, x, y, radius, requireSpace = true) {
  let best = null
  let bestDist = Infinity
  for (const b of burrows) {
    if (requireSpace && !hasSpace(b)) continue
    const dist = burrowDistance(b, x, y)
    if (dist > radius || dist >= bestDist) continue
    bestDist = dist
    best = b
  }
  return best
}

/** True if there is no burrow close enough to make a new one pointless. */
export function canDigAt(burrows, x, y) {
  return !burrows.some((b) => burrowDistance(b, x, y) < BURROW_MIN_SPACING)
}

/** The burrows directly tunnelled to `burrow` (not the whole network). */
export function linkedBurrows(burrows, burrow) {
  return burrows.filter((b) => b !== burrow && burrowDistance(b, burrow.x, burrow.y) <= BURROW_LINK_RADIUS)
}

/**
 * Every directly-tunnelled pair, as [a, b] - what the renderer draws as the
 * lines between entrances, and the cheapest honest description of "the
 * network" for anything that doesn't need whole components.
 */
export function burrowLinks(burrows) {
  const links = []
  for (let i = 0; i < burrows.length; i++) {
    for (let j = i + 1; j < burrows.length; j++) {
      if (burrowDistance(burrows[i], burrows[j].x, burrows[j].y) <= BURROW_LINK_RADIUS) links.push([burrows[i], burrows[j]])
    }
  }
  return links
}

/** The connected components of the tunnel graph: each returned array is one
 * warren whose burrows can all reach each other, directly or by hopping. */
export function burrowNetworks(burrows) {
  const parent = burrows.map((_, i) => i)
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]]
      i = parent[i]
    }
    return i
  }
  for (let i = 0; i < burrows.length; i++) {
    for (let j = i + 1; j < burrows.length; j++) {
      if (burrowDistance(burrows[i], burrows[j].x, burrows[j].y) <= BURROW_LINK_RADIUS) {
        const ri = find(i)
        const rj = find(j)
        if (ri !== rj) parent[ri] = rj
      }
    }
  }
  const groups = new Map()
  for (let i = 0; i < burrows.length; i++) {
    const root = find(i)
    if (!groups.has(root)) groups.set(root, [])
    groups.get(root).push(burrows[i])
  }
  return [...groups.values()]
}

/** Put a rabbit underground. Returns false (and changes nothing) if the
 * burrow is full, so callers never have to pre-check capacity themselves. */
export function enterBurrow(burrow, rabbit) {
  if (!hasSpace(burrow) || rabbit.burrowId === burrow.id) return false
  burrow.occupants.push(rabbit.id)
  rabbit.burrowId = burrow.id
  rabbit.x = burrow.x
  rabbit.y = burrow.y
  return true
}

/** Bring a rabbit back up. Safe to call on a rabbit that isn't in one. */
export function leaveBurrow(burrows, rabbit) {
  if (rabbit.burrowId == null) return
  const burrow = burrows.find((b) => b.id === rabbit.burrowId)
  if (burrow) burrow.occupants = burrow.occupants.filter((id) => id !== rabbit.id)
  rabbit.burrowId = null
}
