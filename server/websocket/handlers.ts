// Socket.IO wiring: validate → rate-limit → apply to room state → broadcast the changed slice.
import crypto from 'node:crypto'
import type { Server as HttpServer } from 'node:http'
import { Server, type Socket } from 'socket.io'
import type { Ack, ClientToServer, Joined, RoomPatch, ServerToClient } from '../../shared/events.ts'
import { positionAt } from '../../shared/playback.ts'
import {
  cleanText, parseCode, parsePlaybackCommand, parseProfile, parseQueueCommand, parseReaction,
  parseLicense, parseReadiness, parseSettingsPatch, parseSignal, parseTrackId,
} from '../../shared/validate.ts'
import { rateLimiter } from '../rateLimit.ts'
import type { RoomStore } from '../rooms/store.ts'
import {
  addChat, addParticipant, applyPlayback, applyQueue, applySettings, ensureHost, reactToMessage,
  isOffering, offerShare, resumeParticipant, setOffline, snapshot, withdrawShare, type Result, type Room,
} from '../state/room.ts'

interface SocketData { code?: string; pid?: string }
type IO = Server<ClientToServer, ServerToClient, Record<string, never>, SocketData>
type Sock = Socket<ClientToServer, ServerToClient, Record<string, never>, SocketData>

export interface RealtimeOptions {
  store: RoomStore
  graceMs?: number // how long a dropped participant stays "present" before "left the room"
}

const GENERIC_ERROR = 'Something went wrong. Please try again.'
const newId = () => crypto.randomUUID()

export function attachRealtime(http: HttpServer, { store, graceMs = 30_000 }: RealtimeOptions): IO {
  // destroyUpgrade:false so Vite's HMR websocket can share the dev server.
  const io: IO = new Server(http, {
    maxHttpBufferSize: 256 * 1024,
    destroyUpgrade: false,
    // Background tabs and sleepy phones answer heartbeats late; don't drop them for it.
    // (A closed connection is still noticed immediately — this only affects silent stalls.)
    pingInterval: 25_000,
    pingTimeout: 60_000,
  })
  const leaveTimers = new Map<string, NodeJS.Timeout>() // `${code}:${pid}`
  const endTimers = new Map<string, NodeJS.Timeout>() // code

  const patch = (room: Room, p: { playback?: boolean; queue?: boolean; history?: boolean; participants?: boolean; settings?: boolean; meta?: boolean; shares?: boolean }) => {
    const out: RoomPatch = {}
    if (p.playback) out.playback = room.playback
    if (p.queue) out.queue = room.queue
    if (p.history) out.history = room.history
    if (p.participants) out.participants = room.participants
    if (p.settings) out.settings = room.settings
    if (p.meta) out.meta = { name: room.name, emoji: room.emoji, hostId: room.hostId }
    if (p.shares) out.shares = room.shares
    if (Object.keys(out).length) io.to(room.code).emit('room:patch', out)
    store.save()
  }

  /** Server-side safety net: if no client reports the song ended (e.g. nobody has the file), advance anyway. */
  const scheduleEnd = (room: Room) => {
    clearTimeout(endTimers.get(room.code))
    const pb = room.playback
    const item = room.queue.items.find(i => i.id === pb.itemId)
    if (!pb.isPlaying || !item?.track.duration) return
    const ms = (item.track.duration - positionAt(pb, Date.now())) * 1000 + 2000
    endTimers.set(room.code, setTimeout(() => {
      const r = applyPlayback(room, '', { type: 'ENDED', itemId: item.id, baseVersion: pb.version }, Date.now())
      if (r.ok) afterChange(room, r)
    }, Math.max(0, ms)))
  }

  const afterChange = (room: Room, r: Extract<Result, { ok: true }>) => {
    patch(room, r)
    if (r.playback) scheduleEnd(room)
  }

  const scheduleLeave = (room: Room, pid: string) => {
    const key = `${room.code}:${pid}`
    clearTimeout(leaveTimers.get(key))
    leaveTimers.set(key, setTimeout(() => {
      leaveTimers.delete(key)
      const p = room.participants.find(x => x.id === pid)
      if (!p || p.isOnline) return
      io.to(room.code).emit('presence:left', p)
      patch(room, { participants: true, meta: ensureHost(room) })
    }, graceMs))
  }

  // After a restart everyone is offline; give them the grace period to reconnect quietly.
  for (const room of store.rooms.values()) for (const p of room.participants) scheduleLeave(room, p.id)
  const sweep = setInterval(() => store.expire(), 60 * 60 * 1000)
  http.on('close', () => {
    clearInterval(sweep)
    for (const t of [...leaveTimers.values(), ...endTimers.values()]) clearTimeout(t)
  })

  io.on('connection', (socket: Sock) => {
    const allow = rateLimiter()
    const ctx = () => {
      const room = socket.data.code ? store.get(socket.data.code) : undefined
      return room && socket.data.pid ? { room, pid: socket.data.pid } : null
    }
    // Every handler is wrapped so a bad payload can never crash the server or leak an exception.
    const on = <E extends keyof ClientToServer | 'disconnect'>(event: E, fn: (...args: any[]) => void) => {
      socket.on(event, ((...args: any[]) => {
        const reply = typeof args.at(-1) === 'function' ? args.at(-1) : null
        try {
          fn(...args)
        } catch (err) {
          console.error(`[${event}]`, err)
          reply?.({ ok: false, error: GENERIC_ERROR })
        }
      }) as any)
    }
    const replyFn = (reply: unknown) => (r: Ack<any>) => { if (typeof reply === 'function') reply(r) }

    const leaveCurrent = () => {
      const c = ctx()
      if (!c) return
      socket.leave(c.room.code)
      socket.data = {}
      // Another tab may still be connected as the same person.
      const stillHere = [...io.sockets.sockets.values()].some(s => s.data.pid === c.pid && s.data.code === c.room.code)
      if (stillHere) return
      setOffline(c.room, c.pid, Date.now()) // also withdraws their share offers
      patch(c.room, { participants: true, shares: true })
      scheduleLeave(c.room, c.pid)
    }

    const enter = (room: Room, token: string | undefined, rawProfile: unknown): Ack<Joined> => {
      const profile = parseProfile(rawProfile)
      if (!profile) return { ok: false, error: 'Please choose a display name and avatar.' }
      leaveCurrent()
      const now = Date.now()
      let p = token ? resumeParticipant(room, token, profile, now) : null
      if (p) {
        const key = `${room.code}:${p.id}`
        if (leaveTimers.has(key)) {
          clearTimeout(leaveTimers.get(key))
          leaveTimers.delete(key) // quick reconnect: nobody needs to hear about it
        } else socket.to(room.code).emit('presence:joined', p)
      } else {
        token = crypto.randomBytes(24).toString('base64url')
        p = addParticipant(room, profile, now, newId(), token)
        socket.to(room.code).emit('presence:joined', p)
      }
      const hostKey = `${room.code}:${room.hostId}`
      const hostChanged = !leaveTimers.has(hostKey) && ensureHost(room)
      socket.join(room.code)
      socket.data = { code: room.code, pid: p.id }
      patch(room, { participants: true, meta: hostChanged })
      return { ok: true, code: room.code, token: token!, you: p.id, state: snapshot(room) }
    }

    on('clock:ping', reply => { if (typeof reply === 'function') reply(Date.now()) })

    on('room:create', (p, reply) => {
      const done = replyFn(reply)
      if (!allow('join')) return done({ ok: false, error: 'Slow down a little and try again.' })
      if (!parseProfile(p?.profile)) return done({ ok: false, error: 'Please choose a display name and avatar.' })
      const room = store.create(cleanText(p?.name, 40) || 'Listening room', cleanText(p?.emoji, 4) || '🎧')
      done(enter(room, undefined, p.profile))
    })

    on('room:join', (p, reply) => {
      const done = replyFn(reply)
      if (!allow('join')) return done({ ok: false, error: 'Slow down a little and try again.' })
      const code = parseCode(p?.code)
      const room = code ? store.get(code) : undefined
      if (!room) return done({ ok: false, error: "That room isn't available." })
      done(enter(room, typeof p.token === 'string' ? p.token : undefined, p.profile))
    })

    on('room:peek', (raw, reply) => {
      const done = replyFn(reply)
      if (!allow('join')) return done({ ok: false, error: 'Slow down a little and try again.' })
      const code = parseCode(raw)
      const room = code ? store.get(code) : undefined
      if (!room) return done({ ok: false, error: "That room isn't available." })
      const online = room.participants.filter(p => p.isOnline).map(({ displayName, avatar }) => ({ displayName, avatar }))
      done({ ok: true, name: room.name, emoji: room.emoji, online })
    })

    on('room:leave', () => leaveCurrent())
    on('disconnect', () => leaveCurrent())

    on('room:settings', (raw, reply) => {
      const done = replyFn(reply)
      const c = ctx()
      const p = parseSettingsPatch(raw)
      if (!c || !p) return done({ ok: false, error: GENERIC_ERROR })
      const r = applySettings(c.room, c.pid, p, Date.now())
      if (r.ok) patch(c.room, { settings: true, meta: true })
      done(r.ok ? { ok: true } : r)
    })

    on('playback:command', (raw, reply) => {
      const done = replyFn(reply)
      const c = ctx()
      const cmd = parsePlaybackCommand(raw)
      if (!c || !cmd) return done({ ok: false, error: GENERIC_ERROR })
      if (!allow('control')) return done({ ok: false, error: 'Slow down a little and try again.' })
      const r = applyPlayback(c.room, c.pid, cmd, Date.now())
      if (r.ok) afterChange(c.room, r)
      done(r.ok ? { ok: true } : r)
    })

    on('queue:command', (raw, reply) => {
      const done = replyFn(reply)
      const c = ctx()
      const cmd = parseQueueCommand(raw)
      if (!c || !cmd) return done({ ok: false, error: GENERIC_ERROR })
      if (!allow('queue')) return done({ ok: false, error: 'Slow down a little and try again.' })
      const r = applyQueue(c.room, c.pid, cmd, Date.now(), newId)
      if (r.ok) afterChange(c.room, r)
      done(r.ok ? { ok: true } : r)
    })

    on('status:update', raw => {
      const c = ctx()
      const readiness = parseReadiness(raw?.readiness)
      const p = c?.room.participants.find(x => x.id === c.pid)
      if (!c || !p || !readiness) return
      const isAway = raw.isAway === true
      if (p.readiness === readiness && p.isAway === isAway) return
      Object.assign(p, { readiness, isAway, lastSeen: Date.now() })
      patch(c.room, { participants: true })
    })

    on('chat:send', (text, reply) => {
      const done = replyFn(reply)
      const c = ctx()
      if (!c) return done({ ok: false, error: GENERIC_ERROR })
      if (!allow('chat')) return done({ ok: false, error: "You're sending messages too quickly." })
      const msg = addChat(c.room, c.pid, cleanText(text, 500, true), Date.now(), newId())
      if (typeof msg === 'string') return done({ ok: false, error: msg })
      io.to(c.room.code).emit('chat:message', msg)
      store.save()
      done({ ok: true })
    })

    on('chat:typing', () => {
      const c = ctx()
      if (c && c.room.settings.allowChat && allow('typing')) socket.to(c.room.code).emit('chat:typing', c.pid)
    })

    on('chat:react', raw => {
      const c = ctx()
      const emoji = parseReaction(raw?.emoji)
      if (!c || !emoji || typeof raw.messageId !== 'string' || !allow('reaction')) return
      const msg = reactToMessage(c.room, c.pid, raw.messageId, emoji)
      if (msg) io.to(c.room.code).emit('chat:reactions', { messageId: msg.id, reactions: msg.reactions })
      store.save()
    })

    on('reaction:send', raw => {
      const c = ctx()
      const emoji = parseReaction(raw)
      if (!c || !emoji || !c.room.settings.allowReactions || !allow('reaction')) return
      io.to(c.room.code).emit('reaction', { participantId: c.pid, emoji, at: Date.now() })
    })

    // ---- peer-to-peer sharing of attested tracks: only metadata and the WebRTC handshake pass here ----

    on('share:offer', raw => {
      const c = ctx()
      const trackId = parseTrackId(raw?.trackId)
      const license = parseLicense(raw?.license)
      if (!c || !trackId || !license || !allow('share')) return
      if (offerShare(c.room, c.pid, trackId, license)) patch(c.room, { shares: true })
    })

    on('share:withdraw', raw => {
      const c = ctx()
      const trackId = parseTrackId(raw)
      if (c && trackId && allow('share') && withdrawShare(c.room, c.pid, trackId)) patch(c.room, { shares: true })
    })

    on('rtc:signal', raw => {
      const c = ctx()
      const data = parseSignal(raw?.data)
      const to = typeof raw?.to === 'string' ? raw.to : ''
      if (!c || !data || to === c.pid || !allow('signal')) return
      // The rights gate: you can only ask for a copy from someone currently offering that exact file.
      if (data.type === 'request' && !isOffering(c.room, to, data.trackId)) return
      for (const s of io.sockets.sockets.values()) {
        if (s.data.pid === to && s.data.code === c.room.code) s.emit('rtc:signal', { from: c.pid, data })
      }
    })
  })

  return io
}
