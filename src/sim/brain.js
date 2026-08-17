// The rabbit's brain / genome: a tiny feedforward net (the maths lives in
// ./net.js, shared with the fox's brain - see ./foxBrain.js). No training or
// backprop here: weights are randomized at spawn, and a child inherits its
// parent's weights with small random mutations. Selection happens implicitly
// through who survives and reproduces: a brain that finds food and avoids
// foxes leaves more copies of itself, and nothing else in here has an
// opinion about which weights are good ones.

import { createNet, forward, mutateNet, sigmoid } from './net.js'

// bias, energy, dx/dy/dist-to-apple, onWater, noise, then dx/dy/dist to the
// nearest fox the rabbit has *detected* (by sight within PREY_ALERT_RADIUS
// or, further out, by ear - see rabbit.js's hearing gene), then the three
// inputs issue #14 added: how loud an alarm call it can hear from another
// rabbit, where the nearest burrow it knows about is, and whether it is
// currently underground. Predators are something a rabbit has to be able to
// perceive - by whichever sense - before it can evolve any response to them.
export const INPUT_SIZE = 14
export const HIDDEN_SIZE = 8
export const OUTPUT_SIZE = 8 // moveX, moveY, run, rest, reproduceDesire, searchDrive, flee, hide
/** Layer sizes as one object, for net.js and for the brain-diagram UI. */
export const BRAIN_SHAPE = { inputs: INPUT_SIZE, hidden: HIDDEN_SIZE, outputs: OUTPUT_SIZE }
// Indices within b2/w2 that are called out by name because createBrain
// nudges their initial bias (see below) and simulation.js reads them as
// genuine evolvable traits rather than hardcoded behavior.
const SEARCH_DRIVE_OUTPUT = 5
const FLEE_OUTPUT = 6
const HIDE_OUTPUT = 7

// Freshly spawned brains start with searchDrive biased toward "yes" - real
// rabbits spend most of their time actively foraging, not sitting still, so
// that should be the default a genome has to evolve *away* from rather than
// a coin flip it has to discover. Random mutation can still push any given
// lineage's search drive down (or further up) over generations; this just
// sets the starting prior.
// Raised from 1.2 alongside the four inputs issue #14 added: a wider input
// layer drives the hidden units harder, so their (random) contribution to
// each output grew and a fixed bias bought a weaker prior than it used to.
// These three numbers are calibrated against how often a fresh brain
// actually says yes - see the "starts fresh brains biased toward..." tests.
const SEARCH_DRIVE_INITIAL_BIAS = 2.0
// Same idea for fleeing: a founder population that has to *discover* running
// away from foxes would simply be eaten before selection could act, so fresh
// brains start jumpy and a lineage has to evolve its way toward calm. (A
// fox close enough to pounce triggers a hard panic override regardless - see
// PANIC_RADIUS in simulation.js - so this gene governs the middle distance,
// where bolting early is safe but costs foraging time.)
const FLEE_INITIAL_BIAS = 2.0
// And the same again for going to ground. A burrow costs 7 energy to dig and
// stops the rabbit eating while it's down there, so "hide" is a genuine
// trade-off a lineage can evolve away from - but a founder population that
// had to *discover* using the holes it can dig would be eaten first, and the
// mechanic would never show up in a run at all. Starts on, evolves off.
const HIDE_INITIAL_BIAS = 1.8

const INITIAL_BIAS = {
  [SEARCH_DRIVE_OUTPUT]: SEARCH_DRIVE_INITIAL_BIAS,
  [FLEE_OUTPUT]: FLEE_INITIAL_BIAS,
  [HIDE_OUTPUT]: HIDE_INITIAL_BIAS,
}

export { WEIGHT_CLAMP } from './net.js'

/** A fresh brain with random weights, using `rng` (a 0..1 generator, e.g.
 * `Math.random` or a seeded rng). */
export function createBrain(rng) {
  return createNet(BRAIN_SHAPE, rng, INITIAL_BIAS)
}

/**
 * Run the net forward. `inputs` must have INPUT_SIZE entries, each roughly
 * in -1..1. Returns the rabbit's intent for this decision tick; callers
 * still enforce hard constraints (e.g. reproduceDesire only matters above
 * the energy threshold).
 */
export function think(brain, inputs) {
  const out = forward(brain, BRAIN_SHAPE, inputs)
  return {
    moveX: Math.tanh(out[0]),
    moveY: Math.tanh(out[1]),
    run: sigmoid(out[2]),
    rest: sigmoid(out[3]),
    reproduceDesire: sigmoid(out[4]),
    searchDrive: sigmoid(out[5]),
    flee: sigmoid(out[6]),
    hide: sigmoid(out[7]),
  }
}

/** A child brain: `brain`'s weights, each independently mutated with
 * probability net.js's MUTATION_RATE. */
export function mutateBrain(brain, rng) {
  return mutateNet(brain, rng)
}
