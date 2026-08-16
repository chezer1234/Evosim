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

function drawRabbits(ctx, sim, tilePx, ox, oy, startX, startY, endX, endY) {
  const r = Math.max(1.5, tilePx * 0.22)
  for (const rabbit of sim.rabbits) {
    if (!rabbit.alive) continue
    if (rabbit.x < startX - 1 || rabbit.x > endX + 1 || rabbit.y < startY - 1 || rabbit.y > endY + 1) continue
    const cx = (rabbit.x + 0.5) * tilePx - ox
    const cy = (rabbit.y + 0.5) * tilePx - oy
    const selected = rabbit.id === sim.selectedId

    if (selected) drawVisionRadius(ctx, cx, cy, tilePx)

    ctx.beginPath()
    ctx.fillStyle = rabbit.running ? 'rgb(255,255,255)' : rabbit.resting ? 'rgb(200,196,190)' : 'rgb(235,231,224)'
    ctx.arc(cx, cy, r, 0, Math.PI * 2)
    ctx.fill()
    ctx.lineWidth = Math.max(0.5, tilePx * 0.03)
    ctx.strokeStyle = selected ? 'rgba(255,224,102,0.9)' : 'rgba(60,50,40,0.6)'
    ctx.stroke()

    if (tilePx >= 8) drawEars(ctx, cx, cy, r)
    if (selected && tilePx >= 6) drawEnergyBar(ctx, rabbit, cx, cy, r, tilePx)
  }
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
