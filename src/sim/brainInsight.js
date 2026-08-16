// Translates a rabbit's raw neural-net weights into plain-language traits an
// average person can read, instead of a wall of numbers. Not a rigorous
// saliency measure - it's a cheap, honest approximation: for each
// input->output pair, sum the weighted path through every hidden neuron
// (input->hidden weight times hidden->output weight), which captures how
// strongly and in which direction that input pulls that output without
// needing to run the network. Good enough to describe a rabbit's
// "personality" at a glance; not a claim about exact behavior in every
// situation (tanh/sigmoid squashing and combined inputs still matter).

import { HIDDEN_SIZE, INPUT_SIZE, OUTPUT_SIZE } from './brain.js'

export const INPUT_LABELS = ['Baseline', 'Energy level', 'Food direction (x)', 'Food direction (y)', 'Food distance', 'In water', 'Randomness']
export const OUTPUT_LABELS = ['Move X', 'Move Y', 'Run', 'Rest', 'Want to breed', 'Search drive']

// Input/output indices, kept in sync with simulation.js's `inputs` array and
// brain.js's think() output shape.
const IN = { BIAS: 0, ENERGY: 1, FOOD_X: 2, FOOD_Y: 3, FOOD_DIST: 4, WATER: 5, NOISE: 6 }
const OUT = { MOVE_X: 0, MOVE_Y: 1, RUN: 2, REST: 3, BREED: 4, SEARCH: 5 }

/** pathways[input][output] = signed net pull of that input on that output,
 * summed across the hidden layer. */
export function computePathways(brain) {
  const { w1, w2 } = brain
  const pathways = []
  for (let i = 0; i < INPUT_SIZE; i++) {
    const row = new Array(OUTPUT_SIZE).fill(0)
    for (let h = 0; h < HIDDEN_SIZE; h++) {
      const wIn = w1[i * HIDDEN_SIZE + h]
      for (let o = 0; o < OUTPUT_SIZE; o++) row[o] += wIn * w2[h * OUTPUT_SIZE + o]
    }
    pathways.push(row)
  }
  return pathways
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v))
}

// Squash an unbounded pathway sum into a readable 0..1 "how much" score.
function squash(x, scale = 3) {
  return clamp01(0.5 + 0.5 * Math.tanh(x / scale))
}

export const TRAIT_META = [
  { key: 'foodDrive', label: 'Food drive', color: 'rgb(120,214,110)' },
  { key: 'wanderer', label: 'Wanders randomly', color: 'rgb(148,163,184)' },
  { key: 'boldness', label: 'Boldness (runs)', color: 'rgb(250,204,21)' },
  { key: 'restfulness', label: 'Restfulness', color: 'rgb(96,165,250)' },
  { key: 'broodiness', label: 'Broodiness', color: 'rgb(244,114,182)' },
  { key: 'searchDrive', label: 'Search drive', color: 'rgb(56,189,248)' },
]

/** Six 0..1 traits summarizing a genome's tendencies, independent of any
 * specific moment/situation. */
export function computeTraits(brain) {
  const p = computePathways(brain)
  const foodPull = Math.abs(p[IN.FOOD_X][OUT.MOVE_X]) + Math.abs(p[IN.FOOD_Y][OUT.MOVE_Y]) + Math.abs(p[IN.FOOD_DIST][OUT.MOVE_X]) + Math.abs(p[IN.FOOD_DIST][OUT.MOVE_Y])
  const noisePull = Math.abs(p[IN.NOISE][OUT.MOVE_X]) + Math.abs(p[IN.NOISE][OUT.MOVE_Y])
  return {
    foodDrive: squash(foodPull, 4),
    wanderer: squash(noisePull, 4),
    boldness: squash(p[IN.BIAS][OUT.RUN]),
    restfulness: squash(p[IN.BIAS][OUT.REST]),
    broodiness: squash(p[IN.BIAS][OUT.BREED]),
    // How eager this genome is, on average, to actively search when it
    // can't see food - see SEARCH_DRIVE_INITIAL_BIAS in brain.js and its use
    // in simulation.js's runDecisionTick.
    searchDrive: squash(p[IN.BIAS][OUT.SEARCH]),
    _pathways: p,
  }
}

function levelWord(v) {
  return v > 0.66 ? 'high' : v < 0.34 ? 'low' : 'moderate'
}

/** A one/two-sentence plain-English summary of the genome's traits. */
export function describeTraits(t) {
  const parts = [
    `${levelWord(t.foodDrive)} food drive`,
    `${levelWord(t.wanderer)} tendency to wander randomly`,
    t.boldness > 0.5 ? 'runs boldly' : 'rarely sprints',
    t.restfulness > 0.5 ? 'rests often' : 'rarely rests',
    t.broodiness > 0.5 ? 'eager to breed' : 'reluctant to breed',
    t.searchDrive > 0.5 ? 'searches actively when food is out of sight' : 'tends to sit tight when food is out of sight',
  ]
  return `This rabbit has ${parts[0]}, a ${parts[1]}, ${parts[2]}, ${parts[3]}, and is ${parts[4]}. It also ${parts[5]}.`
}

/** Short "why it acts this way" notes for run/rest/breed, based on how each
 * is modulated by energy - the plainest second-order thing a lay reader can
 * still verify against what they see the rabbit doing. */
export function describeEnergyEffects(t) {
  const p = t._pathways
  const note = (pathwayValue, risingText, fallingText, flatText) => {
    if (Math.abs(pathwayValue) < 0.15) return flatText
    return pathwayValue > 0 ? risingText : fallingText
  }
  return {
    run: note(p[IN.ENERGY][OUT.RUN], 'Sprints more when energy is high (confident).', 'Sprints more as energy runs low (desperate).', 'Runs about the same regardless of energy.'),
    rest: note(p[IN.ENERGY][OUT.REST], 'Rests more when energy is already high.', 'Rests more as energy drops (conserving).', 'Rests about the same regardless of energy.'),
    breed: note(p[IN.ENERGY][OUT.BREED], 'More eager to breed the more energy it has.', 'Wants to breed even at low energy (still gated by the energy>75 rule).', 'Breeding desire barely tracks energy.'),
  }
}
