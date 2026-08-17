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
const SCATTER = { rabbits: 8, foxes: 4, fish: 0, crabs: 0, minutes: 8, runs: 5, size: 64, seed: 1 }

// The same island with a living shoreline on it, and no rabbits at all. This
// is the scenario the fish and the crabs were added for: a fox population
// whose only food is what it can take off the water's edge.
const SHORELINE_ONLY = { rabbits: 0, foxes: 4, fish: 20, crabs: 20, minutes: 10, runs: 4, size: 64, seed: 1 }

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

describe('an island whose shoreline is alive too', () => {
  // Every batch here is built at describe time, like the one above: a run of
  // several sim-minutes is far past vitest's default per-test timeout, and
  // what is being tested is the summary rather than the running of it.
  const { summary } = runBatch({ ...SCATTER, fish: 20, crabs: 20, runs: 3 })

  it('is still an island the rabbits can live on', () => {
    // The shallows are extra food, so they carry more foxes - measurably:
    // on these seeds it is about half again as many, and the rabbits left at
    // the end are roughly unchanged (10.7 against 11.3 without it). What has
    // to stay true is that switching the second food chain on does not
    // quietly hand the island to the predators, so this is the same loose
    // "not reliably wiped out" bar the batch above uses.
    expect(summary.rabbitExtinctions).toBeLessThanOrEqual(1)
    expect(summary.foxExtinctions).toBe(0)
    expect(summary.shoreCatches).toBeGreaterThan(0)
  })

  it('keeps the foxes going through a rabbit crash rather than after it', () => {
    // The scenario in miniature, and the one that used to end every long run
    // the same way: the rabbits go under and the foxes follow them down.
    // Here the foxes are still on the island at the end of every run whether
    // or not the rabbits made it.
    expect(summary.foxesLeft).toBeGreaterThanOrEqual(SCATTER.foxes)
  })
})

describe('an island with a shoreline and no rabbits at all', () => {
  const { summary } = runBatch(SHORELINE_ONLY)

  it('keeps the foxes alive on fish and crabs alone', () => {
    // The whole point of the second food chain. Before it, a run with no
    // rabbits on it was a countdown: the foxes searched an empty island until
    // their reserves ran out, every time, on every seed. Now the water feeds
    // them - not well, but indefinitely.
    expect(summary.foxExtinctions).toBe(0)
    expect(summary.kills).toBe(0) // nothing to hunt: this is all off the shore
    expect(summary.shoreCatches).toBeGreaterThan(10)
  })

  it('does not let them strip the shallows bare either', () => {
    // The other failure mode, and the reason the fish and crabs breed on
    // their own clock rather than being scenery: a food source that a pack
    // can fish to extinction is a food source that buys them ten minutes.
    expect(summary.fishExtinctions).toBe(0)
    expect(summary.crabExtinctions).toBe(0)
    expect(summary.fishLeft).toBeGreaterThan(SHORELINE_ONLY.fish)
  })
})
