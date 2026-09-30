// Client mirror of the server's room. The server is authoritative: we render what it sends and
// ask it to change things via commands. Reconnects re-join with the saved token and take a fresh snapshot.
import { computed, signal } from '@preact/signals'
import type { Ack, Joined, PlaybackCommand, QueueCommand, RoomPeek } from '../../shared/events.ts'
import type { Participant, Profile, RoomSettings, RoomSnapshot } from '../../shared/types.ts'
import { clock, socket } from '../realtime/socket.ts'
import { forgetRoom, profile, rememberRoom, tokenFor } from './profile.ts'

export const room = signal<RoomSnapshot | null>(null)
export const me = signal('')
export const connection = signal<'connecting' | 'online' | 'reconnecting'>('connecting')

export const you = computed(() => room.value?.participants.find(p => p.id === me.value))
export const isHost = computed(() => !!room.value && room.value.hostId === me.value)
export const canControl = computed(() => room.value?.settings.playbackControl === 'everyone' || isHost.value)
export const canEditQueue = computed(() => room.value?.settings.queueEditing === 'everyone' || isHost.value)
export const currentItem = computed(() => {
  const r = room.value
  return r?.queue.items.find(i => i.id === r.playback.itemId) ?? null
})
export const participantById = (id: string) => room.value?.participants.find(p => p.id === id)

// ---- toasts / activity ----

export interface Toast { id: number; text: string; who?: Pick<Participant, 'displayName' | 'avatar'>; tone?: 'info' | 'error' }
export const toasts = signal<Toast[]>([])
let toastId = 0
export function toast(text: string, opts: Omit<Toast, 'id' | 'text'> = {}) {
  const t = { id: ++toastId, text, ...opts }
  toasts.value = [...toasts.value.slice(-3), t]
  setTimeout(() => { toasts.value = toasts.value.filter(x => x.id !== t.id) }, opts.tone === 'error' ? 5000 : 3500)
}

// ---- transport helpers ----

const OFFLINE = 'Connection lost — reconnecting…'

/** Emit with an ack and a timeout; never buffers commands while offline (they'd be stale on arrival). */
function request<T>(event: string, ...args: unknown[]): Promise<Ack<T>> {
  if (!socket.connected) return Promise.resolve({ ok: false, error: OFFLINE })
  return new Promise(resolve => {
    ;(socket.timeout(8000).emit as any)(event, ...args, (err: unknown, r: Ack<T>) => {
      if (err) console.warn('[jam] no answer for', event, args[0])
      resolve(err ? { ok: false, error: 'The room took too long to answer. Please try again.' } : r)
    })
  })
}

function adopt(r: Ack<Joined>) {
  if (!r.ok) return r
  room.value = r.state
  me.value = r.you
  rememberRoom({ code: r.code, name: r.state.name, emoji: r.state.emoji, token: r.token })
  return r
}

export async function createRoom(name: string, emoji: string, p: Profile) {
  return adopt(await request<Joined>('room:create', { name, emoji, profile: p }))
}

export async function joinRoom(code: string, p: Profile) {
  const r = adopt(await request<Joined>('room:join', { code, profile: p, token: tokenFor(code) }))
  if (!r.ok && r.error.includes("isn't available")) forgetRoom(code)
  return r
}

export const peekRoom = (code: string) => request<RoomPeek>('room:peek', code)

export function leaveRoom() {
  socket.emit('room:leave')
  room.value = null
  me.value = ''
}

async function command(event: 'playback:command' | 'queue:command' | 'room:settings', payload: object) {
  const r = await request(event, payload)
  // "stale" means someone else acted first; their change is already on screen — nothing to report.
  if (!r.ok && r.error !== 'stale') toast(r.error, { tone: 'error' })
  return r
}

type WithoutVersion<T> = T extends unknown ? Omit<T, 'baseVersion'> : never
export const playback = (cmd: WithoutVersion<PlaybackCommand>) =>
  command('playback:command', { ...cmd, baseVersion: room.value?.playback.version ?? 0 })
export const queue = (cmd: QueueCommand) => command('queue:command', cmd)
export const updateSettings = (patch: Partial<RoomSettings> & { name?: string; emoji?: string }) =>
  command('room:settings', patch)

// ---- inbound events ----

socket.on('room:state', s => { room.value = s })
socket.on('room:patch', ({ meta, ...rest }) => {
  if (room.value) room.value = { ...room.value, ...rest, ...(meta ?? {}) }
})
socket.on('presence:joined', p => toast(`${p.displayName} joined the room`, { who: p }))
socket.on('presence:left', p => toast(`${p.displayName} left the room`, { who: p }))

socket.on('connect', async () => {
  connection.value = 'online'
  await clock.sync()
  // Reconnect: take the latest state; the player then re-derives position and resynchronizes.
  if (room.value && profile.value) {
    const r = await joinRoom(room.value.code, profile.value)
    if (!r.ok) toast(r.error, { tone: 'error' })
  }
})
socket.on('disconnect', () => { connection.value = 'reconnecting' })
socket.io.on('reconnect_attempt', () => { connection.value = 'reconnecting' })

setInterval(() => { if (socket.connected) clock.sync() }, 30_000)

// Owns long-lived side effects (sockets, timers, <audio>); a full reload is safer than hot-swapping.
import.meta.hot?.dispose(() => location.reload())
