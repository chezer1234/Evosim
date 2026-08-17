import { describe, it, expect } from 'vitest'
import { FISH_GENE_KEYS, createFishGenes, describeFish, describeFishStats, fishStats, mutateFishGenes } from './fish.js'
import { mulberry32 } from '../worldgen/mapgen.js'

/** Genes with everything at a neutral 0.5 except the overrides, so each test
 * isolates the one dial it is about. */
function genes(overrides = {}) {
  const g = {}
  for (const key of FISH_GENE_KEYS) g[key] = 0.5
  return { ...g, ...overrides }
}

describe('createFishGenes', () => {
  it('produces every gene, inside 0..1, deterministically for a seeded rng', () => {
    const g = createFishGenes(mulberry32(1))
    expect(Object.keys(g).sort()).toEqual([...FISH_GENE_KEYS].sort())
    for (const value of Object.values(g)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
    expect(createFishGenes(mulberry32(9))).toEqual(createFishGenes(mulberry32(9)))
  })

  it('starts founders at the middle of every range', () => {
    // Unlike the rabbits and foxes, a fish has no gene that decides a run at
    // spawn (see the FOUNDER_SPREAD comment in fish.js), so there is nothing
    // here to weight away from the midpoint.
    const totals = {}
    for (const key of FISH_GENE_KEYS) totals[key] = 0
    const n = 400
    for (let seed = 0; seed < n; seed++) {
      const g = createFishGenes(mulberry32(seed))
      for (const key of FISH_GENE_KEYS) totals[key] += g[key]
    }
    for (const key of FISH_GENE_KEYS) expect(totals[key] / n).toBeCloseTo(0.5, 1)
  })
})

describe('mutateFishGenes', () => {
  it('is deterministic, leaves the parent untouched and stays inside 0..1', () => {
    const parent = genes({ speed: 0.7 })
    expect(mutateFishGenes(parent, mulberry32(4))).toEqual(mutateFishGenes(parent, mulberry32(4)))
    expect(parent.speed).toBe(0.7)
    for (const extreme of [0, 1]) {
      const edge = {}
      for (const key of FISH_GENE_KEYS) edge[key] = extreme
      for (let seed = 0; seed < 30; seed++) {
        for (const value of Object.values(mutateFishGenes(edge, mulberry32(seed)))) {
          expect(value).toBeGreaterThanOrEqual(0)
          expect(value).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('actually drifts every gene across a run of spawnings', () => {
    const parent = genes()
    const drifted = new Set()
    let child = parent
    for (let seed = 0; seed < 20; seed++) {
      child = mutateFishGenes(child, mulberry32(seed))
      for (const key of FISH_GENE_KEYS) if (child[key] !== parent[key]) drifted.add(key)
    }
    expect(drifted.size).toBe(FISH_GENE_KEYS.length)
  })
})

describe('fishStats', () => {
  it('makes a fast fish the quickest thing in the water, and a slow one still quick', () => {
    // A rabbit needs at least 2 decision ticks per tile of water even at the
    // top of its swim gene (see SWIM_TICKS_RANGE in rabbit.js) - a fish has
    // to beat that, or "safe in the water" would be a thing a rabbit is.
    expect(fishStats(genes({ speed: 1 })).strokeTicks).toBe(1)
    expect(fishStats(genes({ speed: 0 })).strokeTicks).toBeLessThanOrEqual(3)
    expect(fishStats(genes({ speed: 1 })).strokeTicks).toBeLessThan(fishStats(genes({ speed: 0 })).strokeTicks)
  })

  it('trades speed and wariness off against what they cost to run', () => {
    // The same rule the fox's genes follow: nothing is a free upgrade.
    const plain = fishStats(genes({ speed: 0, wariness: 0 }))
    const twitchy = fishStats(genes({ speed: 1, wariness: 1 }))
    expect(twitchy.upkeepPerSec).toBeGreaterThan(plain.upkeepPerSec)
    expect(twitchy.evasion).toBeGreaterThan(plain.evasion)
    expect(twitchy.alertRadius).toBeGreaterThan(plain.alertRadius)
  })

  it('never lets a fish be uncatchable however fast it gets', () => {
    // Evasion is a share of grabs slipped, not immunity: a shoal that could
    // evolve its way out of being eaten would starve every fox on the island.
    expect(fishStats(genes({ speed: 1 })).evasion).toBeLessThan(0.8)
  })

  it('makes shoaling buy vigilance as well as company', () => {
    const loner = fishStats(genes({ shoaling: 0 }))
    const shoaler = fishStats(genes({ shoaling: 1 }))
    expect(loner.shoalRadius).toBe(0)
    expect(loner.shoalAlertBonus).toBe(0)
    expect(shoaler.shoalRadius).toBeGreaterThan(0)
    expect(shoaler.shoalAlertBonus).toBeGreaterThan(0)
  })

  it('maps fecundity to spawning sooner and more often', () => {
    const eager = fishStats(genes({ fecundity: 1 }))
    const reluctant = fishStats(genes({ fecundity: 0 }))
    expect(eager.breedEnergy).toBeLessThan(reluctant.breedEnergy)
    expect(eager.breedCooldownMs).toBeLessThan(reluctant.breedCooldownMs)
  })
})

describe('describeFish', () => {
  it('reads as a sentence and summarizes the numbers', () => {
    const blurb = describeFish(genes({ speed: 0.98, wariness: 0.02 }))
    expect(blurb.startsWith('This fish ')).toBe(true)
    expect(blurb.endsWith('.')).toBe(true)
    expect(blurb).not.toContain('undefined')
    const notes = describeFishStats(genes())
    expect(notes).toHaveLength(4)
    for (const note of notes) expect(note).not.toContain('NaN')
  })
})
