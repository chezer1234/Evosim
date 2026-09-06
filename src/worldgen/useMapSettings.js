import { DEFAULT_SETTINGS } from './mapgen.js'
import { usePersistentSettings } from './usePersistentSettings.js'

const STORE_KEY = 'evosim.mapSettings.v1'

/** Keep the min/max ranges coherent regardless of which handle moved. */
function coerceRanges(next, changedKey) {
  if (changedKey === 'minLakes' && next.minLakes > next.maxLakes) next.maxLakes = next.minLakes
  if (changedKey === 'maxLakes' && next.maxLakes < next.minLakes) next.minLakes = next.maxLakes
  if (changedKey === 'minIslands' && next.minIslands > next.maxIslands) next.maxIslands = next.minIslands
  if (changedKey === 'maxIslands' && next.maxIslands < next.minIslands) next.minIslands = next.maxIslands
  return next
}

/** Map-generation settings, persisted to localStorage across visits. */
export function useMapSettings() {
  return usePersistentSettings(STORE_KEY, DEFAULT_SETTINGS, coerceRanges)
}
