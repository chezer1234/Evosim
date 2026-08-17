// The fish: the first thing in this world that lives entirely in the water,
// and the reason a fox can eat on an island with no rabbits on it.
//
// A fish is deliberately the *simplest* animal here. Rabbits and foxes carry
// a neural net because the interesting question about them is what they
// decide; the interesting question about a fish is what it can do, and that
// is hardware. So a fish is a gene vector and nothing else (see fishStats
// below for what each gene buys), and its behaviour is three rules that never
// evolve: eat the algae, hold with the shoal, break for open water when
// something big comes to the bank. Everything a lineage can change about
// itself, it changes through those four numbers.
//
// That is a design decision rather than a shortcut: the fish are the bottom
// of the new food chain, and a bottom that thinks as hard as its predators do
// is a bottom that can out-evolve them and turn the shallows into a wall of
// uncatchable fish. What it *can* do is get faster, twitchier and more
// tightly shoaled - which is exactly the arms race worth having with a fox
// that has learned to fish.
//
// Same representation as every other genome in the project: 0..1 genes,
// gaussian mutation per birth, mapped to sim units by fishStats().

/** Display metadata for the genes, in inspector order. `high`/`low` are the
 * plain-English readings describeFish() strings together, so they are verb
 * phrases like the fox's. */
export const FISH_GENE_META = [
  { key: 'speed', label: 'Speed', color: 'rgb(56,189,248)', high: 'flicks clear of a paw before it lands', low: 'idles about in easy reach' },
  { key: 'shoaling', label: 'Shoaling', color: 'rgb(129,140,248)', high: 'holds tight to the shoal, and sees what the shoal sees', low: 'feeds alone' },
  { key: 'wariness', label: 'Wariness', color: 'rgb(250,204,21)', high: 'bolts at the first shadow on the bank', low: 'ignores whatever is standing over it' },
  { key: 'fecundity', label: 'Fecundity', color: 'rgb(244,114,182)', high: 'spawns often', low: 'spawns rarely' },
]

export const FISH_GENE_KEYS = FISH_GENE_META.map((m) => m.key)

const FOUNDER_SPREAD = 0.3
// Founders sit at the middle of every range. Unlike the rabbits and foxes -
// who are weighted away from the midpoint so a scatter of them doesn't decide
// the run on spawn luck - a fish has no gene that is dangerous to start with:
// the shallows are not a fight it can win outright, they are a place it gets
// eaten from more or less slowly.
const MUTATION_RATE = 0.3
const MUTATION_STDDEV = 0.09

/** A fish's tank. Small: a fish is a mouthful, not a meal, and it lives close
 * enough to its food that a big reserve would only mean a longer death. */
export const FISH_ENERGY_MAX = 40

function clamp01(v) {
  return Math.min(1, Math.max(0, v))
}

// Box-Muller, matching net.js/fox.js/rabbit.js: small drifts common, big
// jumps rare.
function gaussian(rng) {
  const u1 = Math.max(1e-9, rng())
  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/** A founder fish's genes, using `rng` (a 0..1 generator). */
export function createFishGenes(rng) {
  const genes = {}
  for (const key of FISH_GENE_KEYS) genes[key] = clamp01(0.5 + (rng() * 2 - 1) * FOUNDER_SPREAD)
  return genes
}

/** Fry inherit the parent's genes, each independently mutated with
 * probability MUTATION_RATE. Never mutates the parent in place. */
export function mutateFishGenes(genes, rng) {
  const out = {}
  for (const key of FISH_GENE_KEYS) {
    out[key] = rng() < MUTATION_RATE ? clamp01(genes[key] + gaussian(rng) * MUTATION_STDDEV) : genes[key]
  }
  return out
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

// ============================ Derived stats =============================
// Cadences are in decision ticks per tile, directly comparable with the other
// species: a rabbit walks a tile every 2 ticks and the best swimmer among
// them manages 2, while a fox prowls at 0.3-0.6 tiles a tick. A fish is the
// fastest thing in the water by a distance - which is the point. It has no
// burrow, no alarm call and no brain; being quick is the whole defence.
const STROKE_TICKS = [3, 1] // at speed 0 -> 1
const ALERT_TILES = [2, 6.5] // how far off it notices something on the bank
const SHOAL_TILES = [0, 6] // how far it will hold station with its neighbours
// Being fast and twitchy costs upkeep, the same way a fox's senses do: a fish
// that maxed every gene would need to feed more or less constantly, and the
// shallows only grow so much (see FORAGE_REGROW_MS in shallows.js).
const BASE_UPKEEP_PER_SEC = 0.12
// The share of grabs a fish slips out of on its own account, before anything
// about the fox is taken into account (see FISH_CATCH_CHANCE in
// simulation.js). Even a sluggish one is not simply picked up.
const EVASION = [0.08, 0.6]
const BREED_ENERGY = [34, 26] // by fecundity: eager fish spawn on less
const BREED_COOLDOWN_MS = [96000, 44000] // by fecundity

/** Everything the sim reads off the genes. Pure and cheap, but cached on the
 * entity at birth (see spawnFish) because the shoaling scan reads every other
 * fish's stats on every decision tick. */
export function fishStats(genes) {
  return {
    strokeTicks: Math.max(1, Math.round(lerp(STROKE_TICKS[0], STROKE_TICKS[1], genes.speed))),
    alertRadius: lerp(ALERT_TILES[0], ALERT_TILES[1], genes.wariness),
    shoalRadius: lerp(SHOAL_TILES[0], SHOAL_TILES[1], genes.shoaling),
    // Collective vigilance: a fish in a shoal is watching with everyone
    // else's eyes, so a tight shoal spots the fox sooner. It is also, of
    // course, twenty fish in one place for the fox to find - which is the
    // trade the shoaling gene actually makes.
    shoalAlertBonus: lerp(0, 0.5, genes.shoaling),
    upkeepPerSec: BASE_UPKEEP_PER_SEC * (1 + 0.55 * genes.speed + 0.3 * genes.wariness),
    evasion: lerp(EVASION[0], EVASION[1], genes.speed),
    breedEnergy: lerp(BREED_ENERGY[0], BREED_ENERGY[1], genes.fecundity),
    breedCooldownMs: lerp(BREED_COOLDOWN_MS[0], BREED_COOLDOWN_MS[1], genes.fecundity),
  }
}

/** A plain-English read on an individual, for the inspector: its standout
 * gene, its weakest, and what that adds up to. */
export function describeFish(genes) {
  const sorted = FISH_GENE_META.map((m) => ({ ...m, value: genes[m.key] })).sort((a, b) => b.value - a.value)
  const best = sorted[0]
  const worst = sorted[sorted.length - 1]
  const slippery = clamp01(0.6 * genes.speed + 0.4 * genes.wariness)
  const verdict =
    slippery > 0.66
      ? 'Hard work for anything hunting from the bank.'
      : slippery < 0.34
        ? 'An easy meal for anything that reaches in.'
        : 'Catchable, but not for free.'
  return `This fish ${best.high}, but ${worst.low}. ${verdict}`
}

/** Short "what these genes are doing right now" notes for the inspector. */
export function describeFishStats(genes) {
  const s = fishStats(genes)
  return [
    `Covers a tile of water every ${s.strokeTicks} decision tick${s.strokeTicks === 1 ? '' : 's'} (a swimming rabbit needs 2 at its very best), and slips ${Math.round(s.evasion * 100)}% of the grabs made at it.`,
    `Notices a fox ${s.alertRadius.toFixed(1)} tiles off, or ${(s.alertRadius * (1 + s.shoalAlertBonus)).toFixed(1)} with the shoal around it - the one thing shoaling buys, against the shoal being a crowd for the fox to find.`,
    `Burns ${s.upkeepPerSec.toFixed(2)} energy/sec, so it needs a patch of algae every ~${Math.round(10 / s.upkeepPerSec)}s to hold station.`,
    `Spawns at ${Math.round(s.breedEnergy)} energy, and not again for ${Math.round(s.breedCooldownMs / 1000)}s.`,
  ]
}
