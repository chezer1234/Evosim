// The feedforward net both species' brains are built from. There is nothing
// clever in here - one hidden layer, tanh inside, no training or backprop -
// but it lives on its own because rabbits and foxes now both think with one
// (see ./brain.js and ./foxBrain.js) and they must inherit and mutate by
// *exactly* the same rules. Two hand-rolled copies of gaussian mutation
// would drift apart the first time either was tuned, and "the foxes evolve
// differently because their mutation code is a slightly different fork" is
// the least interesting reason a simulation could produce different
// dynamics.
//
// A net is a plain object of Float32Arrays - { w1, b1, w2, b2 } - and every
// function here is pure: mutation returns a new net and never touches the
// parent's arrays.

const WEIGHT_RANGE = 1.5
// Exported so the brain-diagram UI can normalize edge weights against the
// same ceiling mutation is clamped to, instead of guessing a scale. It has
// to leave room for a founder's own starting bias (WEIGHT_RANGE plus the
// largest initial bias either species uses, i.e. 3.5), or a fresh brain
// would be born outside the range its own children are clamped to.
export const WEIGHT_CLAMP = 4
// Per weight, per birth. Shared by both species deliberately: the rabbits
// and the foxes are running the same evolutionary loop at the same rate, so
// whichever one adapts faster is telling you something about the *selection
// pressure*, not about a constant one of them happens to have been given.
const MUTATION_RATE = 0.15
const MUTATION_STDDEV = 0.35

/** The pair as one object: the "how fast does evolution happen" dial the
 * player can move before a run (see ./scenario.js, which scales it into
 * `sim.rules.brain`), and the default mutateNet falls back to. Still one
 * setting for both species, for the reason above. */
export const NET_BASE = { mutation: { rate: MUTATION_RATE, stddev: MUTATION_STDDEV } }

function randWeight(rng) {
  return (rng() * 2 - 1) * WEIGHT_RANGE
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v))
}

/** Box-Muller, for gaussian-distributed noise rather than uniform: small
 * drifts are common and big jumps are rare. Shared with the explicit gene
 * vectors (see fox.js / rabbit.js) in spirit, and re-exported here so the
 * net's own mutation and theirs can never diverge by accident. */
export function gaussian(rng) {
  const u1 = Math.max(1e-9, rng())
  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/**
 * A fresh net with random weights, using `rng` (a 0..1 generator, e.g.
 * `Math.random` or a seeded rng).
 *
 * `outputBias` nudges individual output biases at birth - `{ 3: 2.0 }` means
 * "output 3 starts biased toward yes". Both species use it for the same
 * reason: a founder population that has to *discover* an instinct it needs
 * to survive (running from a fox, chasing a rabbit) is dead before selection
 * can act on it, so the instinct starts switched on and a lineage evolves
 * its way *off* it. See the callers for the per-output reasoning.
 */
export function createNet({ inputs, hidden, outputs }, rng, outputBias = {}) {
  const w1 = new Float32Array(inputs * hidden)
  const b1 = new Float32Array(hidden)
  const w2 = new Float32Array(hidden * outputs)
  const b2 = new Float32Array(outputs)
  for (let i = 0; i < w1.length; i++) w1[i] = randWeight(rng)
  for (let i = 0; i < b1.length; i++) b1[i] = randWeight(rng)
  for (let i = 0; i < w2.length; i++) w2[i] = randWeight(rng)
  for (let i = 0; i < b2.length; i++) b2[i] = randWeight(rng)
  for (const [index, nudge] of Object.entries(outputBias)) b2[index] += nudge
  return { w1, b1, w2, b2 }
}

// Scratch buffer for the hidden layer - reused across calls since forward()
// is synchronous and never re-entrant (one creature's pass completes before
// the next starts). Grown on demand so both species' shapes share it.
let hiddenBuf = new Float32Array(0)

/**
 * Run the net forward and return the raw output logits. `values` must have
 * `inputs` entries, each roughly in -1..1; squashing the outputs into
 * whatever the caller means by them is the caller's job (see think() and
 * foxThink()).
 */
export function forward({ w1, b1, w2, b2 }, { inputs, hidden, outputs }, values) {
  if (hiddenBuf.length < hidden) hiddenBuf = new Float32Array(hidden)
  for (let h = 0; h < hidden; h++) {
    let sum = b1[h]
    for (let i = 0; i < inputs; i++) sum += values[i] * w1[i * hidden + h]
    hiddenBuf[h] = Math.tanh(sum)
  }
  const out = new Float32Array(outputs)
  for (let o = 0; o < outputs; o++) {
    let sum = b2[o]
    for (let h = 0; h < hidden; h++) sum += hiddenBuf[h] * w2[h * outputs + o]
    out[o] = sum
  }
  return out
}

export function sigmoid(x) {
  return 1 / (1 + Math.exp(-x))
}

function mutateArray(src, rng, { rate, stddev }) {
  const out = new Float32Array(src.length)
  for (let i = 0; i < src.length; i++) {
    out[i] = rng() < rate ? clamp(src[i] + gaussian(rng) * stddev, -WEIGHT_CLAMP, WEIGHT_CLAMP) : src[i]
  }
  return out
}

/** A child net: `net`'s weights, each independently mutated with probability
 * `mutation.rate`. Never mutates the parent in place. */
export function mutateNet(net, rng, mutation = NET_BASE.mutation) {
  return {
    w1: mutateArray(net.w1, rng, mutation),
    b1: mutateArray(net.b1, rng, mutation),
    w2: mutateArray(net.w2, rng, mutation),
    b2: mutateArray(net.b2, rng, mutation),
  }
}
