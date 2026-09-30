// In-memory rooms with a debounced JSON snapshot on disk so rooms survive restarts.
// ponytail: one JSON file rewritten whole; move to SQLite/Redis once rooms number in the thousands.
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { CODE_ALPHABET, CODE_LENGTH } from '../../shared/validate.ts'
import { createRoom, type Room } from '../state/room.ts'

export const ROOM_TTL_MS = 7 * 24 * 60 * 60 * 1000

export class RoomStore {
  rooms = new Map<string, Room>()
  private timer: NodeJS.Timeout | null = null
  private file: string | null

  constructor(file: string | null) {
    this.file = file
    if (file && fs.existsSync(file)) {
      try {
        const now = Date.now()
        for (const room of JSON.parse(fs.readFileSync(file, 'utf8')) as Room[]) {
          // Nobody is connected right after a restart; their grace period starts now.
          for (const p of room.participants) Object.assign(p, { isOnline: false, lastSeen: now, readiness: 'idle' })
          room.shares = {} // share offers only exist while their sharer is connected
          this.rooms.set(room.code, room)
        }
      } catch (err) {
        console.warn('Could not read saved rooms, starting fresh:', (err as Error).message)
      }
    }
  }

  create(name: string, emoji: string, now = Date.now()): Room {
    let code: string
    do {
      code = Array.from(crypto.randomBytes(CODE_LENGTH), b => CODE_ALPHABET[b % CODE_ALPHABET.length]).join('')
    } while (this.rooms.has(code))
    const room = createRoom(code, name, emoji, now)
    this.rooms.set(code, room)
    this.save()
    return room
  }

  get(code: string) {
    return this.rooms.get(code)
  }

  /** Drop rooms nobody has touched for a week. */
  expire(now = Date.now()) {
    for (const [code, room] of this.rooms) {
      const active = room.participants.some(p => p.isOnline)
      if (!active && now - room.updatedAt > ROOM_TTL_MS) this.rooms.delete(code)
    }
    this.save()
  }

  /** Debounced write; call after any state change worth remembering. */
  save() {
    if (!this.file || this.timer) return
    this.timer = setTimeout(() => {
      this.timer = null
      this.flush()
    }, 1000)
  }

  /** Final write; afterwards this store never touches disk again (e.g. superseded by a dev-server restart). */
  close() {
    this.flush()
    if (this.timer) clearTimeout(this.timer)
    this.file = null
  }

  flush() {
    if (!this.file) return
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.tmp`
    fs.writeFileSync(tmp, JSON.stringify([...this.rooms.values()]))
    fs.renameSync(tmp, this.file)
  }
}
