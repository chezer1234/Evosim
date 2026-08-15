import { useEffect, useRef } from 'react'
import { fbm, makePerlin } from './mapgen.js'

/** Faint procedurally-generated topographic contour lines, purely decorative. */
export default function ContourBackdrop() {
  const canvasRef = useRef(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return

    function draw() {
      const dpr = Math.min(2, window.devicePixelRatio || 1)
      const rect = canvas.getBoundingClientRect()
      const w = Math.max(1, rect.width)
      const h = Math.max(1, rect.height)
      canvas.width = Math.round(w * dpr)
      canvas.height = Math.round(h * dpr)
      const ctx = canvas.getContext('2d')
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, w, h)
      ctx.strokeStyle = 'rgba(110, 231, 183, 0.12)' // emerald-300 at low opacity
      ctx.lineWidth = 1

      const perlin = makePerlin(1337)
      const cell = Math.max(18, Math.min(34, w / 28))
      const cols = Math.ceil(w / cell) + 1
      const rows = Math.ceil(h / cell) + 1
      const field = new Float32Array(cols * rows)
      for (let j = 0; j < rows; j++) {
        for (let i = 0; i < cols; i++) {
          field[j * cols + i] = fbm(perlin, i, j, 4, 0.5, 0.18) * 0.5 + 0.5
        }
      }

      const levels = [0.15, 0.3, 0.45, 0.6, 0.75, 0.9]
      for (const lvl of levels) {
        ctx.beginPath()
        for (let j = 0; j < rows - 1; j++) {
          for (let i = 0; i < cols - 1; i++) {
            const a = field[j * cols + i]
            const b = field[j * cols + i + 1]
            const c = field[(j + 1) * cols + i]
            const d = field[(j + 1) * cols + i + 1]
            const pts = []
            const x0 = i * cell
            const x1 = (i + 1) * cell
            const y0 = j * cell
            const y1 = (j + 1) * cell
            const edge = (v0, v1, ex0, ey0, ex1, ey1) => {
              if ((v0 < lvl) !== (v1 < lvl)) {
                const t = (lvl - v0) / (v1 - v0 || 1e-6)
                pts.push([ex0 + (ex1 - ex0) * t, ey0 + (ey1 - ey0) * t])
              }
            }
            edge(a, b, x0, y0, x1, y0)
            edge(b, d, x1, y0, x1, y1)
            edge(d, c, x1, y1, x0, y1)
            edge(c, a, x0, y1, x0, y0)
            if (pts.length >= 2) {
              ctx.moveTo(pts[0][0], pts[0][1])
              ctx.lineTo(pts[1][0], pts[1][1])
            }
          }
        }
        ctx.stroke()
      }
    }

    draw()
    let timer = null
    const onResize = () => {
      clearTimeout(timer)
      timer = setTimeout(draw, 120)
    }
    window.addEventListener('resize', onResize)
    return () => {
      window.removeEventListener('resize', onResize)
      clearTimeout(timer)
    }
  }, [])

  return <canvas ref={canvasRef} aria-hidden="true" className="absolute inset-0 h-full w-full" />
}
