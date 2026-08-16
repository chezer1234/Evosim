import { describe, it, expect, beforeEach } from 'vitest'
import { TILE } from '../worldgen/mapgen.js'
import { createSimulation, selectCreature, spawnFox, spawnRabbit, stepSimulation, isPlaceable, TICK_MS } from './simulation.js'
import { INPUT_SIZE, HIDDEN_SIZE, OUTPUT_SIZE } from './brain.js'
import { FOX_GENE_KEYS } from './fox.js'

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

  it('spots an uncamouflaged fox at a distance, but not a camouflaged one', () => {
    const seen = createSimulation(makeOpenMap(15))
    const watchful = spawnRabbit(seen, 10, 7, jumpyBrain(), 100)
    spawnFox(seen, 5, 7, hunterGenes({ camouflage: 0, speed: 0 }), 60)
    stepSimulation(seen, TICK_MS)
    expect(watchful.fleeing).toBe(true)

    const ambushed = createSimulation(makeOpenMap(15))
    const oblivious = spawnRabbit(ambushed, 10, 7, jumpyBrain(), 100)
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
    // gestation, so the test doesn't have to run for a simulated minute.
    const fox = spawnFox(sim, 5, 5, foxGenes({ fecundity: 1, metabolism: 0 }), 120)

    stepSimulation(sim, TICK_MS)
    expect(fox.gestating).toBe(true)

    runFor(sim, 34000)

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
})
