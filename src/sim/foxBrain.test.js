import { describe, it, expect } from 'vitest'
import { FOX_BRAIN_SHAPE, FOX_HIDDEN_SIZE, FOX_INPUT_SIZE, FOX_OUTPUT_SIZE, createFoxBrain, foxThink, mutateFoxBrain } from './foxBrain.js'
import { WEIGHT_CLAMP } from './net.js'
import { computeFoxTraits, describeFoxBrain, describeFoxDrives } from './foxInsight.js'
import { mulberry32 } from '../worldgen/mapgen.js'

// Nothing detected: no prey, no scent, no packmate, nothing on the shoreline,
// full stamina, in the open. Matches buildFoxInputs's "reads as nothing
// there" convention - distance 1, direction 0.
const neutralInputs = [1, 0.6, 0, 0, 1, 0, 0, 0, 0, 0, 1, 1, 0, 0, 0, 1, 0]

/** neutralInputs with individual channels overridden by index, so a test can
 * say "same fox, but with a rabbit at 2 o'clock" without respelling
 * seventeen numbers. */
function sensing(overrides) {
  const values = [...neutralInputs]
  for (const [idx, value] of Object.entries(overrides)) values[idx] = value
  return values
}

describe('createFoxBrain', () => {
  it('allocates weight/bias arrays of the expected shape', () => {
    const brain = createFoxBrain(mulberry32(1))
    expect(brain.w1.length).toBe(FOX_INPUT_SIZE * FOX_HIDDEN_SIZE)
    expect(brain.b1.length).toBe(FOX_HIDDEN_SIZE)
    expect(brain.w2.length).toBe(FOX_HIDDEN_SIZE * FOX_OUTPUT_SIZE)
    expect(brain.b2.length).toBe(FOX_OUTPUT_SIZE)
    expect(FOX_BRAIN_SHAPE).toEqual({ inputs: FOX_INPUT_SIZE, hidden: FOX_HIDDEN_SIZE, outputs: FOX_OUTPUT_SIZE })
  })

  it('is deterministic for a seeded rng', () => {
    const a = createFoxBrain(mulberry32(5))
    const b = createFoxBrain(mulberry32(5))
    expect(Array.from(a.w1)).toEqual(Array.from(b.w1))
    expect(Array.from(a.b2)).toEqual(Array.from(b.b2))
  })

  it('starts founders biased toward chasing, so a fresh pack hunts at all', () => {
    // CHASE_INITIAL_BIAS: the same reasoning as the rabbits' flee bias - a
    // founder pack that had to discover chasing rabbits starves before
    // selection can reward the first one that tries it.
    let chasing = 0
    for (let seed = 0; seed < 40; seed++) {
      const out = foxThink(createFoxBrain(mulberry32(seed)), sensing({ 2: 0.2, 3: 0.1, 4: 0.3 }))
      if (out.chase > 0.5) chasing += 1
    }
    expect(chasing).toBeGreaterThan(25)
  })

  it('starts founders willing to take what the tideline offers', () => {
    // FORAGE_INITIAL_BIAS. A founder that has to discover picking a crab up
    // is a founder that starves the moment the rabbits go under, which is the
    // failure the shoreline species exist to fix - so foraging starts on and
    // a lineage evolves its way off it.
    let foraging = 0
    for (let seed = 0; seed < 40; seed++) {
      const out = foxThink(createFoxBrain(mulberry32(seed)), sensing({ 13: 0.3, 14: 0.2, 15: 0.4 }))
      if (out.forage > 0.5) foraging += 1
    }
    expect(foraging).toBeGreaterThan(25)
  })

  it('starts founders biased toward lying up rather than pacing the island', () => {
    // REST_INITIAL_BIAS. A founder that walks non-stop burns its reserves
    // looking for prey that isn't there yet; an ambusher survives the lean
    // opening minutes. Both are still only priors - see the mutation test.
    let resting = 0
    for (let seed = 0; seed < 40; seed++) {
      if (foxThink(createFoxBrain(mulberry32(seed)), neutralInputs).rest > 0.5) resting += 1
    }
    expect(resting).toBeGreaterThan(22)
  })
})

describe('foxThink', () => {
  const brain = createFoxBrain(mulberry32(7))

  it('returns the seven decisions the sim gates on, all inside 0..1', () => {
    const out = foxThink(brain, neutralInputs)
    expect(Object.keys(out).sort()).toEqual(['breed', 'chase', 'forage', 'group', 'rest', 'sprint', 'track'].sort())
    for (const value of Object.values(out)) {
      expect(value).toBeGreaterThanOrEqual(0)
      expect(value).toBeLessThanOrEqual(1)
    }
  })

  it('is a pure function of (brain, inputs)', () => {
    expect(foxThink(brain, neutralInputs)).toEqual(foxThink(brain, neutralInputs))
  })

  it('reacts to prey, to a scent, to a packmate and to something on the shore', () => {
    const quiet = foxThink(brain, neutralInputs)
    const preyInSight = foxThink(brain, sensing({ 2: 0.5, 3: -0.2, 4: 0.4 }))
    const smellsSomething = foxThink(brain, sensing({ 5: 0.7, 6: 0.7, 7: 0.8 }))
    const packmateNear = foxThink(brain, sensing({ 8: 0.3, 9: 0.3, 10: 0.4 }))
    const crabInReach = foxThink(brain, sensing({ 13: 0.2, 14: -0.1, 15: 0.2 }))
    expect(preyInSight).not.toEqual(quiet)
    expect(smellsSomething).not.toEqual(quiet)
    expect(packmateNear).not.toEqual(quiet)
    expect(crabInReach).not.toEqual(quiet)
  })

  it('reacts to its own hunger, which is what makes patience evolvable', () => {
    const full = foxThink(brain, sensing({ 1: 1, 2: 0.4, 3: 0.1, 4: 0.5 }))
    const starving = foxThink(brain, sensing({ 1: 0.05, 2: 0.4, 3: 0.1, 4: 0.5 }))
    expect(full).not.toEqual(starving)
  })
})

describe('mutateFoxBrain', () => {
  it('keeps the shapes, leaves the parent untouched, and stays clamped', () => {
    const parent = createFoxBrain(mulberry32(3))
    const before = Array.from(parent.w1)
    const child = mutateFoxBrain(parent, mulberry32(999))
    expect(child.w1.length).toBe(parent.w1.length)
    expect(Array.from(parent.w1)).toEqual(before)
    for (const arr of [child.w1, child.b1, child.w2, child.b2]) {
      for (const v of arr) {
        expect(v).toBeGreaterThanOrEqual(-WEIGHT_CLAMP)
        expect(v).toBeLessThanOrEqual(WEIGHT_CLAMP)
      }
    }
  })

  it('actually drifts a lineage away from its founder instincts', () => {
    // The whole point: the founder priors are a starting position, not a
    // cap. Over a run of births the traits have to be able to move.
    let brain = createFoxBrain(mulberry32(12))
    const start = computeFoxTraits(brain)
    let biggestSwing = 0
    for (let seed = 0; seed < 60; seed++) {
      brain = mutateFoxBrain(brain, mulberry32(seed))
      const t = computeFoxTraits(brain)
      for (const key of ['aggression', 'tracking', 'idleness', 'broodiness']) {
        biggestSwing = Math.max(biggestSwing, Math.abs(t[key] - start[key]))
      }
    }
    expect(biggestSwing).toBeGreaterThan(0.1)
  })
})

describe('computeFoxTraits', () => {
  it('reads every trait out of the weights, inside 0..1', () => {
    const t = computeFoxTraits(createFoxBrain(mulberry32(4)))
    for (const key of ['aggression', 'tracking', 'commitment', 'sociability', 'idleness', 'broodiness', 'patience', 'beachcombing']) {
      expect(t[key]).toBeGreaterThanOrEqual(0)
      expect(t[key]).toBeLessThanOrEqual(1)
    }
  })

  it('scores a brain wired to chase as more aggressive than one wired against it', () => {
    // Hand-built pathways rather than a random brain: one hidden neuron
    // carrying the bias input straight through to the chase output.
    const build = (sign) => {
      const brain = {
        w1: new Float32Array(FOX_INPUT_SIZE * FOX_HIDDEN_SIZE),
        b1: new Float32Array(FOX_HIDDEN_SIZE),
        w2: new Float32Array(FOX_HIDDEN_SIZE * FOX_OUTPUT_SIZE),
        b2: new Float32Array(FOX_OUTPUT_SIZE),
      }
      brain.w1[0] = 2 // bias input -> hidden 0
      brain.w2[0] = 2 * sign // hidden 0 -> chase
      return brain
    }
    expect(computeFoxTraits(build(1)).aggression).toBeGreaterThan(0.7)
    expect(computeFoxTraits(build(-1)).aggression).toBeLessThan(0.3)
  })

  it('describes a brain in a sentence and names its energy-driven habits', () => {
    const t = computeFoxTraits(createFoxBrain(mulberry32(8)))
    const blurb = describeFoxBrain(t)
    expect(blurb.startsWith('This fox')).toBe(true)
    expect(blurb).not.toContain('undefined')
    const drives = describeFoxDrives(t)
    for (const key of ['chase', 'rest', 'prey', 'shore']) {
      expect(typeof drives[key]).toBe('string')
      expect(drives[key].length).toBeGreaterThan(10)
    }
  })
})
