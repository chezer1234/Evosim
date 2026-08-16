import { useCallback, useState } from 'react'
import HomeScreen from './worldgen/HomeScreen.jsx'
import SettingsScreen from './worldgen/SettingsScreen.jsx'
import GameScreen from './worldgen/GameScreen.jsx'
import { useMapSettings } from './worldgen/useMapSettings.js'
import { generateMap } from './worldgen/mapgen.js'

function App() {
  const [screen, setScreen] = useState('home') // 'home' | 'settings' | 'game'
  const [map, setMap] = useState(null)
  const { settings, update, updateMany, reset } = useMapSettings()

  const playNewMap = useCallback(() => {
    setMap(generateMap(settings))
    setScreen('game')
  }, [settings])

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

  if (screen === 'game') {
    return (
      <GameScreen
        map={map}
        onBack={() => setScreen('home')}
        onNewMap={playNewMap}
        onOpenSettings={() => setScreen('settings')}
      />
    )
  }

  return <HomeScreen onPlay={playNewMap} onOpenSettings={() => setScreen('settings')} />
}

export default App
