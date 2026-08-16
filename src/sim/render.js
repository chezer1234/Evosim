// Canvas overlay for the simulation: apples on their trees, rabbit and fox
// sprites, and the selected creature's vision radius + energy bar. Drawn on
// top of drawMap's terrain pass; mirrors its viewport math (see
// worldgen/mapgen.js's drawMap) so both layers line up under pan/zoom.

import { FOREST_VISION_FACTOR, foxStats } from './fox.js'
import { TILE } from '../worldgen/mapgen.js'
import { BURROW_CAPACITY, burrowLinks } from './burrow.js'
import { rabbitStats } from './rabbit.js'

const VISION_RADIUS = 5 // tiles - keep in sync with sim/simulation.js

export function drawSimulation(ctx, map, sim, tilePx, viewport) {
  const ox = viewport.originX * tilePx
  const oy = viewport.originY * tilePx
  const startX = Math.max(0, Math.floor(viewport.originX))
  const startY = Math.max(0, Math.floor(viewport.originY))
  const endX = Math.min(map.size - 1, Math.ceil(viewport.originX + viewport.width / tilePx))
  const endY = Math.min(map.size - 1, Math.ceil(viewport.originY + viewport.height / tilePx))

  drawApples(ctx, map, sim, tilePx, ox, oy, startX, startY, endX, endY)
  // Under everything alive: the warren is terrain the rabbits have built,
  // and a rabbit standing on an entrance should be drawn on top of it.
  drawBurrows(ctx, sim, tilePx, ox, oy)
  drawRabbits(ctx, sim, tilePx, ox, oy, startX, startY, endX, endY)
  // Foxes last, so a fox standing on its kill is drawn over the rabbit.
  drawFoxes(ctx, map, sim, tilePx, ox, oy, startX, startY, endX, endY)
}

function drawApples(ctx, map, sim, tilePx, ox, oy, startX, startY, endX, endY) {
  const r = Math.max(1.2, tilePx * 0.12)
  ctx.fillStyle = 'rgb(214,48,49)'
  for (let y = startY; y <= endY; y++) {
    for (let x = startX; x <= endX; x++) {
      const idx = y * map.size + x
      if (!map.canHaveApple[idx] || !sim.hasApple[idx]) continue
      const cx = x * tilePx - ox + tilePx * 0.68
      const cy = y * tilePx - oy + tilePx * 0.32
      ctx.beginPath()
      ctx.arc(cx, cy, r, 0, Math.PI * 2)
      ctx.fill()
    }
  }
}

function rgb(r, g, b) {
  return `rgb(${r | 0},${g | 0},${b | 0})`
}

// =============================== Burrows =================================
// A burrow reads as a dark mouth in a small mound of spoil, with one pip per
// rabbit sheltering in it (capacity 5, see sim/burrow.js) - so "is there
// room in there" is answerable at a glance rather than only in the panel.
// Entrances close enough to share a tunnel are joined by a dashed line: that
// line is the difference between a hole and a network, and it's the thing
// that lets a cornered rabbit surface somewhere else.

const TUNNEL_DASH = [3, 4]

function drawBurrows(ctx, sim, tilePx, ox, oy) {
  if (!sim.burrows.length) return
  const r = Math.max(1.5, tilePx * 0.3)

  ctx.save()
  ctx.setLineDash(TUNNEL_DASH)
  ctx.strokeStyle = 'rgba(146,109,72,0.5)'
  ctx.lineWidth = Math.max(0.6, tilePx * 0.05)
  ctx.beginPath()
  for (const [a, b] of burrowLinks(sim.burrows)) {
    ctx.moveTo((a.x + 0.5) * tilePx - ox, (a.y + 0.5) * tilePx - oy)
    ctx.lineTo((b.x + 0.5) * tilePx - ox, (b.y + 0.5) * tilePx - oy)
  }
  ctx.stroke()
  ctx.restore()

  for (const burrow of sim.burrows) {
    const cx = (burrow.x + 0.5) * tilePx - ox
    const cy = (burrow.y + 0.5) * tilePx - oy

    // Spoil heap around the mouth.
    ctx.beginPath()
    ctx.fillStyle = 'rgba(120,92,60,0.75)'
    ctx.ellipse(cx, cy + r * 0.2, r * 1.15, r * 0.8, 0, 0, Math.PI * 2)
    ctx.fill()

    // The hole itself: a flat near-black ellipse, darker than any terrain.
    ctx.beginPath()
    ctx.fillStyle = 'rgb(26,20,15)'
    ctx.ellipse(cx, cy, r * 0.72, r * 0.52, 0, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = Math.max(0.4, tilePx * 0.03)
    ctx.strokeStyle = 'rgba(72,54,36,0.9)'
    ctx.stroke()

    if (tilePx >= 10) drawOccupancyPips(ctx, cx, cy, r, burrow.occupants.length)
  }
}

function drawOccupancyPips(ctx, cx, cy, r, occupied) {
  const gap = r * 0.42
  const left = cx - (gap * (BURROW_CAPACITY - 1)) / 2
  for (let i = 0; i < BURROW_CAPACITY; i++) {
    ctx.beginPath()
    ctx.fillStyle = i < occupied ? 'rgb(235,231,224)' : 'rgba(235,231,224,0.22)'
    ctx.arc(left + i * gap, cy - r * 1.05, Math.max(0.6, r * 0.13), 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawRabbits(ctx, sim, tilePx, ox, oy, startX, startY, endX, endY) {
  const r = Math.max(1.5, tilePx * 0.22)
  for (const rabbit of sim.rabbits) {
    if (!rabbit.alive) continue
    // Underground: nothing to draw. The burrow's occupancy pips are where a
    // sheltering rabbit shows up (see drawBurrows), which is also the honest
    // picture - a fox can't see it either.
    if (rabbit.burrowId != null) continue
    if (rabbit.x < startX - 1 || rabbit.x > endX + 1 || rabbit.y < startY - 1 || rabbit.y > endY + 1) continue
    const cx = (rabbit.x + 0.5) * tilePx - ox
    const cy = (rabbit.y + 0.5) * tilePx - oy
    const selected = sim.selectedKind === 'rabbit' && rabbit.id === sim.selectedId

    if (selected) {
      // Two rings, because a rabbit now has two senses with very different
      // reach: what it can see, and the much wider circle it can hear.
      drawVisionRadius(ctx, cx, cy, rabbitStats(rabbit.genes).hearingRadius * tilePx, 'rgba(147,197,253,')
      drawVisionRadius(ctx, cx, cy, VISION_RADIUS * tilePx, 'rgba(255,224,102,')
    }
    if (rabbit.alarmUntil > sim.clock && tilePx >= 6) drawAlarmCall(ctx, cx, cy, r)

    // Panic reads first: a fleeing rabbit is the most important thing on
    // screen, so it gets a colour nothing else uses plus an alarm ring.
    const [baseR, baseG, baseB] = rabbit.fleeing
      ? [254, 205, 211]
      : rabbit.searching
        ? [125, 211, 252]
        : rabbit.running
          ? [255, 255, 255]
          : rabbit.resting
            ? [200, 196, 190]
            : [235, 231, 224]

    if (rabbit.fleeing && tilePx >= 5) drawAlarmRing(ctx, cx, cy, r)

    // Soft ground shadow so the rabbit reads as sitting on the tile rather
    // than floating as a flat sprite on top of it.
    if (tilePx >= 5) {
      ctx.beginPath()
      ctx.fillStyle = 'rgba(20,16,10,0.22)'
      ctx.ellipse(cx, cy + r * 0.75, r * 0.9, r * 0.32, 0, 0, Math.PI * 2)
      ctx.fill()
    }

    // Tail drawn before the body: the body fill covers its inner half, so
    // only a fluffy crescent pokes out the back, the same way the ears
    // poke out the front.
    if (tilePx >= 8) drawTail(ctx, cx, cy, r)

    // Body: a radial gradient instead of a flat fill gives it some
    // roundness/volume rather than reading as a flat disc from above.
    ctx.beginPath()
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    const grad = ctx.createRadialGradient(cx - r * 0.35, cy - r * 0.4, r * 0.15, cx, cy, r * 1.15)
    grad.addColorStop(0, rgb(Math.min(255, baseR + 20), Math.min(255, baseG + 20), Math.min(255, baseB + 20)))
    grad.addColorStop(0.65, rgb(baseR, baseG, baseB))
    grad.addColorStop(1, rgb(baseR * 0.76, baseG * 0.76, baseB * 0.76))
    ctx.fillStyle = grad
    ctx.fill()
    ctx.lineWidth = Math.max(0.5, tilePx * 0.03)
    ctx.strokeStyle = selected ? 'rgba(255,224,102,0.9)' : 'rgba(60,50,40,0.6)'
    ctx.stroke()

    if (tilePx >= 12) drawFur(ctx, cx, cy, r, baseR, baseG, baseB)
    if (tilePx >= 8) drawEars(ctx, cx, cy, r)
    if (tilePx >= 10) drawFace(ctx, cx, cy, r)
    if (selected && tilePx >= 6) drawEnergyBar(ctx, cx, cy, r, tilePx, rabbit.energy / 100, 'rgb(120,214,110)')
  }
}

function drawTail(ctx, cx, cy, r) {
  ctx.beginPath()
  ctx.fillStyle = 'rgb(250,248,244)'
  ctx.arc(cx, cy + r * 0.95, r * 0.32, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineWidth = Math.max(0.4, r * 0.06)
  ctx.strokeStyle = 'rgba(60,50,40,0.4)'
  ctx.stroke()
}

// A handful of short strokes ticked outward from the body outline - a cheap
// stand-in for fur texture so the silhouette doesn't read as a bald disc.
const FUR_ANGLES = [-2.3, -1.7, -1.1, -0.5, 0.5, 1.1, 1.7, 2.3]
function drawFur(ctx, cx, cy, r, baseR, baseG, baseB) {
  ctx.strokeStyle = rgb(baseR * 0.72, baseG * 0.72, baseB * 0.72)
  ctx.lineWidth = Math.max(0.4, r * 0.05)
  ctx.beginPath()
  for (const a of FUR_ANGLES) {
    const x0 = cx + Math.sin(a) * r * 0.9
    const y0 = cy - Math.cos(a) * r * 0.9
    const x1 = cx + Math.sin(a) * r * 1.2
    const y1 = cy - Math.cos(a) * r * 1.2
    ctx.moveTo(x0, y0)
    ctx.lineTo(x1, y1)
  }
  ctx.stroke()
}

function drawFace(ctx, cx, cy, r) {
  const eyeY = cy - r * 0.15
  const eyeDX = r * 0.32
  ctx.fillStyle = 'rgb(40,32,28)'
  ctx.beginPath()
  ctx.arc(cx - eyeDX, eyeY, r * 0.11, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx + eyeDX, eyeY, r * 0.11, 0, Math.PI * 2)
  ctx.fill()
  // Tiny catchlight so the eyes don't read as flat dots.
  ctx.fillStyle = 'rgba(255,255,255,0.85)'
  ctx.beginPath()
  ctx.arc(cx - eyeDX + r * 0.04, eyeY - r * 0.04, r * 0.035, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.arc(cx + eyeDX + r * 0.04, eyeY - r * 0.04, r * 0.035, 0, Math.PI * 2)
  ctx.fill()
  // Nose
  ctx.fillStyle = 'rgb(214,120,130)'
  ctx.beginPath()
  ctx.arc(cx, cy + r * 0.2, r * 0.09, 0, Math.PI * 2)
  ctx.fill()
}

// `rgbaPrefix` is an 'rgba(r,g,b,' string the two alpha values are appended
// to, so rabbits (yellow) and foxes (red) can share the drawing.
function drawVisionRadius(ctx, cx, cy, radiusPx, rgbaPrefix) {
  ctx.beginPath()
  ctx.arc(cx, cy, radiusPx, 0, Math.PI * 2)
  ctx.strokeStyle = `${rgbaPrefix}0.55)`
  ctx.lineWidth = Math.max(1, radiusPx * 0.01)
  ctx.stroke()
  ctx.fillStyle = `${rgbaPrefix}0.08)`
  ctx.fill()
}

// Sound waves off a rabbit that is calling a fox out to the rest of the
// warren (issue #14). Drawn as arcs opening upward rather than a full ring,
// so it never reads as the fleeing alarm ring below - one means "this rabbit
// is running", the other means "this rabbit is telling everyone".
function drawAlarmCall(ctx, cx, cy, r) {
  ctx.strokeStyle = 'rgba(216,180,254,0.9)'
  ctx.lineWidth = Math.max(0.5, r * 0.12)
  for (const scale of [1.6, 2.2, 2.8]) {
    ctx.beginPath()
    ctx.arc(cx, cy - r * 0.6, r * scale, Math.PI * 1.15, Math.PI * 1.85)
    ctx.stroke()
  }
}

// A quick pulse-free red ring around a bolting rabbit - readable even when
// zoomed out far enough that the body colour alone is a couple of pixels.
function drawAlarmRing(ctx, cx, cy, r) {
  ctx.beginPath()
  ctx.arc(cx, cy, r * 1.9, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(248,113,113,0.75)'
  ctx.lineWidth = Math.max(0.6, r * 0.16)
  ctx.stroke()
}

function drawEars(ctx, cx, cy, r) {
  ctx.fillStyle = 'rgb(235,231,224)'
  ctx.beginPath()
  ctx.ellipse(cx - r * 0.4, cy - r * 1.1, r * 0.22, r * 0.6, -0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(cx + r * 0.4, cy - r * 1.1, r * 0.22, r * 0.6, 0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.fillStyle = 'rgba(220,140,150,0.55)'
  ctx.beginPath()
  ctx.ellipse(cx - r * 0.4, cy - r * 1.08, r * 0.11, r * 0.38, -0.3, 0, Math.PI * 2)
  ctx.fill()
  ctx.beginPath()
  ctx.ellipse(cx + r * 0.4, cy - r * 1.08, r * 0.11, r * 0.38, 0.3, 0, Math.PI * 2)
  ctx.fill()
}

function drawEnergyBar(ctx, cx, cy, r, tilePx, fraction, color) {
  const barW = tilePx * 1.1
  const barH = Math.max(2, tilePx * 0.12)
  const bx = cx - barW / 2
  const by = cy - r * 2.2
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.fillRect(bx, by, barW, barH)
  ctx.fillStyle = color
  ctx.fillRect(bx, by, barW * Math.max(0, Math.min(1, fraction)), barH)
}

// ================================ Foxes ==================================
// A fox is drawn nose-first along its heading (unlike the radially symmetric
// rabbits) because half of what makes it read as a predator is that you can
// see what it's pointed at. Genes show up in the sprite too: camouflage
// fades it toward the ground, and a hunting fox's eyes light up.

const FOX_ENERGY_MAX = 120 // keep in sync with sim/fox.js

function mix(a, b, t) {
  return a + (b - a) * t
}

function drawFoxes(ctx, map, sim, tilePx, ox, oy, startX, startY, endX, endY) {
  // Deliberately bigger than the rabbits' 0.22: a predator that reads as the
  // same size as its prey doesn't look like a threat on the map.
  const r = Math.max(2.5, tilePx * 0.4)
  for (const fox of sim.foxes) {
    if (!fox.alive) continue
    if (fox.x < startX - 2 || fox.x > endX + 2 || fox.y < startY - 2 || fox.y > endY + 2) continue
    const cx = (fox.x + 0.5) * tilePx - ox
    const cy = (fox.y + 0.5) * tilePx - oy
    const selected = sim.selectedKind === 'fox' && fox.id === sim.selectedId
    const stats = foxStats(fox.genes)

    // The ring shrinks when it steps under the canopy: forest costs a fox
    // 45% of its sight (see FOREST_VISION_FACTOR), and watching the circle
    // contract is the clearest way to show that.
    if (selected) {
      const inForest = map.tileType[fox.y * map.size + fox.x] === TILE.FOREST
      const visionPx = stats.visionRadius * (inForest ? FOREST_VISION_FACTOR : 1) * tilePx
      drawVisionRadius(ctx, cx, cy, visionPx, 'rgba(251,146,60,')
    }
    if (fox.hunting && tilePx >= 5) drawMenaceGlow(ctx, cx, cy, r)

    ctx.save()
    ctx.translate(cx, cy)
    // Sprite is authored nose-up; heading 0 points +x, hence the quarter turn.
    ctx.rotate(fox.heading + Math.PI / 2)
    // Camouflage literally makes it harder to see: the pelt desaturates
    // toward dead-grass brown and the whole sprite loses some opacity.
    ctx.globalAlpha = 1 - 0.28 * fox.genes.camouflage
    drawFoxBody(ctx, r, fox, tilePx, selected)
    ctx.restore()

    if (fox.sprinting && tilePx >= 6) drawSprintStreaks(ctx, cx, cy, r, fox.heading)
    if (fox.feedingRemaining > 0 && tilePx >= 6) drawFeedingMark(ctx, cx, cy, r)
    if (fox.packing && tilePx >= 8) drawPackMark(ctx, cx, cy, r)
    if (selected && tilePx >= 6) drawEnergyBar(ctx, cx, cy, r, tilePx, fox.energy / FOX_ENERGY_MAX, 'rgb(251,146,60)')
  }
}

function drawFoxBody(ctx, r, fox, tilePx, selected) {
  const camo = fox.genes.camouflage
  // Rust orange, pulled toward dry-grass brown as camouflage rises - but
  // only part of the way, so even a fully camouflaged fox still reads as a
  // fox rather than a mud-coloured smudge.
  const pelt = [mix(233, 168, camo * 0.8), mix(106, 128, camo * 0.8), mix(34, 84, camo * 0.8)]
  const peltDark = pelt.map((c) => c * 0.66)

  // Ground shadow (drawn in local space, so it stretches along the body).
  if (tilePx >= 5) {
    ctx.beginPath()
    ctx.fillStyle = 'rgba(20,16,10,0.25)'
    ctx.ellipse(0, r * 0.25, r * 0.75, r * 1.05, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  // Brush tail: long, thick, white-tipped - the fox's most recognisable
  // silhouette cue at small zoom levels.
  ctx.beginPath()
  ctx.fillStyle = rgb(...peltDark)
  ctx.ellipse(0, r * 1.5, r * 0.4, r * 0.85, 0, 0, Math.PI * 2)
  ctx.fill()
  if (tilePx >= 8) {
    ctx.beginPath()
    ctx.fillStyle = 'rgb(245,242,236)'
    ctx.ellipse(0, r * 2.1, r * 0.26, r * 0.32, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  // Dark legs, drawn before the body so the fill covers their inner half and
  // only the paws poke out the sides - the same trick the tail and ears use.
  // (Drawn on top they just read as spots on its back.)
  if (tilePx >= 12) {
    ctx.fillStyle = 'rgba(56,34,22,0.9)'
    for (const [lx, ly] of [[-0.62, -0.42], [0.62, -0.42], [-0.6, 0.5], [0.6, 0.5]]) {
      ctx.beginPath()
      ctx.ellipse(r * lx, r * ly, r * 0.17, r * 0.26, 0, 0, Math.PI * 2)
      ctx.fill()
    }
  }

  // Body
  ctx.beginPath()
  ctx.ellipse(0, 0, r * 0.62, r * 1.02, 0, 0, Math.PI * 2)
  const grad = ctx.createRadialGradient(-r * 0.25, -r * 0.35, r * 0.1, 0, 0, r * 1.25)
  grad.addColorStop(0, rgb(Math.min(255, pelt[0] + 26), Math.min(255, pelt[1] + 26), Math.min(255, pelt[2] + 22)))
  grad.addColorStop(0.7, rgb(...pelt))
  grad.addColorStop(1, rgb(...peltDark))
  ctx.fillStyle = grad
  ctx.fill()
  ctx.lineWidth = Math.max(0.5, r * 0.09)
  ctx.strokeStyle = selected ? 'rgba(255,224,102,0.95)' : 'rgba(48,26,12,0.7)'
  ctx.stroke()

  // Cream chest ruff
  if (tilePx >= 10) {
    ctx.beginPath()
    ctx.fillStyle = 'rgba(248,244,236,0.9)'
    ctx.ellipse(0, -r * 0.5, r * 0.3, r * 0.42, 0, 0, Math.PI * 2)
    ctx.fill()
  }

  if (tilePx >= 8) drawFoxEars(ctx, r, pelt)

  // Head
  ctx.beginPath()
  ctx.fillStyle = rgb(...pelt)
  ctx.arc(0, -r * 0.95, r * 0.52, 0, Math.PI * 2)
  ctx.fill()
  ctx.lineWidth = Math.max(0.4, r * 0.07)
  ctx.strokeStyle = 'rgba(48,26,12,0.6)'
  ctx.stroke()

  // Snout: the long pointed muzzle, tipped black.
  ctx.beginPath()
  ctx.fillStyle = rgb(mix(pelt[0], 250, 0.55), mix(pelt[1], 244, 0.55), mix(pelt[2], 236, 0.55))
  ctx.moveTo(-r * 0.26, -r * 1.1)
  ctx.lineTo(0, -r * 1.85)
  ctx.lineTo(r * 0.26, -r * 1.1)
  ctx.closePath()
  ctx.fill()
  ctx.beginPath()
  ctx.fillStyle = 'rgb(30,24,20)'
  ctx.arc(0, -r * 1.76, r * 0.11, 0, Math.PI * 2)
  ctx.fill()

  if (tilePx >= 10) drawFoxEyes(ctx, r, fox.hunting)
}

function drawFoxEars(ctx, r, pelt) {
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.fillStyle = rgb(...pelt)
    ctx.moveTo(side * r * 0.16, -r * 1.2)
    ctx.lineTo(side * r * 0.62, -r * 1.95)
    ctx.lineTo(side * r * 0.66, -r * 1.05)
    ctx.closePath()
    ctx.fill()
    // Black ear tips: the detail that makes the silhouette read "fox"
    // rather than "orange cat".
    ctx.beginPath()
    ctx.fillStyle = 'rgba(32,22,18,0.9)'
    ctx.moveTo(side * r * 0.42, -r * 1.62)
    ctx.lineTo(side * r * 0.62, -r * 1.95)
    ctx.lineTo(side * r * 0.63, -r * 1.5)
    ctx.closePath()
    ctx.fill()
  }
}

// Amber slits normally; a hunting fox's eyes glow red, which is the clearest
// at-a-glance "this one is coming for something" tell on the map.
function drawFoxEyes(ctx, r, hunting) {
  const eyeY = -r * 1.05
  const eyeDX = r * 0.24
  if (hunting) {
    ctx.fillStyle = 'rgba(248,60,40,0.35)'
    for (const side of [-1, 1]) {
      ctx.beginPath()
      ctx.arc(side * eyeDX, eyeY, r * 0.2, 0, Math.PI * 2)
      ctx.fill()
    }
  }
  ctx.fillStyle = hunting ? 'rgb(255,72,52)' : 'rgb(252,196,72)'
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.ellipse(side * eyeDX, eyeY, r * 0.07, r * 0.12, side * 0.35, 0, Math.PI * 2)
    ctx.fill()
  }
  ctx.fillStyle = 'rgb(24,18,16)'
  for (const side of [-1, 1]) {
    ctx.beginPath()
    ctx.ellipse(side * eyeDX, eyeY, r * 0.028, r * 0.1, side * 0.35, 0, Math.PI * 2)
    ctx.fill()
  }
}

function drawMenaceGlow(ctx, cx, cy, r) {
  const glow = ctx.createRadialGradient(cx, cy, r * 0.4, cx, cy, r * 2.6)
  glow.addColorStop(0, 'rgba(220,38,38,0.28)')
  glow.addColorStop(1, 'rgba(220,38,38,0)')
  ctx.fillStyle = glow
  ctx.beginPath()
  ctx.arc(cx, cy, r * 2.6, 0, Math.PI * 2)
  ctx.fill()
}

function drawSprintStreaks(ctx, cx, cy, r, heading) {
  ctx.strokeStyle = 'rgba(255,255,255,0.35)'
  ctx.lineWidth = Math.max(0.5, r * 0.1)
  ctx.beginPath()
  for (const offset of [-0.5, 0, 0.5]) {
    const perpX = Math.cos(heading + Math.PI / 2) * r * offset
    const perpY = Math.sin(heading + Math.PI / 2) * r * offset
    ctx.moveTo(cx - Math.cos(heading) * r * 1.5 + perpX, cy - Math.sin(heading) * r * 1.5 + perpY)
    ctx.lineTo(cx - Math.cos(heading) * r * 2.6 + perpX, cy - Math.sin(heading) * r * 2.6 + perpY)
  }
  ctx.stroke()
}

const FEEDING_SPLATTER = [[-0.9, 0.8], [0.85, 0.95], [0.1, 1.25], [-0.45, 1.1]]
function drawFeedingMark(ctx, cx, cy, r) {
  ctx.fillStyle = 'rgba(153,27,27,0.75)'
  for (const [sx, sy] of FEEDING_SPLATTER) {
    ctx.beginPath()
    ctx.arc(cx + sx * r, cy + sy * r, r * 0.13, 0, Math.PI * 2)
    ctx.fill()
  }
}

// A small violet arc under a fox that's currently hunting alongside a
// packmate - the visible half of the pack-tendency gene.
function drawPackMark(ctx, cx, cy, r) {
  ctx.strokeStyle = 'rgba(167,139,250,0.85)'
  ctx.lineWidth = Math.max(0.6, r * 0.12)
  ctx.beginPath()
  ctx.arc(cx, cy, r * 1.55, Math.PI * 0.2, Math.PI * 0.8)
  ctx.stroke()
}
