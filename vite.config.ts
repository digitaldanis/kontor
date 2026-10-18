/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

/**
 * Writes sw.js with the list of built files, so the app shell can be
 * installed and opens without network. Data always comes from the API.
 */
function serviceWorker(): Plugin {
  return {
    name: 'kontor-service-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((f) => !f.endsWith('.map'))
      const version = files.join('|').length.toString(36) + '-' + Date.now().toString(36)
      const shell = ['./', 'index.html', 'manifest.webmanifest', 'favicon.svg', 'icon-192.png', ...files.filter((f) => !f.startsWith('fonts/'))]
      this.emitFile({
        type: 'asset',
        fileName: 'sw.js',
        source: `const CACHE = 'kontor-${version}'
const SHELL = ${JSON.stringify(shell)}
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})
self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url)
  // never cache data: the server is the only source of truth
  if (e.request.method !== 'GET' || url.origin !== location.origin || url.pathname.includes('/api/')) return
  if (e.request.mode === 'navigate') {
    e.respondWith(fetch(e.request).catch(() => caches.match('index.html')))
    return
  }
  e.respondWith(
    caches.match(e.request).then(
      (hit) =>
        hit ||
        fetch(e.request).then((res) => {
          if (res.ok && (url.pathname.includes('/assets/') || url.pathname.includes('/fonts/'))) {
            const copy = res.clone()
            caches.open(CACHE).then((c) => c.put(e.request, copy))
          }
          return res
        }),
    ),
  )
})
`,
      })
    },
  }
}

export default defineConfig({
  base: './',
  plugins: [react(), serviceWorker()],
  server: {
    proxy: {
      '/api': { target: `http://localhost:${process.env.API_PORT ?? 8787}` },
    },
  },
  build: {
    chunkSizeWarningLimit: 800,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
