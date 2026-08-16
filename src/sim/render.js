// Canvas overlay for the rabbit simulation: apples on their trees, rabbit
// sprites, and the selected rabbit's vision radius + energy bar. Drawn on
// top of drawMap's terrain pass; mirrors its viewport math (see
// worldgen/mapgen.js's drawMap) so both layers line up under pan/zoom.

const VISION_RADIUS = 5 // tiles - keep in sync with sim/simulation.js

export function drawSimulation(ctx, map, sim, tilePx, viewport) {
  const ox = viewport.originX * tilePx
  const oy = viewport.originY * tilePx
  const startX = Math.max(0, Math.floor(viewport.originX))
  const startY = Math.max(0, Math.floor(viewport.originY))
  const endX = Math.min(map.size - 1, Math.ceil(viewport.originX + viewport.width / tilePx))
  const endY = Math.min(map.size - 1, Math.ceil(viewport.originY + viewport.height / tilePx))

  drawApples(ctx, map, sim, tilePx, ox, oy, startX, startY, endX, endY)
  drawRabbits(ctx, sim, tilePx, ox, oy, startX, startY, endX, endY)
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

function drawRabbits(ctx, sim, tilePx, ox, oy, startX, startY, endX, endY) {
  const r = Math.max(1.5, tilePx * 0.22)
  for (const rabbit of sim.rabbits) {
    if (!rabbit.alive) continue
    if (rabbit.x < startX - 1 || rabbit.x > endX + 1 || rabbit.y < startY - 1 || rabbit.y > endY + 1) continue
    const cx = (rabbit.x + 0.5) * tilePx - ox
    const cy = (rabbit.y + 0.5) * tilePx - oy
    const selected = rabbit.id === sim.selectedId

    if (selected) drawVisionRadius(ctx, cx, cy, tilePx)

    const [baseR, baseG, baseB] = rabbit.searching
      ? [125, 211, 252]
      : rabbit.running
        ? [255, 255, 255]
        : rabbit.resting
          ? [200, 196, 190]
          : [235, 231, 224]

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
    if (selected && tilePx >= 6) drawEnergyBar(ctx, rabbit, cx, cy, r, tilePx)
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

function drawVisionRadius(ctx, cx, cy, tilePx) {
  ctx.beginPath()
  ctx.arc(cx, cy, VISION_RADIUS * tilePx, 0, Math.PI * 2)
  ctx.strokeStyle = 'rgba(255,224,102,0.55)'
  ctx.lineWidth = Math.max(1, tilePx * 0.05)
  ctx.stroke()
  ctx.fillStyle = 'rgba(255,224,102,0.08)'
  ctx.fill()
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

function drawEnergyBar(ctx, rabbit, cx, cy, r, tilePx) {
  const barW = tilePx * 1.1
  const barH = Math.max(2, tilePx * 0.12)
  const bx = cx - barW / 2
  const by = cy - r * 2.2
  ctx.fillStyle = 'rgba(0,0,0,0.5)'
  ctx.fillRect(bx, by, barW, barH)
  ctx.fillStyle = 'rgb(120,214,110)'
  ctx.fillRect(bx, by, barW * (rabbit.energy / 100), barH)
}
