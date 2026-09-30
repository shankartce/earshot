// Production entry: serves the built client and the realtime room server. No audio endpoints exist.
import express from 'express'
import http from 'node:http'
import path from 'node:path'
import { RoomStore } from './rooms/store.ts'
import { attachRealtime } from './websocket/handlers.ts'

const root = path.resolve(import.meta.dirname, '..')
const dist = path.join(root, 'dist')
const PORT = Number(process.env.PORT) || 3000

const app = express()
app.disable('x-powered-by')
app.use(express.static(dist, { index: false, maxAge: '1h' }))
app.get('/{*path}', (_req, res) => res.sendFile(path.join(dist, 'index.html'))) // SPA routes

const server = http.createServer(app)
const store = new RoomStore(process.env.DATA_FILE ?? path.join(root, 'data', 'rooms.json'))
attachRealtime(server, { store })

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    store.flush()
    process.exit(0)
  })
}

server.listen(PORT, () => console.log(`Free Jam running at http://localhost:${PORT}`))
