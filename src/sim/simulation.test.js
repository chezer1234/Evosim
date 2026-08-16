import { describe, it, expect, beforeEach } from 'vitest'
import { TILE } from '../worldgen/mapgen.js'
import { createSimulation, selectCreature, spawnFox, spawnRabbit, stepSimulation, isPlaceable, TICK_MS } from './simulation.js'
import { INPUT_SIZE, HIDDEN_SIZE, OUTPUT_SIZE } from './brain.js'
import { FOX_GENE_KEYS } from './fox.js'
import { RABBIT_GENE_KEYS } from './rabbit.js'
import { BURROW_BUILD_ENERGY, BURROW_CAPACITY, burrowNetworks } from './burrow.js'

// A brain that ignores its inputs entirely (all weights/biases zero), so its
// behaviour is fully predictable: moveX/moveY = tanh(0) = 0 (never moves),
// run/rest/reproduceDesire/searchDrive = sigmoid(0) = 0.5 (never crosses the
// > 0.5 gates).
function zeroBrain() {
  return {
    w1: new Float32Array(INPUT_SIZE * HIDDEN_SIZE),
    b1: new Float32Array(HIDDEN_SIZE),
    w2: new Float32Array(HIDDEN_SIZE * OUTPUT_SIZE),
    b2: new Float32Array(OUTPUT_SIZE),
  }
}

// Same as zeroBrain but biased to always want to reproduce.
function reproductiveBrain() {
  const brain = zeroBrain()
  brain.b2[4] = 10 // reproduceDesire logit, sigmoid(10) ~= 0.9999
  return brain
}

// A rabbit that never chooses to flee (flee logit -10, sigmoid ~= 0). It
// still panics inside PANIC_RADIUS - that override is deliberately not
// something a genome can switch off - so this makes a predictable, stationary
// target for testing what the *fox* does.
function fearlessBrain() {
  const brain = zeroBrain()
  brain.b2[6] = -10
  return brain
}

// The opposite: bolts the instant it can see a fox at all, which is what
// makes it a clean probe for whether a fox was detected in the first place.
function jumpyBrain() {
  const brain = zeroBrain()
  brain.b2[6] = 10
  return brain
}

// A brain that always wants to take cover: the burrow half of issue #14 is
// gated on the `hide` output, and zeroBrain sits exactly on the 0.5 fence.
function burrowingBrain(overrides = {}) {
  const brain = zeroBrain()
  brain.b2[7] = 10
  for (const [idx, value] of Object.entries(overrides)) brain.b2[idx] = value
  return brain
}

/** Rabbit sense genes with everything neutral except the overrides. */
function rabbitGenes(overrides = {}) {
  const g = {}
  for (const key of RABBIT_GENE_KEYS) g[key] = 0.5
  return { ...g, ...overrides }
}

/** Fox genes with everything neutral except the overrides. */
function foxGenes(overrides = {}) {
  const g = {}
  for (const key of FOX_GENE_KEYS) g[key] = 0.5
  return { ...g, ...overrides }
}

// A fox built to actually hunt in tests: always hungry for a chase
// (bloodlust 1), fast enough to close, and easy to see so nothing depends on
// camouflage unless a test says so.
function hunterGenes(overrides = {}) {
  return foxGenes({ speed: 1, vision: 1, camouflage: 0, bloodlust: 1, stamina: 1, ...overrides })
}

/** An open square of GRASS ringed by OCEAN, no apples - a plain arena for
 * predator/prey tests where nothing distracts either species with food. */
function makeOpenMap(size) {
  const tileType = new Uint8Array(size * size).fill(TILE.GRASS)
  for (let i = 0; i < size; i++) {
    tileType[i] = TILE.OCEAN
    tileType[(size - 1) * size + i] = TILE.OCEAN
    tileType[i * size] = TILE.OCEAN
    tileType[i * size + size - 1] = TILE.OCEAN
  }
  return { size, tileType, canHaveApple: new Uint8Array(size * size) }
}

/** Run `ms` of sim time in decision-tick slices, so behaviour resolves tick
 * by tick the way it does in the real render loop. */
function runFor(sim, ms) {
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) stepSimulation(sim, TICK_MS)
}

// Tiny hand-built map: an interior 5x5 patch of GRASS ringed by OCEAN, with
// one FOREST/apple tile at (2,2). Bypasses generateMap's own randomness so
// simulation tests are fully deterministic.
function makeTestMap() {
  const size = 5
  const tileType = new Uint8Array(size * size).fill(TILE.GRASS)
  const canHaveApple = new Uint8Array(size * size)
  for (let x = 0; x < size; x++) {
    tileType[x] = TILE.OCEAN
    tileType[(size - 1) * size + x] = TILE.OCEAN
  }
  for (let y = 0; y < size; y++) {
    tileType[y * size] = TILE.OCEAN
    tileType[y * size + size - 1] = TILE.OCEAN
  }
  const appleIdx = 2 * size + 2
  tileType[appleIdx] = TILE.FOREST
  canHaveApple[appleIdx] = 1
  return { size, tileType, canHaveApple }
}

describe('isPlaceable', () => {
  const map = makeTestMap()

  it('allows non-ocean in-bounds tiles', () => {
    expect(isPlaceable(map, 2, 2)).toBe(true)
    expect(isPlaceable(map, 1, 1)).toBe(true)
  })

  it('rejects ocean tiles', () => {
    expect(isPlaceable(map, 0, 0)).toBe(false)
  })

  it('rejects out-of-bounds coordinates', () => {
    expect(isPlaceable(map, -1, 2)).toBe(false)
    expect(isPlaceable(map, 2, 5)).toBe(false)
  })
})

describe('createSimulation', () => {
  it('starts hasApple as an independent copy of the map flags', () => {
    const map = makeTestMap()
    const sim = createSimulation(map)
    expect(Array.from(sim.hasApple)).toEqual(Array.from(map.canHaveApple))
    sim.hasApple[0] = 1
    expect(map.canHaveApple[0]).toBe(0) // proves it's a copy, not a shared reference
  })

  it('starts with no rabbits and a zeroed clock', () => {
    const sim = createSimulation(makeTestMap())
    expect(sim.rabbits).toEqual([])
    expect(sim.clock).toBe(0)
  })
})

describe('spawnRabbit', () => {
  let sim
  beforeEach(() => {
    sim = createSimulation(makeTestMap())
  })

  it('adds a live rabbit at the given position with defaults', () => {
    const rabbit = spawnRabbit(sim, 2, 2, zeroBrain())
    expect(sim.rabbits).toContain(rabbit)
    expect(rabbit.x).toBe(2)
    expect(rabbit.y).toBe(2)
    expect(rabbit.alive).toBe(true)
    expect(rabbit.energy).toBe(100)
    expect(rabbit.generation).toBe(0)
  })

  it('assigns each rabbit a distinct id', () => {
    const a = spawnRabbit(sim, 1, 1, zeroBrain())
    const b = spawnRabbit(sim, 1, 2, zeroBrain())
    expect(a.id).not.toBe(b.id)
  })
})

describe('stepSimulation: eating', () => {
  it('eats an available apple on the first decision tick and gains energy', () => {
    const sim = createSimulation(makeTestMap())
    const rabbit = spawnRabbit(sim, 2, 2, zeroBrain(), 50)
    const idx = 2 * 5 + 2

    expect(sim.hasApple[idx]).toBe(1)
    stepSimulation(sim, TICK_MS)

    expect(rabbit.energy).toBe(60) // 50 + EAT_GAIN(10)
    expect(sim.hasApple[idx]).toBe(0)
    expect(sim.regrowAt[idx]).toBeGreaterThanOrEqual(0)
  })

  it('never lets energy exceed the max even when already near it', () => {
    const sim = createSimulation(makeTestMap())
    const rabbit = spawnRabbit(sim, 2, 2, zeroBrain(), 95)
    stepSimulation(sim, TICK_MS)
    expect(rabbit.energy).toBe(100)
  })
})

describe('stepSimulation: energy depletion and death', () => {
  it('removes a rabbit once its energy is depleted to zero', () => {
    const sim = createSimulation(makeTestMap())
    spawnRabbit(sim, 1, 1, zeroBrain(), 1)
    expect(sim.rabbits.length).toBe(1)

    // ENERGY_DEPLETE_NORMAL_MS is 2500ms per -1 energy at rest.
    stepSimulation(sim, 2500)

    expect(sim.rabbits.length).toBe(0)
  })

  it('leaves a rabbit alive if it has energy left after the tick', () => {
    const sim = createSimulation(makeTestMap())
    // Energy stays above HUNGRY_ENERGY(65) throughout so the hunger
    // override (see runDecisionTick) doesn't kick in and send this
    // otherwise-inert zeroBrain rabbit walking toward the test map's apple -
    // this test is only about depletion math, not foraging.
    const rabbit = spawnRabbit(sim, 1, 1, zeroBrain(), 70)
    stepSimulation(sim, 2500)
    expect(rabbit.alive).toBe(true)
    expect(rabbit.energy).toBe(69)
  })
})

describe('stepSimulation: reproduction', () => {
  it('starts gestation once desire and energy both clear their thresholds', () => {
    const sim = createSimulation(makeTestMap())
    const rabbit = spawnRabbit(sim, 1, 1, reproductiveBrain(), 100)
    stepSimulation(sim, TICK_MS)

    expect(rabbit.gestating).toBe(true)
    expect(rabbit.energy).toBe(90) // 100 - REPRO_COST(10)
  })

  it('does not let a low-energy rabbit start gestation', () => {
    const sim = createSimulation(makeTestMap())
    const rabbit = spawnRabbit(sim, 1, 1, reproductiveBrain(), 50) // <= REPRO_ENERGY_THRESHOLD(75)
    stepSimulation(sim, TICK_MS)
    expect(rabbit.gestating).toBe(false)
  })

  it('spawns a child near the parent once gestation completes', () => {
    const sim = createSimulation(makeTestMap())
    spawnRabbit(sim, 1, 1, reproductiveBrain(), 100)
    stepSimulation(sim, TICK_MS) // starts gestation
    expect(sim.rabbits.length).toBe(1)

    // Land the birth on a 1ms final tick (see the newborn-energy test below
    // for why): a child appended mid-iteration is walked by that same
    // stepSimulation call too, and its mutated brain can now genuinely
    // wander via search mode - fine in general play, but it would make this
    // assertion about *where it was born* flaky if the birth and a chunk of
    // the child's own subsequent movement landed in the same call.
    stepSimulation(sim, 30000 - 1) // GESTATION_MS, just short of completing
    stepSimulation(sim, 1) // completes gestation and spawns the child
    expect(sim.rabbits.length).toBe(2)

    const child = sim.rabbits.find((r) => r.generation === 1)
    expect(child).toBeDefined()
    expect(Math.abs(child.x - 1)).toBeLessThanOrEqual(1)
    expect(Math.abs(child.y - 1)).toBeLessThanOrEqual(1)
  })

  it('starts a newborn at 80 energy, not the old 50, so it can survive to its first meal', () => {
    const sim = createSimulation(makeTestMap())
    spawnRabbit(sim, 1, 1, reproductiveBrain(), 100)
    stepSimulation(sim, TICK_MS) // starts gestation
    // Land the birth on a 1ms final tick (rather than one big jump) so the
    // same stepSimulation call that spawns the child - which also
    // immediately steps the child, since it's appended mid-iteration -
    // advances it by only 1ms. That's short of both the energy-depletion
    // threshold and a full decision tick, so this test's always-eager-to-
    // breed brain doesn't get a chance to fire tryReproduce on the child
    // itself (which would spend REPRO_COST before we get to assert).
    stepSimulation(sim, 30000 - 1) // GESTATION_MS, just short of completing (gestating only starts ticking down after the first call above)
    stepSimulation(sim, 1) // completes gestation and spawns the child

    const child = sim.rabbits.find((r) => r.generation === 1)
    expect(child.energy).toBe(80)
  })
})

describe('spawnFox', () => {
  it('adds a live fox with a full gene set and its own id sequence', () => {
    const sim = createSimulation(makeOpenMap(9))
    const fox = spawnFox(sim, 3, 3)
    expect(sim.foxes).toContain(fox)
    expect(sim.rabbits).toEqual([])
    expect(fox.alive).toBe(true)
    expect(fox.kills).toBe(0)
    expect(Object.keys(fox.genes).sort()).toEqual([...FOX_GENE_KEYS].sort())
  })
})

describe('foxes hunting rabbits', () => {
  it('runs down a rabbit that does not flee, and eats it', () => {
    const sim = createSimulation(makeOpenMap(11))
    spawnRabbit(sim, 7, 5, fearlessBrain(), 100)
    const fox = spawnFox(sim, 3, 5, hunterGenes(), 60)
    const energyBefore = fox.energy

    // Step until the kill rather than for a fixed span, so the assertions
    // below describe the moment it happens instead of some point after it.
    for (let tick = 0; tick < 20 && sim.kills === 0; tick++) stepSimulation(sim, TICK_MS)

    expect(sim.rabbits).toHaveLength(0)
    expect(sim.kills).toBe(1)
    expect(fox.kills).toBe(1)
    expect(fox.energy).toBeGreaterThan(energyBefore)
    expect(fox.feedingRemaining).toBeGreaterThan(0) // stands over the carcass
  })

  it('leaves rabbits alone when it is well fed and has no desire to hunt', () => {
    const sim = createSimulation(makeOpenMap(11))
    spawnRabbit(sim, 6, 5, fearlessBrain(), 100)
    // bloodlust 0 -> only hunts below ~46 energy; this one starts far above it.
    const fox = spawnFox(sim, 4, 5, hunterGenes({ bloodlust: 0 }), 110)

    runFor(sim, 4000)

    expect(sim.rabbits).toHaveLength(1)
    expect(sim.kills).toBe(0)
    expect(fox.hunting).toBe(false)
  })

  it('cannot pounce on a rabbit it has not closed on yet', () => {
    const sim = createSimulation(makeOpenMap(21))
    spawnRabbit(sim, 16, 10, fearlessBrain(), 100)
    spawnFox(sim, 2, 10, hunterGenes(), 60)

    stepSimulation(sim, TICK_MS)

    expect(sim.rabbits).toHaveLength(1)
    expect(sim.kills).toBe(0)
  })

  it('clears the selection when the selected rabbit is eaten', () => {
    const sim = createSimulation(makeOpenMap(11))
    const rabbit = spawnRabbit(sim, 6, 5, fearlessBrain(), 100)
    spawnFox(sim, 4, 5, hunterGenes(), 60)
    selectCreature(sim, 'rabbit', rabbit.id)

    runFor(sim, 3000)

    expect(sim.kills).toBe(1)
    expect(sim.selectedId).toBeNull()
    expect(sim.selectedKind).toBeNull()
  })
})

describe('rabbits fleeing foxes', () => {
  it('bolts away from a fox at point-blank range whatever its genome says', () => {
    const sim = createSimulation(makeOpenMap(15))
    // Fearless genome, but PANIC_RADIUS is a hardwired reflex.
    const rabbit = spawnRabbit(sim, 8, 7, fearlessBrain(), 100)
    spawnFox(sim, 7, 7, hunterGenes({ speed: 0 }), 60)

    stepSimulation(sim, TICK_MS)

    expect(rabbit.fleeing).toBe(true)
    expect(rabbit.running).toBe(true) // a bolt is always a sprint
    expect(rabbit.resting).toBe(false)
    expect(rabbit.x).toBeGreaterThan(8) // directly away from the fox
  })

  it('does not flee when there is no fox in sight', () => {
    const sim = createSimulation(makeOpenMap(11))
    const rabbit = spawnRabbit(sim, 5, 5, jumpyBrain(), 100)
    stepSimulation(sim, TICK_MS)
    expect(rabbit.fleeing).toBe(false)
  })

  it('spots an uncamouflaged fox at a distance, but a camouflaged one can stalk a deaf rabbit', () => {
    const seen = createSimulation(makeOpenMap(15))
    const watchful = spawnRabbit(seen, 10, 7, jumpyBrain(), 100, 0, rabbitGenes({ hearing: 0 }))
    spawnFox(seen, 5, 7, hunterGenes({ camouflage: 0, speed: 0 }), 60)
    stepSimulation(seen, TICK_MS)
    expect(watchful.fleeing).toBe(true)

    // Camouflage still beats *eyes*, and a slow fox is quiet enough that the
    // worst ears in the population (hearing 0 -> 8 tiles, halved again by
    // how little noise a speed-0 fox makes) don't pick it up at 5 tiles
    // either. Both senses have to miss for an ambush to work now.
    const ambushed = createSimulation(makeOpenMap(15))
    const oblivious = spawnRabbit(ambushed, 10, 7, jumpyBrain(), 100, 0, rabbitGenes({ hearing: 0 }))
    spawnFox(ambushed, 5, 7, hunterGenes({ camouflage: 1, speed: 0 }), 60)
    stepSimulation(ambushed, TICK_MS)
    expect(oblivious.fleeing).toBe(false)
  })

  it('outruns a slow fox once it has bolted, opening the gap', () => {
    const sim = createSimulation(makeOpenMap(31))
    const rabbit = spawnRabbit(sim, 14, 15, jumpyBrain(), 100)
    const fox = spawnFox(sim, 10, 15, hunterGenes({ speed: 0 }), 60)
    const gapBefore = Math.hypot(rabbit.x - fox.x, rabbit.y - fox.y)

    runFor(sim, 2000)

    expect(sim.kills).toBe(0)
    expect(Math.hypot(rabbit.x - fox.x, rabbit.y - fox.y)).toBeGreaterThan(gapBefore)
  })
})

describe('fox pack behaviour', () => {
  it('flags foxes as packing only when a packmate is inside their pack radius', () => {
    const sim = createSimulation(makeOpenMap(31))
    const loner = spawnFox(sim, 3, 3, foxGenes({ packTendency: 0, speed: 0 }), 90)
    const packerA = spawnFox(sim, 20, 20, foxGenes({ packTendency: 1, speed: 0 }), 90)
    const packerB = spawnFox(sim, 27, 24, foxGenes({ packTendency: 1, speed: 0 }), 90)

    stepSimulation(sim, TICK_MS)

    expect(loner.packing).toBe(false)
    expect(packerA.packing).toBe(true)
    expect(packerB.packing).toBe(true)
  })

  it('draws pack-minded foxes toward each other while they are not hunting', () => {
    const sim = createSimulation(makeOpenMap(31))
    const a = spawnFox(sim, 8, 15, foxGenes({ packTendency: 1, speed: 1, bloodlust: 0 }), 90)
    const b = spawnFox(sim, 22, 15, foxGenes({ packTendency: 1, speed: 1, bloodlust: 0 }), 90)
    const gapBefore = Math.hypot(a.x - b.x, a.y - b.y)

    runFor(sim, 4000)

    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(gapBefore)
  })
})

describe('fox energy and reproduction', () => {
  it('burns energy over time and dies once it runs out', () => {
    const sim = createSimulation(makeOpenMap(9))
    spawnFox(sim, 4, 4, foxGenes(), 1)
    expect(sim.foxes).toHaveLength(1)

    runFor(sim, 5000)

    expect(sim.foxes).toHaveLength(0)
  })

  it('burns energy faster while sprinting after prey than while prowling', () => {
    const chasing = createSimulation(makeOpenMap(21))
    spawnRabbit(chasing, 14, 10, fearlessBrain(), 100)
    const hunter = spawnFox(chasing, 6, 10, hunterGenes(), 100)

    const idling = createSimulation(makeOpenMap(21))
    const prowler = spawnFox(idling, 6, 10, hunterGenes(), 100)

    runFor(chasing, 1000)
    runFor(idling, 1000)

    expect(hunter.energy).toBeLessThan(prowler.energy)
  })

  it('gestates once it is well fed and produces a cub with mutated genes', () => {
    const sim = createSimulation(makeOpenMap(11))
    // fecundity 1 -> breeds at the lowest energy threshold and the shortest
    // gestation available, which since issue #14 is still 68 seconds.
    const fox = spawnFox(sim, 5, 5, foxGenes({ fecundity: 1, metabolism: 0 }), 120)

    stepSimulation(sim, TICK_MS)
    expect(fox.gestating).toBe(true)

    runFor(sim, 68000)

    const cub = sim.foxes.find((f) => f.generation === 1)
    expect(cub).toBeDefined()
    expect(Math.abs(cub.x - fox.x)).toBeLessThanOrEqual(2)
    expect(Object.keys(cub.genes).sort()).toEqual([...FOX_GENE_KEYS].sort())
  })
})

describe('trait history with both species', () => {
  it('records fox population and average genes alongside the rabbit traits', () => {
    const sim = createSimulation(makeOpenMap(15))
    spawnRabbit(sim, 4, 4, fearlessBrain(), 100)
    spawnFox(sim, 11, 11, foxGenes({ speed: 0.25, bloodlust: 0 }), 100)

    runFor(sim, 5200)

    const sample = sim.traitHistory[sim.traitHistory.length - 1]
    expect(sample.population).toBe(1)
    expect(sample.foxPopulation).toBe(1)
    expect(sample.foxGenes.speed).toBeCloseTo(0.25, 5)
    expect(sample.skittishness).toBeGreaterThanOrEqual(0)
  })

  it('leaves fox gene averages null when no foxes are alive', () => {
    const sim = createSimulation(makeOpenMap(9))
    spawnRabbit(sim, 4, 4, zeroBrain(), 100)
    runFor(sim, 5200)
    expect(sim.traitHistory[sim.traitHistory.length - 1].foxGenes).toBeNull()
  })

  it('records the warren: how many burrows exist and who is in them', () => {
    const sim = createSimulation(makeOpenMap(15))
    spawnRabbit(sim, 7, 7, burrowingBrain(), 100)
    spawnFox(sim, 9, 7, hunterGenes({ speed: 0 }), 60)

    runFor(sim, 5200)

    const sample = sim.traitHistory[sim.traitHistory.length - 1]
    expect(sample.burrows).toBe(sim.burrows.length)
    expect(sample.sheltered).toBe(sim.rabbits.filter((r) => r.burrowId != null).length)
    expect(sample.rabbitGenes.hearing).toBeGreaterThan(0)
  })
})

// ============================ Issue #14 ==================================
// Rabbits could not survive foxes: the fox side compounded faster than the
// rabbits could respond, and a rabbit's only answer to a predator was to
// outrun it. These cover the three things that changed - ears, voices and
// somewhere to hide - plus the forest cover that blunts a fox's eyes.

describe('rabbits hearing foxes', () => {
  it('hears a fox from beyond the distance it could ever see one', () => {
    const sim = createSimulation(makeOpenMap(31))
    // 9 tiles out: well past PREY_ALERT_RADIUS (6), inside a good pair of
    // ears. The fox is uncamouflaged either way - this is about range.
    const rabbit = spawnRabbit(sim, 19, 15, jumpyBrain(), 100, 0, rabbitGenes({ hearing: 1 }))
    spawnFox(sim, 10, 15, hunterGenes({ speed: 0.6 }), 60)

    stepSimulation(sim, TICK_MS)

    expect(rabbit.fleeing).toBe(true)
    expect(rabbit.x).toBeGreaterThan(19) // away from it, not toward it
  })

  it('gives a sharp-eared rabbit a longer warning than a dull-eared one', () => {
    const dist = 9
    const detected = (hearing) => {
      const sim = createSimulation(makeOpenMap(31))
      const rabbit = spawnRabbit(sim, 15 + dist, 15, jumpyBrain(), 100, 0, rabbitGenes({ hearing }))
      spawnFox(sim, 15, 15, hunterGenes({ speed: 0.6 }), 60)
      stepSimulation(sim, TICK_MS)
      return rabbit.fleeing
    }
    expect(detected(1)).toBe(true)
    expect(detected(0)).toBe(false)
  })

  it('hears a camouflaged fox it has no chance of seeing', () => {
    // Camouflage is a visual trick: it buys nothing against ears, which is
    // what stops a maxed-camouflage lineage from being unanswerable.
    const sim = createSimulation(makeOpenMap(31))
    const rabbit = spawnRabbit(sim, 24, 15, jumpyBrain(), 100, 0, rabbitGenes({ hearing: 1 }))
    spawnFox(sim, 15, 15, hunterGenes({ camouflage: 1, speed: 1 }), 60) // 9 tiles, loud legs

    stepSimulation(sim, TICK_MS)

    expect(rabbit.fleeing).toBe(true)
  })
})

describe('rabbits warning each other', () => {
  it('bolts on a neighbour’s alarm call without detecting the fox itself', () => {
    const sim = createSimulation(makeOpenMap(41))
    // The lookout is close enough to hear the fox; the listener is 24 tiles
    // from it - far outside even the best ears - but well inside the
    // lookout's call.
    const lookout = spawnRabbit(sim, 18, 20, jumpyBrain(), 100, 0, rabbitGenes({ hearing: 1, voice: 1 }))
    const listener = spawnRabbit(sim, 26, 20, jumpyBrain(), 100, 0, rabbitGenes({ hearing: 1, voice: 1 }))
    spawnFox(sim, 8, 20, hunterGenes({ speed: 1 }), 60)

    stepSimulation(sim, TICK_MS)
    stepSimulation(sim, TICK_MS) // one tick for the call, one to act on it

    expect(lookout.alarmUntil).toBeGreaterThan(0)
    expect(listener.alarmHeard).toBeGreaterThan(0)
    expect(listener.fleeing).toBe(true)
  })

  it('stays calm when the only rabbit in earshot has nothing to report', () => {
    const sim = createSimulation(makeOpenMap(41))
    const a = spawnRabbit(sim, 18, 20, jumpyBrain(), 100, 0, rabbitGenes({ hearing: 1, voice: 1 }))
    const b = spawnRabbit(sim, 22, 20, jumpyBrain(), 100, 0, rabbitGenes({ hearing: 1, voice: 1 }))

    runFor(sim, 1000)

    expect(a.fleeing).toBe(false)
    expect(b.fleeing).toBe(false)
    expect(b.alarmHeard).toBe(0)
  })

  it('does not carry to a rabbit outside the caller’s voice', () => {
    const sim = createSimulation(makeOpenMap(61))
    const lookout = spawnRabbit(sim, 18, 30, jumpyBrain(), 100, 0, rabbitGenes({ hearing: 1, voice: 0 }))
    const tooFar = spawnRabbit(sim, 45, 30, jumpyBrain(), 100, 0, rabbitGenes({ hearing: 0, voice: 0 }))
    spawnFox(sim, 10, 30, hunterGenes({ speed: 1 }), 60)

    stepSimulation(sim, TICK_MS)
    stepSimulation(sim, TICK_MS)

    expect(lookout.fleeing).toBe(true)
    expect(tooFar.alarmHeard).toBe(0)
    expect(tooFar.fleeing).toBe(false)
  })
})

describe('burrows', () => {
  it('digs one for 7 energy and drops into it', () => {
    const sim = createSimulation(makeOpenMap(15))
    const rabbit = spawnRabbit(sim, 7, 7, burrowingBrain(), 100)
    spawnFox(sim, 10, 7, hunterGenes({ speed: 0 }), 60)

    stepSimulation(sim, TICK_MS)

    expect(sim.burrows).toHaveLength(1)
    expect(sim.burrows[0].diggerId).toBe(rabbit.id)
    expect(rabbit.burrowId).toBe(sim.burrows[0].id)
    expect(rabbit.energy).toBe(100 - BURROW_BUILD_ENERGY)
  })

  it('will not dig without enough energy left over to survive doing it', () => {
    const sim = createSimulation(makeOpenMap(15))
    const rabbit = spawnRabbit(sim, 7, 7, burrowingBrain(), 20)
    spawnFox(sim, 10, 7, hunterGenes({ speed: 0 }), 60)

    stepSimulation(sim, TICK_MS)

    expect(sim.burrows).toHaveLength(0)
    expect(rabbit.energy).toBe(20)
  })

  it('cannot be pounced on or even seen while underground', () => {
    const sim = createSimulation(makeOpenMap(15))
    const rabbit = spawnRabbit(sim, 7, 7, burrowingBrain(), 100)
    const fox = spawnFox(sim, 10, 7, hunterGenes(), 100)

    stepSimulation(sim, TICK_MS)
    expect(rabbit.burrowId).not.toBeNull()

    // The fox parks on the entrance for a good while and gets nothing.
    runFor(sim, 6000)

    expect(sim.kills).toBe(0)
    expect(rabbit.alive).toBe(true)
    expect(fox.hunting).toBe(false) // nothing visible to hunt
  })

  it('cannot eat while it is down there', () => {
    const sim = createSimulation(makeTestMap())
    // Sitting on the apple tile, hiding from a fox: the apple stays put.
    const rabbit = spawnRabbit(sim, 2, 2, burrowingBrain(), 90)
    spawnFox(sim, 3, 2, hunterGenes({ speed: 0, bloodlust: 0 }), 60)
    const appleIdx = 2 * 5 + 2

    stepSimulation(sim, TICK_MS)
    expect(rabbit.burrowId).not.toBeNull()
    const energyUnderground = rabbit.energy

    runFor(sim, 3000)

    expect(sim.hasApple[appleIdx]).toBe(1)
    expect(rabbit.energy).toBeLessThan(energyUnderground) // starving, not grazing
  })

  it('holds five rabbits and no more, leaving the rest above ground', () => {
    const sim = createSimulation(makeOpenMap(21))
    // All on one tile, so every one of them is at the entrance the first
    // rabbit digs and capacity is the only thing deciding who gets in.
    for (let i = 0; i < BURROW_CAPACITY + 2; i++) spawnRabbit(sim, 10, 10, burrowingBrain(), 100)
    spawnFox(sim, 16, 10, hunterGenes({ speed: 0 }), 60)

    runFor(sim, 2000)

    expect(sim.burrows).toHaveLength(1)
    expect(sim.burrows[0].occupants).toHaveLength(BURROW_CAPACITY)
    expect(sim.rabbits.filter((r) => r.burrowId != null)).toHaveLength(BURROW_CAPACITY)
  })

  it('digs a second burrow when the first is full, tunnelled to the first', () => {
    const sim = createSimulation(makeOpenMap(25))
    for (let i = 0; i < BURROW_CAPACITY; i++) spawnRabbit(sim, 10, 10, burrowingBrain(), 100)
    // Far enough out to be allowed to dig (BURROW_MIN_SPACING), close enough
    // that the two holes share a tunnel (BURROW_LINK_RADIUS).
    const latecomer = spawnRabbit(sim, 15, 10, burrowingBrain(), 100)
    spawnFox(sim, 20, 10, hunterGenes({ speed: 0 }), 60)

    runFor(sim, 1000)

    expect(sim.burrows).toHaveLength(2)
    expect(latecomer.burrowId).toBe(sim.burrows[1].id)
    expect(burrowNetworks(sim.burrows)).toHaveLength(1) // one warren, two entrances
  })

  it('surfaces again once it is hungry enough, since a burrow has no food in it', () => {
    const sim = createSimulation(makeOpenMap(15))
    const rabbit = spawnRabbit(sim, 7, 7, burrowingBrain(), 55)
    // A fox that is present (so the rabbit digs in) but well fed and frugal
    // enough that it never crosses its own hunt threshold during the test.
    spawnFox(sim, 12, 7, hunterGenes({ speed: 0, bloodlust: 0, metabolism: 0 }), 120)

    stepSimulation(sim, TICK_MS)
    expect(rabbit.burrowId).not.toBeNull()

    runFor(sim, 40000)

    // Above ground and staying there: with nothing to eat down a burrow,
    // hunger has to win or it would starve holding a slot.
    expect(rabbit.alive).toBe(true)
    expect(rabbit.burrowId).toBeNull()
  })

  it('frees its slot when a sheltering rabbit starves', () => {
    const sim = createSimulation(makeOpenMap(15))
    const rabbit = spawnRabbit(sim, 7, 7, burrowingBrain(), 100)
    spawnFox(sim, 9, 7, hunterGenes({ speed: 0 }), 60)
    stepSimulation(sim, TICK_MS)
    const burrow = sim.burrows[0]
    expect(burrow.occupants).toContain(rabbit.id)

    rabbit.energy = 1
    runFor(sim, 3000)

    expect(sim.rabbits).not.toContain(rabbit)
    expect(burrow.occupants).not.toContain(rabbit.id)
  })

  it('lets a warren survive a fox that would otherwise have eaten it', () => {
    // The regression the issue is actually about: same fox, same rabbits,
    // the only difference is whether they will use a burrow.
    const survivors = (brainFor) => {
      const sim = createSimulation(makeOpenMap(25))
      for (let i = 0; i < 5; i++) spawnRabbit(sim, 10 + i, 12, brainFor(), 100, 0, rabbitGenes())
      spawnFox(sim, 20, 12, hunterGenes(), 100)
      runFor(sim, 20000)
      return sim.rabbits.length
    }
    expect(survivors(burrowingBrain)).toBeGreaterThan(survivors(() => fearlessBrain()))
  })
})

describe('swimming', () => {
  /** An open map with a lake filling columns `x0`..`x1` (inclusive), so a
   * creature on one side has to cross water to reach the other. */
  function makeLakeMap(size, x0, x1) {
    const map = makeOpenMap(size)
    for (let y = 1; y < size - 1; y++) {
      for (let x = x0; x <= x1; x++) map.tileType[y * size + x] = TILE.LAKE
    }
    return map
  }

  it('will not let a rabbit without the gene set foot in the water', () => {
    const sim = createSimulation(makeLakeMap(15, 8, 11))
    // Bolting from a fox to its west: straight into the lake, if it could.
    const rabbit = spawnRabbit(sim, 7, 7, jumpyBrain(), 100, 0, rabbitGenes({ swimming: 0 }))
    spawnFox(sim, 5, 7, hunterGenes({ speed: 0 }), 60)

    runFor(sim, 3000)

    expect(rabbit.fleeing).toBe(true)
    expect(rabbit.x).toBeLessThan(8) // cornered against the shore
    expect(rabbit.swimming).toBe(false)
  })

  it('lets a rabbit that has the gene cross, and drops it into the swim animation state', () => {
    const sim = createSimulation(makeLakeMap(15, 8, 11))
    const rabbit = spawnRabbit(sim, 7, 7, jumpyBrain(), 100, 0, rabbitGenes({ swimming: 1 }))
    spawnFox(sim, 5, 7, hunterGenes({ speed: 0 }), 60)

    let everSwam = false
    for (let elapsed = 0; elapsed < 4000; elapsed += TICK_MS) {
      stepSimulation(sim, TICK_MS)
      everSwam = everSwam || rabbit.swimming
      expect(rabbit.floundering).toBe(false) // it belongs out there
    }

    expect(rabbit.x).toBeGreaterThan(7)
    expect(everSwam).toBe(true)
  })

  it('is the escape it looks like: a landlocked fox breaks off at the bank', () => {
    const sim = createSimulation(makeLakeMap(15, 8, 11))
    const rabbit = spawnRabbit(sim, 9, 7, jumpyBrain(), 100, 0, rabbitGenes({ swimming: 1 }))
    const fox = spawnFox(sim, 6, 7, hunterGenes({ speed: 1, swimming: 0 }), 90)

    runFor(sim, 4000)

    expect(fox.x).toBeLessThan(8)
    expect(fox.swimming).toBe(false)
    expect(rabbit.alive).toBe(true)
    expect(sim.kills).toBe(0)
  })

  it('and stops being one once the foxes evolve the same gene', () => {
    const sim = createSimulation(makeLakeMap(15, 8, 11))
    spawnRabbit(sim, 10, 7, fearlessBrain(), 100, 0, rabbitGenes({ swimming: 1 }))
    const fox = spawnFox(sim, 7, 7, hunterGenes({ speed: 1, swimming: 1 }), 90)

    let followedIn = false
    for (let elapsed = 0; elapsed < 4000; elapsed += TICK_MS) {
      stepSimulation(sim, TICK_MS)
      followedIn = followedIn || fox.swimming
    }

    expect(followedIn).toBe(true)
    expect(sim.kills).toBe(1) // and the lake stops being anywhere to hide
  })

  it('crosses more slowly than it walks, at a pace set by the gene', () => {
    // Same brain, same start, same water: the only difference is how good at
    // it each one is (2 ticks a tile against 7 - see rabbitStats).
    function tilesCrossedIn(skill, ms) {
      const sim = createSimulation(makeLakeMap(21, 6, 17))
      const rabbit = spawnRabbit(sim, 7, 10, jumpyBrain(), 100, 0, rabbitGenes({ swimming: skill }))
      spawnFox(sim, 3, 10, hunterGenes({ speed: 0 }), 60)
      runFor(sim, ms)
      return rabbit.x - 7
    }
    expect(tilesCrossedIn(1, 4000)).toBeGreaterThan(tilesCrossedIn(0.4, 4000))
  })

  it('burns energy far faster in the water than on the same ground dry', () => {
    const wet = createSimulation(makeLakeMap(15, 1, 13))
    const swimmer = spawnRabbit(wet, 7, 7, zeroBrain(), 100, 0, rabbitGenes({ swimming: 0.5 }))
    const dry = createSimulation(makeOpenMap(15))
    const walker = spawnRabbit(dry, 7, 7, zeroBrain(), 100, 0, rabbitGenes({ swimming: 0.5 }))

    runFor(wet, 10000)
    runFor(dry, 10000)

    expect(swimmer.energy).toBeLessThan(walker.energy)
  })

  it('drowns a rabbit that runs out of energy out there, and counts it', () => {
    const sim = createSimulation(makeLakeMap(15, 1, 13))
    const rabbit = spawnRabbit(sim, 7, 7, zeroBrain(), 3, 0, rabbitGenes({ swimming: 0.6 }))

    runFor(sim, 12000)

    expect(rabbit.alive).toBe(false)
    expect(rabbit.drowned).toBe(true)
    expect(sim.drownings).toBe(1)
  })

  it('leaves a rabbit dropped in deep water floundering for the nearest shore', () => {
    // Nothing evolved about this - it is what happens when you put a
    // non-swimmer in a lake with the spawn palette.
    const sim = createSimulation(makeLakeMap(15, 4, 13))
    const rabbit = spawnRabbit(sim, 7, 7, zeroBrain(), 100, 0, rabbitGenes({ swimming: 0 }))

    expect(rabbit.floundering).toBe(true)
    runFor(sim, 6000)

    expect(rabbit.x).toBeLessThan(7) // the bank at x=3 is the closest way out
    expect(rabbit.energy).toBeLessThan(100)
  })

  it('gets that rabbit back onto dry land, where it stops floundering', () => {
    const sim = createSimulation(makeLakeMap(15, 5, 9))
    const rabbit = spawnRabbit(sim, 5, 7, zeroBrain(), 100, 0, rabbitGenes({ swimming: 0 }))

    runFor(sim, 6000)

    expect(rabbit.swimming).toBe(false)
    expect(rabbit.floundering).toBe(false)
    expect(rabbit.alive).toBe(true)
  })

  it('slows a swimming fox to a paddle - no sprinting in the water', () => {
    const sim = createSimulation(makeLakeMap(21, 6, 17))
    spawnRabbit(sim, 16, 10, fearlessBrain(), 100, 0, rabbitGenes({ swimming: 1 }))
    const fox = spawnFox(sim, 8, 10, hunterGenes({ speed: 1, swimming: 1 }), 100)

    runFor(sim, 2000)

    expect(fox.swimming).toBe(true)
    expect(fox.sprinting).toBe(false)
  })

  it('counts a drowned fox too', () => {
    const sim = createSimulation(makeLakeMap(15, 1, 13))
    const fox = spawnFox(sim, 7, 7, hunterGenes({ swimming: 0 }), 2)

    runFor(sim, 4000)

    expect(fox.alive).toBe(false)
    expect(sim.drownings).toBe(1)
  })
})

describe('smooth motion', () => {
  it('gives every spawned creature a drawn position on its own tile', () => {
    const sim = createSimulation(makeOpenMap(11))
    const rabbit = spawnRabbit(sim, 5, 5, zeroBrain(), 100)
    const fox = spawnFox(sim, 3, 3, foxGenes(), 100)
    expect([rabbit.renderX, rabbit.renderY]).toEqual([5, 5])
    expect([fox.renderX, fox.renderY]).toEqual([3, 3])
  })

  it('draws a stepping rabbit between tiles rather than on top of one', () => {
    const sim = createSimulation(makeOpenMap(15))
    const rabbit = spawnRabbit(sim, 8, 7, fearlessBrain(), 100)
    spawnFox(sim, 7, 7, hunterGenes({ speed: 0 }), 60)

    // Frame-sized steps, the way the render loop drives it: the tile changes
    // on one decision tick and the sprite spends the frames after it
    // travelling there, which is the entire point.
    const drawn = []
    for (let elapsed = 0; elapsed < 400; elapsed += 20) {
      stepSimulation(sim, 20)
      drawn.push(rabbit.renderX)
    }

    expect(rabbit.x).toBeGreaterThan(8) // it bolted east, away from the fox
    expect(drawn.some((x) => x > 8 && x < 9)).toBe(true)
  })

  it('catches the drawn position up to the tile when a creature stops', () => {
    const sim = createSimulation(makeOpenMap(11))
    const rabbit = spawnRabbit(sim, 5, 5, zeroBrain(), 100) // never moves
    runFor(sim, 2000)
    expect(rabbit.renderX).toBeCloseTo(rabbit.x, 6)
    expect(rabbit.renderY).toBeCloseTo(rabbit.y, 6)
  })

  it('never lets the drawn position run away from the tile a creature is on', () => {
    // A sprinting fox can take two tiles in one decision tick, so the sprite
    // can be a whole two tiles behind for the instant before it travels
    // them - but it is always catching up, never drifting.
    const sim = createSimulation(makeOpenMap(21))
    spawnRabbit(sim, 10, 10, jumpyBrain(), 100)
    const fox = spawnFox(sim, 6, 10, hunterGenes({ speed: 1 }), 100)
    for (let i = 0; i < 200; i++) {
      stepSimulation(sim, 40)
      for (const c of [...sim.rabbits, fox]) {
        expect(Math.abs(c.renderX - c.x)).toBeLessThanOrEqual(2.001)
        expect(Math.abs(c.renderY - c.y)).toBeLessThanOrEqual(2.001)
      }
    }
  })
})

describe('foxes in forest cover', () => {
  /** An open map with a band of FOREST down the middle column range. */
  function makeForestMap(size) {
    const map = makeOpenMap(size)
    for (let y = 0; y < size; y++) {
      for (let x = 1; x < size - 1; x++) map.tileType[y * size + x] = TILE.FOREST
    }
    return map
  }

  it('loses 45% of its vision under the canopy, so distant prey goes unseen', () => {
    // vision 1 -> 12 tiles in the open, 6.6 in forest. The rabbit sits at 9.
    const open = createSimulation(makeOpenMap(31))
    spawnRabbit(open, 24, 15, fearlessBrain(), 100)
    const openFox = spawnFox(open, 15, 15, hunterGenes({ speed: 0 }), 60)

    const wooded = createSimulation(makeForestMap(31))
    spawnRabbit(wooded, 24, 15, fearlessBrain(), 100)
    const woodedFox = spawnFox(wooded, 15, 15, hunterGenes({ speed: 0 }), 60)

    stepSimulation(open, TICK_MS)
    stepSimulation(wooded, TICK_MS)

    expect(openFox.hunting).toBe(true)
    expect(woodedFox.hunting).toBe(false)
  })

  it('still sees prey that comes close in the trees', () => {
    const sim = createSimulation(makeForestMap(31))
    spawnRabbit(sim, 19, 15, fearlessBrain(), 100)
    const fox = spawnFox(sim, 15, 15, hunterGenes({ speed: 0 }), 60)

    stepSimulation(sim, TICK_MS)

    expect(fox.hunting).toBe(true)
  })
})
