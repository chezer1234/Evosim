// A literal (but simplified) picture of a rabbit's brain: the actual
// input -> hidden -> output network from sim/brain.js, drawn as nodes and
// weighted edges instead of a wall of numbers. "Simplified" because it
// draws every connection but lets weight do the talking - near-zero
// weights fade to almost invisible, so only the pathways that actually
// steer the rabbit stand out. Green = excites the output, red = suppresses
// it; thicker/brighter = stronger pull. Hover any edge or node for the
// exact number.
//
// This is the raw w1/w2 network (literal weights), which is a different
// (complementary) view from brainInsight.js's computePathways - that one
// collapses input->hidden->output into a single signed input->output
// number for the trait bars; this one shows the actual wiring in between.

import { HIDDEN_SIZE, INPUT_SIZE, OUTPUT_SIZE, WEIGHT_CLAMP } from '../sim/brain.js'
import { INPUT_LABELS, OUTPUT_LABELS } from '../sim/brainInsight.js'

const W = 360
const H = 320
const LAYER_X = { input: 112, hidden: 196, output: 280 }
const NODE_R = { input: 5, hidden: 3.5, output: 5 }

function layerYs(count) {
  const step = H / (count + 1)
  return Array.from({ length: count }, (_, i) => step * (i + 1))
}

function weightColor(w) {
  return w >= 0 ? 'rgb(120,214,110)' : 'rgb(248,113,113)'
}

// Near-zero weights fade almost to nothing; strong ones (near the mutation
// clamp) come in bold - this is what makes the diagram read as
// "simplified" despite drawing every edge.
function edgeStyle(w) {
  const mag = Math.min(1, Math.abs(w) / WEIGHT_CLAMP)
  return { opacity: 0.05 + mag * 0.6, width: 0.4 + mag * 2.4 }
}

function Edge({ x1, y1, x2, y2, w }) {
  const { opacity, width } = edgeStyle(w)
  return (
    <line x1={x1} y1={y1} x2={x2} y2={y2} stroke={weightColor(w)} strokeWidth={width} opacity={opacity}>
      <title>{w.toFixed(2)}</title>
    </line>
  )
}

export default function BrainNetworkDiagram({ brain }) {
  const { w1, b1, w2, b2 } = brain
  const inY = layerYs(INPUT_SIZE)
  const hidY = layerYs(HIDDEN_SIZE)
  const outY = layerYs(OUTPUT_SIZE)

  const edges1 = []
  for (let i = 0; i < INPUT_SIZE; i++) {
    for (let h = 0; h < HIDDEN_SIZE; h++) {
      edges1.push(<Edge key={`i${i}h${h}`} x1={LAYER_X.input} y1={inY[i]} x2={LAYER_X.hidden} y2={hidY[h]} w={w1[i * HIDDEN_SIZE + h]} />)
    }
  }
  const edges2 = []
  for (let h = 0; h < HIDDEN_SIZE; h++) {
    for (let o = 0; o < OUTPUT_SIZE; o++) {
      edges2.push(<Edge key={`h${h}o${o}`} x1={LAYER_X.hidden} y1={hidY[h]} x2={LAYER_X.output} y2={outY[o]} w={w2[h * OUTPUT_SIZE + o]} />)
    }
  }

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" height={H}>
      <g>{edges1}</g>
      <g>{edges2}</g>
      {inY.map((y, i) => (
        <g key={`in${i}`}>
          <circle cx={LAYER_X.input} cy={y} r={NODE_R.input} fill="rgb(96,165,250)" />
          <text x={LAYER_X.input - 9} y={y + 2.5} textAnchor="end" fontSize="7" fill="rgb(163,163,163)">
            {INPUT_LABELS[i]}
          </text>
        </g>
      ))}
      {hidY.map((y, h) => (
        <circle key={`h${h}`} cx={LAYER_X.hidden} cy={y} r={NODE_R.hidden} fill="rgb(148,163,184)">
          <title>{`hidden neuron ${h} (bias ${b1[h].toFixed(2)})`}</title>
        </circle>
      ))}
      {outY.map((y, o) => (
        <g key={`out${o}`}>
          <circle cx={LAYER_X.output} cy={y} r={NODE_R.output} fill="rgb(244,114,182)">
            <title>{`bias ${b2[o].toFixed(2)}`}</title>
          </circle>
          <text x={LAYER_X.output + 9} y={y + 2.5} textAnchor="start" fontSize="7" fill="rgb(163,163,163)">
            {OUTPUT_LABELS[o]}
          </text>
        </g>
      ))}
    </svg>
  )
}
