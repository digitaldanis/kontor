import { existsSync } from 'node:fs'
import { createApp } from './app'
import { backupDatabase } from './backups'
import { loadConfig } from './config'
import { openDatabase } from './sqlite'

if (existsSync('.env')) process.loadEnvFile('.env')

const config = loadConfig()
if (!config.secret) console.warn('KONTOR_SECRET is not set: SMTP passwords can only be stored once a secret is configured.')

const sql = openDatabase(config.dataDir)
const { app, events, runSchedules } = createApp({ config, sql })
const server = app.listen(config.port, () => console.log(`Kontor is running on http://localhost:${config.port}`))

const timers: NodeJS.Timeout[] = []
void runSchedules()
timers.push(setInterval(() => void runSchedules(), 60 * 60_000))
if (config.backupIntervalHours > 0) {
  const backup = () => {
    try {
      const file = backupDatabase(sql, config.dataDir, config.backupKeepDays)
      if (file) console.log(`Backup written: ${file}`)
    } catch (e) {
      console.error(`Backup failed: ${e instanceof Error ? e.message : e}`)
    }
  }
  backup()
  timers.push(setInterval(backup, config.backupIntervalHours * 3_600_000))
}

const shutdown = () => {
  timers.forEach(clearInterval)
  events.close()
  server.close(() => {
    sql.close()
    process.exit(0)
  })
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)
