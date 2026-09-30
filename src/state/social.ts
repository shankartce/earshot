// Chat, typing, unread counts and floating reactions — the "room feels alive" layer.
import { computed, effect, signal } from '@preact/signals'
import { socket } from '../realtime/socket.ts'
import { currentItem, me, participantById, room, roomCode, toast } from './room.ts'

// ---- chat ----

export const pending = signal<{ key: number; text: string }[]>([]) // sent, not yet echoed back
/** What you're typing survives switching between the Queue and Chat tabs. */
export const draft = signal('')
let pendingKey = 0

export async function sendChat(text: string): Promise<boolean> {
  const clean = text.trim()
  if (!clean) return false
  const key = ++pendingKey
  pending.value = [...pending.value, { key, text: clean }]
  const r = await new Promise<{ ok: boolean; error?: string }>(resolve => {
    if (!socket.connected) return resolve({ ok: false, error: 'Connection lost — reconnecting…' })
    socket.timeout(8000).emit('chat:send', clean, (err, res) => resolve(err ? { ok: false, error: 'Message not sent. Please try again.' } : res))
  })
  pending.value = pending.value.filter(p => p.key !== key)
  if (!r.ok) toast(r.error ?? 'Message not sent.', { tone: 'error' })
  return r.ok
}

let lastTypingSent = 0
export function notifyTyping() {
  if (Date.now() - lastTypingSent < 1500 || !socket.connected) return
  lastTypingSent = Date.now()
  socket.emit('chat:typing')
}

export const reactToMessage = (messageId: string, emoji: string) => socket.emit('chat:react', { messageId, emoji })

// ---- typing indicator ----

const typingUntil = signal<ReadonlyMap<string, number>>(new Map())
const tick = signal(Date.now())
setInterval(() => { if (typingUntil.value.size) tick.value = Date.now() }, 1000)

export const typingNames = computed(() => {
  const now = tick.value
  return [...typingUntil.value].filter(([id, until]) => until > now && id !== me.value)
    .map(([id]) => participantById(id)?.displayName).filter(Boolean) as string[]
})

// ---- unread ----

/** True while the chat panel is on screen (set by the Chat component). */
export const chatOpen = signal(false)
export const unread = signal(0)
const seen = () => chatOpen.value && document.visibilityState === 'visible'
effect(() => { if (chatOpen.value) unread.value = 0 })
effect(() => { roomCode.value; unread.value = 0 }) // a new room starts with no unread badge
document.addEventListener('visibilitychange', () => { if (seen()) unread.value = 0 })

// Unread count in the tab title so you notice from another tab.
effect(() => {
  const r = room.value
  const base = r ? `${r.emoji} ${r.name} · Earshot` : 'Earshot'
  document.title = unread.value ? `(${unread.value}) ${base}` : base
})

// ---- floating reactions ----

export interface Float { id: number; emoji: string; participantId: string; x: number }
export const floats = signal<Float[]>([])
export const lastReaction = signal<{ id: number; text: string } | null>(null)
let floatId = 0
const MAX_FLOATS = 12

export const sendReaction = (emoji: string) => socket.emit('reaction:send', emoji)

// Screen readers: one polite announcement at a time, throttled so a burst isn't a flood.
export const announcement = signal('')
let lastAnnounce = 0
export function announce(text: string, important = false) {
  if (!important && Date.now() - lastAnnounce < 2000) return
  lastAnnounce = Date.now()
  announcement.value = text
}

// ---- inbound ----

socket.on('chat:message', m => {
  const r = room.value
  if (!r || r.chat.some(x => x.id === m.id)) return
  room.value = { ...r, chat: [...r.chat, m].slice(-100) }
  if (m.authorId === me.value) {
    // our own echo arrived: it replaces the "sending" placeholder
    const i = pending.value.findIndex(p => p.text === m.text)
    if (i > -1) pending.value = pending.value.filter((_, j) => j !== i)
  } else if (!seen()) unread.value++
})

socket.on('chat:reactions', ({ messageId, reactions }) => {
  const r = room.value
  if (r) room.value = { ...r, chat: r.chat.map(m => (m.id === messageId ? { ...m, reactions } : m)) }
})

socket.on('chat:typing', id => {
  typingUntil.value = new Map(typingUntil.value).set(id, Date.now() + 3500)
  tick.value = Date.now()
})
// Someone who sends a message has stopped typing.
socket.on('chat:message', m => {
  if (!typingUntil.value.has(m.authorId)) return
  const next = new Map(typingUntil.value)
  next.delete(m.authorId)
  typingUntil.value = next
})

socket.on('reaction', ({ participantId, emoji }) => {
  const id = ++floatId
  floats.value = [...floats.value.slice(-(MAX_FLOATS - 1)), { id, emoji, participantId, x: 15 + Math.random() * 70 }]
  setTimeout(() => { floats.value = floats.value.filter(f => f.id !== id) }, 2800)
  const who = participantId === me.value ? 'You' : participantById(participantId)?.displayName ?? 'Someone'
  const text = `${who} reacted ${emoji}`
  lastReaction.value = { id, text }
  setTimeout(() => { if (lastReaction.value?.id === id) lastReaction.value = null }, 3000)
  if (participantId !== me.value) announce(text)
})

// Tell screen-reader users when the song changes (the stage heading updates silently otherwise).
let lastItem: string | null | undefined
effect(() => {
  const item = currentItem.value
  if (lastItem !== undefined && item && item.id !== lastItem) {
    announce(`Now playing: ${item.track.title}${item.track.artist ? ` by ${item.track.artist}` : ''}`, true)
  }
  lastItem = item?.id ?? null
})

import.meta.hot?.dispose(() => location.reload())
