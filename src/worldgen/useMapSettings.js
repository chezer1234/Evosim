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
      let next = { ...prev, [key]: value }
      // keep the min/max lake range coherent regardless of which handle moved
      if (key === 'minLakes' && value > next.maxLakes) next.maxLakes = value
      if (key === 'maxLakes' && value < next.minLakes) next.minLakes = value
      persist(next)
      return next
    })
  }, [])

  const reset = useCallback(() => {
    const next = { ...DEFAULT_SETTINGS }
    persist(next)
    setSettings(next)
  }, [])

  return { settings, update, reset }
}
