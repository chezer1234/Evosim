import { DEFAULT_SCENARIO, resolveScenario } from '../sim/scenario.js'
import { usePersistentSettings } from './usePersistentSettings.js'

const STORE_KEY = 'evosim.scenario.v1'

/** The starting conditions a run begins from, persisted across visits (see
 * sim/scenario.js). Every value is clamped to its own slider's range on the
 * way in and out: a scenario in storage was written by whatever build the
 * player last used, and a dial that has since been narrowed - or removed -
 * should not be able to hand the sim a number it no longer offers. */
export function useScenarioSettings() {
  return usePersistentSettings(STORE_KEY, DEFAULT_SCENARIO, resolveScenario)
}
