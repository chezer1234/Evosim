// Tiny hand-rolled feedforward neural net used as each rabbit's "brain" /
// genome. No training or backprop here: weights are randomized at spawn,
// and a child inherits its parent's weights with small random mutations.
// Selection happens implicitly through who survives and reproduces - see
// docs/plans/issue-2-species-rabbits.md for the reasoning.

export const INPUT_SIZE = 7 // bias, energy, dx, dy, dist-to-apple, onWater, noise
export const HIDDEN_SIZE = 8
export const OUTPUT_SIZE = 5 // moveX, moveY, run, rest, reproduceDesire

const WEIGHT_RANGE = 1.5

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
  }
}

const MUTATION_RATE = 0.15
const MUTATION_STDDEV = 0.35
const WEIGHT_CLAMP = 3

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
