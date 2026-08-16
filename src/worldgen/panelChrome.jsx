// Shared chrome for the floating map panels (inspector, population, spawn).
// They differ entirely in content but should look and behave like one family,
// and - since issue #7 - they all have to work as a full-width bottom sheet
// on a phone as well as a corner overlay on a desktop.

/** The panel shell. Width is deliberately `w-full`: the wrapper in
 * GameScreen decides how wide a panel is, because that's where the layout
 * knows whether it's a corner overlay or a bottom sheet. `max-h-full` +
 * `overflow-y-auto` let a sheet scroll its own content instead of growing
 * past the map, and `overscroll-contain` stops that scroll chaining out into
 * the page (which on a phone reads as the whole app bouncing). */
// The border *colour* is left to each panel (the fox inspector wears an
// orange one), since two competing Tailwind border-colour utilities on one
// element resolve by stylesheet order, not by which is written last.
export const PANEL_SHELL =
  'pointer-events-auto flex max-h-full w-full flex-col overflow-y-auto overscroll-contain rounded-lg border bg-neutral-900/95 text-neutral-200 shadow-2xl shadow-black/40 backdrop-blur-sm'

/** Close control. Visually a small ✕, but padded out to a 44px touch target
 * (via a negative margin, so it doesn't push the header around) - the old
 * bare glyph was a ~14px tap target, which is a coin toss with a fingertip. */
export function CloseButton({ onClose }) {
  return (
    <button
      type="button"
      onClick={onClose}
      aria-label="Close"
      className="-m-2 flex h-11 w-11 shrink-0 items-center justify-center text-neutral-500 transition hover:text-neutral-200 active:text-neutral-200"
    >
      ✕
    </button>
  )
}
