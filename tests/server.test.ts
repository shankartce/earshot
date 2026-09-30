import fs from 'node:fs'
import type http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { io as connect } from 'socket.io-client'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer } from '../server/app.ts'
import { ROOM_TTL_MS, RoomStore } from '../server/rooms/store.ts'
import { addParticipant, applyPlayback, applyQueue, createRoom, setOffline } from '../server/state/room.ts'

let server: http.Server
let base: string
const dist = fs.mkdtempSync(path.join(os.tmpdir(), 'jam-dist-'))
fs.writeFileSync(path.join(dist, 'index.html'), '<!doctype html><title>Free Jam</title>')

beforeAll(async () => {
  server = createServer({ store: new RoomStore(null), dist })
  await new Promise<void>(r => server.listen(0, r))
  base = `http://localhost:${(server.address() as any).port}`
})
afterAll(() => new Promise(r => server.close(r)))

describe('http surface', () => {
  it('has no upload endpoint: non-GET requests are 404 and bodies are ignored', async () => {
    const big = new Uint8Array(2 * 1024 * 1024)
    for (const [method, url] of [['POST', '/upload'], ['PUT', '/room/ABCDE'], ['POST', '/'], ['PATCH', '/api/tracks']]) {
      const res = await fetch(base + url, { method, body: big })
      expect(res.status, `${method} ${url}`).toBe(404)
    }
  })

  it('serves the app for client routes (deep links work)', async () => {
    for (const p of ['/', '/room/ABCDE', '/library', '/settings']) {
      const res = await fetch(base + p)
      expect(res.status).toBe(200)
      expect(await res.text()).toContain('<title>Free Jam</title>')
    }
  })

  it('sends security headers', async () => {
    const res = await fetch(base + '/')
    const csp = res.headers.get('content-security-policy')!
    expect(csp).toContain("default-src 'self'")
    expect(csp).toContain("script-src 'self'")
    expect(csp).toContain('media-src \'self\' blob:')
    expect(res.headers.get('x-content-type-options')).toBe('nosniff')
    expect(res.headers.get('x-powered-by')).toBeNull()
  })
})

describe('abuse limits', () => {
  it('rapid-fire playback commands are rate limited', async () => {
    const s = connect(base, { forceNew: true, transports: ['websocket'] })
    const profile = { displayName: 'Spam', avatar: { emoji: '🙂', color: '#ff8844' } }
    const joined: any = await new Promise(r => s.emit('room:create', { name: 'x', emoji: '🎧', profile }, r))
    expect(joined.ok).toBe(true)
    const results: any[] = await Promise.all(Array.from({ length: 25 }, () =>
      new Promise(r => s.emit('playback:command', { type: 'PAUSE', baseVersion: 0 }, r))))
    expect(results.filter(r => r.error === 'Slow down a little and try again.').length).toBeGreaterThan(10)
    s.disconnect()
  })
})

describe('room memory', () => {
  it('expires rooms idle for a week, keeps recent or occupied ones', () => {
    const store = new RoomStore(null)
    const now = Date.now()
    const old = store.create('old', '🎧', now - ROOM_TTL_MS - 1000)
    const recent = store.create('recent', '🎧', now - 1000)
    const occupied = store.create('busy', '🎧', now - ROOM_TTL_MS - 1000)
    addParticipant(occupied, { displayName: 'A', avatar: { emoji: '🙂', color: '#ffffff' } }, now, 'a', 't')
    addParticipant(old, { displayName: 'B', avatar: { emoji: '🙂', color: '#ffffff' } }, now - ROOM_TTL_MS - 1000, 'b', 't2')
    setOffline(old, 'b', now - ROOM_TTL_MS - 1000)
    store.expire(now)
    expect([...store.rooms.values()].map(r => r.name).sort()).toEqual(['busy', 'recent'])
  })

  it('recently played lists each song once, newest first', () => {
    const room = createRoom('ABCDE', 'x', '🎧', 0)
    addParticipant(room, { displayName: 'A', avatar: { emoji: '🙂', color: '#ffffff' } }, 0, 'a', 't')
    const track = (n: number) => ({ id: `sha256:${String(n).padStart(64, '0')}`, title: `S${n}`, artist: '', album: '', duration: 100 })
    let id = 0
    applyQueue(room, 'a', { type: 'ADD', tracks: [track(1), track(2), track(3)] }, 0, () => `i${++id}`)
    const play = (i: number) => applyPlayback(room, 'a', { type: 'PLAY_ITEM', itemId: room.queue.items[i].id, baseVersion: room.playback.version }, 0)
    play(1); play(2); play(0); play(2)
    expect(room.history.map(t => t.title)).toEqual(['S3', 'S1', 'S2'])
  })
})
