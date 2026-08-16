// The renderer has one piece of real behaviour worth pinning down: which of
// two completely different animations a creature gets, and that it is drawn
// at its interpolated position rather than its tile. Everything else in
// render.js is taste, and is checked by looking at it.
//
// A recording stub stands in for the canvas context - enough of the 2D API
// to run the draw path, remembering the calls that distinguish "on land"
// (a ground shadow) from "in the water" (clipped at the waterline).

import { describe, it, expect } from 'vitest'
import { TILE } from '../worldgen/mapgen.js'
import { createSimulation, spawnFox, spawnRabbit } from './simulation.js'
import { RABBIT_GENE_KEYS } from './rabbit.js'
import { FOX_GENE_KEYS } from './fox.js'
import { drawSimulation } from './render.js'

function stubCtx() {
  const calls = { clip: 0, ellipse: [], arc: [], fills: [], strokes: [] }
  const ctx = {
    calls,
    fillStyle: '',
    strokeStyle: '',
    lineWidth: 0,
    globalAlpha: 1,
    save() {},
    restore() {},
    translate() {},
    rotate() {},
    beginPath() {},
    closePath() {},
    moveTo() {},
    lineTo() {},
    rect() {},
    setLineDash() {},
    clip() {
      calls.clip += 1
    },
    arc(x, y, r) {
      calls.arc.push({ x, y, r })
    },
    ellipse(x, y, rx, ry) {
      calls.ellipse.push({ x, y, rx, ry })
    },
    fill() {
      calls.fills.push(ctx.fillStyle)
    },
    stroke() {
      calls.strokes.push(ctx.strokeStyle)
    },
    fillRect() {},
    createRadialGradient() {
      return { addColorStop() {} }
    },
  }
  return ctx
}

/** A 9x9 map, all grass, with a lake filling the middle column band. */
function makeMap() {
  const size = 9
  const tileType = new Uint8Array(size * size).fill(TILE.GRASS)
  for (let y = 0; y < size; y++) {
    for (let x = 3; x <= 5; x++) tileType[y * size + x] = TILE.LAKE
  }
  return { size, tileType, canHaveApple: new Uint8Array(size * size) }
}

function genes(keys, overrides) {
  const g = {}
  for (const key of keys) g[key] = 0.5
  return { ...g, ...overrides }
}

const VIEWPORT = { originX: 0, originY: 0, width: 360, height: 360 }
const TILE_PX = 40

function draw(sim) {
  const ctx = stubCtx()
  drawSimulation(ctx, sim.map, sim, TILE_PX, VIEWPORT)
  return ctx.calls
}

describe('drawSimulation', () => {
  it('draws a land rabbit with a ground shadow and no waterline clip', () => {
    const sim = createSimulation(makeMap())
    spawnRabbit(sim, 1, 4, null, 100, 0, genes(RABBIT_GENE_KEYS, { swimming: 0 }))
    const calls = draw(sim)
    expect(calls.clip).toBe(0)
    expect(calls.fills).toContain('rgba(20,16,10,0.220)') // the shadow
  })

  it('draws a swimming rabbit clipped at the waterline, with no shadow', () => {
    const sim = createSimulation(makeMap())
    spawnRabbit(sim, 4, 4, null, 100, 0, genes(RABBIT_GENE_KEYS, { swimming: 1 }))
    const calls = draw(sim)
    expect(calls.clip).toBe(1)
    expect(calls.fills.some((f) => typeof f === 'string' && f.startsWith('rgba(20,16,10'))).toBe(false)
    // The submerged half of the body, showing through the water.
    expect(calls.fills).toContain('rgba(46,92,120,0.5)')
  })

  it('gives a swimming fox the same treatment, plus a tail on the surface', () => {
    const sim = createSimulation(makeMap())
    spawnFox(sim, 4, 4, genes(FOX_GENE_KEYS, { swimming: 1, camouflage: 0 }), 100)
    const calls = draw(sim)
    expect(calls.clip).toBe(1)
    expect(calls.fills).toContain('rgba(150,86,44,0.8)') // the wet brush tail
  })

  it('draws a land fox unclipped, with its legs and shadow', () => {
    const sim = createSimulation(makeMap())
    spawnFox(sim, 1, 4, genes(FOX_GENE_KEYS, { swimming: 0, camouflage: 0 }), 100)
    const calls = draw(sim)
    expect(calls.clip).toBe(0)
    expect(calls.fills).toContain('rgba(56,34,22,0.9)') // legs
  })

  it('draws creatures at their interpolated position, not their tile', () => {
    const sim = createSimulation(makeMap())
    const rabbit = spawnRabbit(sim, 1, 4, null, 100, 0, genes(RABBIT_GENE_KEYS, { swimming: 0 }))
    rabbit.renderX = 1.5 // mid-hop between (1,4) and (2,4)
    const calls = draw(sim)
    // Body centre: (renderX + 0.5) * tilePx = 80, against 60 for the tile.
    expect(calls.arc.some((a) => Math.abs(a.x - 80) < 0.001)).toBe(true)
    expect(calls.arc.some((a) => Math.abs(a.x - 60) < 0.001)).toBe(false)
  })

  it('skips a rabbit that is underground, wherever it is drawn', () => {
    const sim = createSimulation(makeMap())
    const rabbit = spawnRabbit(sim, 1, 4, null, 100, 0, genes(RABBIT_GENE_KEYS, { swimming: 0 }))
    rabbit.burrowId = 1
    expect(draw(sim).arc).toHaveLength(0)
  })
})
