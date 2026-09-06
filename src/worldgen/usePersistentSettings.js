import { useCallback, useState } from 'react'

// The settings pattern both screens use: a plain object of numbers, kept in
// React state, written to localStorage on every change and read back on the
// next visit. Two of them now - the world you generate (see useMapSettings)
// and the starting conditions you generate it for (useScenarioSettings) -
// which is why the mechanism lives here rather than in either one.
//
// `coerce` is the hook for settings that cannot be edited one key at a time:
// the map's min/max pairs have to stay in order whichever handle moved, and
// a scenario read back from storage has to be clamped to the ranges *this*
// build's sliders allow. It runs on load and on every change, so no caller
// can forget it.

function load(storeKey, defaults, coerce) {
  let stored = null
  try {
    const raw = localStorage.getItem(storeKey)
    stored = raw ? JSON.parse(raw) : null
  } catch {
    // localStorage unavailable (private mode), or something wrote junk into
    // it - either way the defaults are a fine place to start.
    stored = null
  }
  const merged = { ...defaults, ...stored }
  return coerce ? coerce(merged) : merged
}

function persist(storeKey, settings) {
  try {
    localStorage.setItem(storeKey, JSON.stringify(settings))
  } catch {
    // localStorage unavailable (private mode, etc.) - settings just won't persist
  }
  return settings
}

/**
 * Settings persisted to localStorage across visits.
 *
 * @param storeKey  localStorage key, versioned by the caller
 * @param defaults  the full default object; also what `reset` restores
 * @param coerce    optional `(settings, changedKey) => settings`, applied on
 *                  load and after every edit
 */
export function usePersistentSettings(storeKey, defaults, coerce) {
  const [settings, setSettings] = useState(() => load(storeKey, defaults, coerce))

  const apply = useCallback(
    (patch, changedKey) => {
      setSettings((prev) => {
        const next = { ...prev, ...patch }
        return persist(storeKey, coerce ? coerce(next, changedKey) : next)
      })
    },
    [storeKey, coerce],
  )

  const update = useCallback((key, value) => apply({ [key]: value }, key), [apply])

  /** Several keys at once, for the presets - where the individual dials have
   *  to move together or the intermediate state is a world nobody asked for
   *  (a 224-tile map with one island on it, a predator's island with the
   *  predator half applied). */
  const updateMany = useCallback((patch) => apply(patch), [apply])

  const reset = useCallback(() => {
    setSettings(persist(storeKey, { ...defaults }))
  }, [storeKey, defaults])

  return { settings, update, updateMany, reset }
}
