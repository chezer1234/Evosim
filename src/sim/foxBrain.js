// The fox's brain. Until now a fox was *only* a gene vector (see ./fox.js):
// its body was heritable but its decisions were a fixed if/else ladder, so
// every fox on the island hunted, regrouped and bred by the same script and
// the only thing evolution could touch was how fast its legs were. This is
// the other half - a neural net, in the same shape and with the same
// mutation rules as a rabbit's (see ./net.js) - so *when* a fox commits to a
// chase, whether it spends stamina on it, whether it follows a scent it
// cannot see the source of, whether it hunts with the pack, when it lies up
// to save energy and when it breeds are all heritable, mutable, and
// selected for by whether that lineage's cubs make it.
//
// The split with fox.js is the same one the rabbits already use: the genes
// are the *body* (how fast, how far it sees, how much it burns), and the net
// is the *behaviour*. A weight matrix cannot make your legs longer, and a
// leg cannot decide to give up on a chase.
//
// Unlike the rabbit net this one has no moveX/moveY outputs. A fox's
// movement is not a free vector it invents each tick: it is a consequence of
// the decision it just made (run at that rabbit / follow that scent / close
// on that packmate / lie still / sweep). The rabbit brain learned the hard
// way that steering outputs fed by a mostly-constant input collapse into a
// frozen bearing (see the SEARCH_HEADING_TICKS comment in simulation.js), so
// the fox net decides *what to do* and simulation.js works out which way
// that points.

import { createNet, forward, mutateNet, sigmoid } from './net.js'

// What a fox knows on a decision tick. Prey is what it can see (its vision
// gene, halved under forest canopy); scent is the long, vague sense that
// replaces it when it can't - a bearing that gets noisier the further off
// the rabbit is (see SCENT_JITTER in simulation.js). Everything is
// normalized to roughly -1..1 by the ranges the fox's own genes give it, so
// a wide-eyed fox and a short-sighted one read their worlds on the same
// scale.
export const FOX_INPUT_SIZE = 14
export const FOX_HIDDEN_SIZE = 8
export const FOX_OUTPUT_SIZE = 6 // chase, sprint, track, group, rest, breed
export const FOX_BRAIN_SHAPE = { inputs: FOX_INPUT_SIZE, hidden: FOX_HIDDEN_SIZE, outputs: FOX_OUTPUT_SIZE }

// Output indices. `group` is not listed: it is the one decision with no
// founder prior - whether to run with the pack starts as a coin flip,
// because unlike chasing or breeding, a fox that never does it is not
// thereby doomed.
const CHASE_OUTPUT = 0
const SPRINT_OUTPUT = 1
const TRACK_OUTPUT = 2
const REST_OUTPUT = 4
const BREED_OUTPUT = 5

// Founder priors, exactly like the rabbit's flee/hide biases: a founder pack
// that had to *discover* chasing rabbits would starve before selection could
// reward the first fox that tried it, and the mechanic would never show up
// in a run at all. So fresh foxes start as hunters that follow their nose
// and breed when they can, and a lineage evolves its way toward something
// else - patient ambusher, layabout, loner - if the island rewards it.
const CHASE_INITIAL_BIAS = 2.2
const TRACK_INITIAL_BIAS = 2.0
const SPRINT_INITIAL_BIAS = 1.0
const BREED_INITIAL_BIAS = 1.6
// The one negative prior: resting is cheap (it cuts upkeep, see
// REST_UPKEEP_FACTOR in fox.js) and doing it constantly is a slow death, so
// founders start awake. It is still only a prior - a lineage that lives
// somewhere lean can absolutely evolve into one that lies up between meals,
// which is the most interesting thing this net can discover.
const REST_INITIAL_BIAS = 1.4

const INITIAL_BIAS = {
  [CHASE_OUTPUT]: CHASE_INITIAL_BIAS,
  [SPRINT_OUTPUT]: SPRINT_INITIAL_BIAS,
  [TRACK_OUTPUT]: TRACK_INITIAL_BIAS,
  [REST_OUTPUT]: REST_INITIAL_BIAS,
  [BREED_OUTPUT]: BREED_INITIAL_BIAS,
}

/** A fresh fox brain, using `rng` (a 0..1 generator). */
export function createFoxBrain(rng) {
  return createNet(FOX_BRAIN_SHAPE, rng, INITIAL_BIAS)
}

/**
 * Run the net forward. `inputs` must have FOX_INPUT_SIZE entries (see
 * buildFoxInputs in simulation.js, which is the one place that fills them
 * in). Every output is a 0..1 "how much do I want to" that simulation.js
 * gates on 0.5 - and then applies its own hard constraints on top, the same
 * way the rabbit's reproduceDesire still has to clear an energy threshold.
 */
export function foxThink(brain, inputs) {
  const out = forward(brain, FOX_BRAIN_SHAPE, inputs)
  return {
    // Commit to a rabbit it can actually see.
    chase: sigmoid(out[0]),
    // Spend stamina to close the last few tiles, rather than trotting.
    sprint: sigmoid(out[1]),
    // Follow a scent to prey it cannot see - the difference between
    // searching an island and wandering it.
    track: sigmoid(out[2]),
    // Close on a packmate while not hunting, so the pack hunts one patch.
    group: sigmoid(out[3]),
    // Lie up: no movement, and upkeep drops (see fox.js).
    rest: sigmoid(out[4]),
    // Want a litter, still gated on the breed-energy threshold its fecundity
    // gene sets.
    breed: sigmoid(out[5]),
  }
}

/** A cub's brain: the parent's, mutated by the same rules as a rabbit's. */
export function mutateFoxBrain(brain, rng) {
  return mutateNet(brain, rng)
}
