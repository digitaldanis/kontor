// Starts the API (with reload on change) and the Vite dev server together.
import { spawn } from 'node:child_process'

const children = [
  spawn('npx', ['tsx', 'watch', '--clear-screen=false', 'server/src/main.ts'], { stdio: 'inherit', env: { ...process.env, PORT: process.env.API_PORT ?? '8787' } }),
  spawn('npx', ['vite'], { stdio: 'inherit' }),
]

const stop = () => {
  for (const c of children) c.kill('SIGTERM')
  process.exit(0)
}
process.on('SIGINT', stop)
process.on('SIGTERM', stop)
for (const c of children) c.on('exit', (code) => code && stop())
