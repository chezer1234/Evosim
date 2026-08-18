import { describe, it, expect } from 'vitest'
import { CRAB_GENE_KEYS, createCrabGenes, crabStats, describeCrab, describeCrabStats, mutateCrabGenes } from './crab.js'
import { LAND_FORAGE_REACH } from './shallows.js'
import { mulberry32 } from '../worldgen/mapgen.js'

function genes(overrides = {}) {
  const g = {}
  for (const key of CRAB_GENE_KEYS) g[key] = 0.5
  return { ...g, ...overrides }
}

describe('createCrabGenes', () => {
  it('produces every gene, inside 0..1, deterministically for a seeded rng', () => {
    const g = createCrabGenes(mulberry32(1))
    expect(Object.keys(g).sort()).toEqual([...CRAB_GENE_KEYS].sort())
    for (const value of Object.values(g)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
    expect(createCrabGenes(mulberry32(9))).toEqual(createCrabGenes(mulberry32(9)))
  })

  it('weights founders toward the water rather than up the beach', () => {
    // A scatter of bold founders is a scatter that is eaten before it breeds
    // once; boldness is meant to be something the run decides (see
    // FOUNDER_MEAN in crab.js), not the spawn.
    let total = 0
    const n = 400
    for (let seed = 0; seed < n; seed++) total += createCrabGenes(mulberry32(seed)).boldness
    expect(total / n).toBeLessThan(0.45)
  })

  it('still lets mutation carry a lineage well up the shore', () => {
    let child = createCrabGenes(mulberry32(3))
    let boldest = child.boldness
    for (let seed = 0; seed < 200; seed++) {
      child = mutateCrabGenes(child, mulberry32(seed))
      boldest = Math.max(boldest, child.boldness)
    }
    expect(boldest).toBeGreaterThan(0.7)
  })
})

describe('mutateCrabGenes', () => {
  it('is deterministic, leaves the parent untouched and stays inside 0..1', () => {
    const parent = genes({ armour: 0.7 })
    expect(mutateCrabGenes(parent, mulberry32(4))).toEqual(mutateCrabGenes(parent, mulberry32(4)))
    expect(parent.armour).toBe(0.7)
    for (const extreme of [0, 1]) {
      const edge = {}
      for (const key of CRAB_GENE_KEYS) edge[key] = extreme
      for (let seed = 0; seed < 30; seed++) {
        for (const value of Object.values(mutateCrabGenes(edge, mulberry32(seed)))) {
          expect(value).toBeGreaterThanOrEqual(0)
          expect(value).toBeLessThanOrEqual(1)
        }
      }
    }
  })
})

describe('crabStats', () => {
  it('maps boldness to how far up the shore it will feed, water-only at the bottom', () => {
    // The gene the whole species exists to express: at 0 it never leaves the
    // shallows (and no landlocked fox can touch it), at 1 it works the full
    // width of the wrack line.
    expect(crabStats(genes({ boldness: 0 })).landReach).toBe(0)
    expect(crabStats(genes({ boldness: 1 })).landReach).toBe(LAND_FORAGE_REACH)
    expect(crabStats(genes({ boldness: 1 })).landReach).toBeGreaterThan(crabStats(genes({ boldness: 0 })).landReach)
  })

  it('makes armour a trade: it turns paws away, and it costs weight and upkeep', () => {
    const soft = crabStats(genes({ armour: 0 }))
    const armoured = crabStats(genes({ armour: 1 }))
    expect(soft.toughness).toBe(0)
    expect(armoured.toughness).toBeGreaterThan(0)
    expect(armoured.toughness).toBeLessThan(1) // a fox that keeps trying still gets there
    expect(armoured.upkeepPerSec).toBeGreaterThan(soft.upkeepPerSec)
    expect(armoured.strokeTicks).toBeGreaterThanOrEqual(soft.strokeTicks)
    // And it sits tighter, because the shell is the plan.
    expect(armoured.alertRadius).toBeLessThan(soft.alertRadius)
  })

  it('leaves a crab the slowest thing alive even at full speed', () => {
    // A walking rabbit crosses a tile every 2 decision ticks and a prowling
    // fox does better than that: a crab is never outrunning either.
    expect(crabStats(genes({ speed: 1, armour: 0 })).strokeTicks).toBeGreaterThan(2)
  })

  it('maps fecundity to brooding sooner and more often', () => {
    const eager = crabStats(genes({ fecundity: 1 }))
    const reluctant = crabStats(genes({ fecundity: 0 }))
    expect(eager.breedEnergy).toBeLessThan(reluctant.breedEnergy)
    expect(eager.breedCooldownMs).toBeLessThan(reluctant.breedCooldownMs)
  })
})

describe('describeCrab', () => {
  it('says which side of the waterline this one lives on', () => {
    expect(describeCrab(genes({ boldness: 0 }))).toContain('no landlocked fox')
    expect(describeCrab(genes({ boldness: 1 }))).toContain('clear of the water')
    const notes = describeCrabStats(genes())
    expect(notes).toHaveLength(4)
    for (const note of notes) expect(note).not.toContain('NaN')
  })
})
