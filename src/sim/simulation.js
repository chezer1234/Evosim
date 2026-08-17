// Population simulation: entity state, the per-tick decision loops,
// energy/lifecycle and reproduction for the rabbits, the foxes that hunt
// them, and the fish and crabs that give a fox something else to eat.
//
// There are two food chains here, and they meet at the fox. Apples feed
// rabbits and rabbits feed foxes - the original one, and the one that ends a
// run the moment the rabbits go under. Algae and wrack feed fish and crabs,
// and fish and crabs feed a fox that has learned to work a shoreline (see
// ./shallows.js, ./fish.js, ./crab.js). The second chain is smaller in every
// direction - a crab is a third of a rabbit and takes as long to eat - which
// is exactly what makes it a fallback rather than a replacement.
//
// Rabbits and foxes both think with a neural net - rabbits via ./brain.js,
// foxes via ./foxBrain.js - and both also carry an explicit gene
// vector for the parts of an animal a weight matrix cannot express: the
// rabbit's ears, voice and swim skill (./rabbit.js) and the fox's whole
// body (./fox.js). Movement is discrete tile-stepping either way - rabbits
// step on a fixed tick cadence (slower swimming, faster running), foxes
// accumulate a fractional tiles-per-tick budget so their speed gene can vary
// continuously. What the *screen* shows is interpolated between those tile
// steps (see ./motion.js); the grid below is unchanged, and stays the only
// thing the sim reasons about.
//
// Water is terrain with an entry requirement (see ./water.js): both species
// carry a heritable swim gene, and below the usable threshold a shoreline is
// a wall rather than a slow patch. That is the one asymmetry a rabbit can
// evolve into a genuine escape - a lake it can cross and the fox behind it
// cannot.

import { createBrain, mutateBrain, think } from './brain.js'
import { computeTraits } from './brainInsight.js'
import { createFoxBrain, foxThink, mutateFoxBrain } from './foxBrain.js'
import { computeFoxTraits } from './foxInsight.js'
import { FOREST_SCENT_FACTOR, FOREST_VISION_FACTOR, FOX_ENERGY_MAX, FOX_GENE_KEYS, createFoxGenes, foxStats, mutateFoxGenes } from './fox.js'
import { RABBIT_GENE_KEYS, alarmReach, createRabbitGenes, mutateRabbitGenes, rabbitStats } from './rabbit.js'
import { FISH_ENERGY_MAX, FISH_GENE_KEYS, createFishGenes, fishStats, mutateFishGenes } from './fish.js'
import { CRAB_ENERGY_MAX, CRAB_GENE_KEYS, crabStats, createCrabGenes, mutateCrabGenes } from './crab.js'
import {
  FORAGE_REGROW_MS,
  forageTiles,
  isBankside,
  isShallows,
  isTideline,
  shoreDistances,
} from './shallows.js'
import { HOP, SWIM, advanceMotion, attachMotion, beginMove, teleportMotion } from './motion.js'
import {
  canEnterTile,
  FLOUNDER_DRAIN_FACTOR,
  FLOUNDER_SPEED_FACTOR,
  isWaterTile,
  towardNearestLand,
  waterDrainFactor,
} from './water.js'
import { hasCover, TILE } from '../worldgen/mapgen.js'
import {
  BURROW_BUILD_ENERGY,
  BURROW_SENSE_RADIUS,
  canDigAt,
  createBurrow,
  enterBurrow,
  hasSpace,
  leaveBurrow,
  linkedBurrows,
  nearestBurrow,
} from './burrow.js'

export const TICK_MS = 200 // decision-tick cadence (~5/sec)
const VISION_RADIUS = 5 // tiles
const ENERGY_START = 100
const ENERGY_MAX = 100
const ENERGY_DEPLETE_NORMAL_MS = 2500 // -1 energy every 2.5s at rest/walk
const ENERGY_DEPLETE_RUN_MS = 1000 // -1 energy every 1s while running
// A rabbit sitting in the dark doing nothing burns far less than one out
// grazing. This matters much more than it sounds: now that the foxes
// survive long enough to be a permanent presence rather than a bad week,
// rabbits spend a third to a half of their lives underground, and at the
// surface burn rate that was slow starvation for the whole warren - the
// population stopped breeding and dwindled without a single extra rabbit
// being caught. A burrow costs you your foraging time; it should not also
// cost you the same energy as foraging.
const ENERGY_DEPLETE_SHELTERED_MS = 5500
const EAT_GAIN = 10
// With no apple in vision, the brain only ever sees a constant food signal
// (dx=0, dy=0, dist=1) plus one noisy input, so its evolved move outputs
// tend to collapse into one of two failure modes: a fixed bearing (whatever
// the bias weights say - "b-lining" off in one direction regardless of
// what's actually out there) or noise so weak the rabbit barely moves at
// all. Neither is searching. So when no apple is visible, movement is
// driven by an explicit search heading instead of the brain's raw outputs -
// held for SEARCH_HEADING_TICKS decision ticks, then re-randomized, giving
// a genuine sweep of the surrounding area rather than a frozen genome
// artifact.
const SEARCH_HEADING_TICKS = 9 // ~1.8s per heading at TICK_MS=200
// Below this energy, a rabbit is too hungry to just sit out a "rest"
// decision - resting is free of any energy-saving benefit here (it depletes
// at the same rate as walking, see stepRabbit), so a starving rabbit that
// happens to rest while blind to food was starving for nothing. Hunger
// hard-overrides resting so that never happens.
//
// Set well above the halfway point (not just "critical") on purpose: a
// rabbit that only starts genuinely searching once it's nearly dead has
// very little runway left to actually reach food, especially blind - by the
// time it's earned enough travel budget to matter, it's often already too
// late even though it's now doing everything "right". Triggering active
// foraging early costs nothing (resting has no upside to give up) and turns
// most of a rabbit's energy bar into real search-and-reach time instead of
// a countdown that quietly ran out while it was still deciding whether to
// bother.
const HUNGRY_ENERGY = 65
const REPRO_ENERGY_THRESHOLD = 75
const REPRO_COST = 10
// Not specified by the issue, but a child can't start at full energy for
// free: the parent only pays REPRO_COST (10). Raised from 50 -> 80 because
// population crashes were common - newborns at 50 were too close to
// starvation before they'd found their first apple, especially in leaner
// patches of the map, and a single bad early stretch could wipe out a
// generation. 80 gives a child real headroom to find food while still
// costing the parent net energy (parent -10, child +80).
const CHILD_START_ENERGY = 80
const GESTATION_MS = 30000
const REGROW_MS = 45000 // how long an eaten tree takes to bear a new apple
const TRAIT_SAMPLE_MS = 5000 // how often to snapshot population-wide traits
const TRAIT_HISTORY_LIMIT = 240 // ~20 minutes of samples at TRAIT_SAMPLE_MS

// ============================== Predation ===============================
// How far a rabbit can spot a fox with no camouflage at all. Each fox
// shrinks this by its own stealthFactor (see foxStats in ./fox.js), so
// "how close can it get before I notice" is a property of the *fox's*
// genes, not a global constant - camouflage is the gene that buys it.
export const PREY_ALERT_RADIUS = 6
// Inside this distance a rabbit panics no matter what its genome says. Same
// design as the hunger override above: a founder population that has to
// discover "run away from the thing eating you" gets eaten before selection
// can act on it, so the reflex is hardwired and only the *middle distance*
// response (the brain's `flee` output) is left to evolution.
const PANIC_RADIUS = 2.5
// Chebyshev tile distance at which a hunting fox can take a rabbit - the
// pounce. 1 (i.e. adjacent, diagonals included) rather than 0 because both
// species move a whole tile at a time and would otherwise swap places past
// each other without ever "meeting".
export const POUNCE_RANGE = 1
// Decision ticks per tile for a rabbit that is in water it cannot swim - it
// is splashing for the bank, not travelling. Slower than the worst genuine
// swimmer (7, see rabbit.js) for the same reason it costs more energy: being
// out of your depth is not the same as being slow at something you can do.
const FLOUNDER_STROKE_TICKS = 8
const FOX_FEED_MS = 1800 // stands over the carcass, out of the chase
const FOX_START_ENERGY = 100
const FOX_CUB_ENERGY = 60
const FOX_REPRO_COST = 110
const FOX_SPRINT_RANGE = 5 // only worth sprinting once the prey is this close
// How wrong a scent bearing is at the very edge of a fox's nose, in radians
// (+/-). Scale it by how far off the rabbit is and you get the behaviour the
// input is meant to have: a faint smell from across the island only tells
// you roughly which way to walk, and it sharpens into something you can
// actually chase as you close. Re-rolled every decision tick, so a fox
// following a distant scent casts about the way a real one does instead of
// walking a laser-straight line to its dinner.
const SCENT_JITTER = 1.1
// Below this, a fox will not lie up however strongly its brain votes for it.
// Same reasoning as the rabbits' hunger override: resting finds nothing, so
// a lineage that naps through starvation would be selected out by dying in
// its sleep, which is a slow and boring way to learn a lesson the sim can
// just hardwire. Lying up is for waiting out a lean patch with reserves in
// the tank, not for the last of them.
const FOX_ROUSE_ENERGY = FOX_ENERGY_MAX * 0.3
const FOX_MAX_STEPS_PER_TICK = 2 // safety rail on the fractional step budget
const FOX_PACK_KEEP_DISTANCE = 2.5 // don't crowd a packmate once alongside it
// Territory. A vixen will not raise cubs with another fox's scent this close
// to the den, and that single rule is what stops the population from
// overshooting its food supply: without it a good few minutes of hunting
// turns five foxes into twenty, the twenty strip the island bare, and both
// species end the run at zero. It caps how many *breeding* foxes an island
// supports without capping how many can live on it, which is exactly the
// shape a predator/prey cycle needs - and it gives the pack instinct a real
// cost, since foxes that hunt shoulder to shoulder are foxes that cannot
// breed. Widened from 18 when the swim gene landed (#17): a shoreline a
// non-swimming rabbit cannot cross is a wall it can be pinned against, so
// the same fox density catches far more than it used to.
const FOX_TERRITORY_RADIUS = 24
// How long after a litter before a fox will carry another. Gestation itself
// is short now (30-58s, deliberately - see GESTATION_MS in fox.js), and
// without a recovery period a well-fed fox simply converts every second
// kill into another fox: a rabbit boom becomes a fox boom within a couple
// of minutes, and the foxes then strip the island. This is the *rate* limit
// that lets the prey population recover between litters, where the
// territory rule above is the *density* limit.
const FOX_LITTER_RECOVERY_MS = 150000
// How loud a fox is to a rabbit's ears. Hearing is the sense camouflage
// can't beat (issue #14) - but it can be beaten by *moving quietly*, which
// is what keeps a stalking fox viable: a sprint through the undergrowth
// carries much further than a slow prowl, and a fox standing still over a
// carcass gives away least of all. Since heavy legs are the noisy ones, the
// speed gene is what a fox pays with, not its coat.
const FOX_NOISE_SPRINTING = 1.25
const FOX_NOISE_FEEDING = 0.6
// A fox lying up is the quietest thing on the island - quieter even than one
// eating. That is the other half of what the brain's rest output buys: an
// ambusher does not broadcast its position, so the rabbits around it carry
// on grazing instead of spending the afternoon bolting from a fox that was
// never coming. It is also what stops a handful of foxes from suppressing a
// small warren's breeding just by existing near it.
const FOX_NOISE_RESTING = 0.3
const FOX_NOISE_PROWLING = [0.5, 1.0] // by speed gene: a slow stalker is quiet

// ========================= Alarm calls / burrows =========================
// A rabbit that detects a fox calls it - automatically, not as an evolved
// decision: thumping at a predator is a reflex, and a founder population that
// had to discover it would be eaten first. What *is* evolvable is the
// listening half (see the ALARM input in brain.js and `heedsAlarm` in
// brainInsight.js): whether another rabbit's call moves you, and whether it
// moves you to run or to go to ground.
const ALARM_CALL_MS = 1400
// A call this loud (as a fraction of the caller/listener reach, see
// alarmReach) is treated as a hard panic by a rabbit that has detected
// nothing itself - the same reasoning as PANIC_RADIUS above. Quieter calls
// only matter through the brain's own evolved response to them.
const ALARM_PANIC_STRENGTH = 0.5
// Digging is only worth it with something in reserve afterwards: at exactly
// BURROW_BUILD_ENERGY a rabbit would finish the hole and starve in it.
const BURROW_BUILD_RESERVE = 25
// Above this, a calm rabbit with no burrow in reach will dig one anyway, so
// warrens exist before the first fox arrives rather than only during a
// panic (nobody digs a good hole while being chased).
const BURROW_DIG_CALM_ENERGY = 70
const SHELTER_MIN_TICKS = 5 // ~1s underground minimum: stops entry/exit flicker
// A sheltering rabbit cannot eat, so hunger is what eventually forces it back
// up - the cost that stops "hide forever" from being a winning strategy.
const SHELTER_HUNGRY_ENERGY = 45
const SHELTER_ALL_CLEAR_TICKS = 10 // ticks with nothing detected before it will surface
// A fox this close to an entrance means coming up there is suicide: the
// rabbit uses the tunnel network and surfaces at a connected burrow instead.
const BURROW_MOUTH_DANGER = 2.5

// ========================== The shoreline food ===========================
// The second food chain (see ./shallows.js, ./fish.js, ./crab.js): algae and
// wrack feed fish and crabs, and fish and crabs feed a fox that would
// otherwise have nothing to eat but rabbits. That is the whole reason they
// exist - an island where the rabbits have crashed used to be an island where
// the foxes followed them down a few minutes later, which made every long run
// end the same way.
const FISH_START_ENERGY = 28
const FISH_FRY_ENERGY = 16
const FISH_BREED_COST = 18
const FISH_BITE_ENERGY = 10
const CRAB_START_ENERGY = 22
const CRAB_HATCHLING_ENERGY = 12
const CRAB_BREED_COST = 13
const CRAB_BITE_ENERGY = 8
// Below this share of its tank, a fish or a crab goes looking for food rather
// than holding station with the shoal or sitting on the weed it is already
// on. Well above half, for the same reason HUNGRY_ENERGY is: something that
// only starts looking when it is nearly empty rarely gets there.
const AQUATIC_HUNGRY_FRACTION = 0.72
// How far either of them can see a patch of forage. Deliberately short -
// neither has a fox's nose or a rabbit's ears, and a shoal that could see the
// whole lake would strip it in one sweep rather than grazing it.
const FORAGE_SIGHT_RADIUS = 4
// How long a creature that looked around and saw nothing to eat waits before
// looking again. It wanders in between, which is what it would be doing
// anyway - this only stops a stripped patch of shore from costing a full
// scan per animal per tick.
const FORAGE_RESCAN_MS = 1000
// A fleeing animal burns harder, the same multiplier either species pays.
const AQUATIC_FLEE_UPKEEP = 1.6
// The carrying capacity of the shallows, as a share of how many tiles of the
// world can grow anything at all (see forageTiles in shallows.js) - so a pond
// supports a handful of fish and an archipelago supports a lot of them,
// rather than one global number being generous on a small map and absurd on a
// big one. The absolute bounds are a floor for playability (a map with three
// wet tiles should still hold a few fish) and a ceiling for the frame budget.
//
// This is a *ceiling*, not a simulation of the food running out: both species
// breed slowly enough (see their BREED_COOLDOWN_MS) that a founder shoal
// takes a few minutes to reach it, and once there it is deaths that make
// room. What the forage itself decides is finer-grained and more interesting
// than a number - which patch of water is worth being in, whether a crab has
// to leave the water to find weed no fish has taken, and who starves when a
// stretch of shore has been stripped.
const FISH_CAP_PER_FORAGE_TILE = 0.45
const CRAB_CAP_PER_FORAGE_TILE = 0.28
const FISH_CAP_RANGE = [50, 320]
const CRAB_CAP_RANGE = [30, 200]

// How far a fox can pick a fish or a crab out at, as a share of its normal
// vision: they are small, low to the ground and half of them are underwater.
const SHORE_PREY_VISION_FACTOR = 0.6
// The odds a grab succeeds, before the prey's own genes are taken off it (see
// `evasion` in fish.js and `toughness` in crab.js). A fox in the water is a
// far better fisherman than one swiping from the bank - which is one more
// thing the swim gene quietly buys - and a crab out of the water is simply
// picked up.
const FISH_CATCH_CHANCE = { bank: 0.4, swimming: 0.75 }
const CRAB_CATCH_CHANCE = 0.6
// What each is worth, as a share of what the same fox gets off a rabbit (see
// `energyPerKill` in fox.js). A crab is a snack and a fish is most of a meal;
// neither is a carcass. A fox living entirely off the tideline is a fox that
// eats constantly and breeds slowly, which is exactly the marginal existence
// it should be.
const FISH_MEAL_SHARE = 0.5
const CRAB_MEAL_SHARE = 0.32
// Handling time. Much shorter than standing over a rabbit (FOX_FEED_MS):
// there is not much of a crab to eat.
const SHORE_FEED_MS = 700

const MOVE_DEADZONE = 0.3

let nextRabbitId = 1
let nextFoxId = 1
let nextFishId = 1
let nextCrabId = 1

function inBounds(map, x, y) {
  return x >= 0 && y >= 0 && x < map.size && y < map.size
}

/** Any tile a rabbit may occupy - everything except the open ocean (they
 * can swim slowly across lakes/shallows, but not cross the sea). */
export function isPlaceable(map, x, y) {
  return inBounds(map, x, y) && map.tileType[y * map.size + x] !== TILE.OCEAN
}

/**
 * Where a given species may be *dropped* - which is not the same question as
 * where it may walk, and is asked by the spawn palette and the headless
 * harness, both of which have a map and no simulation to consult. A fish put
 * on a hilltop is not a fish, so each species gets its own habitat here
 * rather than everything sharing the rabbits' rule.
 */
export function isPlaceableFor(map, species, x, y) {
  if (!inBounds(map, x, y)) return false
  if (species === 'fish') return isShallows(map, x, y)
  if (species === 'crab') return isShallows(map, x, y) || isTideline(map, x, y)
  return isPlaceable(map, x, y)
}

/** Fresh simulation state for a given map. Apple-current-state starts from
 * the map's fixed canHaveApple flags (every eligible tree starts bearing
 * fruit), and the shallows are laid out the same way - see ./shallows.js. */
export function createSimulation(map) {
  // Both derived from the map and never changed afterwards: how far each tile
  // is from water (what a crab's boldness is measured in) and which tiles can
  // grow algae or wrack at all.
  const shoreDist = shoreDistances(map)
  const canHaveForage = forageTiles(map, shoreDist)
  let forageCount = 0
  for (let i = 0; i < canHaveForage.length; i++) forageCount += canHaveForage[i]
  const cap = (per, [lo, hi]) => Math.min(hi, Math.max(lo, Math.round(forageCount * per)))
  return {
    map,
    rabbits: [],
    foxes: [],
    // The shoreline species. Kept as their own lists rather than one
    // "creatures" array: every loop in here is species-specific anyway, and
    // the fox's scans want to ask about fish and crabs separately.
    fish: [],
    crabs: [],
    shoreDist,
    canHaveForage,
    hasForage: canHaveForage.slice(),
    forageRegrowAt: new Float32Array(map.size * map.size).fill(-1),
    forageQueue: [],
    fishCap: cap(FISH_CAP_PER_FORAGE_TILE, FISH_CAP_RANGE),
    crabCap: cap(CRAB_CAP_PER_FORAGE_TILE, CRAB_CAP_RANGE),
    // Every burrow dug so far (see ./burrow.js). Persist for the whole run
    // even when empty: an abandoned hole is still somewhere the next
    // generation can bolt into, which is what makes a warren an asset a
    // population inherits rather than a per-rabbit possession.
    burrows: [],
    hasApple: map.canHaveApple.slice(),
    regrowAt: new Float32Array(map.size * map.size).fill(-1),
    // Tiles waiting on a new apple, so regrowth costs a walk of what was
    // eaten rather than a sweep of the whole world (see regrowApples).
    regrowQueue: [],
    clock: 0,
    // Selection is per-species: ids are only unique within their own list,
    // so the kind is part of the identity.
    selectedId: null,
    selectedKind: null, // 'rabbit' | 'fox' | 'fish' | 'crab' | null
    kills: 0,
    // Fish and crabs taken by foxes. Counted apart from `kills` because they
    // are a different story: a run with 200 shore catches and no kills is a
    // pack that has stopped hunting rabbits altogether.
    shoreCatches: 0,
    // Anything that ran out of energy in water rather than on land. Tracked
    // separately from starvation because it is a different story: a creature
    // that drowned was somewhere its genes could not carry it.
    drownings: 0,
    traitHistory: [],
    traitHistoryAccum: 0,
    // Uncapped twin of traitHistory, kept for the whole run (traitHistory
    // above rolls off after TRAIT_HISTORY_LIMIT samples so the compact
    // Population panel only shows a recent window). Same sample
    // shape/cadence, so any chart in that panel - either paired population
    // count, or any species' trait/gene trend - can be expanded to the full
    // "since the very beginning" view just by reading from this array
    // instead.
    // Samples are tiny and only taken every TRAIT_SAMPLE_MS, so even a
    // multi-hour session stays a few thousand entries.
    fullHistory: [],
  }
}

/** The list a given species lives in. One place that knows the mapping, so
 * selection, inspection and the UI cannot disagree about it. */
export function creaturesOfKind(sim, kind) {
  if (kind === 'fox') return sim.foxes
  if (kind === 'fish') return sim.fish
  if (kind === 'crab') return sim.crabs
  return sim.rabbits
}

/** Select a creature (or nothing) for the inspector panel. */
export function selectCreature(sim, kind, id) {
  sim.selectedKind = id == null ? null : kind
  sim.selectedId = id == null ? null : id
}

export function spawnRabbit(sim, x, y, brain, startEnergy = ENERGY_START, generation = 0, genes = null) {
  const senseGenes = genes || createRabbitGenes(Math.random)
  const rabbit = {
    id: nextRabbitId++,
    x,
    y,
    energy: startEnergy,
    alive: true,
    tickAccum: 0,
    energyAccum: 0,
    stepPhase: 0,
    running: false,
    resting: false,
    searching: false,
    fleeing: false,
    gestating: false,
    gestationRemaining: 0,
    generation,
    brain: brain || createBrain(Math.random),
    // The sense half of the genome: how far it hears and how far its own
    // alarm call carries (see ./rabbit.js). Separate from the brain because
    // ears are hardware, not an opinion the net can hold.
    genes: senseGenes,
    // Derived once at birth rather than per tick: genes never change during a
    // life, and hearCalls below reads every *other* rabbit's senses on every
    // decision tick - deriving them there is an allocation per pair of
    // rabbits per tick, which a big warren feels.
    senses: rabbitStats(senseGenes),
    // Burrow state (see ./burrow.js): the id of the burrow it is currently
    // inside, or null when it's above ground.
    burrowId: null,
    shelterTicks: 0,
    quietTicks: 0,
    digging: false,
    // Alarm call this rabbit is currently making, with the position of the
    // thing it is calling about. Two channels, because "there is a fox at
    // X" and "there is a burrow at Y" are different messages and a rabbit
    // that has just bolted underground is sending both.
    alarmUntil: 0,
    alarmX: 0,
    alarmY: 0,
    burrowCallUntil: 0,
    burrowCallX: 0,
    burrowCallY: 0,
    // Strength (0..1) of the loudest call it can currently hear, kept on the
    // entity so the renderer and inspector can show a rabbit reacting to
    // something it cannot see itself.
    alarmHeard: 0,
    // True when the fox it is reacting to was picked up by ear alone - the
    // panel says "heard a fox" rather than "fleeing" for it, which is the
    // clearest way to show hearing doing something sight couldn't.
    heardOnly: false,
    // Current search-mode heading (radians) and how many decision ticks are
    // left before it's re-randomized. ticksLeft starts at 0 so the first
    // search tick picks a fresh heading immediately rather than reusing this
    // arbitrary initial value.
    searchHeading: Math.random() * Math.PI * 2,
    searchTicksLeft: 0,
    // Water state, refreshed every decision tick: whether it is currently in
    // water, and whether it is in water it has no business being in (see
    // ./water.js). The renderer draws a swimming rabbit completely
    // differently, so these are read every frame as well as every tick.
    swimming: false,
    floundering: false,
    drowned: false,
  }
  rabbit.swimming = isWaterTile(sim.map, x, y)
  rabbit.floundering = rabbit.swimming && !rabbit.senses.canSwim
  // Visual-only position/gait state (see ./motion.js), starting parked on
  // the tile it was spawned on.
  attachMotion(rabbit, Math.random() * Math.PI * 2)
  sim.rabbits.push(rabbit)
  return rabbit
}

/** A fox. `genes` defaults to a fresh founder genome (see ./fox.js) and
 * `brain` to a fresh founder net (see ./foxBrain.js); cubs are given a
 * mutated copy of both by finishFoxGestation. */
export function spawnFox(sim, x, y, genes, startEnergy = FOX_START_ENERGY, generation = 0, brain = null) {
  const fox = {
    id: nextFoxId++,
    x,
    y,
    energy: startEnergy,
    alive: true,
    genes: genes || createFoxGenes(Math.random),
    // The decision half of the genome: when to chase, sprint, track a
    // scent, join the pack, lie up and breed.
    brain: brain || createFoxBrain(Math.random),
    tickAccum: 0,
    // Fractional tiles-per-tick budget: a whole tile is stepped each time
    // this crosses 1, which is what lets the speed gene be continuous
    // instead of snapping to a whole number of ticks per step.
    stepCredit: 0,
    sprinting: false,
    hunting: false,
    // Following a scent to a rabbit it cannot see - the state that makes a
    // fox's search look like searching. `scentStrength` is what its nose is
    // currently picking up (0..1), kept on the entity for the inspector.
    tracking: false,
    scentStrength: 0,
    // Lying up: not moving, and burning upkeep at restUpkeepFactor.
    resting: false,
    // Working the tideline: closing on a fish or a crab rather than a rabbit
    // (see the shoreline constants above).
    foraging: false,
    packing: false,
    feedingRemaining: 0,
    gestating: false,
    gestationRemaining: 0,
    // Cubs of its own are off the table until this clock time (see
    // FOX_LITTER_RECOVERY_MS). Cubs are born already on the clock, so a
    // litter cannot immediately have litters of its own.
    nextLitterAt: 0,
    generation,
    kills: 0,
    // Fish and crabs taken off the shoreline, kept apart from `kills` so the
    // inspector can say what this fox actually lives on.
    catches: 0,
    // Chase budget, in decision ticks, refilled while not sprinting.
    sprintBudget: 0,
    // Which way it's pointing (radians), so the renderer can draw a fox
    // facing its prey rather than a direction-less blob.
    heading: Math.random() * Math.PI * 2,
    searchHeading: Math.random() * Math.PI * 2,
    searchTicksLeft: 0,
    swimming: false,
    floundering: false,
    drowned: false,
  }
  fox.swimming = isWaterTile(sim.map, x, y)
  fox.floundering = fox.swimming && !foxStats(fox.genes).canSwim
  attachMotion(fox, fox.heading)
  fox.sprintBudget = foxStats(fox.genes).maxSprintTicks
  sim.foxes.push(fox)
  return fox
}

/**
 * A fish. No brain argument, because a fish has no brain (see ./fish.js) -
 * its genes are the whole inheritance, and its behaviour is the three fixed
 * rules in runFishTick.
 */
export function spawnFish(sim, x, y, genes, startEnergy = FISH_START_ENERGY, generation = 0) {
  const fishGenes = genes || createFishGenes(Math.random)
  const fish = {
    id: nextFishId++,
    x,
    y,
    energy: startEnergy,
    alive: true,
    genes: fishGenes,
    // Derived once at birth, like a rabbit's senses: the shoaling scan reads
    // every other fish's stats every decision tick.
    stats: fishStats(fishGenes),
    generation,
    tickAccum: 0,
    stepPhase: 0,
    fleeing: false,
    shoaling: false,
    // Spawning is instant rather than gestated (a fish sheds eggs, it does
    // not carry cubs), so what paces a lineage is this cooldown alone.
    nextBreedAt: 0,
    searchHeading: Math.random() * Math.PI * 2,
    searchTicksLeft: 0,
    // The patch of algae it is currently making for, remembered rather than
    // re-found every tick (see forageTargetFor).
    forageTarget: null,
    nextForageScan: 0,
    // Everything else in the sim asks entities whether they are swimming; a
    // fish always is, and the renderer draws it accordingly.
    swimming: true,
  }
  attachMotion(fish, fish.searchHeading)
  sim.fish.push(fish)
  return fish
}

/** A crab. Same deal as the fish: genes only, no net. */
export function spawnCrab(sim, x, y, genes, startEnergy = CRAB_START_ENERGY, generation = 0) {
  const crabGenes = genes || createCrabGenes(Math.random)
  const crab = {
    id: nextCrabId++,
    x,
    y,
    energy: startEnergy,
    alive: true,
    genes: crabGenes,
    stats: crabStats(crabGenes),
    generation,
    tickAccum: 0,
    stepPhase: 0,
    fleeing: false,
    nextBreedAt: 0,
    searchHeading: Math.random() * Math.PI * 2,
    searchTicksLeft: 0,
    forageTarget: null,
    nextForageScan: 0,
    swimming: isWaterTile(sim.map, x, y),
  }
  attachMotion(crab, crab.searchHeading)
  sim.crabs.push(crab)
  return crab
}

function findNearestApple(sim, x, y) {
  const { map, hasApple } = sim
  const r = VISION_RADIUS
  const x0 = Math.max(0, x - r)
  const x1 = Math.min(map.size - 1, x + r)
  const y0 = Math.max(0, y - r)
  const y1 = Math.min(map.size - 1, y + r)
  let bestDist = Infinity
  let bestX = -1
  let bestY = -1
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      const idx = ty * map.size + tx
      if (!map.canHaveApple[idx] || !hasApple[idx]) continue
      const dx = tx - x
      const dy = ty - y
      const dist = Math.sqrt(dx * dx + dy * dy)
      if (dist > r || dist >= bestDist) continue
      bestDist = dist
      bestX = tx
      bestY = ty
    }
  }
  return bestX < 0 ? null : { x: bestX, y: bestY, dist: bestDist }
}

/** How much noise a fox is making right now, as a multiplier on how far it
 * can be heard. Sprinting gives it away; standing over a carcass doesn't. */
function foxNoiseFactor(fox) {
  if (fox.sprinting) return FOX_NOISE_SPRINTING
  if (fox.resting) return FOX_NOISE_RESTING
  if (fox.feedingRemaining > 0) return FOX_NOISE_FEEDING
  return FOX_NOISE_PROWLING[0] + (FOX_NOISE_PROWLING[1] - FOX_NOISE_PROWLING[0]) * fox.genes.speed
}

/**
 * The nearest fox this rabbit has detected, by either sense, and which sense
 * found it.
 *
 * *Sight* checks each fox against its own spotting range - PREY_ALERT_RADIUS
 * shrunk by its camouflage gene - so a well-camouflaged fox stays invisible
 * until it is much closer, which is exactly what camouflage buys.
 *
 * *Hearing* (issue #14) is the longer sense and the one camouflage cannot
 * beat: a rabbit's ears reach 7-13 tiles depending on its `hearing` gene
 * versus 6 tiles of sight, scaled only by how much noise the fox is making.
 * That ordering is deliberate - it means a rabbit normally learns about a fox
 * while it still has room to run, and a stalking fox has to rely on being
 * quiet rather than on being invisible.
 */
function findNearestDetectedFox(sim, rabbit, stats) {
  let best = null
  let bestDist = Infinity
  let bestHeard = false
  for (const fox of sim.foxes) {
    if (!fox.alive) continue
    const dx = fox.x - rabbit.x
    const dy = fox.y - rabbit.y
    const dist = Math.hypot(dx, dy)
    if (dist >= bestDist) continue
    const seen = dist <= PREY_ALERT_RADIUS * foxStats(fox.genes).stealthFactor
    const heard = dist <= stats.hearingRadius * foxNoiseFactor(fox)
    if (!seen && !heard) continue
    bestDist = dist
    best = fox
    bestHeard = !seen
  }
  return best ? { fox: best, x: best.x, y: best.y, dist: bestDist, heardOnly: bestHeard } : null
}

/**
 * What this rabbit can hear other rabbits shouting about: the loudest alarm
 * call in range and the nearest broadcast burrow location. Range is a
 * property of both ends (see alarmReach in ./rabbit.js) - a loud caller and
 * sharp ears - so communication is something a warren gets better at over
 * generations rather than a fixed radius.
 */
function hearCalls(sim, rabbit, stats) {
  let strength = 0
  let dangerX = null
  let dangerY = null
  let burrowX = null
  let burrowY = null
  let burrowDist = Infinity
  for (const other of sim.rabbits) {
    if (other === rabbit || !other.alive) continue
    const dist = Math.hypot(other.x - rabbit.x, other.y - rabbit.y)
    const reach = alarmReach(other.senses, stats)
    if (dist > reach) continue
    const loudness = 1 - dist / reach
    if (other.alarmUntil > sim.clock && loudness > strength) {
      strength = loudness
      dangerX = other.alarmX
      dangerY = other.alarmY
    }
    if (other.burrowCallUntil > sim.clock && dist < burrowDist) {
      burrowDist = dist
      burrowX = other.burrowCallX
      burrowY = other.burrowCallY
    }
  }
  return { strength, dangerX, dangerY, burrowX, burrowY }
}

/**
 * Where this rabbit thinks the nearest usable burrow is: one it can see the
 * entrance of, or one another rabbit has just called out the location of.
 * Called-out burrows are how a rabbit ends up at a hole it has never been
 * near - the "get in the burrow" half of issue #14's communication.
 */
function knownBurrow(sim, rabbit, calls) {
  const seen = nearestBurrow(sim.burrows, rabbit.x, rabbit.y, BURROW_SENSE_RADIUS)
  if (seen) return seen
  if (calls.burrowX == null) return null
  const called = sim.burrows.find((b) => b.x === calls.burrowX && b.y === calls.burrowY)
  return called && hasSpace(called) ? called : null
}

/** The nearest live rabbit within a fox's (gene-derived) vision radius.
 * Rabbits underground are simply not there as far as a fox is concerned. */
function findNearestPrey(sim, fox, visionRadius) {
  let best = null
  let bestDist = Infinity
  for (const rabbit of sim.rabbits) {
    if (!rabbit.alive || rabbit.burrowId != null) continue
    const dist = Math.hypot(rabbit.x - fox.x, rabbit.y - fox.y)
    if (dist > visionRadius || dist >= bestDist) continue
    bestDist = dist
    best = rabbit
  }
  return best ? { rabbit: best, dist: bestDist } : null
}

/** How strong a rabbit smells, as a multiplier on how far a fox can pick it
 * up. The exact mirror of foxNoiseFactor above: a bolting rabbit leaves a
 * hot trail, one sitting still barely registers. It also means the rabbits'
 * own evolved behaviour feeds back into how findable they are - a lineage
 * that panics at every shadow is easier to track than one that holds its
 * nerve, which is a cost `skittishness` never used to pay. */
function rabbitScentFactor(map, rabbit) {
  let factor = rabbit.running ? 1.3 : rabbit.resting ? 0.55 : 1
  // Undergrowth masks a scent the way a canopy masks a sightline. Woodland
  // already costs a fox 45% of its vision (FOREST_VISION_FACTOR); without
  // the same discount on its nose, the trees stopped being a refuge the
  // moment foxes could smell - and a refuge is the thing that decides
  // whether a prey population can survive a bad few minutes at all.
  // Any biome with real cover, not just the broadleaf woods: a warren that
  // moves north into the pines keeps the benefit (see worldgen/biomes.js).
  if (hasCover(map.tileType[rabbit.y * map.size + rabbit.x])) factor *= FOREST_SCENT_FACTOR
  return factor
}

/**
 * What a fox's nose is telling it: a rough bearing to the nearest rabbit it
 * can smell, plus how strong the smell is.
 *
 * Scent is deliberately the long, *unreliable* sense - the mirror image of
 * the rabbit's hearing, which is long and reliable but only picks up noise
 * the fox chooses to make. The bearing is jittered by SCENT_JITTER scaled by
 * distance, so a smell from across the island is worth following but won't
 * take you straight there, while one from a few tiles away is nearly as good
 * as sight. Without it a fox on a big island searches by pure random walk,
 * which is why five founders used to starve before they ever met a rabbit.
 *
 * Rabbits underground leave nothing to smell - the same "simply not there"
 * rule the fox's eyes use, and one more reason a burrow is worth digging.
 */
function senseScent(sim, fox, radius) {
  let best = null
  let bestDist = Infinity
  let bestReach = 0
  for (const rabbit of sim.rabbits) {
    if (!rabbit.alive || rabbit.burrowId != null) continue
    const dist = Math.hypot(rabbit.x - fox.x, rabbit.y - fox.y)
    if (dist >= bestDist) continue
    const reach = radius * rabbitScentFactor(sim.map, rabbit)
    if (dist > reach) continue
    bestDist = dist
    bestReach = reach
    best = rabbit
  }
  if (!best) return null
  const trueBearing = Math.atan2(best.y - fox.y, best.x - fox.x)
  const vagueness = (bestDist / bestReach) * SCENT_JITTER
  const bearing = trueBearing + (Math.random() * 2 - 1) * vagueness
  return {
    dx: Math.cos(bearing),
    dy: Math.sin(bearing),
    dist: bestDist,
    strength: 1 - bestDist / bestReach,
  }
}

/**
 * The nearest fish or crab this fox could actually get to, and which of the
 * two it is.
 *
 * "Could actually get to" is the interesting clause. A fox that cannot swim -
 * which is nearly all of them, see FOUNDER_MEAN in fox.js - can only reach
 * water that has a bank on it, so a fish out in the middle of a lake is not
 * prey to it, it is scenery. Without that check a landlocked pack spends its
 * life walking up to a shoreline and stopping, which looks exactly like a bug
 * and starves them just as effectively.
 */
function findNearestShorePrey(sim, fox, radius, canSwim) {
  let best = null
  let bestKind = null
  let bestDist = Infinity
  const reachable = (x, y) => canSwim || !isWaterTile(sim.map, x, y) || isBankside(sim.map, x, y)
  for (const [kind, list] of [['crab', sim.crabs], ['fish', sim.fish]]) {
    for (const c of list) {
      if (!c.alive) continue
      const dist = Math.hypot(c.x - fox.x, c.y - fox.y)
      if (dist > radius || dist >= bestDist) continue
      if (!reachable(c.x, c.y)) continue
      bestDist = dist
      best = c
      bestKind = kind
    }
  }
  return best ? { creature: best, kind: bestKind, dist: bestDist } : null
}

/** The nearest other live fox within `radius`, for pack behaviour. */
function findNearestPackmate(sim, fox, radius) {
  let best = null
  let bestDist = Infinity
  for (const other of sim.foxes) {
    if (other === fox || !other.alive) continue
    const dist = Math.hypot(other.x - fox.x, other.y - fox.y)
    if (dist > radius || dist >= bestDist) continue
    bestDist = dist
    best = other
  }
  return best ? { fox: best, dist: bestDist } : null
}

// How many decision ticks a rabbit waits between actual tile-steps: it
// depends on its own swim gene once it is in the water (2-7 ticks a tile,
// see rabbitStats), on whether it is running on land, and on nothing at all
// if it is out of its depth - a floundering rabbit is just splashing.
function stepEveryTicks(map, rabbit, running) {
  if (!isWaterTile(map, rabbit.x, rabbit.y)) return running ? 1 : 2
  return rabbit.senses.canSwim ? rabbit.senses.swimStrokeTicks : FLOUNDER_STROKE_TICKS
}

/**
 * Can this rabbit put itself on that tile? The whole rule lives in
 * canEnterTile (see ./water.js): a lake shore is solid to anything that
 * cannot swim, the shelf between two close islands is solid to anything short
 * of a real open-water swimmer, and deep sea is solid to everything.
 */
function canRabbitEnter(sim, rabbit, x, y) {
  return canEnterTile(sim.map, x, y, rabbit.senses, isWaterTile(sim.map, rabbit.x, rabbit.y))
}

function attemptStep(sim, rabbit, dirX, dirY, durationMs) {
  const nx = rabbit.x + dirX
  const ny = rabbit.y + dirY
  if (!canRabbitEnter(sim, rabbit, nx, ny)) return false
  rabbit.x = nx
  rabbit.y = ny
  // The tile moved; the *sprite* starts travelling there over the same
  // duration the next step is due in, so it arrives just as it is asked to
  // leave again (see ./motion.js).
  beginMove(rabbit, nx, ny, durationMs, isWaterTile(sim.map, nx, ny) ? SWIM : HOP)
  return true
}

// One tile-step along a direction vector, sliding along whichever single axis
// is open if the diagonal is blocked - the same treatment foxes get (see
// stepFoxOnce). Without it a rabbit pinned diagonally against a shoreline
// just vibrates in place instead of running along the bank, which now matters
// far more often: for a non-swimmer, every lake edge is a wall.
function stepRabbitOnce(sim, rabbit, moveX, moveY, durationMs) {
  const dirX = moveX > MOVE_DEADZONE ? 1 : moveX < -MOVE_DEADZONE ? -1 : 0
  const dirY = moveY > MOVE_DEADZONE ? 1 : moveY < -MOVE_DEADZONE ? -1 : 0
  if (dirX === 0 && dirY === 0) return false
  if (attemptStep(sim, rabbit, dirX, dirY, durationMs)) return true
  if (dirX !== 0 && attemptStep(sim, rabbit, dirX, 0, durationMs)) return true
  return dirY !== 0 && attemptStep(sim, rabbit, 0, dirY, durationMs)
}

/** Refresh the water flags the energy loop and the renderer read. */
function updateWaterState(entity, sim, canSwimNow) {
  entity.swimming = isWaterTile(sim.map, entity.x, entity.y)
  entity.floundering = entity.swimming && !canSwimNow
}

/**
 * One decision tick for something that is in water it cannot swim - dropped
 * in a lake by the spawn palette, essentially. It has no opinions left: it
 * splashes toward the nearest shore and burns energy doing it, and if the
 * shore is too far it drowns. That is the honest outcome of putting a
 * non-swimmer in a lake, and it is the same rule for both species.
 */
function flounderToward(sim, entity) {
  const land = towardNearestLand(sim.map, entity.x, entity.y)
  if (!land) return { x: Math.cos(entity.searchHeading), y: Math.sin(entity.searchHeading) }
  return land
}

function tryEat(sim, rabbit) {
  const { map, hasApple, regrowAt } = sim
  const idx = rabbit.y * map.size + rabbit.x
  if (map.canHaveApple[idx] && hasApple[idx]) {
    hasApple[idx] = 0
    regrowAt[idx] = sim.clock + REGROW_MS
    sim.regrowQueue.push(idx)
    rabbit.energy = Math.min(ENERGY_MAX, rabbit.energy + EAT_GAIN)
  }
}

function tryReproduce(sim, rabbit, desireHigh) {
  if (rabbit.gestating || !desireHigh || rabbit.energy <= REPRO_ENERGY_THRESHOLD) return
  rabbit.energy -= REPRO_COST
  rabbit.gestating = true
  rabbit.gestationRemaining = GESTATION_MS
}

// Hold a random heading for SEARCH_HEADING_TICKS decision ticks, then pick a
// new one - a persistent-but-changing sweep, not a frozen bearing and not
// per-tick jitter that cancels itself out.
function updateSearchHeading(rabbit) {
  rabbit.searchTicksLeft -= 1
  if (rabbit.searchTicksLeft <= 0) {
    rabbit.searchHeading = Math.random() * Math.PI * 2
    rabbit.searchTicksLeft = SEARCH_HEADING_TICKS
  }
}

const NEIGHBOR_OFFSETS = [
  [1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1],
]

/**
 * A neighbouring tile to be born onto - dry land for preference.
 *
 * Dry land *for preference* matters more than it sounds now that a world can
 * have a lake on every island: a newborn dropped in water it hasn't the gene
 * for flounders and usually drowns, so a warren living along a shoreline was
 * quietly losing a chunk of every generation to the nearest lake. Water is
 * still the fallback, because a parent that is itself swimming has to give
 * birth somewhere.
 */
function birthTileNear(map, x, y) {
  let wet = null
  for (const [dx, dy] of NEIGHBOR_OFFSETS) {
    const nx = x + dx
    const ny = y + dy
    if (!isPlaceable(map, nx, ny)) continue
    if (!isWaterTile(map, nx, ny)) return [nx, ny]
    if (!wet) wet = [nx, ny]
  }
  return wet ?? [x, y]
}

function finishGestation(sim, rabbit) {
  rabbit.gestating = false
  const childBrain = mutateBrain(rabbit.brain, Math.random)
  const childGenes = mutateRabbitGenes(rabbit.genes, Math.random)
  const childGen = rabbit.generation + 1
  const [nx, ny] = birthTileNear(sim.map, rabbit.x, rabbit.y)
  spawnRabbit(sim, nx, ny, childBrain, CHILD_START_ENERGY, childGen, childGenes)
}

// ============================ Going to ground ============================

/** Shout, so rabbits that haven't detected the fox themselves still get to
 * react to it. Both channels are position-carrying: a warning is only useful
 * if it says *where*. */
function callAlarm(sim, rabbit, x, y) {
  rabbit.alarmUntil = sim.clock + ALARM_CALL_MS
  rabbit.alarmX = x
  rabbit.alarmY = y
}

function callBurrow(sim, rabbit, burrow) {
  rabbit.burrowCallUntil = sim.clock + ALARM_CALL_MS
  rabbit.burrowCallX = burrow.x
  rabbit.burrowCallY = burrow.y
}

function foxNearTile(sim, x, y, radius) {
  return sim.foxes.some((f) => f.alive && Math.hypot(f.x - x, f.y - y) <= radius)
}

/**
 * Dig a new burrow under this rabbit. Returns the burrow, or null if this
 * tile won't take one.
 *
 * Digging does *not* put the rabbit underground by itself: a bolt-hole dug
 * in peacetime is infrastructure, and diving into it the moment it's
 * finished would mean a rabbit that never eats (it can't, down there) for no
 * reason at all - which cost the population far more than the foxes did when
 * this first went in. Only `hideIn` (i.e. an actual threat) sends it down.
 */
function tryDigBurrow(sim, rabbit, hideIn) {
  if (rabbit.energy <= BURROW_BUILD_ENERGY + BURROW_BUILD_RESERVE) return null
  if (isWaterTile(sim.map, rabbit.x, rabbit.y)) return null // a flooded burrow is no burrow
  if (!canDigAt(sim.burrows, rabbit.x, rabbit.y)) return null
  const burrow = createBurrow(rabbit.x, rabbit.y, rabbit.id)
  sim.burrows.push(burrow)
  rabbit.energy -= BURROW_BUILD_ENERGY
  rabbit.digging = true
  if (hideIn) enterBurrow(burrow, rabbit)
  callBurrow(sim, rabbit, burrow)
  return burrow
}

function currentBurrow(sim, rabbit) {
  return rabbit.burrowId == null ? null : sim.burrows.find((b) => b.id === rabbit.burrowId) || null
}

/**
 * One decision tick for a rabbit that is underground. It cannot eat, cannot
 * be seen and cannot be caught - so the only question is when to come back
 * up, and the answer is "when it is quiet, or when staying down any longer
 * would starve it".
 *
 * Coming up into a fox standing on the entrance would make burrows a trap
 * rather than a refuge, so a rabbit forced up by hunger takes the tunnels
 * first and surfaces at a connected burrow if the network offers a safer
 * mouth. That is the entire point of digging near an existing warren.
 */
function runShelteredTick(sim, rabbit, burrow, out, threat) {
  rabbit.running = false
  rabbit.searching = false
  rabbit.resting = true
  rabbit.fleeing = false
  rabbit.shelterTicks += 1
  rabbit.quietTicks = threat ? 0 : rabbit.quietTicks + 1
  // Only ever shout about a fox this rabbit has picked up *itself*.
  // Relaying someone else's alarm sounds helpful and is catastrophic: two
  // rabbits within earshot of each other keep each other's alarm alive
  // forever, so a warren that has gone to ground never hears an all-clear,
  // never comes up, never eats and quietly stops breeding. (The surface
  // code has always been firsthand-only, see runDecisionTick - this is the
  // sheltered path catching up with it.)
  if (threat && threat.firsthand) callAlarm(sim, rabbit, threat.x, threat.y)
  callBurrow(sim, rabbit, burrow)

  if (rabbit.shelterTicks < SHELTER_MIN_TICKS) return
  const starving = rabbit.energy <= SHELTER_HUNGRY_ENERGY
  // Nothing detected for a while means "come up and eat", regardless of how
  // strongly this genome likes cover: `hide` decides whether to take shelter
  // from something, not whether to sit underground while the field is empty.
  // (Gating the all-clear on it made most lineages stay down until they were
  // starving, which cost the population more than the foxes ever did.)
  const allClear = rabbit.quietTicks >= SHELTER_ALL_CLEAR_TICKS
  if (!starving && !allClear) return

  if (foxNearTile(sim, burrow.x, burrow.y, BURROW_MOUTH_DANGER)) {
    const escape = linkedBurrows(sim.burrows, burrow).find(
      (b) => hasSpace(b) && !foxNearTile(sim, b.x, b.y, BURROW_MOUTH_DANGER),
    )
    if (escape) {
      leaveBurrow(sim.burrows, rabbit)
      enterBurrow(escape, rabbit)
      // It came up somewhere else entirely: snap the sprite to the new mouth
      // rather than gliding it across the ground it actually tunnelled under.
      rabbit.x = escape.x
      rabbit.y = escape.y
      teleportMotion(rabbit, escape.x, escape.y)
      rabbit.shelterTicks = 0
      return
    }
    // No tunnel out and not yet desperate: sit tight rather than surface
    // into the fox's mouth.
    if (!starving) return
  }
  leaveBurrow(sim.burrows, rabbit)
  rabbit.shelterTicks = 0
}

function runDecisionTick(sim, rabbit) {
  const { map } = sim
  const stats = rabbit.senses
  const sheltered = currentBurrow(sim, rabbit)

  // Out of its depth: nothing else about this tick matters. A rabbit that
  // cannot swim but is nonetheless in water swims for the bank and nothing
  // else - it can't eat out there, and a fox is the least of its problems.
  if (!sheltered && rabbit.swimming && !stats.canSwim) {
    rabbit.running = false
    rabbit.resting = false
    rabbit.searching = false
    rabbit.fleeing = false
    updateSearchHeading(rabbit)
    const land = flounderToward(sim, rabbit)
    rabbit.stepPhase = (rabbit.stepPhase + 1) % FLOUNDER_STROKE_TICKS
    if (rabbit.stepPhase === 0) stepRabbitOnce(sim, rabbit, land.x, land.y, FLOUNDER_STROKE_TICKS * TICK_MS)
    updateWaterState(rabbit, sim, stats.canSwim)
    return
  }
  // Underground it can still hear, but it can't see the surface - no apples,
  // no watching the fox it's hiding from.
  const apple = sheltered ? null : findNearestApple(sim, rabbit.x, rabbit.y)
  const detected = findNearestDetectedFox(sim, rabbit, stats)
  const calls = hearCalls(sim, rabbit, stats)
  rabbit.alarmHeard = calls.strength

  // A fox someone else called out counts as a threat even when this rabbit
  // has picked up nothing itself - that second-hand knowledge is the whole
  // point of an alarm call. Its own senses win when both are available,
  // since they're current and a call is a moment old.
  rabbit.heardOnly = !!detected && detected.heardOnly
  const threat = detected
    ? { x: detected.x, y: detected.y, dist: detected.dist, firsthand: true }
    : calls.dangerX != null
      ? { x: calls.dangerX, y: calls.dangerY, dist: Math.hypot(calls.dangerX - rabbit.x, calls.dangerY - rabbit.y), firsthand: false }
      : null
  if (detected) callAlarm(sim, rabbit, detected.x, detected.y)

  const cover = sheltered ? null : knownBurrow(sim, rabbit, calls)
  const inputs = [
    1,
    rabbit.energy / ENERGY_MAX,
    apple ? (apple.x - rabbit.x) / VISION_RADIUS : 0,
    apple ? (apple.y - rabbit.y) / VISION_RADIUS : 0,
    apple ? apple.dist / VISION_RADIUS : 1,
    isWaterTile(map, rabbit.x, rabbit.y) ? 1 : 0,
    Math.random() * 2 - 1,
    threat ? (threat.x - rabbit.x) / PREY_ALERT_RADIUS : 0,
    threat ? (threat.y - rabbit.y) / PREY_ALERT_RADIUS : 0,
    threat ? Math.min(2, threat.dist / PREY_ALERT_RADIUS) : 1,
    calls.strength,
    // Only reported while something is actually after it - the same "reads
    // as nothing there" convention the fox inputs use. A permanently-on
    // burrow vector turned out to be actively harmful: once a warren
    // existed, every calm rabbit had a constant extra signal running through
    // random weights, which flipped a large share of the population's
    // breeding gate off and cut the no-fox carrying capacity by two thirds.
    // Where the nearest hole is only matters when you need it.
    cover && threat ? (cover.x - rabbit.x) / BURROW_SENSE_RADIUS : 0,
    cover && threat ? (cover.y - rabbit.y) / BURROW_SENSE_RADIUS : 0,
    sheltered ? 1 : 0,
  ]
  const out = think(rabbit.brain, inputs)

  if (sheltered) {
    runShelteredTick(sim, rabbit, sheltered, out, threat)
    return
  }

  rabbit.running = out.run > 0.5
  rabbit.digging = false
  rabbit.shelterTicks = 0
  rabbit.quietTicks = threat ? 0 : rabbit.quietTicks + 1

  const blind = !apple
  const hungry = rabbit.energy < HUNGRY_ENERGY

  // Fleeing outranks everything below it - a rabbit that keeps grazing with
  // a fox on top of it doesn't get to have opinions about food for long.
  // Point-blank (PANIC_RADIUS) is a hardwired reflex; so is a loud alarm
  // call from a rabbit that *can* see it, for the same reason - a warren
  // where nobody reacts to the alarm is a warren that gets eaten before
  // selection can teach it otherwise. Everything quieter than that is the
  // genome's own `flee` output deciding, which is where the real trade-off
  // lives: bolting early is safe but burns energy and abandons food, so
  // both "jumpy" and "steady" lineages are viable depending on how much
  // pressure the foxes are actually applying.
  const reflexPanic = !!threat && (threat.firsthand ? threat.dist <= PANIC_RADIUS : calls.strength >= ALARM_PANIC_STRENGTH)
  rabbit.fleeing = !!threat && (reflexPanic || out.flee > 0.5)

  // Going to ground: the alternative to outrunning a fox (issue #14). It is
  // gated on the brain's own `hide` output - founders start biased toward
  // yes, and a lineage can evolve away from it - and only ever happens under
  // threat, or calmly with energy to spare, which is how warrens get dug
  // before they're needed.
  // ...unless it is already starving. A rabbit that dives back down the
  // moment it surfaces would never eat again: it would flap between hunger
  // pushing it out and fear pulling it back until it died underground,
  // holding a burrow slot the whole time. Below the shelter-hunger line,
  // finding food outranks safety - the same "hunger is a hard instinct"
  // rule that governs resting.
  const wantsCover = out.hide > 0.5 && rabbit.energy > SHELTER_HUNGRY_ENERGY
  if (wantsCover && (threat || (!cover && rabbit.energy >= BURROW_DIG_CALM_ENERGY))) {
    if (cover && Math.max(Math.abs(cover.x - rabbit.x), Math.abs(cover.y - rabbit.y)) <= 1) {
      if (enterBurrow(cover, rabbit)) {
        callBurrow(sim, rabbit, cover)
        rabbit.running = false
        rabbit.fleeing = false
        rabbit.searching = false
        rabbit.resting = true
        rabbit.shelterTicks = 0
        return
      }
    } else if (!cover) {
      const dug = tryDigBurrow(sim, rabbit, !!threat)
      if (dug && rabbit.burrowId != null) {
        rabbit.running = false
        rabbit.fleeing = false
        rabbit.searching = false
        rabbit.resting = true
        return
      }
    }
  }

  // Hunger is a hard instinct, not a suggestion the brain can outvote: a
  // starving rabbit never just sits out a "rest" decision, whether or not
  // it currently sees food. Earlier this only cleared `resting` while also
  // blind, which left rabbits free to rest right next to (or in view of)
  // an apple they desperately needed - resting fully suppresses movement
  // below, so a "foodDrive" pull that only shows up in moveX/moveY never
  // even got a chance to run.
  rabbit.resting = rabbit.fleeing || hungry ? false : out.rest > 0.5

  // Blind to food (nothing within VISION_RADIUS): the brain's own move
  // outputs are steering off a constant food signal, so they collapse into
  // either a fixed bearing or near-paralysis - not real searching. Search
  // mode replaces them with an actual sweep, gated by two things: the
  // rabbit's own evolvable searchDrive (most genomes start biased toward
  // "yes", see SEARCH_DRIVE_INITIAL_BIAS in brain.js) as a personality
  // trait, and hunger as the same hard override as above.
  rabbit.searching = !rabbit.fleeing && blind && (hungry || out.searchDrive > 0.5)

  // Running covers ground 2x as fast but burns energy 2.5x as fast (see the
  // depletion constants above), so per tile it's *less* energy-efficient
  // than walking - a worse deal precisely when energy is the thing running
  // out. That trade only pays off chasing a specific target you might lose
  // (racing another rabbit to a visible apple, still the brain's call);
  // sprinting through an aimless blind sweep just burns through the search
  // budget faster without covering the area any more thoroughly, so it's
  // suppressed there regardless of what `run` says.
  if (rabbit.searching) rabbit.running = false
  // Running is the whole point of fleeing: at the walking cadence a rabbit
  // is slower than most foxes and simply gets caught, so a bolt is always a
  // sprint regardless of the `run` output.
  if (rabbit.fleeing) rabbit.running = true

  let moveX = out.moveX
  let moveY = out.moveY
  const boltingForCover = rabbit.fleeing && wantsCover && cover
  if (boltingForCover) {
    // Running *to* something rather than away from it: a rabbit heading for
    // a hole beats a rabbit heading for the horizon, because the chase ends
    // when it arrives instead of when the fox is faster.
    const dx = cover.x - rabbit.x
    const dy = cover.y - rabbit.y
    const len = Math.hypot(dx, dy) || 1
    moveX = dx / len
    moveY = dy / len
  } else if (rabbit.fleeing) {
    // Straight away from the fox. Terrain still applies - attemptStep won't
    // walk it into the ocean - so a rabbit can be cornered against water,
    // which is where a fast fox earns its meal.
    const dx = rabbit.x - threat.x
    const dy = rabbit.y - threat.y
    const len = Math.hypot(dx, dy)
    if (len === 0) {
      // Sharing a tile with the fox: there's no "away" vector to follow, so
      // bolt in *some* direction rather than freezing on the spot.
      updateSearchHeading(rabbit)
      moveX = Math.cos(rabbit.searchHeading)
      moveY = Math.sin(rabbit.searchHeading)
    } else {
      moveX = dx / len
      moveY = dy / len
    }
  } else if (rabbit.searching) {
    updateSearchHeading(rabbit)
    moveX = Math.cos(rabbit.searchHeading)
    moveY = Math.sin(rabbit.searchHeading)
  } else if (hungry && apple) {
    // Visible food and desperate: don't leave it up to however strong this
    // particular genome's evolved food-pull pathway happens to be - steer
    // straight at it. A well-fed rabbit still moves (or doesn't) on its own
    // evolved pull, so foodDrive as a personality trait still shows up when
    // it's not urgent; hunger just stops it from being a fatal one.
    const dx = apple.x - rabbit.x
    const dy = apple.y - rabbit.y
    const len = Math.hypot(dx, dy) || 1
    moveX = dx / len
    moveY = dy / len
  }

  const stepEvery = stepEveryTicks(map, rabbit, rabbit.running)
  rabbit.stepPhase = (rabbit.stepPhase + 1) % stepEvery
  if (!rabbit.resting && rabbit.stepPhase === 0) {
    // The step is given the whole interval until the next one as its travel
    // time, so a hop lands right as the following one is due and a swimmer
    // glides continuously rather than twitching once per cadence.
    stepRabbitOnce(sim, rabbit, moveX, moveY, stepEvery * TICK_MS)
  }
  updateWaterState(rabbit, sim, stats.canSwim)

  tryEat(sim, rabbit)
  tryReproduce(sim, rabbit, !rabbit.fleeing && out.reproduceDesire > 0.5)
}

function stepRabbit(sim, rabbit, dtMs) {
  rabbit.energyAccum += dtMs
  // Staying afloat is work: a weak swimmer burns over three times what it
  // would walking (see swimDrainFactor), and anything out of its depth burns
  // more again. That cost is the entire reason a lake is a gamble rather
  // than a free hiding place. Underground is the opposite end of the same
  // scale - a rabbit asleep in a burrow burns less than one out grazing,
  // which is what stops a warren sheltering from a permanent fox presence
  // from quietly starving itself.
  // A sea crossing costs more again than the same distance of lake (see
  // OCEAN_DRAIN_FACTOR), which is what makes migrating between islands a
  // gamble with a lineage's energy rather than a free stroll.
  const swimDrain =
    (rabbit.floundering ? FLOUNDER_DRAIN_FACTOR : rabbit.swimming ? rabbit.senses.swimDrainFactor : 1) *
    (rabbit.swimming ? waterDrainFactor(sim.map, rabbit.x, rabbit.y) : 1)
  const effort = rabbit.burrowId != null ? ENERGY_DEPLETE_SHELTERED_MS : rabbit.running ? ENERGY_DEPLETE_RUN_MS : ENERGY_DEPLETE_NORMAL_MS
  const threshold = effort / swimDrain
  while (rabbit.energyAccum >= threshold) {
    rabbit.energyAccum -= threshold
    rabbit.energy -= 1
    if (rabbit.energy <= 0) {
      rabbit.energy = 0
      rabbit.alive = false
      if (rabbit.swimming) {
        rabbit.drowned = true
        sim.drownings += 1
      }
      return
    }
  }

  if (rabbit.gestating) {
    rabbit.gestationRemaining -= dtMs
    if (rabbit.gestationRemaining <= 0) finishGestation(sim, rabbit)
  }

  rabbit.tickAccum += dtMs
  while (rabbit.tickAccum >= TICK_MS) {
    rabbit.tickAccum -= TICK_MS
    runDecisionTick(sim, rabbit)
  }

  // Visual state last, and by exactly the dt that was just simulated: any
  // step the ticks above issued starts travelling in the same frame it was
  // taken, rather than a frame behind it (see ./motion.js).
  advanceMotion(rabbit, dtMs)
}

// ================================ Foxes ==================================
// A fox's whole decision tick is: can I see a rabbit, do I want it, and can
// I still run? Everything nuanced about it lives in its genes rather than in
// branching here (see ./fox.js) - this function just reads the dials.

function tryFoxStep(sim, fox, dirX, dirY, stats, durationMs) {
  const nx = fox.x + dirX
  const ny = fox.y + dirY
  // The same waterline the rabbits face (see canRabbitEnter): a landlocked
  // fox breaks off at the shore, which is what a swimming rabbit is buying,
  // and a fox that cannot cross a channel is one an island's warren never
  // meets.
  if (!canEnterTile(sim.map, nx, ny, stats, isWaterTile(sim.map, fox.x, fox.y))) return false
  fox.x = nx
  fox.y = ny
  beginMove(fox, nx, ny, durationMs, isWaterTile(sim.map, nx, ny) ? SWIM : HOP)
  return true
}

// One tile-step along a direction vector. If the diagonal is blocked (a
// coastline, typically) it slides along whichever single axis is still open
// instead of stalling - a fox that gets stuck on a headland while its dinner
// hops away isn't scary.
function stepFoxOnce(sim, fox, moveX, moveY, stats, durationMs) {
  const dirX = moveX > MOVE_DEADZONE ? 1 : moveX < -MOVE_DEADZONE ? -1 : 0
  const dirY = moveY > MOVE_DEADZONE ? 1 : moveY < -MOVE_DEADZONE ? -1 : 0
  if (dirX === 0 && dirY === 0) return
  if (tryFoxStep(sim, fox, dirX, dirY, stats, durationMs)) return
  if (dirX !== 0 && tryFoxStep(sim, fox, dirX, 0, stats, durationMs)) return
  if (dirY !== 0) tryFoxStep(sim, fox, 0, dirY, stats, durationMs)
}

// Fractional movement: a fox banks `tilesPerTick` of credit each decision
// tick and steps a whole tile every time that crosses 1. A slow fox moves
// every third tick, a fast one every tick and occasionally twice - all from
// one continuous gene, rather than the integer tick cadence rabbits use.
function moveFox(sim, fox, moveX, moveY, tilesPerTick, stats) {
  fox.stepCredit += tilesPerTick
  let steps = 0
  // How long one tile *should* take at this pace, which is what the sprite
  // is given to travel it in - so a prowling fox glides and a sprinting one
  // covers the ground visibly faster (see ./motion.js).
  const durationMs = Math.max(60, Math.min(4, 1 / Math.max(0.05, tilesPerTick)) * TICK_MS)
  while (fox.stepCredit >= 1 && steps < FOX_MAX_STEPS_PER_TICK) {
    fox.stepCredit -= 1
    steps += 1
    stepFoxOnce(sim, fox, moveX, moveY, stats, durationMs)
  }
  if (fox.stepCredit >= 1) fox.stepCredit = 1 - 1e-6 // don't bank an unbounded backlog
}

/** The pounce: any rabbit within POUNCE_RANGE of a hunting fox is taken. */
function tryPounce(sim, fox, stats) {
  if (!fox.hunting) return
  for (const rabbit of sim.rabbits) {
    // Underground is out of reach: a fox can stand on the entrance all it
    // likes (and that does keep the rabbit down there, starving), but it
    // cannot dig one out.
    if (!rabbit.alive || rabbit.burrowId != null) continue
    if (Math.abs(rabbit.x - fox.x) > POUNCE_RANGE || Math.abs(rabbit.y - fox.y) > POUNCE_RANGE) continue
    rabbit.alive = false
    rabbit.energy = 0
    fox.energy = Math.min(FOX_ENERGY_MAX, fox.energy + stats.energyPerKill)
    fox.kills += 1
    sim.kills += 1
    fox.feedingRemaining = FOX_FEED_MS
    fox.hunting = false
    fox.sprinting = false
    return
  }
}

/**
 * The other way a fox eats: a grab at whatever is in reach along the water's
 * edge. Crabs first, because a crab is the easier of the two and a fox with
 * one in front of it is not going to ignore it in favour of a fish.
 *
 * Unlike the pounce, this can *miss* - a fish flicks away, a shell turns the
 * paw - which is the whole difference between the two food sources. A rabbit
 * is rare, fast and worth a great deal when it works; the tideline is
 * constant, slow and worth a mouthful when it works, and it works often
 * enough to live on. Both species' escape odds come off their own genes (see
 * `evasion` in fish.js and `toughness` in crab.js), so what a fox is really
 * chasing along a beach is a population that is getting harder to catch.
 */
function tryCatchShorePrey(sim, fox, stats) {
  if (!fox.foraging) return
  const inReach = (c) => Math.abs(c.x - fox.x) <= POUNCE_RANGE && Math.abs(c.y - fox.y) <= POUNCE_RANGE
  for (const crab of sim.crabs) {
    if (!crab.alive || !inReach(crab)) continue
    if (Math.random() >= CRAB_CATCH_CHANCE * (1 - crab.stats.toughness)) continue
    takeShorePrey(sim, fox, crab, stats.energyPerKill * CRAB_MEAL_SHARE)
    return
  }
  for (const fish of sim.fish) {
    if (!fish.alive || !inReach(fish)) continue
    const base = fox.swimming ? FISH_CATCH_CHANCE.swimming : FISH_CATCH_CHANCE.bank
    if (Math.random() >= base * (1 - fish.stats.evasion)) continue
    takeShorePrey(sim, fox, fish, stats.energyPerKill * FISH_MEAL_SHARE)
    return
  }
}

function takeShorePrey(sim, fox, prey, gain) {
  prey.alive = false
  prey.energy = 0
  fox.energy = Math.min(FOX_ENERGY_MAX, fox.energy + gain)
  fox.catches += 1
  sim.shoreCatches += 1
  fox.feedingRemaining = SHORE_FEED_MS
  fox.foraging = false
}

/** True when another live fox is close enough that this one will not den
 * here (see FOX_TERRITORY_RADIUS). */
function territoryTaken(sim, fox) {
  return sim.foxes.some((other) => other !== fox && other.alive && Math.hypot(other.x - fox.x, other.y - fox.y) <= FOX_TERRITORY_RADIUS)
}

function tryFoxReproduce(sim, fox, stats, wants) {
  if (fox.gestating || !wants || fox.energy <= stats.breedEnergy) return
  if (sim.clock < fox.nextLitterAt) return
  if (territoryTaken(sim, fox)) return
  fox.energy -= FOX_REPRO_COST
  fox.gestating = true
  fox.gestationRemaining = stats.gestationMs
}

function finishFoxGestation(sim, fox) {
  fox.gestating = false
  fox.nextLitterAt = sim.clock + FOX_LITTER_RECOVERY_MS
  const cubGenes = mutateFoxGenes(fox.genes, Math.random)
  const cubBrain = mutateFoxBrain(fox.brain, Math.random)
  const cubGen = fox.generation + 1
  const [nx, ny] = birthTileNear(sim.map, fox.x, fox.y)
  const cub = spawnFox(sim, nx, ny, cubGenes, FOX_CUB_ENERGY, cubGen, cubBrain)
  cub.nextLitterAt = sim.clock + FOX_LITTER_RECOVERY_MS
}

/**
 * What the fox's net gets to see this tick. Order is load-bearing - it has
 * to match FOX_INPUT_LABELS / the IN indices in foxInsight.js, which is what
 * the trait bars and the network diagram are labelled from.
 *
 * Directions are unit vectors and distances are normalized against the
 * sense that produced them, so every fox reads its world on the same 0..1
 * scale whatever its genes are: "prey distance 1" means "at the edge of what
 * I can see", not a fixed number of tiles. Nothing detected reads as
 * distance 1 with a zero direction - the same convention the rabbit inputs
 * use for "no apple, no fox".
 */
function buildFoxInputs(fox, stats, prey, scent, packmate, visionRadius, inForest, shorePrey, shoreRadius) {
  return [
    1,
    fox.energy / FOX_ENERGY_MAX,
    prey ? (prey.rabbit.x - fox.x) / visionRadius : 0,
    prey ? (prey.rabbit.y - fox.y) / visionRadius : 0,
    prey ? prey.dist / visionRadius : 1,
    scent ? scent.dx : 0,
    scent ? scent.dy : 0,
    scent ? scent.strength : 0,
    packmate ? (packmate.fox.x - fox.x) / stats.packRadius : 0,
    packmate ? (packmate.fox.y - fox.y) / stats.packRadius : 0,
    packmate ? packmate.dist / stats.packRadius : 1,
    Math.min(1, fox.sprintBudget / Math.max(1, stats.maxSprintTicks)),
    inForest ? 1 : 0,
    shorePrey ? (shorePrey.creature.x - fox.x) / shoreRadius : 0,
    shorePrey ? (shorePrey.creature.y - fox.y) / shoreRadius : 0,
    shorePrey ? shorePrey.dist / shoreRadius : 1,
    Math.random() * 2 - 1,
  ]
}

function runFoxDecisionTick(sim, fox) {
  const stats = foxStats(fox.genes)

  // Out of its depth, same rule as the rabbits: swim for the bank or drown
  // trying. A fox in this state is not hunting anything.
  if (fox.floundering) {
    fox.hunting = false
    fox.sprinting = false
    fox.foraging = false
    fox.packing = false
    const land = towardNearestLand(sim.map, fox.x, fox.y)
    const dir = land || { x: Math.cos(fox.searchHeading), y: Math.sin(fox.searchHeading) }
    fox.heading = Math.atan2(dir.y, dir.x)
    moveFox(sim, fox, dir.x, dir.y, stats.prowlTilesPerTick * FLOUNDER_SPEED_FACTOR, stats)
    updateWaterState(fox, sim, stats.canSwim)
    return
  }
  // Mid-meal: it stands over the carcass rather than immediately chasing
  // the next rabbit, which is both realistic and the thing that stops one
  // fast fox from clearing a whole warren in a few seconds.
  if (fox.feedingRemaining > 0) {
    fox.hunting = false
    fox.sprinting = false
    fox.tracking = false
    fox.foraging = false
    fox.resting = false
    fox.sprintBudget = Math.min(stats.maxSprintTicks, fox.sprintBudget + 0.5 + fox.genes.stamina)
    return
  }

  // Forest cover cuts a fox's vision by 45% (issue #14): under a canopy it
  // is hunting by luck as much as by eyesight, which is what turns woodland
  // into somewhere a rabbit can plausibly live rather than just the place
  // the apples are. Measured from the tile the *fox* is standing on - it's
  // the fox's own sightlines the trees are blocking. Its nose is unaffected:
  // trees block sightlines, not smells, which is what stops woodland from
  // being a place rabbits are simply safe.
  const inForest = hasCover(sim.map.tileType[fox.y * sim.map.size + fox.x])
  const visionRadius = stats.visionRadius * (inForest ? FOREST_VISION_FACTOR : 1)
  const prey = findNearestPrey(sim, fox, visionRadius)
  const scent = senseScent(sim, fox, stats.scentRadius)
  const packmate = findNearestPackmate(sim, fox, stats.packRadius)
  // A fish or a crab is a small thing close to the ground, so it is spotted
  // at a fraction of the range a rabbit is - but it is spotted through the
  // trees just the same, and it does not run nearly as far.
  const shoreRadius = visionRadius * SHORE_PREY_VISION_FACTOR
  const shorePrey = findNearestShorePrey(sim, fox, shoreRadius, stats.canSwim)
  fox.packing = !!packmate
  fox.scentStrength = scent ? scent.strength : 0

  const out = foxThink(fox.brain, buildFoxInputs(fox, stats, prey, scent, packmate, visionRadius, inForest, shorePrey, shoreRadius))

  // Every one of these is the brain's call, gated at 0.5 - where the old fox
  // had an if/else ladder and one `bloodlust` number. Hunting a rabbit it
  // can see beats following a smell, which beats regrouping, which beats
  // lying down: a fox cannot do two of them at once, so they resolve in
  // order of how immediate they are rather than by which output happens to
  // be largest.
  fox.hunting = !!prey && out.chase > 0.5
  // The tideline sits directly below chasing a rabbit and above everything
  // else: a rabbit is worth four crabs, so a fox that can see one goes for
  // it, but a crab in reach beats lying up, following a smell or catching up
  // with the pack - all three of which are ways of *maybe* eating later.
  //
  // Hunger overrides the brain here exactly as it does for resting: a fox
  // down to its last reserves takes the certain mouthful whatever its
  // instincts say about beachcombing. That override is what makes "the foxes
  // survive without rabbits" a property of the simulation rather than of
  // whichever lineage happened to evolve a taste for shellfish.
  const starving = fox.energy <= FOX_ROUSE_ENERGY
  fox.foraging = !fox.hunting && !!shorePrey && (out.forage > 0.5 || starving)
  // Lying up outranks the nose on purpose: "sit tight and take whatever
  // wanders past" and "walk the island following smells" are the two
  // strategies this net can express, and they are only genuinely different
  // if choosing the first one means passing up the second. Hunger overrides
  // it either way (see FOX_ROUSE_ENERGY) - resting finds nothing, so it has
  // to be something a fox does with reserves, not instead of eating.
  // Not in the water, either: treading water is not resting, and a fox
  // that stopped swimming to have a lie-down would simply drown.
  fox.resting = !fox.hunting && !fox.foraging && !fox.swimming && out.rest > 0.5 && fox.energy > FOX_ROUSE_ENERGY
  fox.tracking = !fox.hunting && !fox.foraging && !fox.resting && !!scent && out.track > 0.5
  const grouping =
    !fox.hunting && !fox.foraging && !fox.resting && !fox.tracking && !!packmate && out.group > 0.5 && packmate.dist > FOX_PACK_KEEP_DISTANCE

  let moveX = 0
  let moveY = 0
  let tilesPerTick = stats.prowlTilesPerTick

  if (fox.hunting) {
    const dx = prey.rabbit.x - fox.x
    const dy = prey.rabbit.y - fox.y
    const len = Math.hypot(dx, dy) || 1
    moveX = dx / len
    moveY = dy / len
    // Sprinting is rationed by stamina and only worth spending once the prey
    // is close enough for the burst to end in a pounce - but *whether* to
    // spend it there is the brain's decision, so a lineage can evolve into
    // patient stalkers or into foxes that blow their legs out at every
    // glimpse of a rabbit.
    fox.sprinting = fox.sprintBudget >= 1 && prey.dist <= FOX_SPRINT_RANGE && out.sprint > 0.5
    if (fox.sprinting) {
      fox.sprintBudget -= 1
      // A packmate in support means the rabbit has two directions to worry
      // about, so the chase closes faster. This is the second half of what
      // pack instinct buys, alongside the pull toward other foxes below.
      tilesPerTick = stats.sprintTilesPerTick * (fox.packing ? 1 + stats.packSpeedBonus : 1)
    }
  } else {
    fox.sprinting = false
    if (fox.foraging) {
      // Straight at it, at a walk. Nothing sprints at a crab: the whole
      // appeal of the tideline is that it does not run far enough to be
      // worth spending stamina on.
      const dx = shorePrey.creature.x - fox.x
      const dy = shorePrey.creature.y - fox.y
      const len = Math.hypot(dx, dy) || 1
      moveX = dx / len
      moveY = dy / len
    } else if (fox.tracking) {
      // Up the scent gradient, or at least the fox's best guess at it.
      moveX = scent.dx
      moveY = scent.dy
    } else if (grouping) {
      // Regroup: drift toward the pack rather than sweeping alone, so
      // sociable lineages end up hunting the same ground together.
      const dx = packmate.fox.x - fox.x
      const dy = packmate.fox.y - fox.y
      const len = Math.hypot(dx, dy) || 1
      moveX = dx / len
      moveY = dy / len
    } else if (!fox.resting) {
      // Same held-then-re-randomized sweep the rabbits use when blind.
      updateSearchHeading(fox)
      moveX = Math.cos(fox.searchHeading)
      moveY = Math.sin(fox.searchHeading)
    }
  }

  if (!fox.sprinting) fox.sprintBudget = Math.min(stats.maxSprintTicks, fox.sprintBudget + 0.5 + fox.genes.stamina)
  if (moveX !== 0 || moveY !== 0) fox.heading = Math.atan2(moveY, moveX)
  // Swimming is not sprinting: whatever the chase was, in the water it is a
  // paddle at whatever fraction of its pace the fox's swim gene allows.
  if (fox.swimming) {
    fox.sprinting = false
    tilesPerTick = stats.prowlTilesPerTick * stats.swimSpeedFactor
  }

  if (!fox.resting) moveFox(sim, fox, moveX, moveY, tilesPerTick, stats)
  updateWaterState(fox, sim, stats.canSwim)
  tryPounce(sim, fox, stats)
  tryCatchShorePrey(sim, fox, stats)
  tryFoxReproduce(sim, fox, stats, out.breed > 0.5)
}

function stepFox(sim, fox, dtMs) {
  const stats = foxStats(fox.genes)
  // Continuous drain rather than the rabbits' whole-number ticks: a fox's
  // burn rate is a gene, so it needs the resolution. A fox lying up burns a
  // fraction of it - the payoff for a decision its brain made and could just
  // as easily evolve out of - and one in the water burns more, whether it is
  // swimming properly or out of its depth.
  const swimDrain =
    (fox.floundering ? FLOUNDER_DRAIN_FACTOR : fox.swimming ? stats.swimUpkeepMultiplier : 1) *
    (fox.swimming ? waterDrainFactor(sim.map, fox.x, fox.y) : 1)
  const effort = fox.sprinting ? stats.sprintUpkeepMultiplier : fox.resting ? stats.restUpkeepFactor : 1
  fox.energy -= stats.upkeepPerSec * effort * swimDrain * (dtMs / 1000)
  if (fox.energy <= 0) {
    fox.energy = 0
    fox.alive = false
    if (fox.swimming) {
      fox.drowned = true
      sim.drownings += 1
    }
    return
  }

  if (fox.feedingRemaining > 0) fox.feedingRemaining -= dtMs
  if (fox.gestating) {
    fox.gestationRemaining -= dtMs
    if (fox.gestationRemaining <= 0) finishFoxGestation(sim, fox)
  }

  fox.tickAccum += dtMs
  while (fox.tickAccum >= TICK_MS) {
    fox.tickAccum -= TICK_MS
    runFoxDecisionTick(sim, fox)
  }

  advanceMotion(fox, dtMs)
}

// ============================ Shoreline life =============================
// Fish and crabs: the second food chain, and the one that does not run
// through a rabbit (see ./shallows.js for why it exists at all).
//
// Neither species has a brain, and the code below is why that is enough.
// A fish eats, holds with the shoal and bolts; a crab eats, and gets back in
// the water. What varies between individuals is entirely in their genes -
// how fast, how twitchy, how tightly shoaled, how far up the beach - so the
// interesting evolution here is a population being *reshaped* by the foxes
// working it, rather than a population arguing with itself about what to do.

/** The nearest live fox within `radius` of a point. Both aquatic species'
 * entire threat model. */
function nearestFoxWithin(sim, x, y, radius) {
  let best = null
  let bestDist = Infinity
  for (const fox of sim.foxes) {
    if (!fox.alive) continue
    const dist = Math.hypot(fox.x - x, fox.y - y)
    if (dist > radius || dist >= bestDist) continue
    bestDist = dist
    best = fox
  }
  return best ? { fox: best, dist: bestDist } : null
}

/**
 * *A* live fish within `radius` - the first one found, not the nearest.
 *
 * A shoal is not a formation, it is a habit of not being alone, so "hold
 * station with whichever neighbour I noticed" is both the honest model and
 * the cheap one: it lets the scan stop at the first hit instead of walking
 * every fish in the world, which is the difference between a lake of two
 * hundred fish costing linear work per tick and quadratic.
 */
function anyShoalmate(sim, fish, radius) {
  for (const other of sim.fish) {
    if (other === fish || !other.alive) continue
    const dist = Math.hypot(other.x - fish.x, other.y - fish.y)
    if (dist <= radius) return { fish: other, dist }
  }
  return null
}

/** The nearest tile within `radius` that is bearing forage *and* that this
 * creature may enter. A box scan rather than anything cleverer: the radius is
 * four tiles, and both species are cheap enough to think about that there is
 * nothing here worth indexing. */
function findNearestForage(sim, x, y, radius, canEnter) {
  const { map, hasForage } = sim
  let bestDist = Infinity
  let bestX = -1
  let bestY = -1
  for (let ty = Math.max(0, y - radius); ty <= Math.min(map.size - 1, y + radius); ty++) {
    for (let tx = Math.max(0, x - radius); tx <= Math.min(map.size - 1, x + radius); tx++) {
      if (!hasForage[ty * map.size + tx]) continue
      const dist = Math.hypot(tx - x, ty - y)
      if (dist > radius || dist >= bestDist) continue
      if (!canEnter(tx, ty)) continue
      bestDist = dist
      bestX = tx
      bestY = ty
    }
  }
  return bestX < 0 ? null : { x: bestX, y: bestY, dist: bestDist }
}

/**
 * The patch this creature is currently making for, remembered between ticks.
 *
 * The scan itself is a box of tiles around it, and both species do it while
 * hungry, which is most of the time - so doing it every tick for every fish
 * in a full lake is the single most expensive thing the shoreline added.
 * Remembering the target costs one object and makes it rare: a fish
 * re-scans when it arrives, when something else eats the patch first, or
 * (FORAGE_RESCAN_MS later) when the last look found nothing at all.
 */
function forageTargetFor(sim, entity, canEnter) {
  const t = entity.forageTarget
  if (t && sim.hasForage[t.y * sim.map.size + t.x] && canEnter(t.x, t.y) && (t.x !== entity.x || t.y !== entity.y)) return t
  if (sim.clock < entity.nextForageScan) return null
  const found = findNearestForage(sim, entity.x, entity.y, FORAGE_SIGHT_RADIUS, canEnter)
  entity.forageTarget = found ? { x: found.x, y: found.y } : null
  if (!found) entity.nextForageScan = sim.clock + FORAGE_RESCAN_MS
  return entity.forageTarget
}

/** Eat the algae/wrack under this creature, if there is any and it has room
 * for it. The "has room" clause matters: without it a full shoal strips the
 * shallows bare for nothing, and the carrying capacity the whole food chain
 * rests on stops meaning anything. */
function takeForage(sim, entity, gain, energyMax) {
  const idx = entity.y * sim.map.size + entity.x
  if (!sim.hasForage[idx] || entity.energy > energyMax - gain) return false
  sim.hasForage[idx] = 0
  sim.forageRegrowAt[idx] = sim.clock + FORAGE_REGROW_MS
  sim.forageQueue.push(idx)
  entity.energy = Math.min(energyMax, entity.energy + gain)
  return true
}

/** A unit vector toward whichever neighbouring tile is closer to the water -
 * the crab's version of towardNearestLand (see water.js), and the reason a
 * crab caught out on the sand has somewhere to run. */
function towardWater(sim, x, y) {
  const { map, shoreDist } = sim
  const here = shoreDist[y * map.size + x]
  let bestX = 0
  let bestY = 0
  let best = here
  for (const [dx, dy] of NEIGHBOR_OFFSETS) {
    const nx = x + dx
    const ny = y + dy
    if (!inBounds(map, nx, ny)) continue
    const d = shoreDist[ny * map.size + nx]
    if (d >= best) continue
    best = d
    bestX = dx
    bestY = dy
  }
  if (bestX === 0 && bestY === 0) return null
  const len = Math.hypot(bestX, bestY) || 1
  return { x: bestX / len, y: bestY / len }
}

function tryAquaticStep(sim, entity, dirX, dirY, canEnter, durationMs) {
  const nx = entity.x + dirX
  const ny = entity.y + dirY
  if (!canEnter(nx, ny)) return false
  entity.x = nx
  entity.y = ny
  entity.swimming = isWaterTile(sim.map, nx, ny)
  beginMove(entity, nx, ny, durationMs, entity.swimming ? SWIM : HOP)
  return true
}

/** One tile-step, sliding along a single axis if the diagonal is blocked -
 * the same treatment the other two species get (see stepRabbitOnce), and it
 * matters more here than anywhere: a fish's world is *entirely* edges. */
function stepAquaticOnce(sim, entity, moveX, moveY, canEnter, durationMs) {
  const dirX = moveX > MOVE_DEADZONE ? 1 : moveX < -MOVE_DEADZONE ? -1 : 0
  const dirY = moveY > MOVE_DEADZONE ? 1 : moveY < -MOVE_DEADZONE ? -1 : 0
  if (dirX === 0 && dirY === 0) return false
  if (tryAquaticStep(sim, entity, dirX, dirY, canEnter, durationMs)) return true
  if (dirX !== 0 && tryAquaticStep(sim, entity, dirX, 0, canEnter, durationMs)) return true
  return dirY !== 0 && tryAquaticStep(sim, entity, 0, dirY, canEnter, durationMs)
}

/** A neighbouring tile to be born onto, or the parent's own if the water
 * around it is full up against a bank. */
function aquaticBirthTile(x, y, canEnter) {
  for (const [dx, dy] of NEIGHBOR_OFFSETS) {
    if (canEnter(x + dx, y + dy)) return [x + dx, y + dy]
  }
  return [x, y]
}

/** Where a fish may go: sunlit water and nowhere else. The deep is as much a
 * wall to it as the beach is - it grows nothing, and a fish that wandered out
 * there would starve in a place nothing could even eat it. */
function fishCanEnter(sim, x, y) {
  return isShallows(sim.map, x, y)
}

/**
 * Where a crab may go: the shallows always, plus however much dry land its
 * boldness gene will carry it across (see `landReach` in crab.js).
 *
 * The last clause is the escape hatch. A crab that finds itself further
 * inland than its own genes allow - dropped there by the spawn palette, or
 * hatched from a bolder parent - is not frozen in place: it may always move
 * *closer* to the water. Same reasoning as the `fromWater` exemption in
 * water.js: habitat rules should shape where something lives, not build traps
 * it cannot walk out of.
 */
function crabCanEnter(sim, crab, x, y) {
  const { map } = sim
  if (!inBounds(map, x, y)) return false
  if (isWaterTile(map, x, y)) return isShallows(map, x, y)
  const d = sim.shoreDist[y * map.size + x]
  if (d <= crab.stats.landReach) return true
  return d < sim.shoreDist[crab.y * map.size + crab.x]
}

function runFishTick(sim, fish) {
  const stats = fish.stats
  const shoalmate = stats.shoalRadius > 0 ? anyShoalmate(sim, fish, stats.shoalRadius) : null
  fish.shoaling = !!shoalmate
  // Collective vigilance: the shoal is watching for you too.
  const alert = stats.alertRadius * (1 + (shoalmate ? stats.shoalAlertBonus : 0))
  const threat = nearestFoxWithin(sim, fish.x, fish.y, alert)
  fish.fleeing = !!threat

  let moveX = 0
  let moveY = 0
  if (threat) {
    const dx = fish.x - threat.fox.x
    const dy = fish.y - threat.fox.y
    const len = Math.hypot(dx, dy)
    if (len === 0) {
      updateSearchHeading(fish)
      moveX = Math.cos(fish.searchHeading)
      moveY = Math.sin(fish.searchHeading)
    } else {
      moveX = dx / len
      moveY = dy / len
    }
  } else {
    const hungry = fish.energy < FISH_ENERGY_MAX * AQUATIC_HUNGRY_FRACTION
    const food = hungry ? forageTargetFor(sim, fish, (x, y) => fishCanEnter(sim, x, y)) : null
    if (food) {
      const dx = food.x - fish.x
      const dy = food.y - fish.y
      const len = Math.hypot(dx, dy) || 1
      moveX = dx / len
      moveY = dy / len
    } else if (shoalmate && shoalmate.dist > 1.5) {
      const dx = shoalmate.fish.x - fish.x
      const dy = shoalmate.fish.y - fish.y
      const len = Math.hypot(dx, dy) || 1
      moveX = dx / len
      moveY = dy / len
    } else {
      updateSearchHeading(fish)
      moveX = Math.cos(fish.searchHeading)
      moveY = Math.sin(fish.searchHeading)
    }
  }

  fish.stepPhase = (fish.stepPhase + 1) % stats.strokeTicks
  if (fish.stepPhase === 0) {
    stepAquaticOnce(sim, fish, moveX, moveY, (x, y) => fishCanEnter(sim, x, y), stats.strokeTicks * TICK_MS)
  }

  takeForage(sim, fish, FISH_BITE_ENERGY, FISH_ENERGY_MAX)

  if (fish.energy >= stats.breedEnergy && sim.clock >= fish.nextBreedAt && sim.fish.length < sim.fishCap) {
    fish.energy -= FISH_BREED_COST
    fish.nextBreedAt = sim.clock + stats.breedCooldownMs
    const [nx, ny] = aquaticBirthTile(fish.x, fish.y, (x, y) => fishCanEnter(sim, x, y))
    const fry = spawnFish(sim, nx, ny, mutateFishGenes(fish.genes, Math.random), FISH_FRY_ENERGY, fish.generation + 1)
    // Fry are born on the clock, exactly like fox cubs (see
    // finishFoxGestation): without it a fish that eats two patches of algae
    // spawns, and so does everything it spawned, and the shallows go from
    // forty fish to their ceiling inside ten seconds. A generation should
    // take a generation.
    fry.nextBreedAt = sim.clock + fry.stats.breedCooldownMs
  }
}

function runCrabTick(sim, crab) {
  const stats = crab.stats
  const threat = nearestFoxWithin(sim, crab.x, crab.y, stats.alertRadius)
  const stranded = !isWaterTile(sim.map, crab.x, crab.y) && sim.shoreDist[crab.y * sim.map.size + crab.x] > stats.landReach
  crab.fleeing = !!threat

  let moveX = 0
  let moveY = 0
  const water = threat || stranded ? towardWater(sim, crab.x, crab.y) : null
  if (water) {
    // Everything a crab does when frightened is "get back in the sea".
    moveX = water.x
    moveY = water.y
  } else if (threat) {
    // Already in the water: put distance between itself and the bank.
    const dx = crab.x - threat.fox.x
    const dy = crab.y - threat.fox.y
    const len = Math.hypot(dx, dy) || 1
    moveX = dx / len
    moveY = dy / len
  } else {
    const hungry = crab.energy < CRAB_ENERGY_MAX * AQUATIC_HUNGRY_FRACTION
    const food = hungry ? forageTargetFor(sim, crab, (x, y) => crabCanEnter(sim, crab, x, y)) : null
    if (food) {
      const dx = food.x - crab.x
      const dy = food.y - crab.y
      const len = Math.hypot(dx, dy) || 1
      moveX = dx / len
      moveY = dy / len
    } else {
      updateSearchHeading(crab)
      moveX = Math.cos(crab.searchHeading)
      moveY = Math.sin(crab.searchHeading)
    }
  }

  crab.stepPhase = (crab.stepPhase + 1) % stats.strokeTicks
  if (crab.stepPhase === 0) {
    stepAquaticOnce(sim, crab, moveX, moveY, (x, y) => crabCanEnter(sim, crab, x, y), stats.strokeTicks * TICK_MS)
  }

  takeForage(sim, crab, CRAB_BITE_ENERGY, CRAB_ENERGY_MAX)

  if (crab.energy >= stats.breedEnergy && sim.clock >= crab.nextBreedAt && sim.crabs.length < sim.crabCap) {
    crab.energy -= CRAB_BREED_COST
    crab.nextBreedAt = sim.clock + stats.breedCooldownMs
    const [nx, ny] = aquaticBirthTile(crab.x, crab.y, (x, y) => crabCanEnter(sim, crab, x, y))
    const hatchling = spawnCrab(sim, nx, ny, mutateCrabGenes(crab.genes, Math.random), CRAB_HATCHLING_ENERGY, crab.generation + 1)
    hatchling.nextBreedAt = sim.clock + hatchling.stats.breedCooldownMs
  }
}

/** The energy/lifecycle half, shared by both shoreline species: a continuous
 * burn (like a fox's, since their upkeep is a gene rather than a constant),
 * then however many decision ticks fit in the elapsed time. */
function stepAquatic(sim, entity, dtMs, runTick) {
  entity.energy -= entity.stats.upkeepPerSec * (entity.fleeing ? AQUATIC_FLEE_UPKEEP : 1) * (dtMs / 1000)
  if (entity.energy <= 0) {
    entity.energy = 0
    entity.alive = false
    return
  }
  entity.tickAccum += dtMs
  while (entity.tickAccum >= TICK_MS) {
    entity.tickAccum -= TICK_MS
    runTick(sim, entity)
  }
  advanceMotion(entity, dtMs)
}

// Only the patches that have actually been eaten are waiting to regrow, so
// they are kept as a list rather than found by sweeping the map every frame -
// on a 224-tile world that sweep was fifty thousand checks a frame to notice
// a handful of apples. Shared by the apple trees and the shallows, which
// regrow on exactly the same rules at different rates.
function regrowPatches(clock, queue, has, regrowAt) {
  if (!queue.length) return
  let keep = 0
  for (let i = 0; i < queue.length; i++) {
    const idx = queue[i]
    if (regrowAt[idx] >= 0 && clock >= regrowAt[idx]) {
      has[idx] = 1
      regrowAt[idx] = -1
    } else if (regrowAt[idx] >= 0) {
      queue[keep++] = idx
    }
  }
  queue.length = keep
}

// Snapshot population-wide average traits every TRAIT_SAMPLE_MS, so the UI
// can show how the gene pool is drifting over time rather than just a
// single rabbit's wiring. Cheap: the net is tiny and this only runs a few
// times a minute.
const RABBIT_TRAIT_KEYS = ['foodDrive', 'wanderer', 'boldness', 'restfulness', 'broodiness', 'searchDrive', 'skittishness', 'burrowInstinct', 'heedsAlarm']

// The fox instincts worth a trend line, from the same net the inspector
// draws (see foxInsight.js). This is the fox half of "watch selection
// happen": a pack that starts out chasing everything and drifts toward
// hunting only when hungry has been taught that by the rabbits.
const FOX_TRAIT_KEYS = ['aggression', 'tracking', 'commitment', 'sociability', 'idleness', 'broodiness', 'patience', 'beachcombing']

/** Population-wide averages of the fox brains' traits, or null with no foxes
 * alive - same null-vs-zeros reasoning as averageFoxGenes. */
function averageFoxTraits(foxes) {
  if (foxes.length === 0) return null
  const avg = {}
  for (const key of FOX_TRAIT_KEYS) avg[key] = 0
  for (const fox of foxes) {
    const t = computeFoxTraits(fox.brain)
    for (const key of FOX_TRAIT_KEYS) avg[key] += t[key]
  }
  for (const key of FOX_TRAIT_KEYS) avg[key] /= foxes.length
  return avg
}

/** Population-wide averages of an arbitrary gene vector, or null with nothing
 * alive - null rather than zeros so a chart can tell "none left" apart from
 * "all of them sit at 0". */
function averageGenes(creatures, keys) {
  if (creatures.length === 0) return null
  const avg = {}
  for (const key of keys) {
    let sum = 0
    for (const c of creatures) sum += c.genes[key]
    avg[key] = sum / creatures.length
  }
  return avg
}

function sampleTraitHistory(sim) {
  const rabbits = sim.rabbits
  const foxes = sim.foxes
  const sample = {
    tSec: sim.clock / 1000,
    population: rabbits.length,
    foxPopulation: foxes.length,
    // The shoreline, as a trend: a fox population riding out a rabbit crash
    // shows up here as the fish and crab curves being eaten down while the
    // fox curve holds - which is the whole thing they were added for.
    fishPopulation: sim.fish.length,
    crabPopulation: sim.crabs.length,
    kills: sim.kills,
    shoreCatches: sim.shoreCatches,
    minGen: null,
    maxGen: null,
    foxMinGen: null,
    foxMaxGen: null,
    foxGenes: averageGenes(foxes, FOX_GENE_KEYS),
    foxTraits: averageFoxTraits(foxes),
    fishGenes: averageGenes(sim.fish, FISH_GENE_KEYS),
    crabGenes: averageGenes(sim.crabs, CRAB_GENE_KEYS),
    // The warren, as a population-level statistic: how much shelter exists
    // and how much of it is in use right now.
    burrows: sim.burrows.length,
    sheltered: rabbits.filter((r) => r.burrowId != null).length,
    rabbitGenes: averageGenes(rabbits, RABBIT_GENE_KEYS),
  }
  for (const key of RABBIT_TRAIT_KEYS) sample[key] = 0

  if (foxes.length) {
    sample.foxMinGen = Math.min(...foxes.map((f) => f.generation))
    sample.foxMaxGen = Math.max(...foxes.map((f) => f.generation))
  }

  // With no rabbits alive the zeroed sample is still recorded, so a
  // population-over-time chart shows the crash landing at 0 instead of just
  // stopping at its last live sample.
  if (rabbits.length) {
    let minGen = Infinity
    let maxGen = -Infinity
    for (const r of rabbits) {
      const t = computeTraits(r.brain)
      for (const key of RABBIT_TRAIT_KEYS) sample[key] += t[key]
      if (r.generation < minGen) minGen = r.generation
      if (r.generation > maxGen) maxGen = r.generation
    }
    for (const key of RABBIT_TRAIT_KEYS) sample[key] /= rabbits.length
    sample.minGen = minGen
    sample.maxGen = maxGen
  }

  sim.traitHistory.push(sample)
  if (sim.traitHistory.length > TRAIT_HISTORY_LIMIT) sim.traitHistory.shift()
  sim.fullHistory.push(sample)
}

/**
 * Who is living on which landmass right now.
 *
 * This is the number a world of several islands exists to produce: two
 * warrens on two islands are two populations, evolving apart, and a fox
 * population that never crossed the channel is a fox population that island's
 * rabbits will never meet. Anything currently in the water is counted against
 * the island it is swimming from (its tile's landId is -1, so it lands in
 * `atSea` instead), which is how a crossing in progress shows up.
 *
 * @returns {{islands: Array<{id:number, area:number, cx:number, cy:number,
 *   rabbits:number, foxes:number}>, atSea:number, colonised:number}}
 */
export function islandPopulations(sim) {
  const { map } = sim
  if (!map.islands || !map.landId) return { islands: [], atSea: 0, colonised: 0 }
  const byId = new Map()
  for (const island of map.islands) {
    if (island.notable === false) continue
    byId.set(island.id, { ...island, rabbits: 0, foxes: 0 })
  }
  let atSea = 0
  for (const [key, list] of [['rabbits', sim.rabbits], ['foxes', sim.foxes]]) {
    for (const c of list) {
      if (!c.alive) continue
      const entry = byId.get(map.landId[c.y * map.size + c.x])
      if (entry) entry[key] += 1
      else atSea += 1
    }
  }
  const islands = [...byId.values()]
  return {
    islands,
    atSea,
    colonised: islands.filter((i) => i.rabbits + i.foxes > 0).length,
  }
}

/** Advance the simulation by dtMs of real elapsed time. */
export function stepSimulation(sim, dtMs) {
  sim.clock += dtMs
  for (const rabbit of sim.rabbits) {
    if (rabbit.alive) stepRabbit(sim, rabbit, dtMs)
  }
  // Iterated by index rather than for..of: both lists are appended to during
  // the loop (a fish spawning mid-tick), and a newborn should not also be
  // stepped in the same frame it was born in.
  const fishCount = sim.fish.length
  for (let i = 0; i < fishCount; i++) {
    if (sim.fish[i].alive) stepAquatic(sim, sim.fish[i], dtMs, runFishTick)
  }
  const crabCount = sim.crabs.length
  for (let i = 0; i < crabCount; i++) {
    if (sim.crabs[i].alive) stepAquatic(sim, sim.crabs[i], dtMs, runCrabTick)
  }
  // Foxes move after everything they eat within a tick, so a chase - or a
  // grab at the water's edge - resolves against where the prey actually ended
  // up rather than where it started.
  for (const fox of sim.foxes) {
    if (fox.alive) stepFox(sim, fox, dtMs)
  }
  if (sim.rabbits.some((r) => !r.alive)) {
    // Free the burrow slot of anything that died underground, or the warren
    // would silently fill up with ghosts and stop taking the living.
    for (const r of sim.rabbits) {
      if (!r.alive && r.burrowId != null) leaveBurrow(sim.burrows, r)
    }
    sim.rabbits = sim.rabbits.filter((r) => r.alive)
  }
  if (sim.foxes.some((f) => !f.alive)) sim.foxes = sim.foxes.filter((f) => f.alive)
  if (sim.fish.some((f) => !f.alive)) sim.fish = sim.fish.filter((f) => f.alive)
  if (sim.crabs.some((c) => !c.alive)) sim.crabs = sim.crabs.filter((c) => c.alive)
  const selectedList = creaturesOfKind(sim, sim.selectedKind)
  if (sim.selectedId != null && !selectedList.some((c) => c.id === sim.selectedId)) selectCreature(sim, null, null)
  regrowPatches(sim.clock, sim.regrowQueue, sim.hasApple, sim.regrowAt)
  regrowPatches(sim.clock, sim.forageQueue, sim.hasForage, sim.forageRegrowAt)

  sim.traitHistoryAccum += dtMs
  if (sim.traitHistoryAccum >= TRAIT_SAMPLE_MS) {
    sim.traitHistoryAccum -= TRAIT_SAMPLE_MS
    sampleTraitHistory(sim)
  }
}
