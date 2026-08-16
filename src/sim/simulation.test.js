import { describe, it, expect, beforeEach } from 'vitest'
import { TILE } from '../worldgen/mapgen.js'
import { createSimulation, spawnRabbit, stepSimulation, isPlaceable, TICK_MS } from './simulation.js'

// A brain that ignores its inputs entirely (all weights/biases zero), so its
// behaviour is fully predictable: moveX/moveY = tanh(0) = 0 (never moves),
// run/rest/reproduceDesire = sigmoid(0) = 0.5 (never crosses the > 0.5 gates).
function zeroBrain() {
  return {
    w1: new Float32Array(7 * 8),
    b1: new Float32Array(8),
    w2: new Float32Array(8 * 5),
    b2: new Float32Array(5),
  }
}

// Same as zeroBrain but biased to always want to reproduce.
function reproductiveBrain() {
  const brain = zeroBrain()
  brain.b2[4] = 10 // reproduceDesire logit, sigmoid(10) ~= 0.9999
  return brain
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
    const rabbit = spawnRabbit(sim, 1, 1, zeroBrain(), 5)
    stepSimulation(sim, 2500)
    expect(rabbit.alive).toBe(true)
    expect(rabbit.energy).toBe(4)
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

    stepSimulation(sim, 30000) // GESTATION_MS
    expect(sim.rabbits.length).toBe(2)

    const child = sim.rabbits.find((r) => r.generation === 1)
    expect(child).toBeDefined()
    expect(Math.abs(child.x - 1)).toBeLessThanOrEqual(1)
    expect(Math.abs(child.y - 1)).toBeLessThanOrEqual(1)
  })
})
