// The starting-conditions layer (issue #18): the dial table, the rules it
// derives, and - the half that actually matters - that those rules reach the
// simulation instead of stopping at the settings screen.
//
// Every number in here used to be a module constant, so the failure this
// file guards against is a subtle one: a dial that moves in the UI, persists
// to localStorage, appears in `sim.rules`, and is then quietly ignored by
// the code that still reads the constant. Each threading test below therefore
// asserts on the *creature*, not on the rules object.

import { describe, it, expect, afterEach, beforeEach } from 'vitest'
import { mulberry32, TILE } from '../worldgen/mapgen.js'
import { createSimulation, spawnFox, spawnRabbit, stepSimulation, TICK_MS } from './simulation.js'
import {
  DEFAULT_SCENARIO,
  DEFAULT_RULES,
  SCENARIO_DIALS,
  SCENARIO_GROUPS,
  SCENARIO_PRESETS,
  createRules,
  matchingScenarioPreset,
  resolveScenario,
} from './scenario.js'
import { FOX_BASE, FOX_ENERGY_MAX, FOX_GENE_KEYS, foxStats } from './fox.js'
import { RABBIT_BASE } from './rabbit.js'
import { OUTPUT_SIZE, INPUT_SIZE, HIDDEN_SIZE, think } from './brain.js'
import { FOX_OUTPUT_SIZE, FOX_INPUT_SIZE, FOX_HIDDEN_SIZE, foxThink } from './foxBrain.js'

/** An open square of GRASS ringed by OCEAN, with apples on every inland tile
 * unless asked otherwise - the arena for the eat/breed tests below. */
function makeMap(size, { apples = false } = {}) {
  const tileType = new Uint8Array(size * size).fill(TILE.GRASS)
  for (let i = 0; i < size; i++) {
    tileType[i] = TILE.OCEAN
    tileType[(size - 1) * size + i] = TILE.OCEAN
    tileType[i * size] = TILE.OCEAN
    tileType[i * size + size - 1] = TILE.OCEAN
  }
  const canHaveApple = new Uint8Array(size * size)
  if (apples) canHaveApple.fill(1)
  return { size, tileType, canHaveApple }
}

/** A rabbit brain that wants nothing: every gate in the decision loop is
 * `> 0.5` and every output here is sigmoid(0). */
function zeroBrain(overrides = {}) {
  const brain = {
    w1: new Float32Array(INPUT_SIZE * HIDDEN_SIZE),
    b1: new Float32Array(HIDDEN_SIZE),
    w2: new Float32Array(HIDDEN_SIZE * OUTPUT_SIZE),
    b2: new Float32Array(OUTPUT_SIZE),
  }
  for (const [idx, value] of Object.entries(overrides)) brain.b2[idx] = value
  return brain
}

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

function foxGenes(overrides = {}) {
  const g = {}
  for (const key of FOX_GENE_KEYS) g[key] = 0.5
  return { ...g, ...overrides }
}

function runFor(sim, ms) {
  for (let elapsed = 0; elapsed < ms; elapsed += TICK_MS) stepSimulation(sim, TICK_MS)
}

// Founder genes and every mutation draw from Math.random, so anything that
// spawns a population is sampling. Pin the stream (see simulation.test.js for
// the full argument).
const realRandom = Math.random
beforeEach(() => {
  Math.random = mulberry32(20260906)
})
afterEach(() => {
  Math.random = realRandom
})

describe('the dial table', () => {
  it('gives every dial a default, a range that contains it, and a format', () => {
    for (const dial of SCENARIO_DIALS) {
      expect(dial.default, dial.key).toBeGreaterThanOrEqual(dial.min)
      expect(dial.default, dial.key).toBeLessThanOrEqual(dial.max)
      expect(typeof dial.format, dial.key).toBe('function')
      expect(DEFAULT_SCENARIO[dial.key], dial.key).toBe(dial.default)
    }
  })

  it('has no duplicate keys across the groups', () => {
    const keys = SCENARIO_DIALS.map((d) => d.key)
    expect(new Set(keys).size).toBe(keys.length)
  })

  it('leaves the defaults exactly as the sim was tuned', () => {
    // The whole point of the default scenario: opening the app and pressing
    // play has to give the balance every other test in this repo assumes.
    expect(DEFAULT_RULES.fox.founderMean).toEqual(FOX_BASE.founderMean)
    expect(DEFAULT_RULES.fox.founderSpread).toBe(FOX_BASE.founderSpread)
    expect(DEFAULT_RULES.fox.mutation).toEqual(FOX_BASE.mutation)
    expect(DEFAULT_RULES.fox.killEnergy).toEqual(FOX_BASE.killEnergy)
    expect(DEFAULT_RULES.fox.upkeepPerSec).toEqual(FOX_BASE.upkeepPerSec)
    expect(DEFAULT_RULES.fox.gestationMs).toEqual(FOX_BASE.gestationMs)
    expect(DEFAULT_RULES.rabbit.founderMean).toEqual(RABBIT_BASE.founderMean)
    expect(DEFAULT_RULES.rabbit.mutation).toEqual(RABBIT_BASE.mutation)
    // And the sim-loop numbers that moved into scenario.js wholesale.
    expect(DEFAULT_RULES.rabbit.eatGain).toBe(10)
    expect(DEFAULT_RULES.rabbit.breedEnergy).toBe(75)
    expect(DEFAULT_RULES.rabbit.gestationMs).toBe(30000)
    expect(DEFAULT_RULES.fox.litterRecoveryMs).toBe(150000)
    expect(DEFAULT_RULES.fox.territoryRadius).toBe(24)
  })
})

describe('resolveScenario', () => {
  it('fills in from the defaults and ignores keys it does not know', () => {
    const resolved = resolveScenario({ foxUpkeep: 1.5, somethingRemovedInV2: 99 })
    expect(resolved.foxUpkeep).toBe(1.5)
    expect(resolved.rabbitEatGain).toBe(DEFAULT_SCENARIO.rabbitEatGain)
    expect(resolved.somethingRemovedInV2).toBeUndefined()
  })

  it('clamps anything outside the slider that owns it', () => {
    // localStorage is written by whichever build the player last ran, so a
    // value can outlive the range it was valid in.
    const resolved = resolveScenario({ foxUpkeep: 99, foxSpeed: -3, mutationRate: NaN })
    expect(resolved.foxUpkeep).toBe(SCENARIO_DIALS.find((d) => d.key === 'foxUpkeep').max)
    expect(resolved.foxSpeed).toBe(0)
    expect(resolved.mutationRate).toBe(DEFAULT_SCENARIO.mutationRate)
  })
})

describe('createRules', () => {
  it('scales a baseline range by its multiplier, both ends together', () => {
    const rules = createRules({ foxUpkeep: 2, foxEnergyPerKill: 0.5 })
    expect(rules.fox.upkeepPerSec).toEqual(FOX_BASE.upkeepPerSec.map((v) => v * 2))
    expect(rules.fox.killEnergy).toEqual(FOX_BASE.killEnergy.map((v) => v * 0.5))
  })

  it('keeps the fox breeding bar under a full tank however hard it is pushed', () => {
    // A scenario where no fox can ever store enough energy to breed is a dead
    // run that looks like a bug, so the clamp is part of the rules.
    const rules = createRules({ foxBreedEnergy: 1.2 })
    for (const v of rules.fox.breedEnergy) expect(v).toBeLessThan(FOX_ENERGY_MAX)
  })

  it('moves both species and both brains with one evolution dial', () => {
    const rules = createRules({ mutationRate: 2, mutationSpread: 3 })
    expect(rules.fox.mutation.rate).toBeCloseTo(FOX_BASE.mutation.rate * 2)
    expect(rules.rabbit.mutation.rate).toBeCloseTo(RABBIT_BASE.mutation.rate * 2)
    expect(rules.brain.mutation.stddev).toBeCloseTo(DEFAULT_RULES.brain.mutation.stddev * 3)
    // A rate is a probability: it saturates rather than going past certainty.
    expect(createRules({ mutationRate: 4 }).fox.mutation.rate).toBe(1)
  })
})

describe('the presets', () => {
  it('only name dials that exist', () => {
    // The typo guard: a preset key that no dial answers to would silently do
    // nothing, and the preset would look identical to Balanced.
    const keys = new Set(SCENARIO_DIALS.map((d) => d.key))
    for (const preset of SCENARIO_PRESETS) {
      for (const key of Object.keys(preset.scenario)) expect(keys, `${preset.key}.${key}`).toContain(key)
    }
  })

  it('round-trip through matchingScenarioPreset, and a nudge comes off the preset', () => {
    for (const preset of SCENARIO_PRESETS) {
      expect(matchingScenarioPreset(resolveScenario(preset.scenario))).toBe(preset.key)
    }
    expect(matchingScenarioPreset({ ...DEFAULT_SCENARIO, foxUpkeep: 1.25 })).toBeNull()
  })

  it('starts from the defaults, so Balanced is the untouched world', () => {
    expect(matchingScenarioPreset(DEFAULT_SCENARIO)).toBe('balanced')
  })

  it('is offered as one tap per world, ahead of the sliders', () => {
    // Presets matter more than dials here - four of them, and a group for
    // each dimension the issue called out.
    expect(SCENARIO_PRESETS.length).toBeGreaterThanOrEqual(4)
    expect(SCENARIO_GROUPS.map((g) => g.key)).toEqual(['founders', 'energy', 'breeding', 'evolution', 'instincts'])
  })
})

describe('a scenario reaching the simulation', () => {
  it('builds founders around the means it was given', () => {
    const sim = createSimulation(makeMap(24), { foxSpeed: 0.9, foxMetabolism: 0.1, founderVariation: 0 })
    for (let i = 0; i < 5; i++) spawnFox(sim, 5 + i, 5)
    // Variation zero: every founder is the same animal, so the mean is the
    // gene rather than the centre of a spread.
    for (const fox of sim.foxes) {
      expect(fox.genes.speed).toBeCloseTo(0.9)
      expect(fox.genes.metabolism).toBeCloseTo(0.1)
    }
  })

  it('spreads founders wider when asked, and not at all when not', () => {
    const spread = (variation) => {
      const sim = createSimulation(makeMap(24), { founderVariation: variation })
      for (let i = 1; i < 20; i++) spawnRabbit(sim, i, 5)
      const values = sim.rabbits.map((r) => r.genes.hearing)
      return Math.max(...values) - Math.min(...values)
    }
    expect(spread(0)).toBe(0)
    expect(spread(2)).toBeGreaterThan(spread(0.5))
  })

  it('prices a kill and an apple by the run\'s own economy', () => {
    const rich = createSimulation(makeMap(24), { foxEnergyPerKill: 2, rabbitEatGain: 2 })
    expect(foxStats(foxGenes(), rich.rules.fox).energyPerKill).toBeCloseTo(
      foxStats(foxGenes(), DEFAULT_RULES.fox).energyPerKill * 2,
    )

    // The apple half, measured on the rabbit rather than on the rules: a
    // hungry rabbit standing on fruit eats it and gains what the run says
    // one apple is worth.
    const sim = createSimulation(makeMap(24, { apples: true }), { rabbitEatGain: 2 })
    const rabbit = spawnRabbit(sim, 5, 5, zeroBrain(), 40)
    runFor(sim, TICK_MS * 2)
    expect(rabbit.energy).toBeGreaterThan(40 + 15)
  })

  it('holds a pregnancy for as long as the scenario says', () => {
    const quick = createSimulation(makeMap(24, { apples: true }), { rabbitGestation: 0.4 })
    // reproduceDesire pinned high; energy well over the breeding bar.
    const rabbit = spawnRabbit(quick, 5, 5, zeroBrain({ 4: 10 }), 100)
    runFor(quick, TICK_MS * 2)
    expect(rabbit.gestating).toBe(true)
    // Set on the tick it conceived and counted down since, so it is the
    // scenario's term less the ticks that have run.
    const term = DEFAULT_RULES.rabbit.gestationMs * 0.4
    expect(rabbit.gestationRemaining).toBeGreaterThan(term - 4 * TICK_MS)
    expect(rabbit.gestationRemaining).toBeLessThanOrEqual(term)
  })

  it('will not let a rabbit breed below the bar the scenario set', () => {
    const strict = createSimulation(makeMap(24), { rabbitBreedEnergy: 1.2 })
    const rabbit = spawnRabbit(strict, 5, 5, zeroBrain({ 4: 10 }), 85) // over the default 75, under 90
    runFor(strict, TICK_MS * 2)
    expect(rabbit.gestating).toBe(false)
  })

  it('starts fresh brains from the founder biases it was handed', () => {
    // Both species, and in both directions: a prior is a starting opinion,
    // and a scenario can invert it.
    const jumpy = createSimulation(makeMap(24), { rabbitFleeBias: 4 })
    const calm = createSimulation(makeMap(24), { rabbitFleeBias: -2 })
    const flee = (sim) => {
      const rabbit = spawnRabbit(sim, 5, 5)
      return think(rabbit.brain, new Float32Array(INPUT_SIZE)).flee
    }
    expect(flee(jumpy)).toBeGreaterThan(flee(calm))

    const keen = createSimulation(makeMap(24), { foxChaseBias: 4 })
    const idle = createSimulation(makeMap(24), { foxChaseBias: -2 })
    const chase = (sim) => {
      const fox = spawnFox(sim, 5, 5)
      return foxThink(fox.brain, new Float32Array(FOX_INPUT_SIZE)).chase
    }
    expect(chase(keen)).toBeGreaterThan(chase(idle))
  })

  it('freezes evolution at a mutation rate of zero', () => {
    // The cleanest proof the evolution dial is wired to both halves of an
    // inheritance: a cub born under it is its parent, gene for gene and
    // weight for weight.
    const sim = createSimulation(makeMap(24), { mutationRate: 0 })
    const parent = spawnFox(sim, 5, 5, foxGenes({ fecundity: 1 }), FOX_ENERGY_MAX, 0, zeroFoxBrain({ 5: 10 }))
    runFor(sim, 65000)
    const cub = sim.foxes.find((f) => f.generation === 1)
    expect(cub).toBeDefined()
    expect(cub.genes).toEqual(parent.genes)
    expect(Array.from(cub.brain.w1)).toEqual(Array.from(parent.brain.w1))
  })

  it('lets a scenario switch the fox territory rule off', () => {
    // Two foxes on top of each other: the default density cap stops either
    // one denning, and a scenario that zeroes the radius does not.
    const denAt = (scenario) => {
      const sim = createSimulation(makeMap(24), scenario)
      spawnFox(sim, 5, 5, foxGenes({ fecundity: 1 }), FOX_ENERGY_MAX, 0, zeroFoxBrain({ 5: 10 }))
      spawnFox(sim, 6, 5, foxGenes({ fecundity: 1 }), FOX_ENERGY_MAX, 0, zeroFoxBrain({ 5: 10 }))
      runFor(sim, TICK_MS * 4)
      return sim.foxes.some((f) => f.gestating)
    }
    expect(denAt({})).toBe(false)
    expect(denAt({ foxTerritory: 0 })).toBe(true)
  })

  it('keeps the rules it was made with, and the scenario behind them', () => {
    const sim = createSimulation(makeMap(24), { foxUpkeep: 1.5 })
    expect(sim.scenario.foxUpkeep).toBe(1.5)
    expect(sim.rules.fox.upkeepPerSec).toEqual(FOX_BASE.upkeepPerSec.map((v) => v * 1.5))
    // Unspecified dials are still resolved, so nothing downstream has to
    // cope with an undefined rule.
    expect(sim.scenario).toEqual({ ...DEFAULT_SCENARIO, foxUpkeep: 1.5 })
  })

  it('defaults to the tuned balance when no scenario is given at all', () => {
    expect(createSimulation(makeMap(24)).rules).toEqual(DEFAULT_RULES)
  })
})
