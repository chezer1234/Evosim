import { useCallback, useState } from 'react'
import { DEFAULT_SETTINGS } from './mapgen.js'

const STORE_KEY = 'evosim.mapSettings.v1'

function load() {
  try {
    const raw = localStorage.getItem(STORE_KEY)
    if (!raw) return { ...DEFAULT_SETTINGS }
    return { ...DEFAULT_SETTINGS, ...JSON.parse(raw) }
  } catch {
    return { ...DEFAULT_SETTINGS }
  }
}

function persist(settings) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(settings))
  } catch {
    // localStorage unavailable (private mode, etc.) - settings just won't persist
  }
}

/** Map-generation settings, persisted to localStorage across visits. */
export function useMapSettings() {
  const [settings, setSettings] = useState(load)

  const update = useCallback((key, value) => {
    setSettings((prev) => {
      const next = { ...prev, [key]: value }
      // keep the min/max ranges coherent regardless of which handle moved
      if (key === 'minLakes' && value > next.maxLakes) next.maxLakes = value
      if (key === 'maxLakes' && value < next.minLakes) next.minLakes = value
      if (key === 'minIslands' && value > next.maxIslands) next.maxIslands = value
      if (key === 'maxIslands' && value < next.minIslands) next.minIslands = value
      persist(next)
      return next
    })
  }, [])

  /** Several keys at once, for the world presets - where size and island
   *  count have to move together or the intermediate state is a world nobody
   *  asked for (a 224-tile map with one island on it). */
  const updateMany = useCallback((patch) => {
    setSettings((prev) => {
      const next = { ...prev, ...patch }
      persist(next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    const next = { ...DEFAULT_SETTINGS }
    persist(next)
    setSettings(next)
  }, [])

  return { settings, update, updateMany, reset }
}
