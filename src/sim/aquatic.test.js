// The shoreline food chain, as behaviour rather than as numbers: where the
// two new species will and will not go, what they eat, and the two ways a fox
// gets a meal out of them. The genes themselves are covered in fish.test.js
// and crab.test.js; the tile-by-tile rules they add up to are here.

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mulberry32, TILE } from '../worldgen/mapgen.js'
import {
  createSimulation,
  isPlaceableFor,
  spawnCrab,
  spawnFish,
  spawnFox,
  stepSimulation,
  TICK_MS,
} from './simulation.js'
import { FISH_GENE_KEYS } from './fish.js'
import { CRAB_GENE_KEYS } from './crab.js'
import { FOX_GENE_KEYS } from './fox.js'
import { FOX_HIDDEN_SIZE, FOX_INPUT_SIZE, FOX_OUTPUT_SIZE } from './foxBrain.js'
import { FORAGE_REGROW_MS, isBankside } from './shallows.js'

/**
 * A hand-built shore: columns 0-5 are lake (so: shallows, from the sim's
 * point of view) and the rest is grass. No ocean at all, which keeps the
 * shelf rules out of tests that are not about them.
 */
function makeShoreMap(size = 20) {
  const tileType = new Uint8Array(size * size).fill(TILE.GRASS)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < 6; x++) tileType[y * size + x] = TILE.LAKE
  }
  return { size, tileType, canHaveApple: new Uint8Array(size * size), seed: 3 }
}

/** Everything wet: for the "a fish stays in water" checks there is nowhere
 * else it could possibly go, so a dry map with one pond is the honest test. */
function makePondMap(size = 20) {
  const tileType = new Uint8Array(size * size).fill(TILE.GRASS)
  for (let y = 6; y <= 13; y++) {
    for (let x = 6; x <= 13; x++) tileType[y * size + x] = TILE.LAKE
  }
  return { size, tileType, canHaveApple: new Uint8Array(size * size), seed: 5 }
}

/** A one-tile-wide channel of water down column 5, with dry land either
 * side. Nothing in it can put distance between itself and the bank, which is
 * what makes it the right arena for "can a fox fish from dry land" - in an
 * open lake the honest answer is often "no, it swam off", which is a
 * different (and also correct) behaviour. */
function makeChannelMap(size = 20) {
  const tileType = new Uint8Array(size * size).fill(TILE.GRASS)
  for (let y = 0; y < size; y++) tileType[y * size + 5] = TILE.LAKE
  return { size, tileType, canHaveApple: new Uint8Array(size * size), seed: 11 }
}

function runFor(sim, ms) {
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) stepSimulation(sim, TICK_MS)
}

// Fixed random stream, for the same reason simulation.test.js pins one: half
// of what happens below is a roll - where a fish wanders, whether a grab
// connects - and a reproducible run is worth more than an unseeded one that
// fails once a fortnight.
let realRandom
beforeEach(() => {
  realRandom = Math.random
  Math.random = mulberry32(20250817)
})
afterEach(() => {
  Math.random = realRandom
})

function fishGenes(overrides = {}) {
  const g = {}
  for (const key of FISH_GENE_KEYS) g[key] = 0.5
  return { ...g, ...overrides }
}

function crabGenes(overrides = {}) {
  const g = {}
  for (const key of CRAB_GENE_KEYS) g[key] = 0.5
  return { ...g, ...overrides }
}

function foxGenes(overrides = {}) {
  const g = {}
  for (const key of FOX_GENE_KEYS) g[key] = 0.5
  return { ...g, vision: 1, speed: 0.5, camouflage: 0, ...overrides }
}

/** A fox brain that ignores its inputs: every output is sigmoid(0) = 0.5, and
 * every gate is `> 0.5`, so it does nothing but sweep. Output order: chase,
 * sprint, track, group, rest, breed, forage. */
function zeroFoxBrain(overrides = {}) {
  const brain = {
    w1: new Float32Array(FOX_INPUT_SIZE * FOX_HIDDEN_SIZE),
    b1: new Float32Array(FOX_HIDDEN_SIZE),
    w2: new Float32Array(FOX_HIDDEN_SIZE * FOX_OUTPUT_SIZE),
    b2: new Float32Array(FOX_OUTPUT_SIZE),
  }
  for (const [idx, value] of Object.entries(overrides)) brain.b2[idx] = value
  return brain
}

/** Takes whatever the shoreline offers, and never breeds mid-test. */
function foragingBrain(overrides = {}) {
  return zeroFoxBrain({ 6: 10, 5: -10, ...overrides })
}

/** Wants nothing to do with the shore (nor anything else). */
function incuriousBrain(overrides = {}) {
  return zeroFoxBrain({ 6: -10, 5: -10, ...overrides })
}

describe('isPlaceableFor', () => {
  const map = makeShoreMap()

  it('puts each species where it can actually live', () => {
    expect(isPlaceableFor(map, 'fish', 2, 5)).toBe(true)
    expect(isPlaceableFor(map, 'fish', 10, 5)).toBe(false) // dry land
    expect(isPlaceableFor(map, 'crab', 2, 5)).toBe(true) // the shallows
    expect(isPlaceableFor(map, 'crab', 6, 5)).toBe(true) // the tideline
    expect(isPlaceableFor(map, 'crab', 10, 5)).toBe(false) // well inland
    expect(isPlaceableFor(map, 'rabbit', 10, 5)).toBe(true)
    expect(isPlaceableFor(map, 'fish', -1, 5)).toBe(false)
  })
})

describe('fish', () => {
  it('never leaves the water, however long it swims', () => {
    const map = makePondMap()
    const sim = createSimulation(map)
    const fish = spawnFish(sim, 9, 9, fishGenes())
    for (let elapsed = 0; elapsed < 20000; elapsed += TICK_MS) {
      stepSimulation(sim, TICK_MS)
      if (!fish.alive) break
      expect(map.tileType[fish.y * map.size + fish.x]).toBe(TILE.LAKE)
    }
  })

  it('eats the algae under it, and the patch grows back on its own clock', () => {
    const map = makePondMap()
    const sim = createSimulation(map)
    // Put it on a tile that is definitely bearing something.
    let idx = -1
    for (let i = 0; i < sim.hasForage.length && idx < 0; i++) if (sim.hasForage[i]) idx = i
    const x = idx % map.size
    const y = (idx - x) / map.size
    const fish = spawnFish(sim, x, y, fishGenes(), 20)

    stepSimulation(sim, TICK_MS)
    expect(sim.hasForage[idx]).toBe(0)
    expect(fish.energy).toBeGreaterThan(20)

    // Empty the pond, or the patch is simply eaten again the moment it comes
    // back and the regrowth is invisible.
    sim.fish.length = 0
    runFor(sim, FORAGE_REGROW_MS - 2000)
    expect(sim.hasForage[idx]).toBe(0) // nothing regrows early
    runFor(sim, 3000)
    expect(sim.hasForage[idx]).toBe(1)
  })

  it('spawns fry that carry mutated genes and a cooldown of their own', () => {
    const map = makePondMap()
    const sim = createSimulation(map)
    // Full tank and no cooldown: it should spawn on its first tick.
    const parent = spawnFish(sim, 9, 9, fishGenes({ fecundity: 1 }), 40)

    stepSimulation(sim, TICK_MS)

    expect(sim.fish.length).toBe(2)
    const fry = sim.fish.find((f) => f !== parent)
    expect(fry.generation).toBe(1)
    expect(parent.energy).toBeLessThan(40)
    // Born on the clock, so a shoal cannot double every few seconds.
    expect(fry.nextBreedAt).toBeGreaterThan(sim.clock)
  })

  it('bolts from a fox that comes to the bank', () => {
    const map = makeShoreMap()
    const sim = createSimulation(map)
    const fish = spawnFish(sim, 4, 10, fishGenes({ wariness: 1 }))
    spawnFox(sim, 6, 10, foxGenes(), 100, 0, incuriousBrain())

    runFor(sim, 1000)

    expect(fish.fleeing).toBe(true)
    // Away from the bank, deeper into the lake.
    expect(fish.x).toBeLessThan(4)
  })
})

describe('crabs', () => {
  it('stays in the water entirely when its boldness says so', () => {
    const map = makeShoreMap()
    const sim = createSimulation(map)
    const crab = spawnCrab(sim, 3, 10, crabGenes({ boldness: 0 }))

    for (let elapsed = 0; elapsed < 20000; elapsed += TICK_MS) {
      stepSimulation(sim, TICK_MS)
      if (!crab.alive) break
      expect(map.tileType[crab.y * map.size + crab.x]).toBe(TILE.LAKE)
    }
  })

  it('works the wrack line when it is bold enough, but only as far as its gene allows', () => {
    const map = makeShoreMap()
    const sim = createSimulation(map)
    const crab = spawnCrab(sim, 5, 10, crabGenes({ boldness: 1 }), 12) // hungry, so it goes looking
    let furthest = 0

    for (let elapsed = 0; elapsed < 40000; elapsed += TICK_MS) {
      stepSimulation(sim, TICK_MS)
      if (!crab.alive) break
      // Columns 0-5 are water, so x-5 is how far up the beach it has come.
      furthest = Math.max(furthest, crab.x - 5)
      expect(crab.x - 5).toBeLessThanOrEqual(2) // landReach at boldness 1
    }
    expect(furthest).toBeGreaterThan(0)
  })

  it('walks itself back to the water when it is dropped somewhere it cannot live', () => {
    // The spawn palette can put a crab on the tideline; nothing stops a
    // player putting a timid one there. Habitat rules should shape where it
    // lives, not trap it where it landed (see crabCanEnter).
    const map = makeShoreMap()
    const sim = createSimulation(map)
    const crab = spawnCrab(sim, 7, 10, crabGenes({ boldness: 0, speed: 1 }))

    runFor(sim, 12000)

    expect(map.tileType[crab.y * map.size + crab.x]).toBe(TILE.LAKE)
  })

  it('scuttles for the water when a fox turns up', () => {
    const map = makeShoreMap()
    const sim = createSimulation(map)
    const crab = spawnCrab(sim, 7, 10, crabGenes({ boldness: 1, armour: 0, speed: 1, fecundity: 0 }), 15)
    spawnFox(sim, 10, 10, foxGenes(), 100, 0, incuriousBrain())

    let everFled = false
    let closest = crab.x
    for (let elapsed = 0; elapsed < 3000; elapsed += TICK_MS) {
      stepSimulation(sim, TICK_MS)
      everFled = everFled || crab.fleeing
      closest = Math.min(closest, crab.x)
    }

    expect(everFled).toBe(true)
    expect(closest).toBeLessThan(7) // and it went toward the water, not away
  })
})

describe('a fox working the shoreline', () => {
  it('picks up a crab it is standing next to, and counts it apart from its kills', () => {
    const map = makeShoreMap()
    const sim = createSimulation(map)
    spawnCrab(sim, 6, 10, crabGenes({ armour: 0, speed: 0, fecundity: 0 }), 14)
    const fox = spawnFox(sim, 7, 10, foxGenes(), 60, 0, foragingBrain())

    runFor(sim, 4000)

    expect(sim.crabs.length).toBe(0)
    expect(sim.shoreCatches).toBe(1)
    expect(fox.catches).toBe(1)
    expect(fox.kills).toBe(0) // a crab is not a rabbit, and the panel says so
    expect(fox.energy).toBeGreaterThan(60)
  })

  it('fishes from the bank without getting its feet wet', () => {
    // The point of the whole mechanic: a fox that cannot swim a stroke - and
    // nearly none of them can - still eats off the water.
    const map = makeChannelMap()
    const sim = createSimulation(map)
    spawnFish(sim, 5, 10, fishGenes({ speed: 0, wariness: 0, fecundity: 0 }), 18)
    const fox = spawnFox(sim, 6, 10, foxGenes({ swimming: 0 }), 60, 0, foragingBrain())

    let everSwam = false
    for (let elapsed = 0; elapsed < 20000; elapsed += TICK_MS) {
      stepSimulation(sim, TICK_MS)
      everSwam = everSwam || fox.swimming
    }

    expect(sim.shoreCatches).toBeGreaterThan(0)
    expect(everSwam).toBe(false)
  })

  it('does not stalk a fish it could never reach', () => {
    // A landlocked fox and a fish in open water: without the bankside check
    // it would walk to the shore and stand there for the rest of its life
    // (see findNearestShorePrey).
    const map = makePondMap()
    const sim = createSimulation(map)
    spawnFish(sim, 9, 9, fishGenes({ fecundity: 0 }), 18) // middle of the pond, no bank adjacent
    const fox = spawnFox(sim, 9, 15, foxGenes({ swimming: 0 }), 100, 0, foragingBrain())

    // Checked tick by tick against where the fish actually is: it wanders,
    // and a fish that has drifted to the edge of the pond genuinely *is*
    // fair game for a fox on the bank. What must never happen is the fox
    // fixing on one out in open water.
    let stalkedTheUnreachable = false
    for (let elapsed = 0; elapsed < 6000; elapsed += TICK_MS) {
      stepSimulation(sim, TICK_MS)
      const outOfReach = sim.fish.every((f) => !isBankside(map, f.x, f.y))
      stalkedTheUnreachable = stalkedTheUnreachable || (fox.foraging && outOfReach)
    }

    expect(stalkedTheUnreachable).toBe(false)
  })

  it('takes what it can get once it is starving, whatever its instincts say', () => {
    // The hunger override, and the reason "foxes survive without rabbits" is
    // a property of the simulation rather than of whichever lineage happened
    // to evolve a taste for shellfish.
    const map = makeShoreMap()
    const sim = createSimulation(map)
    spawnCrab(sim, 6, 10, crabGenes({ armour: 0, speed: 0, fecundity: 0 }), 14)
    const fox = spawnFox(sim, 7, 10, foxGenes(), 20, 0, incuriousBrain()) // wants nothing to do with it

    runFor(sim, 4000)

    expect(sim.shoreCatches).toBe(1)
    expect(fox.energy).toBeGreaterThan(20)
  })
})

describe('the population sample', () => {
  it('records both shoreline populations and their average genes', () => {
    const map = makeShoreMap()
    const sim = createSimulation(map)
    spawnFish(sim, 3, 8, fishGenes())
    spawnCrab(sim, 3, 12, crabGenes())

    runFor(sim, 5200) // one TRAIT_SAMPLE_MS

    const sample = sim.traitHistory[0]
    expect(sample.fishPopulation).toBeGreaterThan(0)
    expect(sample.crabPopulation).toBeGreaterThan(0)
    expect(sample.fishGenes.speed).toBeGreaterThan(0)
    expect(sample.crabGenes.boldness).toBeGreaterThan(0)
  })

  it('reports no genes at all rather than zeros when nothing is alive', () => {
    const sim = createSimulation(makeShoreMap())
    runFor(sim, 5200)
    expect(sim.traitHistory[0].fishGenes).toBeNull()
    expect(sim.traitHistory[0].crabGenes).toBeNull()
  })
})
