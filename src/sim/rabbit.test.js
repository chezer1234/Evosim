import { describe, it, expect } from 'vitest'
import { RABBIT_GENE_KEYS, alarmReach, createRabbitGenes, describeRabbitSenses, mutateRabbitGenes, rabbitStats } from './rabbit.js'
import { PREY_ALERT_RADIUS } from './simulation.js'
import { mulberry32 } from '../worldgen/mapgen.js'

function genes(overrides = {}) {
  const g = {}
  for (const key of RABBIT_GENE_KEYS) g[key] = 0.5
  return { ...g, ...overrides }
}

describe('createRabbitGenes', () => {
  it('produces every gene, inside 0..1', () => {
    const g = createRabbitGenes(mulberry32(1))
    expect(Object.keys(g).sort()).toEqual([...RABBIT_GENE_KEYS].sort())
    for (const key of RABBIT_GENE_KEYS) {
      expect(g[key]).toBeGreaterThanOrEqual(0)
      expect(g[key]).toBeLessThanOrEqual(1)
    }
  })

  it('is deterministic for a seeded rng', () => {
    expect(createRabbitGenes(mulberry32(9))).toEqual(createRabbitGenes(mulberry32(9)))
  })
})

describe('mutateRabbitGenes', () => {
  it('leaves the parent untouched and stays inside 0..1 at the extremes', () => {
    for (const extreme of [0, 1]) {
      const parent = {}
      for (const key of RABBIT_GENE_KEYS) parent[key] = extreme
      for (let seed = 0; seed < 30; seed++) {
        for (const value of Object.values(mutateRabbitGenes(parent, mulberry32(seed)))) {
          expect(value).toBeGreaterThanOrEqual(0)
          expect(value).toBeLessThanOrEqual(1)
        }
      }
      expect(Object.values(parent).every((v) => v === extreme)).toBe(true)
    }
  })

  it('varies hearing across a run of births, so ear size actually evolves', () => {
    // Issue #14: "the size of these hearing ranges should vary through
    // mutation" - a fixed range would just be another constant.
    const sizes = new Set()
    let child = genes()
    for (let seed = 0; seed < 40; seed++) {
      child = mutateRabbitGenes(child, mulberry32(seed))
      sizes.add(rabbitStats(child).hearingRadius.toFixed(3))
    }
    expect(sizes.size).toBeGreaterThan(3)
  })
})

describe('rabbitStats', () => {
  it('always hears further than it can see, however poor its ears', () => {
    // The core of issue #14: ears are the long sense, eyes only confirm.
    for (const hearing of [0, 0.25, 0.5, 0.75, 1]) {
      expect(rabbitStats(genes({ hearing })).hearingRadius).toBeGreaterThan(PREY_ALERT_RADIUS)
    }
  })

  it('maps the hearing gene to a bigger radius and voice to a longer call', () => {
    expect(rabbitStats(genes({ hearing: 1 })).hearingRadius).toBeGreaterThan(rabbitStats(genes({ hearing: 0 })).hearingRadius)
    expect(rabbitStats(genes({ voice: 1 })).callRadius).toBeGreaterThan(rabbitStats(genes({ voice: 0 })).callRadius)
  })
})

describe('alarmReach', () => {
  it('takes both ends into account: a loud caller and a sharp listener carry furthest', () => {
    const loud = rabbitStats(genes({ voice: 1 }))
    const quiet = rabbitStats(genes({ voice: 0 }))
    const sharp = rabbitStats(genes({ hearing: 1 }))
    const dull = rabbitStats(genes({ hearing: 0 }))
    expect(alarmReach(loud, sharp)).toBeGreaterThan(alarmReach(loud, dull))
    expect(alarmReach(loud, sharp)).toBeGreaterThan(alarmReach(quiet, sharp))
    expect(alarmReach(quiet, dull)).toBeGreaterThan(0)
  })
})

describe('describeRabbitSenses', () => {
  it('summarizes both senses without leaking NaN into the panel', () => {
    const notes = describeRabbitSenses(genes())
    expect(notes).toHaveLength(3)
    for (const note of notes) expect(note).not.toContain('NaN')
  })
})
