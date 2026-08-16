import { describe, it, expect } from 'vitest'
import { FOREST_SCENT_FACTOR, FOREST_VISION_FACTOR, FOX_GENE_KEYS, createFoxGenes, describeFox, describeFoxStats, foxMenace, foxStats, mutateFoxGenes } from './fox.js'
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

  it('keeps founders near their founder mean rather than at the extremes', () => {
    // Otherwise the first fox you place decides the simulation by spawn luck
    // instead of by selection (see FOUNDER_SPREAD).
    const mean = { speed: 0.4, metabolism: 0.5, fecundity: 0.36, swimming: 0.22 }
    for (let seed = 0; seed < 25; seed++) {
      for (const [key, value] of Object.entries(createFoxGenes(mulberry32(seed)))) {
        expect(Math.abs(value - (mean[key] ?? 0.5))).toBeLessThanOrEqual(0.34)
      }
    }
  })

  it('still weights founders below the midpoint on speed and fecundity', () => {
    // The spawn-time weight that stops a founder pack wiping the rabbits out
    // before the rabbit gene pool can respond (issue #14). Averaged over many
    // founders, since any individual is still drawn across a wide spread.
    // Both were nudged back up when the foxes got brains - a founder pack
    // slow enough that it could not catch anything simply starved - so this
    // pins the direction rather than the old numbers.
    const totals = { speed: 0, metabolism: 0, fecundity: 0, vision: 0 }
    const n = 400
    for (let seed = 0; seed < n; seed++) {
      const g = createFoxGenes(mulberry32(seed))
      for (const key of Object.keys(totals)) totals[key] += g[key]
    }
    expect(totals.speed / n).toBeLessThan(0.5)
    expect(totals.fecundity / n).toBeLessThan(0.45)
    // Genes with no founder weight sit at the midpoint.
    expect(totals.vision / n).toBeCloseTo(0.5, 1)
    expect(totals.metabolism / n).toBeCloseTo(0.5, 1)
  })

  it('still lets mutation carry a lineage past its founder weighting', () => {
    // The weight is a starting prior, not a cap: "this does not mean that
    // mutations cannot happen to prevent changes such as lowering gestation
    // periods" (issue #14).
    let child = createFoxGenes(mulberry32(3))
    let fastest = child.speed
    for (let seed = 0; seed < 200; seed++) {
      child = mutateFoxGenes(child, mulberry32(seed))
      fastest = Math.max(fastest, child.speed)
    }
    expect(fastest).toBeGreaterThan(0.68) // beyond the founder range entirely
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

  it('prices speed superlinearly, so evolving fast legs costs more than it used to', () => {
    // Issue #14: "any higher speed if evolved should be more costly than it
    // currently is". Same metabolism throughout, so this is purely the
    // speed surcharge - and the *jump* from mid to top speed has to cost
    // more than the jump from bottom to mid, which is what linear pricing
    // could never express.
    const lower = foxStats(genes({ speed: 0.5 })).upkeepPerSec - foxStats(genes({ speed: 0 })).upkeepPerSec
    const upper = foxStats(genes({ speed: 1 })).upkeepPerSec - foxStats(genes({ speed: 0.5 })).upkeepPerSec
    expect(upper).toBeGreaterThan(lower)
  })

  it('gives a fox real runway between meals without making a carcass a windfall', () => {
    // A mid fox breaks even at roughly a rabbit a minute and a half. That is
    // deliberately longer than it used to be (about 30 seconds): five
    // founders scattered on a 64x64 island starved before they ever met a
    // rabbit, which is a stopwatch rather than a predator/prey dynamic. It
    // still has to keep eating - a carcass does not fund an afternoon.
    const mid = foxStats(genes())
    const secondsPerKill = mid.energyPerKill / mid.upkeepPerSec
    expect(secondsPerKill).toBeGreaterThan(45)
    expect(secondsPerKill).toBeLessThan(150)
  })

  it('makes lying up meaningfully cheaper than prowling', () => {
    // The payoff for the brain's rest output: waiting out a lean patch has
    // to actually buy time, or the decision is not a trade-off at all.
    const s = foxStats(genes())
    expect(s.restUpkeepFactor).toBeGreaterThan(0)
    expect(s.restUpkeepFactor).toBeLessThan(0.6)
  })

  it('gives every fox a nose that beats its eyes under the canopy', () => {
    // Scent is what turns a fox's search into searching rather than
    // wandering. In the open it reaches slightly *less* far than sight - a
    // longer nose simply wiped the rabbits out - but woodland costs the fox
    // 45% of its vision and only 15% of its smell, so under the trees the
    // nose is the sense that still works. What it costs either way is
    // accuracy (see SCENT_JITTER in simulation.js).
    for (const vision of [0, 0.5, 1]) {
      const s = foxStats(genes({ vision }))
      expect(s.scentRadius).toBeGreaterThan(s.visionRadius * 0.75)
      expect(s.scentRadius * FOREST_SCENT_FACTOR).toBeGreaterThan(s.visionRadius * FOREST_VISION_FACTOR)
    }
    expect(foxStats(genes({ vision: 1 })).scentRadius).toBeGreaterThan(foxStats(genes({ vision: 0 })).scentRadius)
  })

  it('keeps litters slower than a rabbit but inside a minute', () => {
    // Shortened at both ends: at 110-68 seconds a fox line could not answer
    // a rabbit boom before it had already turned into a bust, so the
    // populations never cycled - the foxes just drifted down.
    expect(foxStats(genes({ fecundity: 1 })).gestationMs).toBeLessThan(35000)
    expect(foxStats(genes({ fecundity: 0 })).gestationMs).toBeLessThan(60000)
    // Still well over the rabbits' 30 seconds at the reluctant end.
    expect(foxStats(genes({ fecundity: 0 })).gestationMs).toBeGreaterThan(45000)
  })

  it('maps stamina to a longer chase and fecundity to earlier, quicker litters', () => {
    expect(foxStats(genes({ stamina: 1 })).maxSprintTicks).toBeGreaterThan(foxStats(genes({ stamina: 0 })).maxSprintTicks)
    const eager = foxStats(genes({ fecundity: 1 }))
    const reluctant = foxStats(genes({ fecundity: 0 }))
    expect(eager.breedEnergy).toBeLessThan(reluctant.breedEnergy)
    expect(eager.gestationMs).toBeLessThan(reluctant.gestationMs)
  })

  it('gives pack instinct both a wider pack radius and a chase bonus', () => {
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
    expect(blurb).toContain('covers open ground quickly')
    expect(blurb).toContain('is obvious from a distance')
    // Verb phrases throughout, so three of them strung together is a
    // sentence rather than "This fox is breeds readily and…".
    expect(blurb.startsWith('This fox covers')).toBe(true)
    expect(blurb.endsWith('.')).toBe(true)
  })

  it('summarizes the numbers a player would otherwise have to work out', () => {
    const notes = describeFoxStats(genes())
    expect(notes).toHaveLength(5)
    for (const note of notes) expect(note).not.toContain('NaN')
  })
})
