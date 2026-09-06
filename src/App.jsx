import { useCallback, useState } from 'react'
import HomeScreen from './worldgen/HomeScreen.jsx'
import SettingsScreen from './worldgen/SettingsScreen.jsx'
import ScenarioScreen from './worldgen/ScenarioScreen.jsx'
import GameScreen from './worldgen/GameScreen.jsx'
import { useMapSettings } from './worldgen/useMapSettings.js'
import { useScenarioSettings } from './worldgen/useScenarioSettings.js'
import { generateMap } from './worldgen/mapgen.js'

function App() {
  const [screen, setScreen] = useState('home') // 'home' | 'settings' | 'scenario' | 'game'
  const [map, setMap] = useState(null)
  // The scenario the *running* game was started with, which is not the same
  // thing as the one the setup screen is currently showing: a run's rules
  // are fixed when you press play (see createSimulation), so editing a dial
  // mid-game must not re-shape the world underneath the player. Snapshotted
  // together with the map, and both replaced on the next play.
  const [runScenario, setRunScenario] = useState(null)
  const { settings, update, updateMany, reset } = useMapSettings()
  const {
    settings: scenario,
    update: updateScenario,
    updateMany: updateScenarioMany,
    reset: resetScenario,
  } = useScenarioSettings()

  const playNewMap = useCallback(() => {
    setMap(generateMap(settings))
    setRunScenario(scenario)
    setScreen('game')
  }, [settings, scenario])

  if (screen === 'settings') {
    return (
      <SettingsScreen
        settings={settings}
        onChange={update}
        onChangeMany={updateMany}
        onReset={reset}
        onBack={() => setScreen(map ? 'game' : 'home')}
        onPlay={playNewMap}
      />
    )
  }

  if (screen === 'scenario') {
    return (
      <ScenarioScreen
        scenario={scenario}
        onChange={updateScenario}
        onChangeMany={updateScenarioMany}
        onReset={resetScenario}
        onBack={() => setScreen(map ? 'game' : 'home')}
        onPlay={playNewMap}
      />
    )
  }

  if (screen === 'game') {
    return (
      <GameScreen
        map={map}
        scenario={runScenario}
        onBack={() => setScreen('home')}
        onNewMap={playNewMap}
        onOpenSettings={() => setScreen('settings')}
        onOpenScenario={() => setScreen('scenario')}
      />
    )
  }

  return (
    <HomeScreen
      onPlay={playNewMap}
      onOpenSettings={() => setScreen('settings')}
      onOpenScenario={() => setScreen('scenario')}
    />
  )
}

export default App
