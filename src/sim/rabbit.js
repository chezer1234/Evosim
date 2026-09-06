// The rabbit's *senses*, as explicit genes - the small half of a rabbit's
// inheritance. Its behaviour is still an opaque neural net (see ./brain.js):
// what this file adds is the physical hardware that net is wired to, which
// is not something a weight matrix can express. How far a rabbit can hear is
// the size of its ears, not an opinion it holds.
//
// Same representation as the fox genome (see ./fox.js): 0..1 genes, gaussian
// mutation per birth, mapped to sim units by rabbitStats(). Issue #14 asked
// for hearing that outranges sight and varies through mutation, so this is
// where "how big are its ears" lives and drifts.
//
// It is also where "can it get across that lake" lives. Swimming is the one
// gene here that founders start *below* the usable threshold on (see
// water.js): a warren has to evolve its way into the water, and the payoff -
// a fox that cannot follow - only exists for the lineages that do.

import { canCrossOpenWater, canSwim, describeSwimming, swimDrainFactor, swimSpeedFactor } from './water.js'

/** Display metadata for the sense genes, in inspector order. */
export const RABBIT_GENE_META = [
  { key: 'hearing', label: 'Hearing', color: 'rgb(147,197,253)', high: 'picks a fox out of the undergrowth long before seeing it', low: 'half-deaf, has to lay eyes on a fox to know it is there' },
  { key: 'voice', label: 'Voice', color: 'rgb(216,180,254)', high: 'thumps an alarm the whole warren hears', low: 'panics quietly, alone' },
  { key: 'swimming', label: 'Swimming', color: 'rgb(56,189,248)', high: 'takes to open water, and loses a landlocked fox in it', low: 'stays dry - the lake shore is a wall it will not cross' },
]

export const RABBIT_GENE_KEYS = RABBIT_GENE_META.map((m) => m.key)

const FOUNDER_SPREAD = 0.3 // +/- around the gene's founder mean
// Founder means. Ears and voice sit at the middle of their range; swimming
// does not, because it is meant to be something a warren *learns*. At 0.28
// (against a SWIM_MIN_SKILL of 0.35) roughly a third of the rabbits you drop
// on the island can get into water at all, and whether that third leaves
// more descendants than the dry two thirds is up to the map - a warren with
// no lake worth crossing will never select for it, and one penned against
// the water by foxes very much will.
const FOUNDER_MEAN = { swimming: 0.28 }
const MUTATION_RATE = 0.3 // per gene, per birth
const MUTATION_STDDEV = 0.09

function clamp01(v) {
  return Math.min(1, Math.max(0, v))
}

// Box-Muller, matching brain.js and fox.js: gaussian rather than uniform, so
// small drifts are common and big jumps are rare.
function gaussian(rng) {
  const u1 = Math.max(1e-9, rng())
  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/** A founder rabbit's sense genes, using `rng` (a 0..1 generator). */
export function createRabbitGenes(rng) {
  const genes = {}
  for (const key of RABBIT_GENE_KEYS) {
    const mean = FOUNDER_MEAN[key] ?? 0.5
    genes[key] = clamp01(mean + (rng() * 2 - 1) * FOUNDER_SPREAD)
  }
  return genes
}

/** A child's sense genes: the parent's, each independently mutated with
 * probability MUTATION_RATE. Never mutates the parent in place. */
export function mutateRabbitGenes(genes, rng) {
  const out = {}
  for (const key of RABBIT_GENE_KEYS) {
    out[key] = rng() < MUTATION_RATE ? clamp01(genes[key] + gaussian(rng) * MUTATION_STDDEV) : genes[key]
  }
  return out
}

// ============================ Derived stats =============================
// Hearing is deliberately the *long* sense: even a poorly-eared rabbit hears
// further than PREY_ALERT_RADIUS (6 tiles, see simulation.js), so ears are
// always the thing that saves it and eyes only ever confirm. That ordering
// is the point of issue #14 - a rabbit that only reacts to what it can see
// reacts once the fox is already inside sprinting range.
//
// The ceiling is deliberately modest (13, against a fox's 4-12 tiles of
// vision): a range that always beat the fox's own eyes made an average fox
// unable to hunt at all, and the resulting ecosystem was one where every
// fox starved. What a rabbit actually hears is this radius scaled by how
// much noise the fox is making (see foxNoiseFactor in simulation.js), so a
// slow stalker still gets close.
const HEARING_TILES = [7, 13] // at hearing 0 -> 1
// How far this rabbit's own alarm call carries. Listeners still need ears to
// pick it up (see alarmReach below), so warren-wide communication takes a
// loud caller *and* a listener who can hear it.
const CALL_TILES = [6, 14] // at voice 0 -> 1
// Decision ticks a rabbit spends per tile of water, derived from the shared
// swim curve (see water.js) against its 2-ticks-per-tile walking cadence. A
// barely-competent swimmer wallows at 7 ticks a tile - slower than anything
// else in the sim, and slow enough that a fox waiting on the bank wins - and
// a strong one is only just off its walking pace.
const SWIM_TICKS_RANGE = [2, 7]
// Keep in sync with stepEveryTicks in simulation.js - a walking rabbit steps
// every other decision tick, and the swim cadence is priced against that.
const WALK_TICKS_PER_TILE = 2

function lerp(a, b, t) {
  return a + (b - a) * t
}

/** Everything the sim reads off the sense genes. Pure and cheap - called per
 * decision tick rather than cached, exactly like foxStats(). */
export function rabbitStats(genes) {
  const skill = genes.swimming ?? 0
  return {
    hearingRadius: lerp(HEARING_TILES[0], HEARING_TILES[1], genes.hearing),
    callRadius: lerp(CALL_TILES[0], CALL_TILES[1], genes.voice),
    // The swim half (see water.js): whether it will enter water at all, how
    // many decision ticks a tile of it costs, and how much faster it burns
    // energy while it's out there.
    swimSkill: skill,
    canSwim: canSwim(skill),
    // The sea, not the lake: only a lineage that has pushed this gene near
    // the top of its range can leave the island it was born on (water.js).
    canCrossOpenWater: canCrossOpenWater(skill),
    swimStrokeTicks: Math.min(
      SWIM_TICKS_RANGE[1],
      Math.max(SWIM_TICKS_RANGE[0], Math.round(WALK_TICKS_PER_TILE / swimSpeedFactor(skill))),
    ),
    swimDrainFactor: swimDrainFactor(skill),
  }
}

/** How far apart a caller and a listener can be and still communicate: the
 * caller has to be loud enough *and* the listener sharp enough, so the
 * usable range is the average of the two. Two well-equipped rabbits talk
 * across the warren; two poorly-equipped ones only warn their neighbours. */
export function alarmReach(callerStats, listenerStats) {
  return (callerStats.callRadius + listenerStats.hearingRadius) / 2
}

/** The furthest away a rabbit could possibly be and still be heard by this
 * listener: the loudest voice the gene pool allows, against these ears. The
 * spatial index needs it to know how big a box to search before it can start
 * discarding candidates (see hearCalls in ./simulation.js), and it lives here
 * so that widening CALL_TILES widens the search with it. */
export function maxAlarmReach(listenerStats) {
  return (CALL_TILES[1] + listenerStats.hearingRadius) / 2
}

/** Short "what these ears are doing" notes for the inspector. */
export function describeRabbitSenses(genes) {
  const s = rabbitStats(genes)
  return [
    `Hears a fox up to ${s.hearingRadius.toFixed(1)} tiles off - camouflage does not help a fox here, only distance does (it can only see one at 6).`,
    `Its alarm call carries ${s.callRadius.toFixed(1)} tiles, warning rabbits that have not spotted anything themselves.`,
    s.canSwim
      ? `${describeSwimming(s.swimSkill)}${
          s.swimStrokeTicks > WALK_TICKS_PER_TILE
            ? ` A tile of water costs it ${s.swimStrokeTicks} decision ticks against ${WALK_TICKS_PER_TILE} walking on dry grass.`
            : ' At that standard it crosses water about as quickly as it walks.'
        }`
      : describeSwimming(s.swimSkill),
  ]
}
