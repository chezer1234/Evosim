import { describe, it, expect } from 'vitest'
import { FOX_ENERGY_MAX, FOX_GENE_KEYS, createFoxGenes, describeFox, describeFoxStats, foxMenace, foxStats, mutateFoxGenes } from './fox.js'
import { mulberry32 } from '../worldgen/mapgen.js'

/** Genes with everything at a neutral 0.5 except the overrides - so each
 * test isolates the one dial it's actually about. */
function genes(overrides = {}) {
  const g = {}
  for (const key of FOX_GENE_KEYS) g[key] = 0.5
  return { ...g, ...overrides }
}

describe('createFoxGenes', () => {
  it('produces every gene, inside 0..1', () => {
    const g = createFoxGenes(mulberry32(1))
    expect(Object.keys(g).sort()).toEqual([...FOX_GENE_KEYS].sort())
    for (const key of FOX_GENE_KEYS) {
      expect(g[key]).toBeGreaterThanOrEqual(0)
      expect(g[key]).toBeLessThanOrEqual(1)
    }
  })

  it('is deterministic for a seeded rng', () => {
    expect(createFoxGenes(mulberry32(9))).toEqual(createFoxGenes(mulberry32(9)))
  })

  it('keeps founders near the middle of the range rather than at the extremes', () => {
    // Otherwise the first fox you place decides the simulation by spawn luck
    // instead of by selection (see FOUNDER_SPREAD).
    for (let seed = 0; seed < 25; seed++) {
      for (const value of Object.values(createFoxGenes(mulberry32(seed)))) {
        expect(Math.abs(value - 0.5)).toBeLessThanOrEqual(0.34)
      }
    }
  })
})

describe('mutateFoxGenes', () => {
  it('is deterministic for a seeded rng and leaves the parent untouched', () => {
    const parent = genes({ speed: 0.7 })
    const childA = mutateFoxGenes(parent, mulberry32(4))
    const childB = mutateFoxGenes(parent, mulberry32(4))
    expect(childA).toEqual(childB)
    expect(parent.speed).toBe(0.7)
  })

  it('stays inside 0..1 even mutating genes that already sit at the extremes', () => {
    for (const extreme of [0, 1]) {
      const parent = {}
      for (const key of FOX_GENE_KEYS) parent[key] = extreme
      for (let seed = 0; seed < 30; seed++) {
        for (const value of Object.values(mutateFoxGenes(parent, mulberry32(seed)))) {
          expect(value).toBeGreaterThanOrEqual(0)
          expect(value).toBeLessThanOrEqual(1)
        }
      }
    }
  })

  it('actually changes some genes across a run of births', () => {
    const parent = genes()
    const drifted = new Set()
    let child = parent
    for (let seed = 0; seed < 20; seed++) {
      child = mutateFoxGenes(child, mulberry32(seed))
      for (const key of FOX_GENE_KEYS) if (child[key] !== parent[key]) drifted.add(key)
    }
    expect(drifted.size).toBe(FOX_GENE_KEYS.length)
  })
})

describe('foxStats', () => {
  it('maps speed to how fast it covers ground, sprinting faster than prowling', () => {
    const slow = foxStats(genes({ speed: 0 }))
    const fast = foxStats(genes({ speed: 1 }))
    expect(fast.prowlTilesPerTick).toBeGreaterThan(slow.prowlTilesPerTick)
    expect(fast.sprintTilesPerTick).toBeGreaterThan(fast.prowlTilesPerTick)
    // A rabbit runs at 1.0 tiles/tick: a top-speed fox has to be able to run
    // one down, and a bottom-speed one must not.
    expect(fast.sprintTilesPerTick).toBeGreaterThan(1)
    expect(slow.sprintTilesPerTick).toBeLessThan(1)
  })

  it('maps vision to a bigger spotting radius', () => {
    expect(foxStats(genes({ vision: 1 })).visionRadius).toBeGreaterThan(foxStats(genes({ vision: 0 })).visionRadius)
  })

  it('maps camouflage to a smaller share of the rabbit alert range', () => {
    expect(foxStats(genes({ camouflage: 0 })).stealthFactor).toBe(1)
    expect(foxStats(genes({ camouflage: 1 })).stealthFactor).toBeLessThan(0.5)
  })

  it('trades metabolism off: burns faster, but strips more energy per kill', () => {
    const lean = foxStats(genes({ metabolism: 0 }))
    const hot = foxStats(genes({ metabolism: 1 }))
    expect(hot.upkeepPerSec).toBeGreaterThan(lean.upkeepPerSec)
    expect(hot.energyPerKill).toBeGreaterThan(lean.energyPerKill)
  })

  it('charges upkeep for every other gene, so maxing them all is not free', () => {
    const minimal = {}
    const maximal = {}
    for (const key of FOX_GENE_KEYS) {
      minimal[key] = 0
      maximal[key] = 0
    }
    // Same metabolism on both sides: this is about the *surcharge* the other
    // genes add, which is the thing stopping evolution driving every dial to 1.
    for (const key of ['speed', 'vision', 'camouflage', 'stamina']) maximal[key] = 1
    expect(foxStats(maximal).upkeepPerSec).toBeGreaterThan(foxStats(minimal).upkeepPerSec)
  })

  it('lets desire to hunt run from "only when starving" to "always"', () => {
    expect(foxStats(genes({ bloodlust: 0 })).huntBelowEnergy).toBeLessThan(FOX_ENERGY_MAX / 2)
    expect(foxStats(genes({ bloodlust: 1 })).huntBelowEnergy).toBeGreaterThan(FOX_ENERGY_MAX)
  })

  it('maps stamina to a longer chase and fecundity to earlier, quicker litters', () => {
    expect(foxStats(genes({ stamina: 1 })).maxSprintTicks).toBeGreaterThan(foxStats(genes({ stamina: 0 })).maxSprintTicks)
    const eager = foxStats(genes({ fecundity: 1 }))
    const reluctant = foxStats(genes({ fecundity: 0 }))
    expect(eager.breedEnergy).toBeLessThan(reluctant.breedEnergy)
    expect(eager.gestationMs).toBeLessThan(reluctant.gestationMs)
  })

  it('gives pack tendency both a wider pack radius and a chase bonus', () => {
    const loner = foxStats(genes({ packTendency: 0 }))
    const packer = foxStats(genes({ packTendency: 1 }))
    expect(packer.packRadius).toBeGreaterThan(loner.packRadius)
    expect(loner.packSpeedBonus).toBe(0)
    expect(packer.packSpeedBonus).toBeGreaterThan(0)
  })
})

describe('foxMenace', () => {
  it('stays within 0..1 at both extremes', () => {
    const min = {}
    const max = {}
    for (const key of FOX_GENE_KEYS) {
      min[key] = 0
      max[key] = 1
    }
    expect(foxMenace(min)).toBeGreaterThanOrEqual(0)
    expect(foxMenace(max)).toBeLessThanOrEqual(1)
  })

  it('rises with the genes a rabbit would actually fear', () => {
    const base = genes({ speed: 0.2, camouflage: 0.2 })
    expect(foxMenace(genes({ speed: 0.9, camouflage: 0.9 }))).toBeGreaterThan(foxMenace(base))
  })
})

describe('describeFox', () => {
  it('names the standout gene and reads as a sentence', () => {
    const blurb = describeFox(genes({ speed: 0.98, camouflage: 0.02 }))
    expect(blurb).toContain('quick over open ground')
    expect(blurb).toContain('obvious from a distance')
    expect(blurb.endsWith('.')).toBe(true)
  })

  it('summarizes the numbers a player would otherwise have to work out', () => {
    const notes = describeFoxStats(genes())
    expect(notes).toHaveLength(4)
    for (const note of notes) expect(note).not.toContain('NaN')
  })
})
