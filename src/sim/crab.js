// The crab: the tideline animal, and the one that makes the shoreline a
// place a fox can actually make a living.
//
// A fish is safe from anything that will not get its feet wet, which is
// almost every fox ever born (see FOUNDER_MEAN in fox.js). A crab is the
// other half of that bargain: it walks out of the water to feed on the wrack
// line, where the weed is uncontested by anything that swims - and where a
// fox can simply pick it up. So the crab genome's load-bearing gene is
// `boldness`: how far from the water a lineage is prepared to feed. Nothing
// else in this simulation states a trade-off quite that plainly, and it is
// the dial the foxes are really selecting on when they work a beach.
//
// Same shape as the fish (see ./fish.js): four 0..1 genes, gaussian mutation
// per birth, no neural net. A crab's decisions are "eat, and get back to the
// water", and neither of those needs a weight matrix.

import { LAND_FORAGE_REACH } from './shallows.js'

/** Display metadata for the genes, in inspector order. */
export const CRAB_GENE_META = [
  // Deliberately not "never leaves the water" at the low end: how far it
  // actually goes is stated exactly by describeCrab's verdict below, and two
  // sentences disagreeing about it reads as a bug.
  { key: 'boldness', label: 'Boldness', color: 'rgb(251,146,60)', high: 'works the wrack line well clear of the water', low: 'is reluctant to leave the water' },
  { key: 'armour', label: 'Armour', color: 'rgb(163,163,163)', high: 'shrugs off a paw that has already landed on it', low: 'is soft-shelled, and knows it' },
  { key: 'speed', label: 'Speed', color: 'rgb(56,189,248)', high: 'scuttles for the water the moment it looks up', low: 'plods' },
  { key: 'fecundity', label: 'Fecundity', color: 'rgb(244,114,182)', high: 'broods often', low: 'broods rarely' },
]

export const CRAB_GENE_KEYS = CRAB_GENE_META.map((m) => m.key)

const FOUNDER_SPREAD = 0.3
// Founder crabs are weighted *toward* the water. A scatter of bold founders
// on a beach with foxes on it is a scatter of founders that is eaten before
// it breeds once, and the interesting run is the one where boldness climbs
// (or doesn't) as the shallows fill up - not one decided at spawn.
const FOUNDER_MEAN = { boldness: 0.34 }
const MUTATION_RATE = 0.3
const MUTATION_STDDEV = 0.09

/** A crab's tank. Bigger than a fish's relative to its burn rate: a crab is
 * slow, and something that slow needs to be able to sit out a bad tide. */
export const CRAB_ENERGY_MAX = 30

function clamp01(v) {
  return Math.min(1, Math.max(0, v))
}

function gaussian(rng) {
  const u1 = Math.max(1e-9, rng())
  const u2 = rng()
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2)
}

/** A founder crab's genes, using `rng` (a 0..1 generator). */
export function createCrabGenes(rng) {
  const genes = {}
  for (const key of CRAB_GENE_KEYS) {
    const mean = FOUNDER_MEAN[key] ?? 0.5
    genes[key] = clamp01(mean + (rng() * 2 - 1) * FOUNDER_SPREAD)
  }
  return genes
}

/** A hatchling's genes: the parent's, each independently mutated with
 * probability MUTATION_RATE. Never mutates the parent in place. */
export function mutateCrabGenes(genes, rng) {
  const out = {}
  for (const key of CRAB_GENE_KEYS) {
    out[key] = rng() < MUTATION_RATE ? clamp01(genes[key] + gaussian(rng) * MUTATION_STDDEV) : genes[key]
  }
  return out
}

function lerp(a, b, t) {
  return a + (b - a) * t
}

// ============================ Derived stats =============================
// A crab is the slowest thing in the simulation: 6 to 3 decision ticks a
// tile, against a walking rabbit's 2 and a prowling fox's ~2. It is not
// getting away from anything, and it is not meant to - what it has instead is
// a shell, a short dash to the water, and the option of never leaving it.
const STROKE_TICKS = [6, 3] // at speed 0 -> 1
// How far off it notices a fox. An armoured crab sits tighter than a soft one
// for the same reason a tank is not twitchy: the shell *is* the plan.
const ALERT_TILES = [5, 2.5] // at armour 0 -> 1
const BASE_UPKEEP_PER_SEC = 0.09
// Share of grabs the shell turns away (see CRAB_CATCH_CHANCE in
// simulation.js). Armour is never total: a fox that keeps trying gets there.
const TOUGHNESS = [0, 0.55]
const BREED_ENERGY = [26, 20] // by fecundity
const BREED_COOLDOWN_MS = [112000, 52000] // by fecundity

/** Everything the sim reads off the genes. Cached on the entity at birth
 * (see spawnCrab), like the fish's and the rabbit's senses. */
export function crabStats(genes) {
  return {
    // Armour is dead weight as well as protection - it is the second half of
    // what makes the gene a trade rather than a free upgrade, the first being
    // the upkeep below.
    strokeTicks: Math.max(1, Math.round(lerp(STROKE_TICKS[0], STROKE_TICKS[1], genes.speed) + genes.armour)),
    // How many tiles of dry land it will put between itself and the water.
    // 0 means "stays in the shallows entirely", which is safe from any fox
    // that cannot swim and puts it in direct competition with the fish.
    landReach: Math.round(lerp(0, LAND_FORAGE_REACH, genes.boldness)),
    alertRadius: lerp(ALERT_TILES[0], ALERT_TILES[1], genes.armour),
    upkeepPerSec: BASE_UPKEEP_PER_SEC * (1 + 0.35 * genes.speed + 0.45 * genes.armour),
    toughness: lerp(TOUGHNESS[0], TOUGHNESS[1], genes.armour),
    breedEnergy: lerp(BREED_ENERGY[0], BREED_ENERGY[1], genes.fecundity),
    breedCooldownMs: lerp(BREED_COOLDOWN_MS[0], BREED_COOLDOWN_MS[1], genes.fecundity),
  }
}

/** A plain-English read on an individual, for the inspector. */
export function describeCrab(genes) {
  const sorted = CRAB_GENE_META.map((m) => ({ ...m, value: genes[m.key] })).sort((a, b) => b.value - a.value)
  const best = sorted[0]
  const worst = sorted[sorted.length - 1]
  const exposure = crabStats(genes).landReach
  const verdict =
    exposure === 0
      ? 'It feeds in the water and takes its chances with the fish, where no landlocked fox can touch it.'
      : `It feeds up to ${exposure} tile${exposure === 1 ? '' : 's'} clear of the water, which is uncontested weed and a fox's whole reason to walk a beach.`
  return `This crab ${best.high}, but ${worst.low}. ${verdict}`
}

/** Short "what these genes are doing right now" notes for the inspector. */
export function describeCrabStats(genes) {
  const s = crabStats(genes)
  return [
    `Takes ${s.strokeTicks} decision ticks to cross a tile - slower than everything else alive, armour included.`,
    `Its shell turns away ${Math.round(s.toughness * 100)}% of the grabs made at it, and it looks up at a fox ${s.alertRadius.toFixed(1)} tiles off.`,
    `Burns ${s.upkeepPerSec.toFixed(2)} energy/sec, so it needs a patch of weed every ~${Math.round(8 / s.upkeepPerSec)}s.`,
    `Broods at ${Math.round(s.breedEnergy)} energy, and not again for ${Math.round(s.breedCooldownMs / 1000)}s.`,
  ]
}
