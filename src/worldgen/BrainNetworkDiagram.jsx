// A literal (but simplified) picture of a creature's brain: the actual
// input -> hidden -> output network - a rabbit's (sim/brain.js) or a fox's
// (sim/foxBrain.js), since the two nets differ only in their shape and
// labels - drawn as nodes and weighted edges instead of a wall of numbers.
// "Simplified" because it
// draws every connection but lets weight do the talking - near-zero
// weights fade to almost invisible, so only the pathways that actually
// steer the rabbit stand out. Green = excites the output, red = suppresses
// it; thicker/brighter = stronger pull. Hover any edge or node for the
// exact number - or tap it, on a device with no hover to give (issue #7):
// the selection is echoed in a readout under the diagram, which is also
// where the number goes when the labels are too small to squint at.
//
// This is the raw w1/w2 network (literal weights), which is a different
// (complementary) view from brainInsight.js's computePathways - that one
// collapses input->hidden->output into a single signed input->output
// number for the trait bars; this one shows the actual wiring in between.

import { useEffect, useState } from 'react'
import { BRAIN_SHAPE, WEIGHT_CLAMP } from '../sim/brain.js'
import { INPUT_LABELS, OUTPUT_LABELS } from '../sim/brainInsight.js'

const W = 400
const H = 310
const LAYER_X = { input: 130, hidden: 225, output: 300 }
const NODE_R = { input: 5, hidden: 4, output: 5 }
// Fingers need something bigger than a 1px line to hit; an invisible fat
// stroke over each edge is the usual trick, and costs nothing visually.
const HIT_WIDTH = 12
const LABEL_SIZE = 8.5

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

function Edge({ x1, y1, x2, y2, w, label, onPick, active }) {
  const { opacity, width } = edgeStyle(w)
  return (
    <g onClick={() => onPick({ label, value: w })} style={{ cursor: 'pointer' }}>
      <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="transparent" strokeWidth={HIT_WIDTH} />
      <line
        x1={x1}
        y1={y1}
        x2={x2}
        y2={y2}
        stroke={active ? 'rgb(250,250,250)' : weightColor(w)}
        strokeWidth={active ? Math.max(width, 2) : width}
        opacity={active ? 1 : opacity}
      >
        <title>{`${label}: ${w.toFixed(2)}`}</title>
      </line>
    </g>
  )
}

/** `shape`/`inputLabels`/`outputLabels` default to the rabbit's net, so the
 * fox panel is the only caller that has to say which brain it is drawing. */
export default function BrainNetworkDiagram({ brain, shape = BRAIN_SHAPE, inputLabels = INPUT_LABELS, outputLabels = OUTPUT_LABELS }) {
  const { w1, b1, w2, b2 } = brain
  const { inputs: inputSize, hidden: hiddenSize, outputs: outputSize } = shape
  const [picked, setPicked] = useState(null)

  // A different creature is a different network, so the last one's selection
  // would be pointing at a connection that no longer exists.
  useEffect(() => setPicked(null), [brain])

  const inY = layerYs(inputSize)
  const hidY = layerYs(hiddenSize)
  const outY = layerYs(outputSize)
  const isActive = (label) => picked?.label === label

  const edges1 = []
  for (let i = 0; i < inputSize; i++) {
    for (let h = 0; h < hiddenSize; h++) {
      const label = `${inputLabels[i]} → hidden ${h + 1}`
      edges1.push(
        <Edge
          key={`i${i}h${h}`}
          x1={LAYER_X.input}
          y1={inY[i]}
          x2={LAYER_X.hidden}
          y2={hidY[h]}
          w={w1[i * hiddenSize + h]}
          label={label}
          active={isActive(label)}
          onPick={setPicked}
        />,
      )
    }
  }
  const edges2 = []
  for (let h = 0; h < hiddenSize; h++) {
    for (let o = 0; o < outputSize; o++) {
      const label = `hidden ${h + 1} → ${outputLabels[o]}`
      edges2.push(
        <Edge
          key={`h${h}o${o}`}
          x1={LAYER_X.hidden}
          y1={hidY[h]}
          x2={LAYER_X.output}
          y2={outY[o]}
          w={w2[h * outputSize + o]}
          label={label}
          active={isActive(label)}
          onPick={setPicked}
        />,
      )
    }
  }

  return (
    <div className="flex flex-col gap-1">
      {/* height:auto so the diagram scales with the panel rather than
          letterboxing itself inside a fixed 320px box on a narrow screen. */}
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full touch-manipulation" role="img" aria-label="Neural network diagram">
        <g>{edges1}</g>
        <g>{edges2}</g>
        {inY.map((y, i) => (
          <g key={`in${i}`} onClick={() => setPicked({ label: inputLabels[i], value: null })} style={{ cursor: 'pointer' }}>
            <circle cx={LAYER_X.input} cy={y} r={NODE_R.input + 6} fill="transparent" />
            <circle cx={LAYER_X.input} cy={y} r={NODE_R.input} fill="rgb(96,165,250)" />
            <text x={LAYER_X.input - 10} y={y + 3} textAnchor="end" fontSize={LABEL_SIZE} fill="rgb(163,163,163)">
              {inputLabels[i]}
            </text>
          </g>
        ))}
        {hidY.map((y, h) => (
          <g key={`h${h}`} onClick={() => setPicked({ label: `hidden neuron ${h + 1} bias`, value: b1[h] })} style={{ cursor: 'pointer' }}>
            <circle cx={LAYER_X.hidden} cy={y} r={NODE_R.hidden + 6} fill="transparent" />
            <circle cx={LAYER_X.hidden} cy={y} r={NODE_R.hidden} fill="rgb(148,163,184)">
              <title>{`hidden neuron ${h + 1} (bias ${b1[h].toFixed(2)})`}</title>
            </circle>
          </g>
        ))}
        {outY.map((y, o) => (
          <g key={`out${o}`} onClick={() => setPicked({ label: `${outputLabels[o]} bias`, value: b2[o] })} style={{ cursor: 'pointer' }}>
            <circle cx={LAYER_X.output} cy={y} r={NODE_R.output + 6} fill="transparent" />
            <circle cx={LAYER_X.output} cy={y} r={NODE_R.output} fill="rgb(244,114,182)">
              <title>{`bias ${b2[o].toFixed(2)}`}</title>
            </circle>
            <text x={LAYER_X.output + 10} y={y + 3} textAnchor="start" fontSize={LABEL_SIZE} fill="rgb(163,163,163)">
              {outputLabels[o]}
            </text>
          </g>
        ))}
      </svg>
      <p className="min-h-8 rounded-sm bg-neutral-900 px-2 py-1 text-[11px] leading-snug text-neutral-300">
        {picked ? (
          <>
            <span className="text-neutral-400">{picked.label}</span>
            {picked.value == null ? null : (
              <>
                {' '}
                <b className="font-mono tabular-nums" style={{ color: weightColor(picked.value) }}>
                  {picked.value.toFixed(2)}
                </b>
              </>
            )}
          </>
        ) : (
          <span className="text-neutral-600">Tap a line or dot to read its exact weight.</span>
        )}
      </p>
    </div>
  )
}
