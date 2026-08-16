// Smooth motion, kept separate from the simulation's discrete tile grid.
//
// Both species think and move in whole tiles on a fixed decision cadence
// (see simulation.js), which is the right model for the sim - it keeps
// distances, vision radii and pouncing honest - but it is a terrible model
// for the eye: at 200ms per decision tick a creature teleports five times a
// second and reads as a stuttering dot rather than an animal.
//
// So the grid stays, and a second, purely visual position rides on top of
// it. When the sim moves a creature a tile, it hands the tile *and how long
// that step is meant to take* to beginMove(); every frame, advanceMotion()
// walks a `renderX`/`renderY` pair along that step. The renderer draws the
// interpolated pair. Nothing here can change where a creature actually is -
// it only decides where it looks like it is between two grid cells.
//
// The same interpolation carries the gait: a land step is a hop (an arc up
// and back down, the body swelling slightly at the top as it nears the
// camera, its shadow shrinking beneath it), while a water step is a flat
// glide with a paddling bob. That distinction is the whole reason `style`
// is threaded through - see render.js for what gets drawn on top of it.

export const HOP = 'hop'
export const SWIM = 'swim'

// Fraction of a step's duration actually spent travelling. A real hop lands
// before the next one starts, so the last quarter of the interval is the
// rabbit sitting still on the new tile - which is what makes it read as
// hopping rather than sliding.
export const HOP_TRAVEL = 0.72
// A swimmer never stops moving mid-stroke, so its glide fills the interval.
const SWIM_TRAVEL = 1
// Time constant for turning to face a new direction. Short enough that a
// bolting rabbit doesn't arc lazily into its escape, long enough that the
// heading isn't the snapping thing left over once the position is smooth.
const TURN_TAU_MS = 90
// Free-running animation cycles, used for what happens when nothing is
// moving (breathing) and for the paddle stroke, which has its own rhythm
// independent of how fast the creature is crossing the water.
const BREATH_PERIOD_MS = 2600
const PADDLE_PERIOD_MS = 620

const TAU = Math.PI * 2

/** Give an entity its visual state, parked exactly on its current tile. */
export function attachMotion(entity, facing = 0) {
  entity.renderX = entity.x
  entity.renderY = entity.y
  entity.moveFromX = entity.x
  entity.moveFromY = entity.y
  entity.moveToX = entity.x
  entity.moveToY = entity.y
  entity.moveElapsed = 1
  entity.moveDuration = 1
  entity.moveStyle = HOP
  entity.facing = facing
  entity.renderFacing = facing
  entity.gaitPhase = 0
  entity.breathPhase = 0
  // Flipped every step so a fox's legs alternate instead of both front paws
  // swinging together.
  entity.stepParity = 0
  return entity
}

/**
 * Start a visual step to (toX, toY) lasting `durationMs`.
 *
 * The step starts from wherever the creature is currently *drawn*, not from
 * the tile it logically left. Those differ whenever a step is issued before
 * the previous one finished (a fox at full sprint takes two tiles in a tick),
 * and starting from the tile would snap it backwards a whole cell first.
 */
export function beginMove(entity, toX, toY, durationMs, style = HOP) {
  if (entity.renderX == null) attachMotion(entity)
  entity.moveFromX = entity.renderX
  entity.moveFromY = entity.renderY
  entity.moveToX = toX
  entity.moveToY = toY
  entity.moveElapsed = 0
  entity.moveDuration = Math.max(1, durationMs)
  entity.moveStyle = style
  entity.stepParity = entity.stepParity ? 0 : 1
  const dx = toX - entity.moveFromX
  const dy = toY - entity.moveFromY
  if (dx !== 0 || dy !== 0) entity.facing = Math.atan2(dy, dx)
}

/** Snap the visual position to the logical one, with no travel: for spawning,
 * and for a rabbit surfacing from a tunnel somewhere else entirely, where
 * gliding across the intervening ground would be a lie. */
export function teleportMotion(entity, x, y) {
  if (entity.renderX == null) attachMotion(entity)
  entity.renderX = x
  entity.renderY = y
  entity.moveFromX = x
  entity.moveFromY = y
  entity.moveToX = x
  entity.moveToY = y
  entity.moveElapsed = entity.moveDuration
}

/** How far through its current step an entity is, 0..1. */
export function motionProgress(entity) {
  if (!entity.moveDuration) return 1
  return Math.min(1, entity.moveElapsed / entity.moveDuration)
}

/** Shortest-way-round angle interpolation, so a creature turning past due
 * west spins 10 degrees rather than 350. */
export function lerpAngle(from, to, t) {
  let delta = (to - from) % TAU
  if (delta > Math.PI) delta -= TAU
  if (delta < -Math.PI) delta += TAU
  return from + delta * t
}

/** Travel curve for a hop: eases in and out, and arrives early enough to
 * leave a beat of stillness before the next one. */
export function easeHop(t) {
  const u = Math.min(1, t / HOP_TRAVEL)
  return u * u * (3 - 2 * u)
}

/** Travel curve for a swim stroke: near-constant velocity with the barest
 * ease, because a swimming animal glides rather than lands. */
export function easeGlide(t) {
  return t * (1.08 - 0.08 * t)
}

/** How high off the ground a hop is at progress `t`, 0..1. Zero at both ends
 * (feet down) and 1 at the top of the arc. */
export function hopArc(t) {
  if (t >= 1) return 0
  return Math.sin(Math.PI * Math.min(1, t / HOP_TRAVEL))
}

/**
 * Advance an entity's visual state by `dtMs` of simulated time.
 *
 * Simulated, not real: the caller passes the same speed-scaled dt it gives
 * the sim, so at 4x the animation runs at 4x too and a creature's legs keep
 * up with the ground it is covering.
 */
export function advanceMotion(entity, dtMs) {
  if (entity.renderX == null) attachMotion(entity)
  entity.moveElapsed = Math.min(entity.moveDuration, entity.moveElapsed + dtMs)
  const t = motionProgress(entity)
  const travel = entity.moveStyle === SWIM ? easeGlide(t / SWIM_TRAVEL) : easeHop(t)
  entity.renderX = entity.moveFromX + (entity.moveToX - entity.moveFromX) * travel
  entity.renderY = entity.moveFromY + (entity.moveToY - entity.moveFromY) * travel

  const period = entity.moveStyle === SWIM ? PADDLE_PERIOD_MS : Math.max(240, entity.moveDuration)
  entity.gaitPhase = (entity.gaitPhase + dtMs / period) % 1
  entity.breathPhase = (entity.breathPhase + dtMs / BREATH_PERIOD_MS) % 1

  // Foxes carry a heading of their own (they point at what they're chasing
  // even while standing still); everything else faces the way it last moved.
  const target = entity.heading != null ? entity.heading : entity.facing
  entity.renderFacing = lerpAngle(entity.renderFacing, target, 1 - Math.exp(-dtMs / TURN_TAU_MS))
  return entity
}

/**
 * Everything the renderer needs to pose a sprite this frame, in multiples of
 * the sprite's own radius so it scales with zoom:
 *
 *  - `lift`    how far off the ground/surface to draw it
 *  - `scale`   body swell, standing in for "nearer the camera" at the top of
 *              a hop, and for breathing when nothing is moving
 *  - `shadow`  how big and dark the ground shadow should be (0 in water,
 *              where a shadow makes no sense and a wake does)
 *  - `stroke`  0..1 position in the paddle cycle, for the water animation
 *  - `stride`  0..1 how extended the legs are mid-step, for the fox's trot
 */
export function motionPose(entity) {
  const t = motionProgress(entity)
  const breath = Math.sin((entity.breathPhase ?? 0) * TAU)
  if (entity.moveStyle === SWIM) {
    const stroke = entity.gaitPhase ?? 0
    return {
      swimming: true,
      // Bobbing is the whole read on "this animal is in water": it rides the
      // surface instead of standing on the ground, so it never fully settles.
      lift: Math.sin(stroke * TAU) * 0.09,
      scale: 1 + Math.sin(stroke * TAU) * 0.02,
      shadow: 0,
      stroke,
      stride: 0,
      moving: t < 1,
    }
  }
  const arc = hopArc(t)
  return {
    swimming: false,
    lift: arc * 0.42,
    scale: 1 + arc * 0.11 + (arc > 0 ? 0 : breath * 0.015),
    // The shadow staying put on the ground while the body rises off it is
    // what sells the hop as vertical rather than as the sprite growing.
    shadow: 1 - arc * 0.42,
    stroke: entity.gaitPhase ?? 0,
    stride: Math.sin(Math.PI * Math.min(1, t / HOP_TRAVEL)),
    moving: t < 1,
  }
}
