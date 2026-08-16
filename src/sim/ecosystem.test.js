// Whole-ecosystem regression tests.
//
// Every other test in this project pins one mechanic in isolation - a fox
// lying up burns less, a rabbit hears a fox it cannot see. None of them can
// tell you the thing that actually matters, which is whether an island still
// has two species on it ten minutes after you walk away. That question has
// been answered by hand (a headless script, run across a handful of maps)
// for every balance change so far, which means the answer was never gated on
// anything: a change that quietly reintroduced "the foxes always starve by
// minute three" would pass the entire suite.
//
// So the headless script lives in the repo now (scripts/ecosystem.mjs) and
// these run it. They are deterministic - each run seeds Math.random, which
// both the sim and the map generator draw from - so a failure here is a real
// change in behaviour rather than an unlucky island, and can be reproduced
// exactly with `npm run ecosystem -- --seed <n> --runs 1`.
//
// The assertions are deliberately loose. They are guarding against
// *collapse* - one species reliably wiped out, evolution never getting a
// second generation - not pinning today's numbers, which are meant to move
// as the sim gets richer.

import { describe, it, expect } from 'vitest'
import { runBatch } from '../../scripts/ecosystem.mjs'

// A modest founder population on a default island: the scenario you get by
// opening the app, picking a species and hitting scatter.
const SCATTER = { rabbits: 8, foxes: 4, minutes: 8, runs: 5, size: 64, seed: 1 }

describe('the ecosystem as a whole', () => {
  const { summary, results } = runBatch(SCATTER)

  it('keeps foxes alive well past the founder generation', () => {
    // The regression this exists for: before the foxes had brains, a scatter
    // of founders starved within about three minutes on every island tested,
    // every time, without ever breeding. "Foxes died out again" has to be a
    // test failure, not something you notice by eye a month later.
    expect(summary.foxExtinctions).toBeLessThanOrEqual(1)
    expect(Math.max(...results.map((r) => r.foxGen))).toBeGreaterThan(0)
  })

  it('does not let the foxes eat the island bare either', () => {
    // The opposite failure, and the one the territory rule and the litter
    // recovery period are there to prevent: foxes boom on a rabbit boom,
    // strip the island, and both species end the run at zero.
    expect(summary.rabbitExtinctions).toBeLessThanOrEqual(1)
    expect(summary.bothAlive).toBeGreaterThanOrEqual(Math.ceil(SCATTER.runs / 2))
  })

  it('actually runs an evolutionary loop rather than a static population', () => {
    // Generations and kills both have to be happening: a run where nothing
    // is eaten and nothing is born would satisfy the survival checks above
    // while being a much less interesting simulation.
    expect(summary.kills).toBeGreaterThan(0)
    expect(summary.maxRabbitGen).toBeGreaterThan(1)
  })

  it('is reproducible from its seed', () => {
    // The property the whole harness rests on: same seed, same island, same
    // brains, same outcome - so two balance configurations can be compared
    // on identical worlds instead of on the luck of the map.
    const again = runBatch({ ...SCATTER, runs: 2 })
    expect(again.results.map((r) => [r.rabbits, r.foxes, r.kills])).toEqual(
      results.slice(0, 2).map((r) => [r.rabbits, r.foxes, r.kills]),
    )
  })
})
