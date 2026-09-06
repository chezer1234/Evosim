#!/usr/bin/env node
// Headless ecosystem harness: runs the real simulation, with no rendering,
// for several simulated minutes across a batch of seeds and reports what
// happened to each species.
//
// Unit tests can pin a mechanic ("a resting fox burns less"); they cannot
// tell you whether the island still has both species on it in ten minutes.
// That is what this is for, and it is how every balance change in this
// project has actually been judged - see docs/plans/fox-neural-nets.md and
// docs/plans/issue-14-rabbit-survival.md for the numbers it produced.
//
//   npm run ecosystem                    # the default 5v5 scatter
//   npm run ecosystem -- --rabbits 20 --foxes 5 --minutes 20 --runs 12
//   npm run ecosystem -- --json          # machine-readable summary
//   npm run ecosystem -- --preset boom   # a starting-conditions preset (issue #18)
//
// Every run is *deterministic*: each one seeds Math.random (which the sim
// and the map generator both draw from) with `--seed + run index`, so the
// same command always produces the same islands, the same brains and the
// same outcome. Two configurations can therefore be compared on identical
// worlds, which matters more than it sounds - outcomes vary so much between
// islands that an unseeded A/B of 8 runs is mostly measuring the map.

import { generateMap, DEFAULT_SETTINGS, mulberry32 } from '../src/worldgen/mapgen.js'
import {
  createSimulation,
  spawnCrab,
  spawnFish,
  spawnFox,
  spawnRabbit,
  stepSimulation,
  isPlaceableFor,
  TICK_MS,
} from '../src/sim/simulation.js'
import { computeFoxTraits } from '../src/sim/foxInsight.js'
import { SCENARIO_PRESETS } from '../src/sim/scenario.js'

const DEFAULTS = { rabbits: 5, foxes: 5, fish: 0, crabs: 0, minutes: 15, runs: 8, size: 64, seed: 1, json: false, preset: 'balanced' }

/** The starting-conditions preset named on the command line, as a scenario
 * (see src/sim/scenario.js). Presets are the thing a player actually picks,
 * so they are the thing that has to be balance-checked here rather than by
 * eye - `make ecosystem-presets` runs every one of them on identical seeds. */
function scenarioFor(preset) {
  const found = SCENARIO_PRESETS.find((p) => p.key === preset)
  if (!found) {
    throw new Error(`unknown preset ${preset} (expected ${SCENARIO_PRESETS.map((p) => p.key).join(', ')})`)
  }
  return found.scenario
}

function parseArgs(argv) {
  const opts = { ...DEFAULTS }
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg === '--json') {
      opts.json = true
      continue
    }
    const key = arg.replace(/^--/, '')
    if (!(key in opts)) throw new Error(`unknown option ${arg} (expected ${Object.keys(opts).map((k) => `--${k}`).join(', ')})`)
    // Every other flag is a count; --preset names one of the scenarios the
    // app itself offers, so it is the one that stays a string.
    if (key === 'preset') {
      opts.preset = argv[++i]
      scenarioFor(opts.preset)
      continue
    }
    opts[key] = Number(argv[++i])
    if (Number.isNaN(opts[key])) throw new Error(`--${key} needs a number`)
  }
  return opts
}

// Species-aware, because a fish dropped on a hillside is not a fish: each one
// is scattered across the tiles it can actually live on (see isPlaceableFor).
// The attempt budget is generous for the same reason - the shallows are a
// thin band of a map, so rejection sampling has to work harder for them than
// it does for a rabbit.
function scatter(map, species, count, rng) {
  const tiles = []
  for (let attempts = 0; attempts < count * 2000 && tiles.length < count; attempts++) {
    const x = Math.floor(rng() * map.size)
    const y = Math.floor(rng() * map.size)
    if (isPlaceableFor(map, species, x, y)) tiles.push([x, y])
  }
  return tiles
}

const TRACKED_TRAITS = ['aggression', 'tracking', 'idleness', 'patience', 'broodiness', 'beachcombing']

/** Mean of one gene across a population, or null if it died out. The
 * shoreline species have no brain to read instincts off (see sim/fish.js), so
 * their genes are the only place their evolution shows up. */
function meanGene(creatures, key) {
  if (!creatures.length) return null
  return creatures.reduce((sum, c) => sum + c.genes[key], 0) / creatures.length
}

/** One run. Seeds the global rng first, so the map, both species' brains and
 * every decision in the run follow from `seed` alone. */
export function runScenario({ rabbits, foxes, fish, crabs, minutes, size, seed, preset = 'balanced' }) {
  const rng = mulberry32(seed)
  const realRandom = Math.random
  Math.random = rng
  try {
    const map = generateMap({ ...DEFAULT_SETTINGS, size })
    const sim = createSimulation(map, scenarioFor(preset))
    for (const [x, y] of scatter(map, 'rabbit', rabbits, rng)) spawnRabbit(sim, x, y)
    for (const [x, y] of scatter(map, 'fox', foxes, rng)) spawnFox(sim, x, y)
    for (const [x, y] of scatter(map, 'fish', fish, rng)) spawnFish(sim, x, y)
    for (const [x, y] of scatter(map, 'crab', crabs, rng)) spawnCrab(sim, x, y)

    let peakRabbits = rabbits
    let peakFoxes = foxes
    let rabbitsOutAt = null
    let foxesOutAt = null
    for (let t = 0; t < minutes * 60000; t += TICK_MS) {
      stepSimulation(sim, TICK_MS)
      peakRabbits = Math.max(peakRabbits, sim.rabbits.length)
      peakFoxes = Math.max(peakFoxes, sim.foxes.length)
      if (!sim.rabbits.length && rabbitsOutAt == null) rabbitsOutAt = t / 60000
      if (!sim.foxes.length && foxesOutAt == null) foxesOutAt = t / 60000
    }

    const foxTraits = {}
    for (const key of TRACKED_TRAITS) {
      foxTraits[key] = sim.foxes.length ? sim.foxes.reduce((sum, f) => sum + computeFoxTraits(f.brain)[key], 0) / sim.foxes.length : null
    }
    return {
      seed,
      preset,
      rabbits: sim.rabbits.length,
      foxes: sim.foxes.length,
      fish: sim.fish.length,
      crabs: sim.crabs.length,
      kills: sim.kills,
      shoreCatches: sim.shoreCatches,
      burrows: sim.burrows.length,
      peakRabbits,
      peakFoxes,
      rabbitsOutAt,
      foxesOutAt,
      rabbitGen: sim.rabbits.length ? Math.max(...sim.rabbits.map((r) => r.generation)) : 0,
      foxGen: sim.foxes.length ? Math.max(...sim.foxes.map((f) => f.generation)) : 0,
      foxTraits,
      // Where the shoreline's own evolution shows up: crabs that have been
      // worked over by foxes should be retreating toward the water, and fish
      // in a fished lake should be getting quicker.
      shoreGenes: {
        crabBoldness: meanGene(sim.crabs, 'boldness'),
        crabArmour: meanGene(sim.crabs, 'armour'),
        fishSpeed: meanGene(sim.fish, 'speed'),
        fishWariness: meanGene(sim.fish, 'wariness'),
      },
      crabGen: sim.crabs.length ? Math.max(...sim.crabs.map((c) => c.generation)) : 0,
      fishGen: sim.fish.length ? Math.max(...sim.fish.map((f) => f.generation)) : 0,
    }
  } finally {
    Math.random = realRandom
  }
}

/** `runs` scenarios on consecutive seeds, plus the summary the balance
 * numbers in the plan docs are quoted from. */
export function runBatch(opts) {
  const results = []
  for (let i = 0; i < opts.runs; i++) results.push(runScenario({ ...opts, seed: opts.seed + i }))
  const mean = (key) => results.reduce((sum, r) => sum + r[key], 0) / results.length
  return {
    results,
    summary: {
      runs: results.length,
      rabbitsLeft: mean('rabbits'),
      foxesLeft: mean('foxes'),
      fishLeft: mean('fish'),
      crabsLeft: mean('crabs'),
      rabbitExtinctions: results.filter((r) => r.rabbits === 0).length,
      foxExtinctions: results.filter((r) => r.foxes === 0).length,
      fishExtinctions: results.filter((r) => r.fish === 0).length,
      crabExtinctions: results.filter((r) => r.crabs === 0).length,
      bothAlive: results.filter((r) => r.rabbits > 0 && r.foxes > 0).length,
      kills: mean('kills'),
      shoreCatches: mean('shoreCatches'),
      peakFoxes: mean('peakFoxes'),
      maxFoxGen: mean('foxGen'),
      maxRabbitGen: mean('rabbitGen'),
    },
  }
}

function main() {
  const opts = parseArgs(process.argv.slice(2))
  const { results, summary } = runBatch(opts)
  if (opts.json) {
    console.log(JSON.stringify({ opts, summary, results }, null, 2))
    return
  }
  const pad = (v, n) => String(v).padStart(n)
  const mins = (v) => (v == null ? '—' : `${v.toFixed(1)}m`)
  for (const r of results) {
    const traits = r.foxTraits.aggression == null ? '' : `  fox instincts: ${TRACKED_TRAITS.map((k) => `${k} ${Math.round(r.foxTraits[k] * 100)}%`).join(', ')}`
    const pct = (v) => (v == null ? '—' : `${Math.round(v * 100)}%`)
    const shore = opts.fish || opts.crabs
      ? `  fish ${pad(r.fish, 4)} (gen ${r.fishGen}) crabs ${pad(r.crabs, 4)} (gen ${r.crabGen}) shore-catches ${pad(r.shoreCatches, 4)}` +
        `  crab boldness ${pct(r.shoreGenes.crabBoldness)}/armour ${pct(r.shoreGenes.crabArmour)}` +
        `  fish speed ${pct(r.shoreGenes.fishSpeed)}/wariness ${pct(r.shoreGenes.fishWariness)}`
      : ''
    console.log(
      `seed ${pad(r.seed, 4)}: rabbits ${pad(r.rabbits, 4)} (peak ${pad(r.peakRabbits, 4)}, gen ${r.rabbitGen})  ` +
        `foxes ${pad(r.foxes, 3)} (peak ${pad(r.peakFoxes, 3)}, gen ${r.foxGen})  kills ${pad(r.kills, 4)}${shore}  ` +
        `rabbits out ${mins(r.rabbitsOutAt)}  foxes out ${mins(r.foxesOutAt)}${traits}`,
    )
  }
  const s = summary
  const seeded = [`${opts.rabbits} rabbits`, `${opts.foxes} foxes`]
  if (opts.fish) seeded.push(`${opts.fish} fish`)
  if (opts.crabs) seeded.push(`${opts.crabs} crabs`)
  console.log('—'.repeat(80))
  console.log(
    `${seeded.join(' + ')}, ${opts.size}x${opts.size}, ${opts.minutes} sim-minutes, ${s.runs} runs from seed ${opts.seed}` +
      `, "${SCENARIO_PRESETS.find((p) => p.key === opts.preset).label}" starting conditions`,
  )
  console.log(`rabbits left ${s.rabbitsLeft.toFixed(1)} (extinct in ${s.rabbitExtinctions}/${s.runs})`)
  console.log(`foxes   left ${s.foxesLeft.toFixed(1)} (extinct in ${s.foxExtinctions}/${s.runs}), peak ${s.peakFoxes.toFixed(1)}`)
  if (opts.fish || opts.crabs) {
    console.log(
      `fish    left ${s.fishLeft.toFixed(1)} (extinct in ${s.fishExtinctions}/${s.runs}), ` +
        `crabs left ${s.crabsLeft.toFixed(1)} (extinct in ${s.crabExtinctions}/${s.runs}), shore catches ${s.shoreCatches.toFixed(1)}`,
    )
  }
  console.log(`both species alive at the end: ${s.bothAlive}/${s.runs}`)
  console.log(`kills ${s.kills.toFixed(1)}, furthest generation reached: rabbits ${s.maxRabbitGen.toFixed(1)}, foxes ${s.maxFoxGen.toFixed(1)}`)
}

// Only run when invoked directly, so the ecosystem test can import runBatch.
if (process.argv[1] && process.argv[1].endsWith('ecosystem.mjs')) main()
