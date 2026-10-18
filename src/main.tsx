import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { uiLanguage } from './lib/i18n'
import { startSync } from './lib/sync'

document.documentElement.lang = uiLanguage()

startSync()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
