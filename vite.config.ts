import preact from '@preact/preset-vite'
import { defineConfig } from 'vitest/config'
import { realtimeDevServer } from './server/vite-plugin.ts'

export default defineConfig({
  plugins: [preact(), realtimeDevServer()],
  server: { host: true, port: 5173 },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
})
