// The fox genome. Unlike a rabbit - whose whole personality is an opaque
// neural net (see ./brain.js) - a fox is defined by a handful of named,
// readable dials: speed, vision, camouflage, metabolism, desire to hunt,
// pack tendency, stamina and fecundity. Issue #11 asked for "parameters that
// control how bitey it gets", and explicit genes make that legible: you can
// look at a fox and see *why* it hunts the way it does, and watch those
// numbers drift across generations in the population panel.
//
// Every gene is stored 0..1 (the genome's own units) and mapped to real sim
// units by foxStats(). Children inherit their parent's genes with small
// gaussian mutations, exactly like rabbit brain weights - same evolutionary
// loop, different representation.

/** Display metadata for the genes, in inspector order. `high`/`low` are the
 * plain-English readings the UI and describeFox() use, so the wording lives
 * next to the gene rather than being duplicated per call site. */
export const FOX_GENE_META = [
  { key: 'speed', label: 'Speed', color: 'rgb(251,146,60)', high: 'quick over open ground', low: 'slow, plodding' },
  { key: 'vision', label: 'Vision', color: 'rgb(250,204,21)', high: 'spots prey from far off', low: 'short-sighted' },
  { key: 'camouflage', label: 'Camouflage', color: 'rgb(163,163,163)', high: 'creeps up almost unseen', low: 'obvious from a distance' },
  { key: 'metabolism', label: 'Metabolism', color: 'rgb(248,113,113)', high: 'burns hot, feasts hard', low: 'frugal, lean living' },
  { key: 'bloodlust', label: 'Desire to hunt', color: 'rgb(220,38,38)', high: 'kills for the sake of it', low: 'only hunts when hungry' },
  { key: 'packTendency', label: 'Pack tendency', color: 'rgb(167,139,250)', high: 'hunts with the pack', low: 'a loner' },
  { key: 'stamina', label: 'Stamina', color: 'rgb(56,189,248)', high: 'chases relentlessly', low: 'winded after a short dash' },
  { key: 'fecundity', label: 'Fecundity', color: 'rgb(244,114,182)', high: 'breeds readily', low: 'breeds rarely' },
]

export const FOX_GENE_KEYS = FOX_GENE_META.map((m) => m.key)

// Fresh foxes are drawn around the middle of each range rather than
// uniformly across 0..1: a founder population of extremes would decide the
// simulation by spawn luck instead of by selection. Mutation still reaches
// the extremes over generations - that's the point - it just has to get
// there.
const FOUNDER_SPREAD = 0.34 // +/- around 0.5

const MUTATION_RATE = 0.3 // per gene, per birth
const MUTATION_STDDEV = 0.09

function clamp01(v) {
  return Math.min(1, Math.max(0, v))
}

// Box-Muller, matching brain.js's mutation noise: gaussian rather than
// uniform, so small drifts are common and big jumps are rare.
function gaussian(rng) {
  const u1 = Math.max(1e-9, rng())
  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/** A founder fox's genes, using `rng` (a 0..1 generator). */
export function createFoxGenes(rng) {
  const genes = {}
  for (const key of FOX_GENE_KEYS) genes[key] = clamp01(0.5 + (rng() * 2 - 1) * FOUNDER_SPREAD)
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
export const FOX_ENERGY_MAX = 120

const PROWL_TILES_PER_TICK = [0.3, 0.6] // at speed 0 -> 1
const SPRINT_MULTIPLIER = 2.05
const VISION_TILES = [4, 12]
const KILL_ENERGY = [30, 62] // by metabolism: burns hot, but strips a carcass better
const UPKEEP_PER_SEC = [0.34, 0.86] // by metabolism, before the gene surcharge
const SPRINT_UPKEEP_MULTIPLIER = 2.2
const SPRINT_TICKS = [14, 58] // by stamina - how long a chase can be pressed
const BREED_ENERGY = [104, 76] // by fecundity: eager foxes breed at lower reserves
const GESTATION_MS = [52000, 34000] // by fecundity

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
  const geneCost = 1 + 0.4 * genes.speed + 0.3 * genes.vision + 0.22 * genes.camouflage + 0.18 * genes.stamina
  return {
    prowlTilesPerTick: lerp(PROWL_TILES_PER_TICK[0], PROWL_TILES_PER_TICK[1], genes.speed),
    sprintTilesPerTick: lerp(PROWL_TILES_PER_TICK[0], PROWL_TILES_PER_TICK[1], genes.speed) * SPRINT_MULTIPLIER,
    visionRadius: lerp(VISION_TILES[0], VISION_TILES[1], genes.vision),
    // How close this fox gets before a rabbit notices it, as a fraction of
    // the rabbit's own predator-spotting range (see PREY_ALERT_RADIUS in
    // simulation.js). A fully camouflaged fox is on top of its prey before
    // the rabbit reacts at all.
    stealthFactor: lerp(1, 0.22, genes.camouflage),
    energyPerKill: lerp(KILL_ENERGY[0], KILL_ENERGY[1], genes.metabolism),
    upkeepPerSec: lerp(UPKEEP_PER_SEC[0], UPKEEP_PER_SEC[1], genes.metabolism) * geneCost,
    sprintUpkeepMultiplier: SPRINT_UPKEEP_MULTIPLIER,
    // Above this energy a fox stops bothering to chase. A bloodlust of 1
    // sits above FOX_ENERGY_MAX, i.e. it hunts even with a full belly.
    huntBelowEnergy: lerp(46, FOX_ENERGY_MAX + 10, genes.bloodlust),
    maxSprintTicks: Math.round(lerp(SPRINT_TICKS[0], SPRINT_TICKS[1], genes.stamina)),
    // Pack tendency does two things: it pulls idle foxes toward each other,
    // and it makes a chase faster when a packmate is close enough to help
    // cut the rabbit off.
    packRadius: lerp(6, 18, genes.packTendency),
    packSpeedBonus: lerp(0, 0.3, genes.packTendency),
    breedEnergy: lerp(BREED_ENERGY[0], BREED_ENERGY[1], genes.fecundity),
    gestationMs: lerp(GESTATION_MS[0], GESTATION_MS[1], genes.fecundity),
  }
}

/**
 * A 0..1 "how frightening is this individual" score, for the UI. Weighted
 * toward the genes a rabbit would actually care about: how fast it closes,
 * how far it sees, how late you notice it, and how readily it attacks.
 */
export function foxMenace(genes) {
  const g = genes
  return clamp01(0.34 * g.speed + 0.22 * g.vision + 0.2 * g.camouflage + 0.16 * g.bloodlust + 0.08 * g.stamina)
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
  return `This fox is ${best.high} and ${second.high}, but ${worst.low}. ${verdict}`
}

/** Short "what this gene is doing right now" notes for the inspector. */
export function describeFoxStats(genes) {
  const s = foxStats(genes)
  return [
    `Sees prey ${s.visionRadius.toFixed(1)} tiles away, and closes at ${s.sprintTilesPerTick.toFixed(2)} tiles/tick flat out (a running rabbit does 1.00).`,
    `Rabbits only notice it at ${Math.round(s.stealthFactor * 100)}% of their normal spotting range.`,
    `Burns ${s.upkeepPerSec.toFixed(2)} energy/sec prowling and gains ${Math.round(s.energyPerKill)} per kill, so it needs a rabbit every ~${Math.round(s.energyPerKill / s.upkeepPerSec)}s to break even.`,
    `Hunts whenever its energy is below ${Math.round(s.huntBelowEnergy)} (${levelWord(genes.bloodlust)} desire to hunt), and can press a chase for ${s.maxSprintTicks} ticks before it has to break off.`,
  ]
}
