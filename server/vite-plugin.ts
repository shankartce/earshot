// Dev only: run the room server inside Vite's own HTTP server, so `npm run dev` is one process.
import path from 'node:path'
import type { Plugin } from 'vite'
import { aiFromEnv } from './ai/provider.ts'
import { RoomStore } from './rooms/store.ts'
import { attachRealtime } from './websocket/handlers.ts'

export function realtimeDevServer(): Plugin {
  return {
    name: 'earshot-realtime',
    configureServer(server) {
      if (!server.httpServer) return
      const store = new RoomStore(path.resolve('data', 'rooms.dev.json'))
      try { process.loadEnvFile() } catch { /* no .env: AI stays off */ }
      attachRealtime(server.httpServer as import('node:http').Server, { store, ai: aiFromEnv() })
      server.httpServer.on('close', () => store.close())
    },
  }
}
