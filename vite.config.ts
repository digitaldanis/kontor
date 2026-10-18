/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    proxy: {
      '/api': { target: `http://localhost:${process.env.API_PORT ?? 8787}`, changeOrigin: false },
    },
  },
  build: {
    chunkSizeWarningLimit: 700,
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
})
