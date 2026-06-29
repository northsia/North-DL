import { useEffect, useState } from 'react'
import DownloaderView from './views/DownloaderView'
import SettingsView from './views/SettingsView'

function App() {
  const [route, setRoute] = useState(window.location.hash)

  useEffect(() => {
    const onHashChange = () => setRoute(window.location.hash)
    window.addEventListener('hashchange', onHashChange)
    return () => window.removeEventListener('hashchange', onHashChange)
  }, [])

  if (route === '#settings') {
    return <SettingsView />
  }

  return <DownloaderView />
}

export default App