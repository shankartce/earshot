// Multi-client integration tests against a real in-process Socket.IO server.
import fs from 'node:fs'
import http from 'node:http'
import os from 'node:os'
import path from 'node:path'
import { io as connect, type Socket } from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Ack, ClientToServer, Joined, RoomPatch, ServerToClient } from '../shared/events.ts'
import { positionAt } from '../shared/playback.ts'
import type { RoomSnapshot, Track } from '../shared/types.ts'
import { RoomStore } from '../server/rooms/store.ts'
import { attachRealtime } from '../server/websocket/handlers.ts'
import { Clock } from '../src/sync/clock.ts'

type Client = Socket<ServerToClient, ClientToServer>

let server: http.Server
let url: string
let store: RoomStore
const clients: Client[] = []

const track = (n: number, duration = 200): Track => ({
  id: `sha256:${String(n).padStart(64, '0')}`, title: `Song ${n}`, artist: 'A', album: '', duration,
})
const profile = (name: string) => ({ displayName: name, avatar: { emoji: '🙂', color: '#ff8844' } })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

/** A client that mirrors room state from room:state/room:patch, with optional one-way latency. */
function client(latencyMs = 0) {
  const s: Client = connect(url, { forceNew: true, transports: ['websocket'] })
  clients.push(s)
  const view = { state: null as RoomSnapshot | null, events: [] as string[], you: '', token: '' }
  s.on('room:state', st => { view.state = st })
  s.on('room:patch', (p: RoomPatch) => {
    if (!view.state) return
    const { meta, ...rest } = p
    Object.assign(view.state, rest, meta ?? {})
  })
  s.on('presence:joined', p => view.events.push(`joined:${p.displayName}`))
  s.on('presence:left', p => view.events.push(`left:${p.displayName}`))
  const call = <T,>(event: string, ...args: unknown[]) => new Promise<T>(resolve => {
    setTimeout(() => (s.emit as any)(event, ...args, (r: T) => setTimeout(() => resolve(r), latencyMs)), latencyMs)
  })
  const adopt = (r: Ack<Joined>) => {
    if (r.ok) Object.assign(view, { state: r.state, you: r.you, token: r.token })
    return r
  }
  return {
    s, view,
    create: (name = 'Alex') => call<Ack<Joined>>('room:create', { name: 'Late Night', emoji: '🌙', profile: profile(name) }).then(adopt),
    join: (code: string, name: string, token?: string) => call<Ack<Joined>>('room:join', { code, profile: profile(name), token }).then(adopt),
    play: (cmd: object) => call<Ack>('playback:command', { baseVersion: view.state!.playback.version, ...cmd }),
    queue: (cmd: object) => call<Ack>('queue:command', cmd),
    chat: (text: string) => call<Ack>('chat:send', text),
    ping: () => call<number>('clock:ping'),
  }
}

async function until(fn: () => boolean, ms = 2000) {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition')
    await sleep(10)
  }
}

async function start(graceMs = 150, file: string | null = null) {
  store = new RoomStore(file)
  server = http.createServer()
  attachRealtime(server, { store, graceMs })
  await new Promise<void>(r => server.listen(0, r))
  url = `http://localhost:${(server.address() as any).port}`
}

beforeEach(() => start())
afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect()
  await new Promise(r => server.close(r))
})

async function roomOf(n: number, latency: number[] = []) {
  const people = Array.from({ length: n }, (_, i) => client(latency[i] ?? 0))
  const names = ['Alex', 'Sam', 'Jamie', 'Riley', 'Kai']
  const r = await people[0].create(names[0])
  if (!r.ok) throw new Error(r.error)
  for (let i = 1; i < n; i++) await people[i].join(r.code, names[i])
  return { people, code: r.code }
}

describe('rooms & presence', () => {
  it('3+ users see each other join', async () => {
    const { people } = await roomOf(3)
    await until(() => people.every(p => p.view.state!.participants.length === 3))
    expect(people[0].view.events).toEqual(['joined:Sam', 'joined:Jamie'])
    expect(people[0].view.state!.hostId).toBe(people[0].view.you)
  })

  it('unknown rooms and bad profiles are rejected politely', async () => {
    const c = client()
    expect(await c.join('ZZZZZ', 'Sam')).toEqual({ ok: false, error: "That room isn't available." })
    expect(await c.join('not a code', 'Sam')).toMatchObject({ ok: false })
    const bad = await new Promise<Ack>(r => c.s.emit('room:create', { name: 'x', emoji: 'x', profile: { displayName: '' } } as any, r))
    expect(bad.ok).toBe(false)
  })

  it('quick reconnect with token keeps identity silently; long absence announces leave and hands off host', async () => {
    const { people, code } = await roomOf(3)
    const [alex, sam] = people
    const samId = sam.view.you
    sam.s.disconnect()
    const sam2 = client()
    const again = await sam2.join(code, 'Sam', sam.view.token)
    expect(again.ok && again.you).toBe(samId)
    await sleep(250)
    expect(alex.view.events).not.toContain('left:Sam')

    alex.s.disconnect() // host leaves for good
    await until(() => people[2].view.events.includes('left:Alex'))
    await until(() => people[2].view.state!.hostId === samId) // Sam joined before Jamie
  })

  it('peek shows the room name and who is listening, without joining', async () => {
    const { people, code } = await roomOf(2)
    const visitor = client()
    const r = await new Promise<any>(res => visitor.s.emit('room:peek', code, res))
    expect(r).toMatchObject({ ok: true, name: 'Late Night', emoji: '🌙' })
    expect(r.online.map((p: any) => p.displayName)).toEqual(['Alex', 'Sam'])
    expect(JSON.stringify(r)).not.toContain(people[0].view.you) // no ids, no tokens
    await until(() => people[0].view.state!.participants.length === 2)
    expect(await new Promise<any>(res => visitor.s.emit('room:peek', 'ZZZZZ', res))).toMatchObject({ ok: false })
  })

  it('a stolen participant id is useless without the token', async () => {
    const { people, code } = await roomOf(2)
    const intruder = client()
    const r = await intruder.join(code, 'Mallory', people[0].view.you)
    expect(r.ok && r.you).not.toBe(people[0].view.you)
  })
})

describe('synchronized playback', () => {
  it('clients with skewed clocks and latency compute the same room position', async () => {
    const { people } = await roomOf(3, [0, 40, 120])
    await people[0].queue({ type: 'ADD', tracks: [track(1), track(2)] })
    const skews = [0, 90_000, -45_000] // wildly wrong local clocks
    const clocks = people.map((p, i) => new Clock(() => p.ping(), () => Date.now() + skews[i]))
    await Promise.all(clocks.map(c => c.sync(5)))

    await people[1].play({ type: 'PLAY' })
    await until(() => people.every(p => p.view.state!.playback.isPlaying))
    await sleep(300)
    const positions = people.map((p, i) => positionAt(p.view.state!.playback, clocks[i].serverNow()))
    const spread = Math.max(...positions) - Math.min(...positions)
    expect(spread).toBeLessThan(0.08) // estimation error is bounded by ~half the RTT asymmetry
    expect(positions[0]).toBeGreaterThan(0.2)
  })

  it('pause / seek / next reach everyone', async () => {
    const { people } = await roomOf(2)
    const [a, b] = people
    await a.queue({ type: 'ADD', tracks: [track(1), track(2)] })
    await until(() => b.view.state!.queue.items.length === 2)
    await a.play({ type: 'PLAY' })
    await until(() => b.view.state!.playback.isPlaying)
    await b.play({ type: 'SEEK', position: 73.42 })
    await until(() => a.view.state!.playback.position === 73.42)
    await a.play({ type: 'PAUSE' })
    await until(() => !b.view.state!.playback.isPlaying)
    expect(b.view.state!.playback.position).toBeGreaterThanOrEqual(73.42)
    await b.play({ type: 'NEXT' })
    await until(() => a.view.state!.playback.itemId === a.view.state!.queue.items[1].id)
  })

  it('simultaneous conflicting commands: exactly one wins', async () => {
    const { people } = await roomOf(2)
    const [a, b] = people
    await a.queue({ type: 'ADD', tracks: [track(1)] })
    await until(() => b.view.state!.queue.items.length === 1)
    const [ra, rb] = await Promise.all([a.play({ type: 'PLAY' }), b.play({ type: 'SEEK', position: 30 })])
    expect([ra.ok, rb.ok].filter(Boolean)).toHaveLength(1)
    await until(() => a.view.state!.playback.version === b.view.state!.playback.version)
  })

  it('track completion reported by several clients advances once', async () => {
    const { people } = await roomOf(3)
    await people[0].queue({ type: 'ADD', tracks: [track(1), track(2), track(3)] })
    await people[0].play({ type: 'PLAY' })
    await until(() => people.every(p => p.view.state!.playback.isPlaying))
    const item = people[0].view.state!.playback.itemId
    const results = await Promise.all(people.map(p => p.play({ type: 'ENDED', itemId: item })))
    expect(results.filter(r => r.ok)).toHaveLength(1)
    await until(() => people.every(p => p.view.state!.playback.itemId === p.view.state!.queue.items[1].id))
  })

  it('server advances on its own when nobody reports the end (e.g. nobody has the file)', async () => {
    const { people } = await roomOf(1)
    await people[0].queue({ type: 'ADD', tracks: [track(1, 0.2), track(2)] })
    await people[0].play({ type: 'PLAY' })
    await until(() => people[0].view.state!.playback.itemId === people[0].view.state!.queue.items[1].id, 4000)
  })

  it('late joiner / reconnect receives the current playhead', async () => {
    const { people, code } = await roomOf(1)
    await people[0].queue({ type: 'ADD', tracks: [track(1)] })
    await people[0].play({ type: 'PLAY' })
    await sleep(200)
    const late = client()
    const r = await late.join(code, 'Sam')
    expect(r.ok && r.state.playback.isPlaying).toBe(true)
    expect(r.ok && positionAt(r.state.playback, Date.now())).toBeGreaterThan(0.15)
  })
})

describe('queue', () => {
  it('concurrent edits converge to the same queue for everyone', async () => {
    const { people } = await roomOf(3, [0, 30, 60])
    await people[0].queue({ type: 'ADD', tracks: [track(1), track(2), track(3)] })
    await until(() => people.every(p => p.view.state!.queue.items.length === 3))
    const items = people[0].view.state!.queue.items
    await Promise.all([
      people[0].queue({ type: 'ADD', tracks: [track(4)] }),
      people[1].queue({ type: 'REMOVE', itemId: items[1].id }),
      people[2].queue({ type: 'PLAY_NEXT', itemId: items[2].id }),
    ])
    await until(() => new Set(people.map(p => p.view.state!.queue.version)).size === 1)
    const orders = people.map(p => p.view.state!.queue.items.map(i => i.track.title).join())
    expect(new Set(orders).size).toBe(1)
    expect(orders[0]).toBe('Song 1,Song 3,Song 4')
  })
})

describe('chat & abuse protection', () => {
  it('delivers sanitized messages and rate-limits spam', async () => {
    const { people } = await roomOf(2)
    const got: string[] = []
    people[1].s.on('chat:message', m => got.push(m.text))
    await people[0].chat('  <b>hi</b>\u0000  ')
    const burst = await Promise.all(Array.from({ length: 8 }, (_, i) => people[0].chat(`m${i}`)))
    expect(burst.filter(r => !r.ok).length).toBeGreaterThan(0)
    await until(() => got.length >= 4)
    expect(got[0]).toBe('<b>hi</b>') // stored as text; the client renders it as text, never HTML
  })

  it('typing reaches others but not yourself', async () => {
    const { people } = await roomOf(2)
    const seenBySam: string[] = []
    const seenByAlex: string[] = []
    people[1].s.on('chat:typing', id => seenBySam.push(id))
    people[0].s.on('chat:typing', id => seenByAlex.push(id))
    people[0].s.emit('chat:typing')
    await until(() => seenBySam.length === 1)
    expect(seenBySam[0]).toBe(people[0].view.you)
    await sleep(50)
    expect(seenByAlex).toEqual([])
  })

  it('room reactions and message reactions reach everyone', async () => {
    const { people } = await roomOf(3)
    const floats: string[] = []
    people[2].s.on('reaction', r => floats.push(`${r.participantId}:${r.emoji}`))
    people[1].s.emit('reaction:send', '🔥')
    await until(() => floats.length === 1)
    expect(floats[0]).toBe(`${people[1].view.you}:🔥`)

    let msgId = ''
    people[2].s.on('chat:message', m => { msgId = m.id })
    await people[0].chat('this song!!')
    await until(() => !!msgId)
    const updates: Record<string, string[]>[] = []
    people[0].s.on('chat:reactions', p => updates.push(p.reactions))
    people[1].s.emit('chat:react', { messageId: msgId, emoji: '❤️' })
    people[2].s.emit('chat:react', { messageId: msgId, emoji: '❤️' })
    await until(() => updates.length === 2)
    expect(updates[1]['❤️']).toHaveLength(2)
  })

  it('host can switch chat and reactions off', async () => {
    const { people } = await roomOf(2)
    const [alex, sam] = people
    const settings = (p: object) => new Promise<Ack>(r => alex.s.emit('room:settings', p, r))
    expect((await settings({ allowChat: false, allowReactions: false })).ok).toBe(true)
    expect(await sam.chat('hello?')).toEqual({ ok: false, error: 'Chat is turned off in this room.' })
    const floats: unknown[] = []
    alex.s.on('reaction', r => floats.push(r))
    sam.s.emit('reaction:send', '❤️')
    await sleep(150)
    expect(floats).toEqual([])
    // guests can't turn it back on
    expect((await new Promise<Ack>(r => sam.s.emit('room:settings', { allowChat: true }, r))).ok).toBe(false)
  })

  it('late joiners get recent chat history', async () => {
    const { people, code } = await roomOf(1)
    await people[0].chat('first')
    await people[0].chat('second')
    const late = client()
    const r = await late.join(code, 'Sam')
    expect(r.ok && r.state.chat.map(m => m.text)).toEqual(['first', 'second'])
  })

  it('malformed payloads never crash the server', async () => {
    const { people } = await roomOf(1)
    const s = people[0].s as any
    s.emit('playback:command', null, () => {})
    s.emit('queue:command', { type: 'ADD', tracks: 'lol' }, () => {})
    s.emit('status:update', 42)
    s.emit('chat:react', { messageId: {}, emoji: '❤️' })
    s.emit('reaction:send', '💣')
    expect((await people[0].ping()) > 0).toBe(true)
  })
})

describe('p2p sharing: the server only relays the handshake, and only for attested songs', () => {
  const signalsTo = (c: ReturnType<typeof client>) => {
    const got: any[] = []
    c.s.on('rtc:signal', p => got.push(p))
    return got
  }
  const emitSignal = (c: ReturnType<typeof client>, to: string, data: object) => (c.s as any).emit('rtc:signal', { to, data })

  async function sharingRoom(n = 2) {
    const r = await roomOf(n)
    const [alex] = r.people
    await alex.queue({ type: 'ADD', tracks: [track(1), track(2)] })
    alex.s.emit('share:offer', { trackId: track(1).id, license: 'cc-by' })
    await until(() => r.people.every(p => (p.view.state!.shares?.[track(1).id] ?? []).length === 1))
    return r
  }

  it('a copy can only be requested from someone offering that exact song; otherwise an instant reject', async () => {
    const { people } = await sharingRoom()
    const [alex, sam] = people
    expect(sam.view.state!.shares[track(1).id][0]).toEqual({ participantId: alex.view.you, license: 'cc-by' })
    const atAlex = signalsTo(alex)
    const atSam = signalsTo(sam)
    emitSignal(sam, alex.view.you, { type: 'request', transferId: 'r2', trackId: track(2).id }) // not offered
    emitSignal(sam, alex.view.you, { type: 'request', transferId: 'r1', trackId: track(1).id })
    await until(() => atAlex.length === 1 && atSam.length === 1)
    await sleep(100)
    expect(atAlex).toEqual([{ from: sam.view.you, data: { type: 'request', transferId: 'r1', trackId: track(1).id } }])
    expect(atSam).toEqual([{ from: alex.view.you, data: { type: 'reject', transferId: 'r2', reason: 'unavailable' } }])
  })

  it("one tab answers a request, and the rest of the handshake stays between the two sockets", async () => {
    const { people, code } = await sharingRoom(3)
    const [alex, sam, jamie] = people
    const alexTab2 = client()
    await alexTab2.join(code, 'Alex', alex.view.token) // same person, second tab
    const outsider = (await roomOf(1)).people[0]
    const [atTab1, atTab2, atSam, atJamie, atOutsider] = [alex, alexTab2, sam, jamie, outsider].map(signalsTo)

    emitSignal(sam, alex.view.you, { type: 'request', transferId: 't1', trackId: track(1).id })
    await until(() => atTab1.length + atTab2.length === 1)
    await sleep(100)
    expect(atTab1.length + atTab2.length).toBe(1) // never both tabs
    const answering = atTab2.length ? alexTab2 : alex
    const idle = atTab2.length ? alex : alexTab2

    emitSignal(answering, sam.view.you, { type: 'offer', transferId: 't1', sdp: 'v=0' })
    emitSignal(idle, sam.view.you, { type: 'offer', transferId: 't1', sdp: 'v=1' }) // the other tab isn't part of it
    emitSignal(answering, sam.view.you, { type: 'offer', transferId: 'nope', sdp: 'v=0' }) // no such transfer
    emitSignal(outsider, sam.view.you, { type: 'offer', transferId: 't1', sdp: 'v=0' }) // other room
    await until(() => atSam.length === 1)
    await sleep(150)
    expect(atSam).toEqual([{ from: alex.view.you, data: { type: 'offer', transferId: 't1', sdp: 'v=0' } }])
    expect(atJamie).toEqual([])
    expect(atOutsider).toEqual([])
  })

  it('oversized or malformed handshakes are dropped; spam is rate limited', async () => {
    const { people } = await sharingRoom()
    const [alex, sam] = people
    const atAlex = signalsTo(alex)
    const atSam = signalsTo(sam)
    emitSignal(sam, alex.view.you, { type: 'request', transferId: 'x', trackId: track(1).id })
    await until(() => atAlex.length === 1)
    emitSignal(alex, sam.view.you, { type: 'offer', transferId: 'x', sdp: 'x'.repeat(20_000) })
    emitSignal(alex, sam.view.you, { type: 'file', transferId: 'x', bytes: 'AAAA' })
    for (let i = 0; i < 100; i++) emitSignal(alex, sam.view.you, { type: 'ice', transferId: 'x', candidate: { candidate: `c${i}` } })
    await sleep(400)
    expect(atSam.some(m => m.data.type !== 'ice')).toBe(false)
    expect(atSam.length).toBeGreaterThan(30)
    expect(atSam.length).toBeLessThan(100)
  })

  it("a sharer's offers disappear when they leave", async () => {
    const { people } = await sharingRoom()
    const [alex, sam] = people
    alex.s.disconnect()
    await until(() => !sam.view.state!.shares?.[track(1).id])
  })
})

describe('persistence', () => {
  it('rooms survive a server restart', async () => {
    const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'jam-')), 'rooms.json')
    await new Promise(r => server.close(r))
    await start(150, file)
    const { people, code } = await roomOf(1)
    await people[0].queue({ type: 'ADD', tracks: [track(1)] })
    store.flush()
    const token = people[0].view.token
    people[0].s.disconnect()
    await new Promise(r => server.close(r))

    await start(150, file)
    const back = client()
    const r = await back.join(code, 'Alex', token)
    expect(r.ok && r.state.queue.items[0].track.title).toBe('Song 1')
    expect(r.ok && r.state.hostId).toBe(r.ok && r.you)
  })
})
