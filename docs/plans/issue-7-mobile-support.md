# Issue #7 — Better mobile support: implementation plan

Source: https://github.com/chezer1234/Evosim/issues/7

> "Detect when a device is mobile
>
> - need pinch to zoom
> - can't see the brain feature - very odd navigation to that and certainly not mobile friendly
>
> But generally we want a mobile compatible experience across the whole app"

## Decisions

| Question | Decision |
|---|---|
| Detect the *device*? | No — detect the **room available**. A `(max-width: 640px), (max-height: 560px)` media query (`useIsCompact`) drives the layout, so a phone, a phone in landscape and a small desktop window all get chrome that fits. Nothing branches on user-agent, and rotating a phone re-lays-out immediately. |
| Where do the panels go? | Three placements from one hook (`usePanelPlacement`): **corner** overlays on a desktop (unchanged), a full-width **bottom sheet** on an upright phone, and a **side** panel on a phone held sideways — where a sheet would swallow a map area only ~200px tall. |
| Two panels at once? | On a desktop, yes (unchanged — they were deliberately independent). On a compact screen the sheets would stack on top of each other, so opening one closes the others. |
| Where do the controls go? | The desktop toolbar wrapped to four rows on a phone and left a sliver of island. Compact splits it: a slim icon row on top (menu / new map / settings / live counts) and a thumb-height **tab bar** at the bottom for Spawn · Inspect · Trends · Pause · Speed · Fit. |
| Pinch implementation | Pointer events, not touch events — the existing pan/click handling is already pointer-based, so a pinch is just "the gesture when a second pointer is down". |
| Keep browser page zoom? | Yes. `maximum-scale` is deliberately **not** set: the map has its own pinch handler (the canvas is `touch-action: none`), and disabling browser zoom outright breaks anyone who needs it to read. |

## Pinch, pan and tap (`src/worldgen/viewport.js`)

The view maths moved out of `GameScreen.jsx` into a DOM-free module so the
gesture handling is a thin layer of event plumbing over functions that can be
tested (`viewport.test.js`). A *view* is `{ tilePx, originX, originY }` — how
many CSS pixels a tile occupies and which tile sits at the canvas's top-left.

| Function | Used by |
|---|---|
| `zoomedView` | wheel zoom, the desktop +/− buttons |
| `pannedView` | one-finger / mouse drag |
| `pinchStart` + `pinchedView` | two-finger pinch |
| `clampOriginAxis` | all of them — clamps pan to the map, centres it when the viewport is bigger |

All three funnel into `viewAnchoredAt`: *re-zoom so that this map tile stays
under this screen point*. Pinch therefore zooms **and** pans at once — the
point you grabbed stays between your fingers, and a two-finger drag with no
change in separation pans without zooming. Zoom clamping is what separates
the two: past the limits the scale stops but the pan keeps tracking.

Gesture bookkeeping in `GameScreen`: every pointer down is tracked in a `Map`.
One pointer is a drag; a second promotes the gesture to a pinch (cancelling the
drag, so releasing never registers as a stray tap). Lifting back to one pointer
resumes panning from where that finger currently is, pre-marked as moved.
iOS Safari's non-standard `gesturestart`/`gesturechange` events are also
suppressed on the canvas, since it will otherwise page-zoom the whole UI on
two fingers regardless of `touch-action`.

**Touch tolerances**, both in `viewport.js`:

- `clickSlopPx` — a fingertip wobbles far more than a mouse between press and
  release, so touch gets 12px of slop before a tap becomes a pan (mouse: 4px).
  Without this, half of all taps registered as tiny pans and selected nothing.
- `selectRadiusTiles` — a finger covers ~20 CSS px of screen however far you're
  zoomed out, so on touch the selection radius is whatever that works out to in
  tiles, floored at the mouse's original 0.7. Fully zoomed out, 0.7 tiles is
  about 8px — invisible to a fingertip.

## The brain panel (issue's second bullet)

Three separate problems, all fixed:

1. **Reaching it.** It was behind a toolbar button that wrapped off-screen.
   It's now a first-class tab in the bottom bar — *and* tapping a creature on
   the map opens the inspector automatically on a compact screen, since there's
   no hover to hint that something got selected.
2. **Reading it.** The panel was a fixed 320px overlay pinned to a corner. It's
   now a full-width sheet, and the network diagram scales to the panel width
   (`h-auto`) instead of letterboxing inside a fixed 320px box.
3. **The numbers.** Exact weights were on `<title>` hover tooltips, which a
   touch device cannot show at all. Every edge and node now has an invisible
   fat hit area, and tapping one highlights it and prints its exact weight in a
   readout under the diagram. Hover still works on a desktop.

## Everything else

- **Panel slots pin both edges** (`top-3 bottom-3`) rather than one edge plus a
  percentage `max-height`. A percentage max-height resolves to nothing against
  an auto-height absolutely-positioned parent, so the panels were spilling past
  the bottom of the map and covering the controls underneath — on the desktop
  layout too. Pinning both edges plus `flex-col` gives "as tall as its content,
  up to the space available, then scroll".
- **Tap targets**: 44px minimum on every control — the compact toolbars, the
  panels' close buttons (padded out from a ~14px glyph via negative margin, so
  the header layout doesn't change), the spawn counts, and the Settings
  buttons.
- **Sliders** (`.evo-slider` in `index.css`) are hand-styled so the *hit area*
  can be 40px tall on a coarse pointer while the visible track stays a thin
  line — padding on a wrapper doesn't extend an input's hit area, so the
  element itself has to be tall.
- **`overscroll-behavior: none`** on the body: without it, dragging the map
  past the top of the page fired pull-to-refresh and reloaded the simulation.
  Panels get `overscroll-contain` for the same reason.
- **Safe areas**: `viewport-fit=cover` plus `.safe-x` / `.safe-b`, so the
  chrome clears notches and the home indicator.
- **The map hint** ("Pinch to zoom · Tap a creature") sits over the map on a
  compact screen, so it retires after six seconds rather than permanently
  covering a strip of island, and comes back when it has something new to say.
- **Canvas measurement** reads the wrapper's actual padding instead of assuming
  the desktop's 20px, since the compact layout uses a much tighter gutter.
- **Counters and panels update while paused.** Previously they were inside the
  `if (!paused)` branch, so spawning a creature while paused showed nothing —
  which is exactly what you do on a phone to set a scenario up before pressing
  play.

## Testing

`viewport.test.js` covers the new pure logic: pan clamping, zoom anchoring and
limits, pinch (proportional zoom, midpoint tracking, two-finger pan, limits),
and the touch tolerances. The gesture plumbing and layout were verified in a
real browser at iPhone-portrait, iPhone-landscape, 320×568 and desktop sizes —
pinch 100% → 433% → back, tap-to-place, tap-to-select, drag-not-selecting, and
the desktop wheel/button/panel behaviour left unchanged.
