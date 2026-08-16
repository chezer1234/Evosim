import { useEffect, useState } from 'react'

// "Compact" rather than "mobile": what actually matters is how much room the
// chrome can take before it starts eating the map, not what kind of device
// it is. The height clause is what catches a phone held sideways - plenty
// wide, but only ~380px tall, where the desktop toolbar would leave a sliver
// of island underneath it.
const COMPACT_QUERY = '(max-width: 640px), (max-height: 560px)'
// Short but wide - a phone in landscape. A bottom sheet there would cover
// almost the entire map, so panels dock to the side instead.
const SHORT_WIDE_QUERY = '(max-height: 560px) and (min-width: 560px)'
const COARSE_QUERY = '(pointer: coarse)'

function useMediaQuery(query) {
  const [matches, setMatches] = useState(() =>
    typeof window !== 'undefined' && window.matchMedia ? window.matchMedia(query).matches : false,
  )

  useEffect(() => {
    const mq = window.matchMedia(query)
    const onChange = (e) => setMatches(e.matches)
    setMatches(mq.matches)
    mq.addEventListener('change', onChange)
    return () => mq.removeEventListener('change', onChange)
  }, [query])

  return matches
}

/** True when the viewport is too small for the desktop chrome: drives the
 * compact toolbars in GameScreen. Re-evaluates on resize/rotate, so turning a
 * phone sideways switches layout immediately. */
export function useIsCompact() {
  return useMediaQuery(COMPACT_QUERY)
}

/** True on devices whose primary input is a finger. Used only for wording
 * ("Pinch to zoom" vs "Scroll to zoom") - every gesture itself works from
 * either input, so nothing functional hangs off this. */
export function useIsTouch() {
  return useMediaQuery(COARSE_QUERY)
}

/** Where the map's floating panels should sit, given the room available:
 * - `corner` - the desktop overlays, one per corner, independent of each other
 * - `sheet`  - a full-width bottom sheet (phone held upright)
 * - `side`   - a full-height panel down one edge (phone held sideways, where
 *              a sheet would swallow the whole map)
 */
export function usePanelPlacement() {
  const compact = useIsCompact()
  const shortWide = useMediaQuery(SHORT_WIDE_QUERY)
  if (!compact) return 'corner'
  return shortWide ? 'side' : 'sheet'
}
