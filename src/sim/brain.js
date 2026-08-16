// Tiny hand-rolled feedforward neural net used as each rabbit's "brain" /
// genome. No training or backprop here: weights are randomized at spawn,
// and a child inherits its parent's weights with small random mutations.
// Selection happens implicitly through who survives and reproduces - see
// docs/plans/issue-2-species-rabbits.md for the reasoning.

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
// Indices within b2/w2 that are called out by name because createBrain
// nudges their initial bias (see below) and simulation.js reads them as
// genuine evolvable traits rather than hardcoded behavior.
const SEARCH_DRIVE_OUTPUT = 5
const FLEE_OUTPUT = 6
const HIDE_OUTPUT = 7

const WEIGHT_RANGE = 1.5
// Freshly spawned brains start with searchDrive biased toward "yes" - real
// rabbits spend most of their time actively foraging, not sitting still, so
// that should be the default a genome has to evolve *away* from rather than
// a coin flip it has to discover. Random mutation can still push any given
// lineage's search drive down (or further up) over generations; this just
// sets the starting prior. See docs/plans/issue-2-species-rabbits.md.
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

function randWeight(rng) {
  return (rng() * 2 - 1) * WEIGHT_RANGE
}

/** A fresh brain with random weights, using `rng` (a 0..1 generator, e.g.
 * `Math.random` or a seeded rng). */
export function createBrain(rng) {
  const w1 = new Float32Array(INPUT_SIZE * HIDDEN_SIZE)
  const b1 = new Float32Array(HIDDEN_SIZE)
  const w2 = new Float32Array(HIDDEN_SIZE * OUTPUT_SIZE)
  const b2 = new Float32Array(OUTPUT_SIZE)
  for (let i = 0; i < w1.length; i++) w1[i] = randWeight(rng)
  for (let i = 0; i < b1.length; i++) b1[i] = randWeight(rng)
  for (let i = 0; i < w2.length; i++) w2[i] = randWeight(rng)
  for (let i = 0; i < b2.length; i++) b2[i] = randWeight(rng)
  b2[SEARCH_DRIVE_OUTPUT] += SEARCH_DRIVE_INITIAL_BIAS
  b2[FLEE_OUTPUT] += FLEE_INITIAL_BIAS
  b2[HIDE_OUTPUT] += HIDE_INITIAL_BIAS
  return { w1, b1, w2, b2 }
}

function sigmoid(x) {
  return 1 / (1 + Math.exp(-x))
}

// Scratch buffer for the hidden layer - reused across calls since think()
// is synchronous and never re-entrant (one rabbit's forward pass completes
// before the next starts).
const hiddenBuf = new Float32Array(HIDDEN_SIZE)

/**
 * Run the net forward. `inputs` must have INPUT_SIZE entries, each roughly
 * in -1..1. Returns the rabbit's intent for this decision tick; callers
 * still enforce hard constraints (e.g. reproduceDesire only matters above
 * the energy threshold).
 */
export function think(brain, inputs) {
  const { w1, b1, w2, b2 } = brain
  for (let h = 0; h < HIDDEN_SIZE; h++) {
    let sum = b1[h]
    for (let i = 0; i < INPUT_SIZE; i++) sum += inputs[i] * w1[i * HIDDEN_SIZE + h]
    hiddenBuf[h] = Math.tanh(sum)
  }
  const out = new Float32Array(OUTPUT_SIZE)
  for (let o = 0; o < OUTPUT_SIZE; o++) {
    let sum = b2[o]
    for (let h = 0; h < HIDDEN_SIZE; h++) sum += hiddenBuf[h] * w2[h * OUTPUT_SIZE + o]
    out[o] = sum
  }
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

const MUTATION_RATE = 0.15
const MUTATION_STDDEV = 0.35
// Exported so the brain-diagram UI can normalize edge weights against the
// same ceiling mutation is clamped to, instead of guessing a scale. It has
// to leave room for a founder's own starting bias (WEIGHT_RANGE plus the
// largest initial bias above, i.e. 3.5), or a fresh brain would be born
// outside the range its own children are clamped to.
export const WEIGHT_CLAMP = 4

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}

// Box-Muller, for gaussian-distributed mutation noise rather than uniform.
function gaussian(rng) {
  const u1 = Math.max(1e-9, rng())
  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

function mutateArray(src, rng) {
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) {
    out[i] = rng() < MUTATION_RATE ? clamp(src[i] + gaussian(rng) * MUTATION_STDDEV, -WEIGHT_CLAMP, WEIGHT_CLAMP) : src[i]
  }
  return out
}

/** A child brain: `brain`'s weights, each independently mutated with
 * probability MUTATION_RATE. */
export function mutateBrain(brain, rng) {
  return {
    w1: mutateArray(brain.w1, rng),
    b1: mutateArray(brain.b1, rng),
    w2: mutateArray(brain.w2, rng),
    b2: mutateArray(brain.b2, rng),
  }
}
