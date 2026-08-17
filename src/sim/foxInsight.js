// Translates a fox's raw neural-net weights into plain-language instincts,
// the same trick brainInsight.js plays on a rabbit's brain and by the same
// cheap approximation: for each input->output pair, sum the weighted path
// through every hidden neuron. It captures how strongly and in which
// direction an input pulls an output without running the network, which is
// enough to describe a fox's temperament at a glance - not a claim about
// exactly what it will do in a given moment.
//
// Kept apart from brainInsight.js rather than generalized into it: the two
// nets have different inputs, different outputs and different stories to
// tell, and a shared "computeTraits(brain, config)" would be a bigger,
// vaguer thing than either.

import { FOX_BRAIN_SHAPE } from './foxBrain.js'

export const FOX_INPUT_LABELS = [
  'Baseline',
  'Energy level',
  'Prey direction (x)',
  'Prey direction (y)',
  'Prey distance',
  'Scent direction (x)',
  'Scent direction (y)',
  'Scent strength',
  'Pack direction (x)',
  'Pack direction (y)',
  'Pack distance',
  'Stamina left',
  'Under cover',
  'Shore prey direction (x)',
  'Shore prey direction (y)',
  'Shore prey distance',
  'Randomness',
]
export const FOX_OUTPUT_LABELS = ['Chase', 'Sprint', 'Follow scent', 'Join the pack', 'Lie up', 'Want to breed', 'Work the shore']

// Input/output indices, kept in sync with buildFoxInputs in simulation.js
// and foxThink()'s output shape in foxBrain.js.
const IN = {
  BIAS: 0,
  ENERGY: 1,
  PREY_X: 2,
  PREY_Y: 3,
  PREY_DIST: 4,
  SCENT_X: 5,
  SCENT_Y: 6,
  SCENT: 7,
  PACK_X: 8,
  PACK_Y: 9,
  PACK_DIST: 10,
  STAMINA: 11,
  COVER: 12,
  SHORE_X: 13,
  SHORE_Y: 14,
  SHORE_DIST: 15,
  NOISE: 16,
}
const OUT = { CHASE: 0, SPRINT: 1, TRACK: 2, GROUP: 3, REST: 4, BREED: 5, FORAGE: 6 }

/** pathways[input][output] = signed net pull of that input on that output,
 * summed across the hidden layer. */
export function computeFoxPathways(brain) {
  const { inputs, hidden, outputs } = FOX_BRAIN_SHAPE
  const { w1, w2 } = brain
  const pathways = []
  for (let i = 0; i < inputs; i++) {
    const row = new Array(outputs).fill(0)
    for (let h = 0; h < hidden; h++) {
      const wIn = w1[i * hidden + h]
      for (let o = 0; o < outputs; o++) row[o] += wIn * w2[h * outputs + o]
    }
    pathways.push(row)
  }
  return pathways
}

function clamp01(v) {
  return Math.min(1, Math.max(0, v))
}

function squash(x, scale = 3) {
  return clamp01(0.5 + 0.5 * Math.tanh(x / scale))
}

export const FOX_TRAIT_META = [
  { key: 'aggression', label: 'Aggression', color: 'rgb(220,38,38)' },
  { key: 'tracking', label: 'Nose for prey', color: 'rgb(132,204,22)' },
  { key: 'commitment', label: 'Chase commitment', color: 'rgb(251,146,60)' },
  { key: 'sociability', label: 'Sociability', color: 'rgb(167,139,250)' },
  { key: 'idleness', label: 'Lies up to save energy', color: 'rgb(96,165,250)' },
  { key: 'broodiness', label: 'Broodiness', color: 'rgb(244,114,182)' },
  { key: 'patience', label: 'Hunts only when hungry', color: 'rgb(250,204,21)' },
  { key: 'beachcombing', label: 'Works the shoreline', color: 'rgb(45,212,191)' },
]

/**
 * Seven 0..1 instincts summarizing a fox brain's tendencies, independent of
 * any particular moment. These are what the population panel averages, so
 * you can watch a pack drift from "chases everything" toward "waits until
 * it's hungry" as the rabbits get harder to catch.
 */
export function computeFoxTraits(brain) {
  const p = computeFoxPathways(brain)
  return {
    // How readily this genome commits to a rabbit it can see. Replaces the
    // old hardcoded `bloodlust` gene, which set a fixed hunger threshold for
    // the whole lineage.
    aggression: squash(p[IN.BIAS][OUT.CHASE]),
    // How much the scent inputs actually move it: a fox with no nose for
    // prey wanders the island instead of searching it.
    tracking: squash(Math.abs(p[IN.SCENT][OUT.TRACK]) + Math.abs(p[IN.SCENT_X][OUT.TRACK]) + Math.abs(p[IN.SCENT_Y][OUT.TRACK]), 4),
    // Willingness to spend stamina rather than trot after prey and hope.
    commitment: squash(p[IN.BIAS][OUT.SPRINT]),
    sociability: squash(p[IN.BIAS][OUT.GROUP]),
    // Lying up cuts upkeep but finds nothing, so this is the fox's answer to
    // a lean island: sit out the famine, or keep hunting through it.
    idleness: squash(p[IN.BIAS][OUT.REST]),
    broodiness: squash(p[IN.BIAS][OUT.BREED]),
    // Hunger-gated hunting, as a trait rather than a constant: a strongly
    // negative energy->chase pathway means "only bothers when empty", which
    // is the behaviour the bloodlust gene used to hardcode at one value per
    // fox.
    patience: squash(-p[IN.ENERGY][OUT.CHASE]),
    // Whether this lineage bothers with the tideline at all. It is the
    // cheapest food on the map and the least of it, so a pack that leans on
    // it is a pack that has decided small and certain beats large and
    // occasional - which is exactly the decision an island with no rabbits
    // left on it forces.
    beachcombing: squash(p[IN.BIAS][OUT.FORAGE]),
    _pathways: p,
  }
}

function levelWord(v) {
  return v > 0.66 ? 'high' : v < 0.34 ? 'low' : 'moderate'
}

/** A plain-English read on what this brain does, for the inspector. */
export function describeFoxBrain(t) {
  const parts = [
    t.aggression > 0.5 ? 'goes after anything it sees' : 'lets most rabbits walk past',
    t.patience > 0.5 ? 'and mostly only when it is hungry' : 'hungry or not',
    t.tracking > 0.5 ? 'hunts by nose as much as by eye' : 'ignores a scent it cannot see the source of',
    t.commitment > 0.5 ? 'commits to a sprint' : 'rarely spends stamina on a chase',
    t.sociability > 0.5 ? 'runs with the pack' : 'keeps to itself',
    t.idleness > 0.5 ? 'lies up between meals to save energy' : 'stays on the move',
    t.beachcombing > 0.5 ? 'It works the tideline for fish and crabs as well as hunting' : 'It walks past the shoreline without looking at it',
  ]
  return `This fox ${parts[0]}, ${parts[1]}. It ${parts[2]}, ${parts[3]}, ${parts[4]}, and ${parts[5]}. ${parts[6]}. Its ${levelWord(t.broodiness)} broodiness decides how readily it turns a full belly into cubs.`
}

/** Short "why it acts this way" notes: how its own state modulates the three
 * decisions a viewer can actually watch it make. */
export function describeFoxDrives(t) {
  const p = t._pathways
  const note = (value, rising, falling, flat) => {
    if (Math.abs(value) < 0.15) return flat
    return value > 0 ? rising : falling
  }
  return {
    chase: note(
      p[IN.ENERGY][OUT.CHASE],
      'Hunts hardest when it is already well fed (kills for the sake of it).',
      'Only really hunts once it is hungry.',
      'Hunts about as readily full as empty.',
    ),
    rest: note(
      p[IN.ENERGY][OUT.REST],
      'Lies up more when it has energy in reserve.',
      'Lies up as its energy drains - waiting out a lean patch rather than burning through it.',
      'Rests about the same whatever its reserves.',
    ),
    prey: note(
      p[IN.PREY_DIST][OUT.SPRINT],
      'Saves its sprint for prey that is still a long way off.',
      'Holds its sprint until the rabbit is close, then spends it.',
      'Sprints without much regard for range.',
    ),
    shore: note(
      p[IN.ENERGY][OUT.FORAGE],
      'Picks crabs up when it is already full - a habit rather than a fallback.',
      'Turns to the tideline as its reserves run down, and hunts properly while they last.',
      'Takes whatever the shoreline offers, full or empty.',
    ),
  }
}
