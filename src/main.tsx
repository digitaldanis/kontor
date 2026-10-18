import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { setDatabase } from './lib/db'
import { uiLanguage } from './lib/i18n'
import { remoteDatabase } from './lib/remote'
import './index.css'

document.documentElement.lang = uiLanguage()
setDatabase(remoteDatabase())

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
