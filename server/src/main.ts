import { loadConfig } from './config.ts'
import { createApp } from './app.ts'
import { Store } from './store.ts'

const config = loadConfig()
if (!config.secret) console.warn('Hinweis: KONTOR_SECRET ist nicht gesetzt. SMTP-Passwörter können erst gespeichert werden, wenn ein Schlüssel hinterlegt ist.')

const store = new Store(config.dataDir)
const app = createApp({ config, store })
const server = app.listen(config.port, () => console.log(`Kontor-Server läuft auf Port ${config.port}`))

const shutdown = () => {
  server.close(() => {
    store.close()
    process.exit(0)
  })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
