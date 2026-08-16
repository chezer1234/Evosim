// The fox's *body*. Its behaviour lives in a neural net now (see
// ./foxBrain.js) - what this file describes is the animal that net is
// driving: how fast it moves, how far it sees and smells, how much it burns
// standing still, how long it can press a chase, and how readily it turns a
// full belly into cubs.
//
// That split matches the rabbits (an opaque net for decisions, an explicit
// gene vector for senses) and it is the reason the old `bloodlust` gene is
// gone: "how badly do I want to kill this rabbit" is an opinion, and
// opinions belong in the net, where they can depend on how hungry the fox
// is, how far off the rabbit is and whether the pack is with it, instead of
// being one fixed number per lineage.
//
// Every gene is stored 0..1 (the genome's own units) and mapped to real sim
// units by foxStats(). Children inherit their parent's genes with small
// gaussian mutations, exactly like both species' brain weights - same
// evolutionary loop, different representation.

import { canCrossOpenWater, canSwim, describeSwimming, swimDrainFactor, swimSpeedFactor } from './water.js'

/** Display metadata for the genes, in inspector order. `high`/`low` are the
 * plain-English readings the UI and describeFox() use, so the wording lives
 * next to the gene rather than being duplicated per call site. Both are
 * *verb phrases* ("covers open ground quickly", not "quick over open
 * ground"): describeFox strings three of them together, and a mix of verbs
 * and adjectives there reads as broken English. */
export const FOX_GENE_META = [
  { key: 'speed', label: 'Speed', color: 'rgb(251,146,60)', high: 'covers open ground quickly', low: 'plods' },
  { key: 'vision', label: 'Vision & nose', color: 'rgb(250,204,21)', high: 'spots prey from far off and smells it through the trees', low: 'is short-sighted, with no better a nose' },
  { key: 'camouflage', label: 'Camouflage', color: 'rgb(163,163,163)', high: 'creeps up almost unseen', low: 'is obvious from a distance' },
  { key: 'metabolism', label: 'Metabolism', color: 'rgb(248,113,113)', high: 'burns hot and feasts hard', low: 'lives lean and frugally' },
  { key: 'packTendency', label: 'Pack instinct', color: 'rgb(167,139,250)', high: 'keeps track of the whole pack', low: 'notices only what is under its nose' },
  { key: 'stamina', label: 'Stamina', color: 'rgb(56,189,248)', high: 'chases relentlessly', low: 'is winded after a short dash' },
  { key: 'fecundity', label: 'Fecundity', color: 'rgb(244,114,182)', high: 'breeds readily', low: 'breeds rarely' },
  { key: 'swimming', label: 'Swimming', color: 'rgb(56,189,248)', high: 'follows prey straight into the lake', low: 'will not get its feet wet - water stops it dead' },
]

export const FOX_GENE_KEYS = FOX_GENE_META.map((m) => m.key)

// Fresh foxes are drawn around the middle of each range rather than
// uniformly across 0..1: a founder population of extremes would decide the
// simulation by spawn luck instead of by selection. Mutation still reaches
// the extremes over generations - that's the point - it just has to get
// there.
const FOUNDER_SPREAD = 0.34 // +/- around the gene's founder mean

// Founder *weights* (issue #14): the foxes you drop on the map start
// slower, hungrier and slower to breed than the 0.5 midpoint, because a
// founder pack drawn at the middle of every range wiped the rabbits out
// before the rabbit gene pool could respond at all. This is only the
// starting prior - mutation is untouched and unbounded within 0..1, so a
// lineage can still evolve back toward fast legs, a frugal gut or a short
// gestation if the ecosystem rewards it. Genes not listed start at 0.5.
//
// Speed and fecundity were nudged back up when the foxes got brains: a
// founder pack at speed 0.34 could not run down *any* rabbit that saw it
// coming, so five founders on a big island reliably starved before their
// genes could drift anywhere interesting. They still start below the
// midpoint - a fresh fox is not a match for a running rabbit in a straight
// line - just not hopeless.
const FOUNDER_MEAN = {
  speed: 0.4, // slower than a bolting rabbit; sprinting still has to be evolved for
  metabolism: 0.5,
  fecundity: 0.36, // longer gestation and a higher bar to breed at all
  // Lower than the rabbits' own founder mean (0.28, see rabbit.js), and
  // below the usable threshold either way: a lake should start out as a
  // place prey escapes to, and a fox lineage should have to earn its way in
  // after the rabbits have already learned to use the water.
  swimming: 0.22,
}

const MUTATION_RATE = 0.3 // per gene, per birth
const MUTATION_STDDEV = 0.09

function clamp01(v) {
  return Math.min(1, Math.max(0, v))
}

// Box-Muller, matching net.js's mutation noise: gaussian rather than
// uniform, so small drifts are common and big jumps are rare.
function gaussian(rng) {
  const u1 = Math.max(1e-9, rng())
  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/** A founder fox's genes, using `rng` (a 0..1 generator). */
export function createFoxGenes(rng) {
  const genes = {}
  for (const key of FOX_GENE_KEYS) {
    const mean = FOUNDER_MEAN[key] ?? 0.5
    genes[key] = clamp01(mean + (rng() * 2 - 1) * FOUNDER_SPREAD)
  }
  return genes
}

/** A cub's genes: the parent's, each independently mutated with probability
 * MUTATION_RATE. Never mutates the parent in place. */
export function mutateFoxGenes(genes, rng) {
  const out = {}
  for (const key of FOX_GENE_KEYS) {
    out[key] = rng() < MUTATION_RATE ? clamp01(genes[key] + gaussian(rng) * MUTATION_STDDEV) : genes[key]
  }
  return out
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

// ============================ Derived stats =============================
// Sim-unit constants. Tiles-per-tick numbers are directly comparable to
// rabbits: a rabbit walks 0.5 tiles/tick and runs 1.0 (see stepEveryTicks in
// simulation.js), so a mid-speed fox out-walks a rabbit but only an
// above-average one can run a fleeing rabbit down in a straight line.
//
// The energy numbers were reworked when the foxes got brains. A fox's tank
// is much bigger and its upkeep much lower than it was, because the old fox
// was on a ~100 second timer from full: on a big island, five scattered
// founders simply starved before they found their first rabbit, which is
// not a predator/prey dynamic, it's a stopwatch. A fox now has real runway
// to search - and, if its brain has evolved to lie up between meals,
// several minutes more on top (see restUpkeepFactor).
export const FOX_ENERGY_MAX = 170

const PROWL_TILES_PER_TICK = [0.3, 0.6] // at speed 0 -> 1
const SPRINT_MULTIPLIER = 1.95
const VISION_TILES = [4, 12]
// How much of its vision a fox keeps while standing in forest (issue #14):
// under a canopy it loses 45% of its spotting range, which is what makes
// woodland a place a rabbit can actually live rather than just the place the
// apples are.
export const FOREST_VISION_FACTOR = 0.55
// And what a rabbit's scent is worth under the same trees. Undergrowth
// muddles a smell far less than a canopy blocks a sightline, which is
// precisely why a fox has a nose at all: in woodland it is the sense that
// still works.
export const FOREST_SCENT_FACTOR = 0.85
// The nose. It reaches about as far as the fox's eyes, but it says something
// different: a *bearing* rather than a position (and a noisy one - see
// SCENT_JITTER in simulation.js), and it works where sight does not. Under
// the canopy a fox loses 45% of its vision and only 15% of its nose, so
// woodland is where a fox hunts by smell and open ground is where it hunts
// by eye. That is what turns its search into searching rather than
// wandering, which is what founders on a big island need to survive long
// enough to matter.
//
// Derived from the vision gene rather than being a gene of its own - "sharp
// senses" is one investment, and it is priced as one in geneCost below - so
// a short-sighted fox is short-nosed too. A longer nose was tried and it
// simply wiped the rabbits out: at 1.7x sight a pack could find the last
// five rabbits on the island, which ends the run instead of cycling it. It
// came down again (1.0 -> 0.9) when the swim gene landed and a shoreline
// stopped being something a cornered rabbit could cross.
const SCENT_VISION_MULTIPLIER = 0.9
const KILL_ENERGY = [30, 55] // by metabolism: burns hot, but strips a carcass better
const UPKEEP_PER_SEC = [0.10, 0.26] // by metabolism, before the gene surcharge
const SPRINT_UPKEEP_MULTIPLIER = 2.2
// What lying up is worth. A resting fox does not move and cannot find
// anything, so this is a genuine trade - wait out a lean patch on half
// rations, or spend the reserve looking. Which one a lineage picks is the
// most interesting thing its brain can evolve (see REST_OUTPUT in
// foxBrain.js).
const REST_UPKEEP_FACTOR = 0.45
const SPRINT_TICKS = [14, 58] // by stamina - how long a chase can be pressed
// Deliberately above FOX_START_ENERGY for all but the most fecund founder:
// a fox you drop on the map has to catch something before it turns into two
// foxes, or five scattered founders quietly become eleven before a single
// rabbit has been eaten.
const BREED_ENERGY = [165, 140] // by fecundity: eager foxes breed at lower reserves
// Gestation, shortened at both ends: a fox line that has to hold a
// pregnancy for the best part of two minutes cannot answer a rabbit boom
// before it has already turned into a bust, so the population never cycles -
// it just drifts down. Cubs still cost energy and a cub still has to feed
// itself, so this is a faster loop rather than a free one.
const GESTATION_MS = [58000, 30000] // by fecundity

/**
 * Everything the sim actually reads, derived from the 0..1 genes. Pure and
 * cheap - called per decision tick rather than cached, so a gene edit can
 * never go stale.
 *
 * The load-bearing trade-off lives in `upkeepPerSec`: big eyes, fast legs
 * and a good coat all cost energy to run, so a fox that maxes every gene
 * starves between kills. That surcharge is what stops evolution from just
 * driving every dial to 1.
 */
export function foxStats(genes) {
  // Speed is priced quadratically rather than linearly (issue #14): a
  // plodding fox pays about what it always did, but every step toward a
  // full sprint gene costs disproportionately more, so "fast" has to be
  // paid for in rabbits rather than being a free upgrade every lineage
  // drifts into. At speed 1 the surcharge is 0.85 where it used to be 0.40.
  const speedCost = 0.3 * genes.speed + 0.55 * genes.speed * genes.speed
  // Vision's share went up (0.30 -> 0.45) when it started buying a nose as
  // well as eyes: senses are the strongest thing a fox can invest in now, so
  // they have to be the dearest to run.
  const geneCost = 1 + speedCost + 0.45 * genes.vision + 0.22 * genes.camouflage + 0.18 * genes.stamina
  const visionRadius = lerp(VISION_TILES[0], VISION_TILES[1], genes.vision)
  return {
    prowlTilesPerTick: lerp(PROWL_TILES_PER_TICK[0], PROWL_TILES_PER_TICK[1], genes.speed),
    sprintTilesPerTick: lerp(PROWL_TILES_PER_TICK[0], PROWL_TILES_PER_TICK[1], genes.speed) * SPRINT_MULTIPLIER,
    visionRadius,
    scentRadius: visionRadius * SCENT_VISION_MULTIPLIER,
    // How close this fox gets before a rabbit notices it, as a fraction of
    // the rabbit's own predator-spotting range (see PREY_ALERT_RADIUS in
    // simulation.js). A fully camouflaged fox is on top of its prey before
    // the rabbit reacts at all.
    stealthFactor: lerp(1, 0.22, genes.camouflage),
    energyPerKill: lerp(KILL_ENERGY[0], KILL_ENERGY[1], genes.metabolism),
    upkeepPerSec: lerp(UPKEEP_PER_SEC[0], UPKEEP_PER_SEC[1], genes.metabolism) * geneCost,
    sprintUpkeepMultiplier: SPRINT_UPKEEP_MULTIPLIER,
    restUpkeepFactor: REST_UPKEEP_FACTOR,
    maxSprintTicks: Math.round(lerp(SPRINT_TICKS[0], SPRINT_TICKS[1], genes.stamina)),
    // Pack instinct is the *hardware* half of hunting together: how far away
    // a fox can keep track of a packmate, and how much faster a chase closes
    // with one alongside. Whether it actually converges on the pack is its
    // brain's call (see GROUP_OUTPUT in foxBrain.js).
    packRadius: lerp(6, 18, genes.packTendency),
    packSpeedBonus: lerp(0, 0.3, genes.packTendency),
    breedEnergy: lerp(BREED_ENERGY[0], BREED_ENERGY[1], genes.fecundity),
    gestationMs: lerp(GESTATION_MS[0], GESTATION_MS[1], genes.fecundity),
    // Water (see water.js). A fox that cannot swim is stopped dead by a lake
    // shore, which is precisely what makes swimming worth a rabbit evolving:
    // the refuge only works while the predator is still landlocked.
    swimSkill: genes.swimming ?? 0,
    canSwim: canSwim(genes.swimming ?? 0),
    // And the sea: a fox only follows prey to the next island if its own swim
    // gene has come as far as theirs (see OPEN_WATER_MIN_SKILL). Until it
    // does, an island a warren has reached is an island without foxes on it.
    canCrossOpenWater: canCrossOpenWater(genes.swimming ?? 0),
    swimSpeedFactor: swimSpeedFactor(genes.swimming ?? 0),
    swimUpkeepMultiplier: swimDrainFactor(genes.swimming ?? 0),
  }
}

/**
 * A 0..1 "how frightening is this individual" score, for the UI. Weighted
 * toward the genes a rabbit would actually care about: how fast it closes,
 * how far it senses, and how late you notice it. What it *does* with that
 * body is its brain's business (see computeFoxTraits in foxInsight.js), so
 * this is the body's half of the answer.
 */
export function foxMenace(genes) {
  const g = genes
  return clamp01(0.38 * g.speed + 0.26 * g.vision + 0.24 * g.camouflage + 0.12 * g.stamina)
}

function levelWord(v) {
  return v > 0.66 ? 'high' : v < 0.34 ? 'low' : 'moderate'
}

/** A plain-English read on an individual's genes: its two standout traits,
 * its weakest, and what that means in practice. */
export function describeFox(genes) {
  const sorted = FOX_GENE_META.map((m) => ({ ...m, value: genes[m.key] })).sort((a, b) => b.value - a.value)
  const best = sorted[0]
  const second = sorted[1]
  const worst = sorted[sorted.length - 1]
  const menace = foxMenace(genes)
  const verdict =
    menace > 0.66
      ? 'A nightmare for anything with long ears.'
      : menace < 0.34
        ? 'More of a scavenger than a terror - rabbits often get away.'
        : 'A workable hunter: it eats, but it has to earn every meal.'
  return `This fox ${best.high} and ${second.high}, but ${worst.low}. ${verdict}`
}

/** Short "what this gene is doing right now" notes for the inspector. */
export function describeFoxStats(genes) {
  const s = foxStats(genes)
  return [
    `Sees prey ${s.visionRadius.toFixed(1)} tiles off, or only ${(s.visionRadius * FOREST_VISION_FACTOR).toFixed(1)} under forest cover - but smells it at ${s.scentRadius.toFixed(1)} tiles, and still ${(s.scentRadius * FOREST_SCENT_FACTOR).toFixed(1)} in the trees, which is what makes woodland huntable at all.`,
    `Closes at ${s.sprintTilesPerTick.toFixed(2)} tiles/tick flat out (a running rabbit does 1.00), and rabbits only notice it at ${Math.round(s.stealthFactor * 100)}% of their normal spotting range.`,
    `Burns ${s.upkeepPerSec.toFixed(2)} energy/sec prowling (${(s.upkeepPerSec * s.restUpkeepFactor).toFixed(2)} lying up) and gains ${Math.round(s.energyPerKill)} per kill, so it needs a rabbit every ~${Math.round(s.energyPerKill / s.upkeepPerSec)}s to break even.`,
    `Can press a chase for ${s.maxSprintTicks} ticks before breaking off, and needs ${Math.round(s.breedEnergy)} energy to start a ${Math.round(s.gestationMs / 1000)}s pregnancy (${levelWord(genes.fecundity)} fecundity).`,
    describeSwimming(s.swimSkill),
  ]
}
