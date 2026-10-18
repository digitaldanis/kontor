// Starts the API (reloading on change) and the Vite dev server together.
import { spawn } from 'node:child_process'

const apiPort = process.env.API_PORT ?? process.env.PORT ?? '8787'
const env = { ...process.env, API_PORT: apiPort }
const children = [
  spawn(process.execPath, ['node_modules/tsx/dist/cli.mjs', 'watch', '--clear-screen=false', 'server/src/main.ts'], { stdio: 'inherit', env: { ...env, PORT: apiPort } }),
  spawn(process.execPath, ['node_modules/vite/bin/vite.js'], { stdio: 'inherit', env }),
]

let stopping = false
const stop = (code = 0) => {
  if (stopping) return
  stopping = true
  for (const c of children) c.kill('SIGTERM')
  setTimeout(() => process.exit(code), 300)
}
process.on('SIGINT', () => stop())
process.on('SIGTERM', () => stop())
for (const c of children) c.on('exit', (code) => stop(code ?? 0))
