import { describe, it, expect } from 'vitest'
import {
  HOP,
  HOP_TRAVEL,
  SWIM,
  advanceMotion,
  attachMotion,
  beginMove,
  easeGlide,
  easeHop,
  hopArc,
  lerpAngle,
  motionPose,
  motionProgress,
  teleportMotion,
} from './motion.js'

/** A bare entity, the way the sim's spawn functions hand one over. */
function entity(x = 0, y = 0) {
  return attachMotion({ x, y }, 0)
}

describe('attachMotion', () => {
  it('parks a fresh entity exactly on its tile', () => {
    const e = entity(3, 4)
    expect(e.renderX).toBe(3)
    expect(e.renderY).toBe(4)
    expect(motionProgress(e)).toBe(1)
  })
})

describe('beginMove / advanceMotion', () => {
  it('walks the drawn position across the step and lands exactly on the tile', () => {
    const e = entity(0, 0)
    beginMove(e, 1, 0, 400, HOP)
    advanceMotion(e, 200)
    // Halfway through in time; the eased curve puts it somewhere strictly
    // between the two tiles, which is the whole point - the sim has already
    // moved it a whole tile, the eye has not.
    expect(e.renderX).toBeGreaterThan(0)
    expect(e.renderX).toBeLessThan(1)
    advanceMotion(e, 200)
    expect(e.renderX).toBeCloseTo(1, 6)
    expect(e.renderY).toBeCloseTo(0, 6)
  })

  it('never overshoots, however far past the end it is advanced', () => {
    const e = entity(0, 0)
    beginMove(e, 2, -2, 300, HOP)
    advanceMotion(e, 5000)
    expect(e.renderX).toBeCloseTo(2, 6)
    expect(e.renderY).toBeCloseTo(-2, 6)
    expect(motionProgress(e)).toBe(1)
  })

  it('starts a new step from where the sprite currently is, not from the tile', () => {
    // A fox at full sprint takes a second tile before the first step has
    // finished drawing. Starting the new one from the tile it logically left
    // would snap it backwards a whole cell first.
    const e = entity(0, 0)
    beginMove(e, 1, 0, 400, HOP)
    advanceMotion(e, 100)
    const mid = e.renderX
    expect(mid).toBeGreaterThan(0)
    beginMove(e, 2, 0, 400, HOP)
    expect(e.moveFromX).toBeCloseTo(mid, 6)
    advanceMotion(e, 1)
    expect(e.renderX).toBeGreaterThanOrEqual(mid)
  })

  it('faces the way it is travelling', () => {
    const e = entity(0, 0)
    beginMove(e, 0, 1, 200, HOP) // straight down: +y
    expect(e.facing).toBeCloseTo(Math.PI / 2, 6)
    advanceMotion(e, 900)
    expect(e.renderFacing).toBeCloseTo(Math.PI / 2, 3)
  })

  it('follows an explicit heading instead of its travel direction when it has one', () => {
    // Foxes point at what they are chasing even while standing still.
    const e = entity(0, 0)
    e.heading = -Math.PI / 2
    advanceMotion(e, 900)
    expect(e.renderFacing).toBeCloseTo(-Math.PI / 2, 3)
  })

  it('teleports without travel, for a rabbit surfacing from another burrow', () => {
    const e = entity(0, 0)
    beginMove(e, 1, 0, 400, HOP)
    teleportMotion(e, 9, 9)
    expect(e.renderX).toBe(9)
    expect(e.renderY).toBe(9)
    expect(motionProgress(e)).toBe(1)
  })
})

describe('easing', () => {
  it('finishes the hop before the step interval is up, leaving a beat of stillness', () => {
    expect(easeHop(0)).toBe(0)
    expect(easeHop(HOP_TRAVEL)).toBeCloseTo(1, 6)
    expect(easeHop(1)).toBeCloseTo(1, 6)
  })

  it('glides through a swim stroke at near-constant speed', () => {
    expect(easeGlide(0)).toBe(0)
    expect(easeGlide(1)).toBeCloseTo(1, 6)
    // Distinctly less easing than the hop at the same point in the step.
    expect(easeGlide(0.25)).toBeGreaterThan(easeHop(0.25) * 0.5)
  })

  it('arcs a hop off the ground and back onto it', () => {
    expect(hopArc(0)).toBeCloseTo(0, 6)
    expect(hopArc(HOP_TRAVEL / 2)).toBeCloseTo(1, 6)
    expect(hopArc(1)).toBe(0)
  })
})

describe('lerpAngle', () => {
  it('turns the short way round rather than the long way', () => {
    const from = 3.0
    const to = -3.0 // just past pi: 0.28 rad away going forwards, not 6.0 back
    const next = lerpAngle(from, to, 0.5)
    expect(Math.abs(next - from)).toBeLessThan(0.2)
  })

  it('reaches the target at t = 1', () => {
    expect(lerpAngle(0.4, 1.1, 1)).toBeCloseTo(1.1, 6)
  })
})

describe('motionPose', () => {
  it('lifts a hopping creature off the ground and shrinks its shadow to match', () => {
    const e = entity(0, 0)
    beginMove(e, 1, 0, 400, HOP)
    advanceMotion(e, 140) // mid-arc
    const pose = motionPose(e)
    expect(pose.swimming).toBe(false)
    expect(pose.lift).toBeGreaterThan(0.1)
    expect(pose.scale).toBeGreaterThan(1)
    expect(pose.shadow).toBeLessThan(1)
  })

  it('settles flat on the ground once the step is done', () => {
    const e = entity(0, 0)
    beginMove(e, 1, 0, 400, HOP)
    advanceMotion(e, 400)
    const pose = motionPose(e)
    expect(pose.lift).toBe(0)
    expect(pose.shadow).toBe(1)
    expect(pose.moving).toBe(false)
  })

  it('bobs a swimmer instead of hopping it, and gives it no shadow', () => {
    const e = entity(0, 0)
    beginMove(e, 1, 0, 600, SWIM)
    advanceMotion(e, 150)
    const pose = motionPose(e)
    expect(pose.swimming).toBe(true)
    expect(pose.shadow).toBe(0)
    expect(pose.stride).toBe(0)
    // The bob is small and signed - it rides the surface rather than
    // launching off it, which is the visual difference the whole split exists
    // to make.
    expect(Math.abs(pose.lift)).toBeLessThan(0.12)
  })

  it('alternates which legs lead on successive steps', () => {
    const e = entity(0, 0)
    beginMove(e, 1, 0, 400, HOP)
    const first = e.stepParity
    beginMove(e, 2, 0, 400, HOP)
    expect(e.stepParity).not.toBe(first)
  })
})
