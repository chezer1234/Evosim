// Rabbit population simulation: entity state, the per-tick decision loop
// (driven by each rabbit's brain, see ./brain.js), energy/lifecycle, and
// reproduction. Movement is discrete tile-stepping, gated at a slower
// cadence while swimming and a faster one while running (see
// docs/plans/issue-2-species-rabbits.md).

import { TILE } from '../worldgen/mapgen.js'
import { createBrain, mutateBrain, think } from './brain.js'
import { computeTraits } from './brainInsight.js'

export const TICK_MS = 200 // decision-tick cadence (~5/sec)
const VISION_RADIUS = 5 // tiles
const ENERGY_START = 100
const ENERGY_MAX = 100
const ENERGY_DEPLETE_NORMAL_MS = 2500 // -1 energy every 2.5s at rest/walk
const ENERGY_DEPLETE_RUN_MS = 1000 // -1 energy every 1s while running
const EAT_GAIN = 10
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

let nextRabbitId = 1

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
    hasApple: map.canHaveApple.slice(),
    regrowAt: new Float32Array(map.size * map.size).fill(-1),
    clock: 0,
    selectedId: null,
    traitHistory: [],
    traitHistoryAccum: 0,
  }
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
    gestating: false,
    gestationRemaining: 0,
    generation,
    brain: brain || createBrain(Math.random),
  }
  sim.rabbits.push(rabbit)
  return rabbit
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
  const inputs = [
    1,
    rabbit.energy / ENERGY_MAX,
    apple ? (apple.x - rabbit.x) / VISION_RADIUS : 0,
    apple ? (apple.y - rabbit.y) / VISION_RADIUS : 0,
    apple ? apple.dist / VISION_RADIUS : 1,
    isWaterTile(map, rabbit.x, rabbit.y) ? 1 : 0,
    Math.random() * 2 - 1,
  ]
  const out = think(rabbit.brain, inputs)
  rabbit.running = out.run > 0.5
  rabbit.resting = out.rest > 0.5

  const stepEvery = stepEveryTicks(map, rabbit.x, rabbit.y, rabbit.running)
  rabbit.stepPhase = (rabbit.stepPhase + 1) % stepEvery
  if (!rabbit.resting && rabbit.stepPhase === 0) {
    const dirX = out.moveX > MOVE_DEADZONE ? 1 : out.moveX < -MOVE_DEADZONE ? -1 : 0
    const dirY = out.moveY > MOVE_DEADZONE ? 1 : out.moveY < -MOVE_DEADZONE ? -1 : 0
    if (dirX !== 0 || dirY !== 0) attemptStep(sim, rabbit, dirX, dirY)
  }

  tryEat(sim, rabbit)
  tryReproduce(sim, rabbit, out.reproduceDesire > 0.5)
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
function sampleTraitHistory(sim) {
  const rabbits = sim.rabbits
  if (rabbits.length === 0) {
    // Still record the zero so a population-over-time chart shows the
    // crash landing at 0 instead of just stopping at its last live sample.
    sim.traitHistory.push({ tSec: sim.clock / 1000, population: 0, minGen: null, maxGen: null, foodDrive: 0, wanderer: 0, boldness: 0, restfulness: 0, broodiness: 0 })
    if (sim.traitHistory.length > TRAIT_HISTORY_LIMIT) sim.traitHistory.shift()
    return
  }
  const sums = { foodDrive: 0, wanderer: 0, boldness: 0, restfulness: 0, broodiness: 0 }
  let minGen = Infinity
  let maxGen = -Infinity
  for (const r of rabbits) {
    const t = computeTraits(r.brain)
    sums.foodDrive += t.foodDrive
    sums.wanderer += t.wanderer
    sums.boldness += t.boldness
    sums.restfulness += t.restfulness
    sums.broodiness += t.broodiness
    if (r.generation < minGen) minGen = r.generation
    if (r.generation > maxGen) maxGen = r.generation
  }
  const n = rabbits.length
  sim.traitHistory.push({
    tSec: sim.clock / 1000,
    population: n,
    minGen,
    maxGen,
    foodDrive: sums.foodDrive / n,
    wanderer: sums.wanderer / n,
    boldness: sums.boldness / n,
    restfulness: sums.restfulness / n,
    broodiness: sums.broodiness / n,
  })
  if (sim.traitHistory.length > TRAIT_HISTORY_LIMIT) sim.traitHistory.shift()
}

/** Advance the simulation by dtMs of real elapsed time. */
export function stepSimulation(sim, dtMs) {
  sim.clock += dtMs
  for (const rabbit of sim.rabbits) {
    if (rabbit.alive) stepRabbit(sim, rabbit, dtMs)
  }
  if (sim.rabbits.some((r) => !r.alive)) {
    sim.rabbits = sim.rabbits.filter((r) => r.alive)
    if (sim.selectedId != null && !sim.rabbits.some((r) => r.id === sim.selectedId)) sim.selectedId = null
  }
  regrowApples(sim)

  sim.traitHistoryAccum += dtMs
  if (sim.traitHistoryAccum >= TRAIT_SAMPLE_MS) {
    sim.traitHistoryAccum -= TRAIT_SAMPLE_MS
    sampleTraitHistory(sim)
  }
}
