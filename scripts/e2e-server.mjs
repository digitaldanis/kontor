// Starts the built server with an empty database for the end-to-end tests.
import { spawn } from 'node:child_process'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dataDir = mkdtempSync(join(tmpdir(), 'kontor-e2e-'))
const child = spawn('node', ['dist-server/main.js'], {
  stdio: 'inherit',
  env: { ...process.env, NODE_ENV: 'production', PORT: process.env.E2E_PORT ?? '4317', DATA_DIR: dataDir, COOKIE_SECURE: 'false', KONTOR_SECRET: 'e2e-secret', BACKUP_INTERVAL_HOURS: '0', STATIC_DIR: './dist' },
})
const stop = () => child.kill('SIGTERM')
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
child.on('exit', (code) => process.exit(code ?? 0))
