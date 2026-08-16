// Two-species population simulation: entity state, the per-tick decision
// loops, energy/lifecycle and reproduction for both rabbits and the foxes
// that hunt them.
//
// Rabbits are driven by a neural-net genome (see ./brain.js and
// docs/plans/issue-2-species-rabbits.md); foxes by an explicit gene vector
// (see ./fox.js and docs/plans/issue-11-predator-foxes.md). Movement is
// discrete tile-stepping either way - rabbits step on a fixed tick cadence
// (slower swimming, faster running), foxes accumulate a fractional
// tiles-per-tick budget so their speed gene can vary continuously.

import { TILE } from '../worldgen/mapgen.js'
import { createBrain, mutateBrain, think } from './brain.js'
import { computeTraits } from './brainInsight.js'
import { FOX_ENERGY_MAX, FOX_GENE_KEYS, createFoxGenes, foxStats, mutateFoxGenes } from './fox.js'

export const TICK_MS = 200 // decision-tick cadence (~5/sec)
const VISION_RADIUS = 5 // tiles
const ENERGY_START = 100
const ENERGY_MAX = 100
const ENERGY_DEPLETE_NORMAL_MS = 2500 // -1 energy every 2.5s at rest/walk
const ENERGY_DEPLETE_RUN_MS = 1000 // -1 energy every 1s while running
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
const FOX_FEED_MS = 1800 // stands over the carcass, out of the chase
const FOX_START_ENERGY = 95
const FOX_CUB_ENERGY = 70
const FOX_REPRO_COST = 22
const FOX_SPRINT_RANGE = 7 // only worth sprinting once the prey is this close
const FOX_WATER_SPEED = 0.55 // foxes wade badly; rabbits swim slowly too
const FOX_MAX_STEPS_PER_TICK = 2 // safety rail on the fractional step budget
const FOX_PACK_KEEP_DISTANCE = 2.5 // don't crowd a packmate once alongside it

let nextRabbitId = 1
let nextFoxId = 1

function isWaterTile(map, x, y) {
  const t = map.tileType[y * map.size + x]
  return t === TILE.OCEAN || t === TILE.LAKE
}
function inBounds(map, x, y) {
  return x >= 0 && y >= 0 && x < map.size && y < map.size
}

/** Any tile a rabbit may occupy - everything except the open ocean (they
 * can swim slowly across lakes/shallows, but not cross the sea). */
export function isPlaceable(map, x, y) {
  return inBounds(map, x, y) && map.tileType[y * map.size + x] !== TILE.OCEAN
}

/** Fresh simulation state for a given map. Apple-current-state starts from
 * the map's fixed canHaveApple flags (every eligible tree starts bearing
 * fruit). */
export function createSimulation(map) {
  return {
    map,
    rabbits: [],
    foxes: [],
    hasApple: map.canHaveApple.slice(),
    regrowAt: new Float32Array(map.size * map.size).fill(-1),
    clock: 0,
    // Selection is per-species: ids are only unique within their own list,
    // so the kind is part of the identity.
    selectedId: null,
    selectedKind: null, // 'rabbit' | 'fox' | null
    kills: 0,
    traitHistory: [],
    traitHistoryAccum: 0,
  }
}

/** Select a creature (or nothing) for the inspector panel. */
export function selectCreature(sim, kind, id) {
  sim.selectedKind = id == null ? null : kind
  sim.selectedId = id == null ? null : id
}

export function spawnRabbit(sim, x, y, brain, startEnergy = ENERGY_START, generation = 0) {
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
    // Current search-mode heading (radians) and how many decision ticks are
    // left before it's re-randomized. ticksLeft starts at 0 so the first
    // search tick picks a fresh heading immediately rather than reusing this
    // arbitrary initial value.
    searchHeading: Math.random() * Math.PI * 2,
    searchTicksLeft: 0,
  }
  sim.rabbits.push(rabbit)
  return rabbit
}

/** A fox. `genes` defaults to a fresh founder genome (see ./fox.js); cubs
 * are given a mutated copy of their parent's by finishFoxGestation. */
export function spawnFox(sim, x, y, genes, startEnergy = FOX_START_ENERGY, generation = 0) {
  const fox = {
    id: nextFoxId++,
    x,
    y,
    energy: startEnergy,
    alive: true,
    genes: genes || createFoxGenes(Math.random),
    tickAccum: 0,
    // Fractional tiles-per-tick budget: a whole tile is stepped each time
    // this crosses 1, which is what lets the speed gene be continuous
    // instead of snapping to a whole number of ticks per step.
    stepCredit: 0,
    sprinting: false,
    hunting: false,
    packing: false,
    feedingRemaining: 0,
    gestating: false,
    gestationRemaining: 0,
    generation,
    kills: 0,
    // Chase budget, in decision ticks, refilled while not sprinting.
    sprintBudget: 0,
    // Which way it's pointing (radians), so the renderer can draw a fox
    // facing its prey rather than a direction-less blob.
    heading: Math.random() * Math.PI * 2,
    searchHeading: Math.random() * Math.PI * 2,
    searchTicksLeft: 0,
  }
  fox.sprintBudget = foxStats(fox.genes).maxSprintTicks
  sim.foxes.push(fox)
  return fox
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

/**
 * The nearest fox this rabbit can actually see. Each fox is checked against
 * its *own* spotting range - PREY_ALERT_RADIUS shrunk by its camouflage
 * gene - so a well-camouflaged fox stays invisible to the rabbit's brain
 * (its predator inputs read "nothing there") until it is much closer, which
 * is exactly what the camouflage gene is buying.
 */
function findNearestVisibleFox(sim, rabbit) {
  let best = null
  let bestDist = Infinity
  for (const fox of sim.foxes) {
    if (!fox.alive) continue
    const dx = fox.x - rabbit.x
    const dy = fox.y - rabbit.y
    const dist = Math.hypot(dx, dy)
    if (dist > PREY_ALERT_RADIUS * foxStats(fox.genes).stealthFactor || dist >= bestDist) continue
    bestDist = dist
    best = fox
  }
  return best ? { fox: best, x: best.x, y: best.y, dist: bestDist } : null
}

/** The nearest live rabbit within a fox's (gene-derived) vision radius. */
function findNearestPrey(sim, fox, visionRadius) {
  let best = null
  let bestDist = Infinity
  for (const rabbit of sim.rabbits) {
    if (!rabbit.alive) continue
    const dist = Math.hypot(rabbit.x - fox.x, rabbit.y - fox.y)
    if (dist > visionRadius || dist >= bestDist) continue
    bestDist = dist
    best = rabbit
  }
  return best ? { rabbit: best, dist: bestDist } : null
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

// How many decision ticks a rabbit waits between actual tile-steps: slow in
// water, fast while running, medium otherwise.
function stepEveryTicks(map, x, y, running) {
  if (isWaterTile(map, x, y)) return 3
  return running ? 1 : 2
}

function attemptStep(sim, rabbit, dirX, dirY) {
  const nx = rabbit.x + dirX
  const ny = rabbit.y + dirY
  if (!isPlaceable(sim.map, nx, ny)) return
  rabbit.x = nx
  rabbit.y = ny
}

function tryEat(sim, rabbit) {
  const { map, hasApple, regrowAt } = sim
  const idx = rabbit.y * map.size + rabbit.x
  if (map.canHaveApple[idx] && hasApple[idx]) {
    hasApple[idx] = 0
    regrowAt[idx] = sim.clock + REGROW_MS
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

function finishGestation(sim, rabbit) {
  rabbit.gestating = false
  const childBrain = mutateBrain(rabbit.brain, Math.random)
  const childGen = rabbit.generation + 1
  for (const [dx, dy] of NEIGHBOR_OFFSETS) {
    const nx = rabbit.x + dx
    const ny = rabbit.y + dy
    if (isPlaceable(sim.map, nx, ny)) {
      spawnRabbit(sim, nx, ny, childBrain, CHILD_START_ENERGY, childGen)
      return
    }
  }
  // No free neighboring tile - fall back to the parent's own tile.
  spawnRabbit(sim, rabbit.x, rabbit.y, childBrain, CHILD_START_ENERGY, childGen)
}

const MOVE_DEADZONE = 0.3

function runDecisionTick(sim, rabbit) {
  const { map } = sim
  const apple = findNearestApple(sim, rabbit.x, rabbit.y)
  const fox = findNearestVisibleFox(sim, rabbit)
  const inputs = [
    1,
    rabbit.energy / ENERGY_MAX,
    apple ? (apple.x - rabbit.x) / VISION_RADIUS : 0,
    apple ? (apple.y - rabbit.y) / VISION_RADIUS : 0,
    apple ? apple.dist / VISION_RADIUS : 1,
    isWaterTile(map, rabbit.x, rabbit.y) ? 1 : 0,
    Math.random() * 2 - 1,
    fox ? (fox.x - rabbit.x) / PREY_ALERT_RADIUS : 0,
    fox ? (fox.y - rabbit.y) / PREY_ALERT_RADIUS : 0,
    fox ? fox.dist / PREY_ALERT_RADIUS : 1,
  ]
  const out = think(rabbit.brain, inputs)
  rabbit.running = out.run > 0.5

  const blind = !apple
  const hungry = rabbit.energy < HUNGRY_ENERGY

  // Fleeing outranks everything below it - a rabbit that keeps grazing with
  // a fox on top of it doesn't get to have opinions about food for long.
  // Point-blank (PANIC_RADIUS) is a hardwired reflex; further out it's the
  // genome's own `flee` output deciding, which is where the real trade-off
  // lives: bolting early is safe but burns energy and abandons food, so
  // both "jumpy" and "steady" lineages are viable depending on how much
  // pressure the foxes are actually applying.
  rabbit.fleeing = !!fox && (fox.dist <= PANIC_RADIUS || out.flee > 0.5)

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
  if (rabbit.fleeing) {
    // Straight away from the fox. Terrain still applies - attemptStep won't
    // walk it into the ocean - so a rabbit can be cornered against water,
    // which is where a fast fox earns its meal.
    const dx = rabbit.x - fox.x
    const dy = rabbit.y - fox.y
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

  const stepEvery = stepEveryTicks(map, rabbit.x, rabbit.y, rabbit.running)
  rabbit.stepPhase = (rabbit.stepPhase + 1) % stepEvery
  if (!rabbit.resting && rabbit.stepPhase === 0) {
    const dirX = moveX > MOVE_DEADZONE ? 1 : moveX < -MOVE_DEADZONE ? -1 : 0
    const dirY = moveY > MOVE_DEADZONE ? 1 : moveY < -MOVE_DEADZONE ? -1 : 0
    if (dirX !== 0 || dirY !== 0) attemptStep(sim, rabbit, dirX, dirY)
  }

  tryEat(sim, rabbit)
  tryReproduce(sim, rabbit, !rabbit.fleeing && out.reproduceDesire > 0.5)
}

function stepRabbit(sim, rabbit, dtMs) {
  rabbit.energyAccum += dtMs
  const threshold = rabbit.running ? ENERGY_DEPLETE_RUN_MS : ENERGY_DEPLETE_NORMAL_MS
  while (rabbit.energyAccum >= threshold) {
    rabbit.energyAccum -= threshold
    rabbit.energy -= 1
    if (rabbit.energy <= 0) {
      rabbit.energy = 0
      rabbit.alive = false
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
}

// ================================ Foxes ==================================
// A fox's whole decision tick is: can I see a rabbit, do I want it, and can
// I still run? Everything nuanced about it lives in its genes rather than in
// branching here (see ./fox.js) - this function just reads the dials.

function tryFoxStep(sim, fox, dirX, dirY) {
  const nx = fox.x + dirX
  const ny = fox.y + dirY
  if (!isPlaceable(sim.map, nx, ny)) return false
  fox.x = nx
  fox.y = ny
  return true
}

// One tile-step along a direction vector. If the diagonal is blocked (a
// coastline, typically) it slides along whichever single axis is still open
// instead of stalling - a fox that gets stuck on a headland while its dinner
// hops away isn't scary.
function stepFoxOnce(sim, fox, moveX, moveY) {
  const dirX = moveX > MOVE_DEADZONE ? 1 : moveX < -MOVE_DEADZONE ? -1 : 0
  const dirY = moveY > MOVE_DEADZONE ? 1 : moveY < -MOVE_DEADZONE ? -1 : 0
  if (dirX === 0 && dirY === 0) return
  if (tryFoxStep(sim, fox, dirX, dirY)) return
  if (dirX !== 0 && tryFoxStep(sim, fox, dirX, 0)) return
  if (dirY !== 0) tryFoxStep(sim, fox, 0, dirY)
}

// Fractional movement: a fox banks `tilesPerTick` of credit each decision
// tick and steps a whole tile every time that crosses 1. A slow fox moves
// every third tick, a fast one every tick and occasionally twice - all from
// one continuous gene, rather than the integer tick cadence rabbits use.
function moveFox(sim, fox, moveX, moveY, tilesPerTick) {
  fox.stepCredit += tilesPerTick
  let steps = 0
  while (fox.stepCredit >= 1 && steps < FOX_MAX_STEPS_PER_TICK) {
    fox.stepCredit -= 1
    steps += 1
    stepFoxOnce(sim, fox, moveX, moveY)
  }
  if (fox.stepCredit >= 1) fox.stepCredit = 1 - 1e-6 // don't bank an unbounded backlog
}

/** The pounce: any rabbit within POUNCE_RANGE of a hunting fox is taken. */
function tryPounce(sim, fox, stats) {
  if (!fox.hunting) return
  for (const rabbit of sim.rabbits) {
    if (!rabbit.alive) continue
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

function tryFoxReproduce(sim, fox, stats) {
  if (fox.gestating || fox.energy <= stats.breedEnergy) return
  fox.energy -= FOX_REPRO_COST
  fox.gestating = true
  fox.gestationRemaining = stats.gestationMs
}

function finishFoxGestation(sim, fox) {
  fox.gestating = false
  const cubGenes = mutateFoxGenes(fox.genes, Math.random)
  const cubGen = fox.generation + 1
  for (const [dx, dy] of NEIGHBOR_OFFSETS) {
    const nx = fox.x + dx
    const ny = fox.y + dy
    if (isPlaceable(sim.map, nx, ny)) {
      spawnFox(sim, nx, ny, cubGenes, FOX_CUB_ENERGY, cubGen)
      return
    }
  }
  spawnFox(sim, fox.x, fox.y, cubGenes, FOX_CUB_ENERGY, cubGen)
}

function runFoxDecisionTick(sim, fox) {
  const stats = foxStats(fox.genes)
  // Mid-meal: it stands over the carcass rather than immediately chasing
  // the next rabbit, which is both realistic and the thing that stops one
  // fast fox from clearing a whole warren in a few seconds.
  if (fox.feedingRemaining > 0) {
    fox.hunting = false
    fox.sprinting = false
    fox.sprintBudget = Math.min(stats.maxSprintTicks, fox.sprintBudget + 0.5 + fox.genes.stamina)
    return
  }

  const prey = findNearestPrey(sim, fox, stats.visionRadius)
  const packmate = findNearestPackmate(sim, fox, stats.packRadius)
  fox.packing = !!packmate
  // "Desire to hunt": a high-bloodlust fox's threshold sits above its own
  // maximum energy, so it hunts constantly; a low one only bothers once it
  // is genuinely hungry.
  fox.hunting = !!prey && fox.energy < stats.huntBelowEnergy

  let moveX = 0
  let moveY = 0
  let tilesPerTick = stats.prowlTilesPerTick

  if (fox.hunting) {
    const dx = prey.rabbit.x - fox.x
    const dy = prey.rabbit.y - fox.y
    const len = Math.hypot(dx, dy) || 1
    moveX = dx / len
    moveY = dy / len
    // Sprinting is rationed by stamina and only spent once the prey is
    // close enough for the burst to actually end in a pounce.
    fox.sprinting = fox.sprintBudget >= 1 && prey.dist <= FOX_SPRINT_RANGE
    if (fox.sprinting) {
      fox.sprintBudget -= 1
      // A packmate in support means the rabbit has two directions to worry
      // about, so the chase closes faster. This is the second half of what
      // pack tendency buys, alongside the pull toward other foxes below.
      tilesPerTick = stats.sprintTilesPerTick * (fox.packing ? 1 + stats.packSpeedBonus : 1)
    }
  } else {
    fox.sprinting = false
    if (packmate && packmate.dist > FOX_PACK_KEEP_DISTANCE) {
      // Regroup: drift toward the pack rather than sweeping alone, so
      // high-packTendency lineages end up hunting the same ground together.
      const dx = packmate.fox.x - fox.x
      const dy = packmate.fox.y - fox.y
      const len = Math.hypot(dx, dy) || 1
      moveX = dx / len
      moveY = dy / len
    } else {
      // Same held-then-re-randomized sweep the rabbits use when blind.
      updateSearchHeading(fox)
      moveX = Math.cos(fox.searchHeading)
      moveY = Math.sin(fox.searchHeading)
    }
  }

  if (!fox.sprinting) fox.sprintBudget = Math.min(stats.maxSprintTicks, fox.sprintBudget + 0.5 + fox.genes.stamina)
  if (moveX !== 0 || moveY !== 0) fox.heading = Math.atan2(moveY, moveX)
  if (isWaterTile(sim.map, fox.x, fox.y)) tilesPerTick *= FOX_WATER_SPEED

  moveFox(sim, fox, moveX, moveY, tilesPerTick)
  tryPounce(sim, fox, stats)
  tryFoxReproduce(sim, fox, stats)
}

function stepFox(sim, fox, dtMs) {
  const stats = foxStats(fox.genes)
  // Continuous drain rather than the rabbits' whole-number ticks: a fox's
  // burn rate is a gene, so it needs the resolution.
  fox.energy -= stats.upkeepPerSec * (fox.sprinting ? stats.sprintUpkeepMultiplier : 1) * (dtMs / 1000)
  if (fox.energy <= 0) {
    fox.energy = 0
    fox.alive = false
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
}

function regrowApples(sim) {
  const { map, hasApple, regrowAt } = sim
  for (let i = 0; i < hasApple.length; i++) {
    if (!hasApple[i] && map.canHaveApple[i] && regrowAt[i] >= 0 && sim.clock >= regrowAt[i]) {
      hasApple[i] = 1
      regrowAt[i] = -1
    }
  }
}

// Snapshot population-wide average traits every TRAIT_SAMPLE_MS, so the UI
// can show how the gene pool is drifting over time rather than just a
// single rabbit's wiring. Cheap: the net is tiny and this only runs a few
// times a minute.
const RABBIT_TRAIT_KEYS = ['foodDrive', 'wanderer', 'boldness', 'restfulness', 'broodiness', 'searchDrive', 'skittishness']

/** Population-wide averages of the fox genes, or null with no foxes alive -
 * null rather than zeros so the chart can tell "no foxes" apart from "foxes
 * whose genes all sit at 0". */
function averageFoxGenes(foxes) {
  if (foxes.length === 0) return null
  const avg = {}
  for (const key of FOX_GENE_KEYS) {
    let sum = 0
    for (const f of foxes) sum += f.genes[key]
    avg[key] = sum / foxes.length
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
    kills: sim.kills,
    minGen: null,
    maxGen: null,
    foxMinGen: null,
    foxMaxGen: null,
    foxGenes: averageFoxGenes(foxes),
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
}

/** Advance the simulation by dtMs of real elapsed time. */
export function stepSimulation(sim, dtMs) {
  sim.clock += dtMs
  for (const rabbit of sim.rabbits) {
    if (rabbit.alive) stepRabbit(sim, rabbit, dtMs)
  }
  // Foxes move after rabbits within a tick, so a chase resolves against
  // where the rabbit actually ended up rather than where it started.
  for (const fox of sim.foxes) {
    if (fox.alive) stepFox(sim, fox, dtMs)
  }
  if (sim.rabbits.some((r) => !r.alive)) sim.rabbits = sim.rabbits.filter((r) => r.alive)
  if (sim.foxes.some((f) => !f.alive)) sim.foxes = sim.foxes.filter((f) => f.alive)
  const selectedList = sim.selectedKind === 'fox' ? sim.foxes : sim.rabbits
  if (sim.selectedId != null && !selectedList.some((c) => c.id === sim.selectedId)) selectCreature(sim, null, null)
  regrowApples(sim)

  sim.traitHistoryAccum += dtMs
  if (sim.traitHistoryAccum >= TRAIT_SAMPLE_MS) {
    sim.traitHistoryAccum -= TRAIT_SAMPLE_MS
    sampleTraitHistory(sim)
  }
}
