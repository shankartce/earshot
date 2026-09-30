// Production entry: `npm run build && npm start`.
import path from 'node:path'
import { createServer } from './app.ts'
import { RoomStore } from './rooms/store.ts'

const root = path.resolve(import.meta.dirname, '..')
const PORT = Number(process.env.PORT) || 3000
const store = new RoomStore(process.env.DATA_FILE ?? path.join(root, 'data', 'rooms.json'))
const server = createServer({ store, dist: path.join(root, 'dist') })

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    store.close()
    process.exit(0)
  })
}

server.listen(PORT, () => console.log(`Earshot running at http://localhost:${PORT}`))
