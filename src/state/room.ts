// Client mirror of the server's room. The server is authoritative: we render what it sends and
// ask it to change things via commands. Reconnects re-join with the saved token and take a fresh snapshot.
import { computed, signal } from '@preact/signals'
import type { Ack, Joined, PlaybackCommand, QueueCommand, RoomPeek } from '../../shared/events.ts'
import type { Participant, Profile, QueueState, RoomSettings, RoomSnapshot } from '../../shared/types.ts'
import { applyQueue } from '../../server/state/room.ts' // the same pure reducer the server runs
import { clock, socket } from '../realtime/socket.ts'
import { forgetRoom, profile, rememberRoom, saveProfile, tokenFor } from './profile.ts'

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

/** The current room's code; changes only when you enter or leave a room (per-room state resets on it). */
export const roomCode = computed(() => room.value?.code ?? null)

export function leaveRoom() {
  socket.emit('room:leave')
  room.value = null
  me.value = ''
  pendingQueue.value = null
  optimisticPlaying.value = null
}

async function command(event: 'playback:command' | 'queue:command' | 'room:settings' | 'participant:host' | 'participant:remove', payload: unknown) {
  const r = await request(event, payload)
  // "stale" means someone else acted first; their change is already on screen — nothing to report.
  if (!r.ok && r.error !== 'stale') toast(r.error, { tone: 'error' })
  return r
}

type WithoutVersion<T> = T extends unknown ? Omit<T, 'baseVersion'> : never

// Playback commands go out one at a time and read the version when *sent*, so a quick double-tap
// on Next (or repeated J/L) applies twice instead of the second being dropped as "stale".
let playChain: Promise<unknown> = Promise.resolve()
export function playback(cmd: WithoutVersion<PlaybackCommand>) {
  const send = () => command('playback:command', { ...cmd, baseVersion: room.value?.playback.version ?? 0 })
  const p = playChain.then(send, send)
  playChain = p
  return p
}

export const HOST_ONLY = 'Only the host can control playback in this room.'
/** Controls stay tappable for guests (tooltips don't exist on phones); a tap explains instead. */
export function mayControl() {
  if (canControl.value) return true
  toast(HOST_ONLY)
  return false
}

// Play/pause answer instantly: the button (and your own audio, on pause) follow the tap, then the
// room confirms. Only the last of several quick taps decides; a refusal snaps back to the room.
export const optimisticPlaying = signal<boolean | null>(null)
export const shownPlaying = computed(() => optimisticPlaying.value ?? !!room.value?.playback.isPlaying)
let toggleSeq = 0
export function togglePlay() {
  const want = !shownPlaying.value
  optimisticPlaying.value = want
  const seq = ++toggleSeq
  return playback({ type: want ? 'PLAY' : 'PAUSE' }).then(r => {
    if (seq === toggleSeq) optimisticPlaying.value = null
    return r
  })
}

// ---- people ----

/** Save your profile here and, if you're in a room, show it to everyone right away. */
export async function updateProfile(p: Profile) {
  saveProfile(p)
  if (!room.value) return { ok: true } as const
  const r = await request('profile:update', p)
  if (!r.ok) toast(r.error, { tone: 'error' })
  return r
}
export const makeHost = (pid: string) => command('participant:host', pid)
export const removePerson = (pid: string) => command('participant:remove', pid)

// ---- queue with optimistic updates ----
// Edits show instantly (predicted with the server's own reducer), then the server's answer replaces
// the prediction. Commands go out one at a time so quick successive moves don't trip the stale check.

type Move = Extract<QueueCommand, { type: 'MOVE' }>
export type QueueInput = Exclude<QueueCommand, Move> | Omit<Move, 'baseVersion'>

export const pendingQueue = signal<QueueState | null>(null)
export const shownQueue = computed<QueueState>(() => pendingQueue.value ?? room.value?.queue ?? { items: [], version: 0 })
let inflight = 0
let chain: Promise<unknown> = Promise.resolve()

export function queue(input: QueueInput) {
  const r = room.value
  if (r && input.type !== 'ADD') {
    const base = pendingQueue.value ?? r.queue
    const draft = { ...r, tokens: {}, queue: structuredClone(base), playback: { ...r.playback } }
    const predicted = applyQueue(draft, me.value, { ...input, baseVersion: base.version } as QueueCommand, Date.now(), () => 'pending')
    if (predicted.ok) pendingQueue.value = draft.queue
  }
  inflight++
  const send = () => command('queue:command', input.type === 'MOVE' ? { ...input, baseVersion: room.value?.queue.version ?? 0 } : input)
  const p = chain.then(send, send)
  chain = p
  return p.finally(() => { if (--inflight === 0) pendingQueue.value = null })
}
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
  await clock.sync(5, true)
  // Reconnect: rejoin *before* announcing we're online, so everything that reacts to "online"
  // (share offers, readiness) reaches a socket that's actually in the room again.
  if (room.value && profile.value) {
    const r = await joinRoom(room.value.code, profile.value)
    if (!r.ok) {
      toast(r.error, { tone: 'error' })
      room.value = null // don't leave a room that looks live but where every button fails
    }
  }
  connection.value = 'online'
})
socket.on('disconnect', () => { connection.value = 'reconnecting' })
socket.on('room:removed', () => {
  if (room.value) forgetRoom(room.value.code) // the old token is dead; joining again makes you someone new
  room.value = null
  me.value = ''
  toast('The host removed you from this room. You can rejoin with the link.', { tone: 'error' })
})
socket.io.on('reconnect_attempt', () => { connection.value = 'reconnecting' })

setInterval(() => { if (socket.connected) clock.sync() }, 30_000)

// Owns long-lived side effects (sockets, timers, <audio>); a full reload is safer than hot-swapping.
import.meta.hot?.dispose(() => location.reload())
