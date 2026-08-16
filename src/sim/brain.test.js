import { describe, it, expect } from 'vitest'
import { createBrain, think, mutateBrain, INPUT_SIZE, HIDDEN_SIZE, OUTPUT_SIZE, WEIGHT_CLAMP } from './brain.js'
import { mulberry32 } from '../worldgen/mapgen.js'

describe('createBrain', () => {
  it('allocates weight/bias arrays of the expected shape', () => {
    const brain = createBrain(mulberry32(1))
    expect(brain.w1.length).toBe(INPUT_SIZE * HIDDEN_SIZE)
    expect(brain.b1.length).toBe(HIDDEN_SIZE)
    expect(brain.w2.length).toBe(HIDDEN_SIZE * OUTPUT_SIZE)
    expect(brain.b2.length).toBe(OUTPUT_SIZE)
  })

  it('is deterministic for a seeded rng', () => {
    const a = createBrain(mulberry32(5))
    const b = createBrain(mulberry32(5))
    expect(Array.from(a.w1)).toEqual(Array.from(b.w1))
    expect(Array.from(a.b2)).toEqual(Array.from(b.b2))
  })
})

describe('think', () => {
  const brain = createBrain(mulberry32(7))
  // bias, energy, apple dx/dy/dist, onWater, noise, fox dx/dy/dist, alarm
  // call, burrow dx/dy, underground - "no apple and no fox detected" reads
  // as distance 1 for both, and nothing heard, no burrow known, above ground.
  const neutralInputs = [1, 0.5, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0]

  it('returns all eight expected outputs', () => {
    const out = think(brain, neutralInputs)
    expect(Object.keys(out).sort()).toEqual(['moveX', 'moveY', 'reproduceDesire', 'rest', 'run', 'searchDrive', 'flee', 'hide'].sort())
  })

  it('keeps outputs within their activation ranges', () => {
    const out = think(brain, neutralInputs)
    expect(out.moveX).toBeGreaterThanOrEqual(-1)
    expect(out.moveX).toBeLessThanOrEqual(1)
    expect(out.moveY).toBeGreaterThanOrEqual(-1)
    expect(out.moveY).toBeLessThanOrEqual(1)
    for (const key of ['run', 'rest', 'reproduceDesire', 'searchDrive', 'flee', 'hide']) {
      expect(out[key]).toBeGreaterThanOrEqual(0)
      expect(out[key]).toBeLessThanOrEqual(1)
    }
  })

  it('is a pure function of (brain, inputs)', () => {
    const a = think(brain, neutralInputs)
    const b = think(brain, neutralInputs)
    expect(a).toEqual(b)
  })

  it('produces different output for different inputs', () => {
    const a = think(brain, [1, 0.9, 1, 1, 0.1, 0, 0, 0, 0, 1, 0, 0, 0, 0])
    const b = think(brain, [1, 0.1, -1, -1, 1, 1, 0, 0, 0, 1, 0, 0, 0, 0])
    expect(a).not.toEqual(b)
  })

  it('reacts to the predator inputs, not just the food ones', () => {
    const noFox = think(brain, [1, 0.5, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0])
    const foxAdjacent = think(brain, [1, 0.5, 0, 0, 1, 0, 0, -0.2, -0.2, 0.2, 0, 0, 0, 0])
    expect(foxAdjacent).not.toEqual(noFox)
  })

  it('reacts to another rabbit’s alarm call and to a burrow in reach', () => {
    // The issue #14 inputs: a rabbit can respond to danger it has not
    // perceived itself, and to shelter it knows about.
    const quiet = think(brain, [1, 0.5, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0])
    const alarmed = think(brain, [1, 0.5, 0, 0, 1, 0, 0, 0, 0, 1, 0.9, 0, 0, 0])
    const nearBurrow = think(brain, [1, 0.5, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0.3, -0.2, 0])
    expect(alarmed).not.toEqual(quiet)
    expect(nearBurrow).not.toEqual(quiet)
  })

  it('starts fresh brains biased toward fleeing rather than a coin flip', () => {
    // FLEE_INITIAL_BIAS: a founder population that has to discover running
    // away gets eaten before selection can act (see brain.js).
    let fleeing = 0
    for (let seed = 0; seed < 40; seed++) {
      const out = think(createBrain(mulberry32(seed)), neutralInputs)
      if (out.flee > 0.5) fleeing += 1
    }
    expect(fleeing).toBeGreaterThan(25)
  })

  it('starts fresh brains biased toward taking cover, so burrows get used at all', () => {
    // HIDE_INITIAL_BIAS, same reasoning as fleeing: a lineage can evolve
    // away from digging, but it has to start doing it first.
    let hiding = 0
    for (let seed = 0; seed < 40; seed++) {
      const out = think(createBrain(mulberry32(seed)), neutralInputs)
      if (out.hide > 0.5) hiding += 1
    }
    expect(hiding).toBeGreaterThan(25)
  })
})

describe('mutateBrain', () => {
  it('keeps the same array shapes', () => {
    const parent = createBrain(mulberry32(3))
    const child = mutateBrain(parent, mulberry32(11))
    expect(child.w1.length).toBe(parent.w1.length)
    expect(child.b1.length).toBe(parent.b1.length)
    expect(child.w2.length).toBe(parent.w2.length)
    expect(child.b2.length).toBe(parent.b2.length)
  })

  it('is deterministic for a seeded rng', () => {
    const parent = createBrain(mulberry32(3))
    const childA = mutateBrain(parent, mulberry32(11))
    const childB = mutateBrain(parent, mulberry32(11))
    expect(Array.from(childA.w1)).toEqual(Array.from(childB.w1))
  })

  it('does not mutate the parent brain in place', () => {
    const parent = createBrain(mulberry32(3))
    const before = Array.from(parent.w1)
    mutateBrain(parent, mulberry32(11))
    expect(Array.from(parent.w1)).toEqual(before)
  })

  it('keeps mutated weights within the clamp range', () => {
    const parent = createBrain(mulberry32(3))
    // A high-churn rng still shouldn't blow past the documented clamp.
    const child = mutateBrain(parent, mulberry32(999))
    for (const arr of [child.w1, child.b1, child.w2, child.b2]) {
      for (const v of arr) {
        expect(v).toBeGreaterThanOrEqual(-WEIGHT_CLAMP)
        expect(v).toBeLessThanOrEqual(WEIGHT_CLAMP)
      }
    }
  })
})
