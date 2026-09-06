// The rules of a run: the handful of numbers that decide what kind of world
// the player is about to press play on, settled before the first creature is
// dropped and fixed for the rest of the run.
//
// All of them used to be module-level `const`s in fox.js, rabbit.js,
// brain.js, foxBrain.js, net.js and simulation.js - the right home for a
// number nobody is meant to touch, and the wrong one for a number the player
// is. Issue #18 hands a few over: how the founder pack is built, what a kill
// is worth, how quickly anything breeds, and how fast evolution moves.
//
// Three things with three different jobs, and the split is worth keeping:
//
//   * The **baselines** stay where they always were, beside the mechanic
//     they govern and the paragraph explaining why they are what they are -
//     FOX_BASE in fox.js, RABBIT_BASE in rabbit.js, the two brains' founder
//     biases in brain.js / foxBrain.js, NET_BASE in net.js, and SIM_BASE
//     below for the few that only ever lived in the sim loop. Nothing here
//     restates a number that has a home; it imports it.
//   * A **scenario** is the flat, player-facing dial set: one number per
//     slider, persisted to localStorage and handed to createSimulation.
//   * **Rules** are what the sim actually reads. createRules() turns a
//     scenario into the nested shape every genome and brain function takes
//     as its trailing argument, and createSimulation stores it as
//     `sim.rules` so nothing has to reach back for a module constant.
//
// Most economy dials are *multipliers* against a baseline range rather than
// raw numbers, which is deliberate. The curves in fox.js are tuned
// relationships - a hot metabolism earns more per kill *and* burns more
// standing still - and a player dragging one end of that off its baseline
// would be editing the model rather than the world. A multiplier moves the
// whole range and leaves the relationship intact.

import { FOX_BASE, FOX_ENERGY_MAX } from './fox.js'
import { RABBIT_BASE } from './rabbit.js'
import { RABBIT_BRAIN_BASE } from './brain.js'
import { FOX_BRAIN_BASE } from './foxBrain.js'
import { NET_BASE } from './net.js'

/** The tunable baselines that never belonged to a genome file: they are the
 * sim loop's own numbers (an apple's food value, the bar a rabbit breeds at,
 * how long a vixen waits between litters). Everything else here is imported
 * from the file that owns it. */
const SIM_BASE = {
  // What one apple is worth, against a 100-energy tank.
  rabbitEatGain: 10,
  // A rabbit will not start a pregnancy below this, so it is also the
  // ceiling on how many rabbits a given number of apple trees can carry.
  rabbitBreedEnergy: 75,
  rabbitGestationMs: 30000,
  // How long a vixen waits before she can carry another litter. The brake on
  // the predator's numerical response: fox gestation is short (30-58s, see
  // FOX_BASE.gestationMs), so without a recovery period a fox that finds a
  // rabbit boom turns it into foxes faster than the boom can replace itself.
  foxLitterRecoveryMs: 150000,
  // How much room a fox needs before it will breed at all: no litter within
  // this many tiles of another fox. The density cap that stops a good island
  // from becoming one enormous pack.
  foxTerritoryRadius: 24,
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}

/** A [lo, hi] baseline range, scaled by a dial. Both ends move together, so
 * the gene's own trade-off (see foxStats) survives the edit. */
function scaleRange([lo, hi], factor) {
  return [lo * factor, hi * factor]
}

// ============================== The dials ===============================
// The player-facing settings, as UI metadata: label, range, and the plain
// reading of what moving it does. DEFAULT_SCENARIO is derived from this
// table rather than written out twice, so a dial cannot exist without a
// default or drift away from one.
//
// Ordered, as the groups are, by how much a dial changes a run - founder
// bodies and the energy economy decide whether the populations cycle at all;
// the instinct biases only nudge where evolution starts from.

/** @typedef {{key: string, label: string, hint?: string, min: number, max: number, step: number, default: number, format: (v: number) => string}} Dial */

const percent = (v) => `${Math.round(v * 100)}%`
const times = (v) => `${v.toFixed(2)}×`
const tiles = (v) => (v === 0 ? 'off' : `${v} tiles`)
const bias = (v) => (v === 0 ? 'neutral' : v.toFixed(1))

/** @type {{key: string, title: string, blurb: string, advanced?: boolean, dials: Dial[]}[]} */
export const SCENARIO_GROUPS = [
  {
    key: 'founders',
    title: 'Founder bodies',
    blurb:
      'The genes each founder is drawn around. Only a starting prior - mutation still goes wherever selection pushes it - so this is picking where evolution begins, not where it ends.',
    dials: [
      {
        key: 'foxSpeed',
        label: 'Fox speed',
        hint: 'Below the middle by default: a fresh fox is no match for a running rabbit in a straight line, and has to evolve its way there.',
        min: 0, max: 1, step: 0.02, default: FOX_BASE.founderMean.speed, format: percent,
      },
      {
        key: 'foxMetabolism',
        label: 'Fox metabolism',
        hint: 'Burns hot and strips a carcass better, or lives lean on less. Moves both energy per kill and upkeep at once.',
        min: 0, max: 1, step: 0.02, default: FOX_BASE.founderMean.metabolism, format: percent,
      },
      {
        key: 'foxFecundity',
        label: 'Fox fecundity',
        hint: 'How readily the founders breed: a lower bar to start a pregnancy and a shorter one to carry it.',
        min: 0, max: 1, step: 0.02, default: FOX_BASE.founderMean.fecundity, format: percent,
      },
      {
        key: 'foxSwimming',
        label: 'Fox swimming',
        hint: 'Starts below the usable threshold, so a lake is somewhere prey escapes to until a fox line earns its way in.',
        min: 0, max: 1, step: 0.02, default: FOX_BASE.founderMean.swimming, format: percent,
      },
      {
        key: 'rabbitSwimming',
        label: 'Rabbit swimming',
        hint: 'Higher than the foxes start, and still below the threshold: about a third of the founders can enter water at all.',
        min: 0, max: 1, step: 0.02, default: RABBIT_BASE.founderMean.swimming, format: percent,
      },
      {
        key: 'founderVariation',
        label: 'Founder variation',
        hint: 'How widely founders are scattered around those means. At zero every founder of a species is a copy of the same animal, and every difference in the run is one mutation made.',
        min: 0, max: 2, step: 0.05, default: 1, format: times,
      },
    ],
  },
  {
    key: 'energy',
    title: 'Energy economy',
    blurb:
      'How many predators a given prey base can carry - the single biggest determinant of whether the populations cycle or one of them collapses.',
    dials: [
      {
        key: 'foxUpkeep',
        label: 'Fox upkeep',
        hint: 'Energy burnt per second just being a fox. Raise it and the island supports fewer of them.',
        min: 0.4, max: 2, step: 0.05, default: 1, format: times,
      },
      {
        key: 'foxEnergyPerKill',
        label: 'Energy per kill',
        hint: 'What a rabbit is worth to the fox that catches it.',
        min: 0.4, max: 2, step: 0.05, default: 1, format: times,
      },
      {
        key: 'rabbitEatGain',
        label: 'Rabbit eat gain',
        hint: 'What one apple is worth. The bottom of the food chain: everything above it is paid for in apples.',
        min: 0.4, max: 2, step: 0.05, default: 1, format: times,
      },
    ],
  },
  {
    key: 'breeding',
    title: 'Breeding',
    blurb: 'The brakes on how fast either population can answer a good year.',
    dials: [
      {
        key: 'foxBreedEnergy',
        label: 'Fox breeding bar',
        hint: 'The reserve a fox needs before it will start a litter. Capped just under a full tank, so breeding is always at least possible.',
        min: 0.6, max: 1.2, step: 0.02, default: 1, format: times,
      },
      {
        key: 'foxGestation',
        label: 'Fox gestation',
        hint: 'How long a litter takes to carry.',
        min: 0.4, max: 2, step: 0.05, default: 1, format: times,
      },
      {
        key: 'foxLitterRecovery',
        label: 'Litter recovery',
        hint: 'The wait between litters. At zero a fox that keeps eating keeps breeding, which is how a rabbit boom becomes a bare island.',
        min: 0, max: 2, step: 0.05, default: 1, format: times,
      },
      {
        key: 'foxTerritory',
        label: 'Fox territory',
        hint: 'No litter within this many tiles of another fox. The density cap on a pack; off means none.',
        min: 0, max: 48, step: 2, default: SIM_BASE.foxTerritoryRadius, format: tiles,
      },
      {
        key: 'rabbitBreedEnergy',
        label: 'Rabbit breeding bar',
        hint: 'The reserve a rabbit needs to breed, against a 100-energy tank - so it is also the ceiling on how many rabbits a given number of trees can carry.',
        min: 0.6, max: 1.2, step: 0.02, default: 1, format: times,
      },
      {
        key: 'rabbitGestation',
        label: 'Rabbit gestation',
        min: 0.4, max: 2, step: 0.05, default: 1, format: times,
      },
    ],
  },
  {
    key: 'evolution',
    title: 'Evolution',
    blurb:
      'The honest "how fast does this happen" dials. Both apply to every genome and both brains at once: whichever species adapts faster should be telling you about the selection pressure, not about a constant one of them was handed.',
    dials: [
      {
        key: 'mutationRate',
        label: 'Mutation rate',
        hint: 'How often a gene or a brain weight changes at birth. High is visible evolution in a single sitting; low is a slow, realistic drift.',
        min: 0, max: 4, step: 0.1, default: 1, format: times,
      },
      {
        key: 'mutationSpread',
        label: 'Mutation size',
        hint: 'How far a mutation moves what it touches. Small drifts are always commoner than big jumps; this scales both.',
        min: 0.2, max: 3, step: 0.05, default: 1, format: times,
      },
    ],
  },
  {
    key: 'instincts',
    title: 'Founder instincts',
    advanced: true,
    blurb:
      'What a fresh brain is born believing, before it has learnt anything. A founder population that has to discover running from foxes for itself is eaten before selection can act, so the instincts it needs start switched on and a lineage evolves its way off them. Zero is a coin flip; negative is a prior against.',
    dials: [
      { key: 'rabbitFleeBias', label: 'Rabbit: flee', hint: 'How jumpy the first rabbits are at middle distance. A fox close enough to pounce triggers panic regardless.', min: -2, max: 4, step: 0.2, default: RABBIT_BRAIN_BASE.bias.flee, format: bias },
      { key: 'rabbitHideBias', label: 'Rabbit: go to ground', hint: 'How readily they dig and use burrows, which costs energy and foraging time.', min: -2, max: 4, step: 0.2, default: RABBIT_BRAIN_BASE.bias.hide, format: bias },
      { key: 'rabbitSearchBias', label: 'Rabbit: forage', hint: 'How much of its time a fresh rabbit spends actively looking for food.', min: -2, max: 4, step: 0.2, default: RABBIT_BRAIN_BASE.bias.search, format: bias },
      { key: 'foxChaseBias', label: 'Fox: chase', hint: 'How readily the first foxes commit to a rabbit they can see.', min: -2, max: 4, step: 0.2, default: FOX_BRAIN_BASE.bias.chase, format: bias },
      { key: 'foxTrackBias', label: 'Fox: follow a scent', hint: 'Whether they hunt what they can smell but not see - the difference between searching an island and wandering it.', min: -2, max: 4, step: 0.2, default: FOX_BRAIN_BASE.bias.track, format: bias },
      { key: 'foxSprintBias', label: 'Fox: sprint', hint: 'Whether they spend stamina closing the last few tiles or trot and hope.', min: -2, max: 4, step: 0.2, default: FOX_BRAIN_BASE.bias.sprint, format: bias },
      { key: 'foxRestBias', label: 'Fox: lie up', hint: 'Resting halves upkeep but finds nothing. The most interesting thing a fox lineage can discover, and the one prior that starts negative.', min: -2, max: 4, step: 0.2, default: FOX_BRAIN_BASE.bias.rest, format: bias },
      { key: 'foxBreedBias', label: 'Fox: breed', hint: 'How eagerly a well-fed fox turns a full belly into cubs.', min: -2, max: 4, step: 0.2, default: FOX_BRAIN_BASE.bias.breed, format: bias },
      { key: 'foxForageBias', label: 'Fox: work the shore', hint: 'Whether they take the fish and crabs on offer. What keeps a pack alive on an island whose rabbits have crashed.', min: -2, max: 4, step: 0.2, default: FOX_BRAIN_BASE.bias.forage, format: bias },
    ],
  },
]

/** Every dial, flattened - for defaults, validation and the presets. */
export const SCENARIO_DIALS = SCENARIO_GROUPS.flatMap((group) => group.dials)

/** The scenario you get if you never open the screen: today's balance,
 * exactly as it was before any of this was tunable. */
export const DEFAULT_SCENARIO = Object.fromEntries(SCENARIO_DIALS.map((dial) => [dial.key, dial.default]))

/** A partial scenario filled in from the defaults, with every dial clamped to
 * its own slider range - a value out of localStorage is only as trustworthy
 * as the version of the app that wrote it. */
export function resolveScenario(scenario) {
  const merged = { ...DEFAULT_SCENARIO, ...scenario }
  const out = {}
  for (const dial of SCENARIO_DIALS) {
    const value = Number(merged[dial.key])
    out[dial.key] = Number.isFinite(value) ? clamp(value, dial.min, dial.max) : dial.default
  }
  return out
}

/**
 * A scenario turned into the rules the sim reads. Called once, by
 * createSimulation, and the result lives on `sim.rules` for the whole run:
 *
 *   sim.rules.fox     → fox.js (genes, foxStats) and foxBrain.js (founder biases)
 *   sim.rules.rabbit  → rabbit.js and brain.js, plus the rabbit's own lifecycle
 *   sim.rules.brain   → net.js, i.e. how *both* species' weights mutate
 */
export function createRules(scenario) {
  const s = resolveScenario(scenario)
  const geneMutation = (base) => ({
    // A rate is a probability, so it saturates rather than overflowing; a
    // spread is a standard deviation and has no such ceiling.
    rate: clamp(base.rate * s.mutationRate, 0, 1),
    stddev: base.stddev * s.mutationSpread,
  })
  return {
    fox: {
      founderMean: {
        ...FOX_BASE.founderMean,
        speed: s.foxSpeed,
        metabolism: s.foxMetabolism,
        fecundity: s.foxFecundity,
        swimming: s.foxSwimming,
      },
      founderSpread: FOX_BASE.founderSpread * s.founderVariation,
      mutation: geneMutation(FOX_BASE.mutation),
      killEnergy: scaleRange(FOX_BASE.killEnergy, s.foxEnergyPerKill),
      upkeepPerSec: scaleRange(FOX_BASE.upkeepPerSec, s.foxUpkeep),
      // Clamped under a full tank on purpose: the baseline bar is already
      // near the ceiling (a fox has to catch something before it turns into
      // two foxes), and a scenario that pushed it over would be one where no
      // fox can ever breed - a dead run that looks like a bug.
      breedEnergy: scaleRange(FOX_BASE.breedEnergy, s.foxBreedEnergy).map((v) =>
        Math.min(v, FOX_ENERGY_MAX * 0.98),
      ),
      gestationMs: scaleRange(FOX_BASE.gestationMs, s.foxGestation),
      litterRecoveryMs: SIM_BASE.foxLitterRecoveryMs * s.foxLitterRecovery,
      territoryRadius: s.foxTerritory,
      bias: {
        ...FOX_BRAIN_BASE.bias,
        chase: s.foxChaseBias,
        track: s.foxTrackBias,
        sprint: s.foxSprintBias,
        rest: s.foxRestBias,
        breed: s.foxBreedBias,
        forage: s.foxForageBias,
      },
    },
    rabbit: {
      founderMean: { ...RABBIT_BASE.founderMean, swimming: s.rabbitSwimming },
      founderSpread: RABBIT_BASE.founderSpread * s.founderVariation,
      mutation: geneMutation(RABBIT_BASE.mutation),
      eatGain: SIM_BASE.rabbitEatGain * s.rabbitEatGain,
      breedEnergy: SIM_BASE.rabbitBreedEnergy * s.rabbitBreedEnergy,
      gestationMs: SIM_BASE.rabbitGestationMs * s.rabbitGestation,
      bias: {
        ...RABBIT_BRAIN_BASE.bias,
        flee: s.rabbitFleeBias,
        hide: s.rabbitHideBias,
        search: s.rabbitSearchBias,
      },
    },
    // Shared by both species deliberately - see net.js. One dial pair moves
    // both, and neither can be tuned without the other.
    brain: { mutation: geneMutation(NET_BASE.mutation) },
  }
}

/** Today's rules, for every function that takes a rules fragment but was
 * called from somewhere without a simulation to hand (tests, insight panels,
 * the odd pure helper). */
export const DEFAULT_RULES = createRules(DEFAULT_SCENARIO)

// ============================== Presets =================================
// Four worlds worth having as one tap. Presets matter more than the sliders
// do: twenty raw dials mostly produce dead islands, and the point of the
// screen is to get someone to an interesting run in one click and let them
// take the dials apart afterwards.
//
// Each one is balance-checked headlessly rather than by eye -
// `make ecosystem-presets` runs the real sim across a batch of seeded
// islands for every preset here (see scripts/ecosystem.mjs).

export const SCENARIO_PRESETS = [
  {
    key: 'balanced',
    label: 'Balanced',
    hint: 'The tuned default: two species that cycle, on an island that can carry both.',
    scenario: {},
  },
  {
    key: 'predator',
    label: "Predator's island",
    hint: 'Founders that start fast, breed hard and get more out of every kill. The rabbits are on the back foot from minute one.',
    scenario: {
      foxSpeed: 0.5,
      foxFecundity: 0.55,
      foxUpkeep: 0.85,
      foxEnergyPerKill: 1.35,
      foxGestation: 0.7,
      foxLitterRecovery: 0.5,
    },
  },
  {
    key: 'boom',
    label: 'Rabbit boom',
    hint: 'Rich foraging and quick litters against a slower, hungrier predator. Watch what the foxes do to a population that outruns them.',
    scenario: {
      rabbitEatGain: 1.4,
      rabbitGestation: 0.7,
      rabbitBreedEnergy: 0.86,
      foxSpeed: 0.3,
      foxUpkeep: 1.15,
    },
  },
  {
    key: 'fast',
    label: 'Fast evolution',
    hint: 'The same world, running its genetics at several times speed. Generations diverge while you watch, for better and for worse.',
    scenario: { mutationRate: 3, mutationSpread: 1.8, founderVariation: 1.4 },
  },
]

/** The preset a scenario matches exactly, if any (for highlighting the UI).
 * Exact rather than the "every key the preset names" test the world presets
 * use: a preset here is a whole scenario, so a single dial nudged off it is
 * no longer that preset. */
export function matchingScenarioPreset(scenario) {
  const resolved = resolveScenario(scenario)
  return (
    SCENARIO_PRESETS.find((preset) => {
      const target = resolveScenario(preset.scenario)
      return SCENARIO_DIALS.every((dial) => resolved[dial.key] === target[dial.key])
    })?.key ?? null
  )
}
