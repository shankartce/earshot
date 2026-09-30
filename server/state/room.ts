// Room state transitions. Every function mutates the room in place, takes `now` from the caller
// (always the server clock) and never trusts client time. Pure enough to unit-test without sockets.
import type { PlaybackCommand, QueueCommand } from '../../shared/events.ts'
import { positionAt } from '../../shared/playback.ts'
import type { ChatMessage, License, Participant, Profile, QueueItem, RoomSettings, RoomSnapshot } from '../../shared/types.ts'

export interface Room extends RoomSnapshot {
  tokens: Record<string, string> // secret session token -> participant id (never sent to clients)
}

export type Result =
  | { ok: true; playback?: boolean; queue?: boolean; history?: boolean }
  | { ok: false; error: string }

export const LIMITS = { queue: 500, participants: 50, chat: 100, history: 20, previousRestart: 3 }

const fail = (error: string): Result => ({ ok: false, error })

export function createRoom(code: string, name: string, emoji: string, now: number): Room {
  return {
    code, name, emoji, hostId: null,
    settings: { playbackControl: 'everyone', queueEditing: 'everyone', allowChat: true, allowReactions: true },
    participants: [],
    queue: { items: [], version: 0 },
    playback: { itemId: null, isPlaying: false, position: 0, serverTimestamp: now, version: 0 },
    history: [], chat: [], shares: {}, createdAt: now, updatedAt: now, tokens: {},
  }
}

export function snapshot(room: Room): RoomSnapshot {
  const { tokens: _secret, ...rest } = room
  return { ...rest, chat: room.chat.slice(-50) }
}

// ---------- presence ----------

export function addParticipant(room: Room, profile: Profile, now: number, id: string, token: string): Participant {
  // ponytail: prune the longest-offline person once the room is full; a real account system would replace this
  if (room.participants.length >= LIMITS.participants) {
    const stale = room.participants.filter(p => !p.isOnline).sort((a, b) => a.lastSeen - b.lastSeen)[0]
    if (stale) removeParticipant(room, stale.id)
  }
  const p: Participant = { id, ...profile, isOnline: true, isAway: false, joinedAt: now, lastSeen: now, readiness: 'idle' }
  room.participants.push(p)
  room.tokens[token] = id
  if (!room.hostId) room.hostId = id
  return p
}

function removeParticipant(room: Room, id: string) {
  room.participants = room.participants.filter(p => p.id !== id)
  for (const [t, pid] of Object.entries(room.tokens)) if (pid === id) delete room.tokens[t]
}

export function resumeParticipant(room: Room, token: string, profile: Profile, now: number): Participant | null {
  const p = room.participants.find(x => x.id === room.tokens[token])
  if (!p) return null
  Object.assign(p, profile, { isOnline: true, isAway: false, lastSeen: now })
  if (!room.hostId) room.hostId = p.id
  return p
}

export function setOffline(room: Room, id: string, now: number) {
  const p = room.participants.find(x => x.id === id)
  if (p) Object.assign(p, { isOnline: false, lastSeen: now, readiness: 'idle' })
  clearShares(room, id) // you can only share while you're here to send
}

// ---- peer-to-peer share offers (metadata only; audio never passes through the server) ----

/** Record that `pid` attested they may share this exact file. Only for songs in this room's queue. */
export function offerShare(room: Room, pid: string, trackId: string, license: License): boolean {
  if (!room.queue.items.some(i => i.track.id === trackId)) return false
  const offers = (room.shares[trackId] ?? []).filter(o => o.participantId !== pid)
  room.shares[trackId] = [...offers, { participantId: pid, license }]
  return true
}

export function withdrawShare(room: Room, pid: string, trackId: string): boolean {
  const offers = room.shares[trackId]
  if (!offers?.some(o => o.participantId === pid)) return false
  const rest = offers.filter(o => o.participantId !== pid)
  if (rest.length) room.shares[trackId] = rest
  else delete room.shares[trackId]
  return true
}

export function clearShares(room: Room, pid: string): boolean {
  let changed = false
  for (const trackId of Object.keys(room.shares ?? {})) changed = withdrawShare(room, pid, trackId) || changed
  return changed
}

export const isOffering = (room: Room, pid: string, trackId: string) =>
  !!room.shares?.[trackId]?.some(o => o.participantId === pid)

/** If the host is gone, hand control to whoever has been here longest. Returns true if host changed.
 *  An empty room keeps its host, so they're still host when they come back. */
export function ensureHost(room: Room): boolean {
  const host = room.participants.find(p => p.id === room.hostId)
  if (host?.isOnline) return false
  const next = room.participants.filter(p => p.isOnline).sort((a, b) => a.joinedAt - b.joinedAt)[0]
  if (!next) return false
  room.hostId = next.id
  return true
}

// ---------- playback ----------

const current = (room: Room) => room.queue.items.find(i => i.id === room.playback.itemId)
const indexOfCurrent = (room: Room) => room.queue.items.findIndex(i => i.id === room.playback.itemId)
const clampToTrack = (room: Room, pos: number) => {
  const d = current(room)?.track.duration || Infinity
  return Math.min(Math.max(0, pos), d)
}

function setPlayback(room: Room, now: number, patch: Partial<Room['playback']>) {
  Object.assign(room.playback, patch, { serverTimestamp: now, version: room.playback.version + 1 })
  room.updatedAt = now
}

/** Switch to an item (or nothing), recording it in recently-played. */
function setItem(room: Room, item: QueueItem | undefined, isPlaying: boolean, now: number): Result {
  setPlayback(room, now, { itemId: item?.id ?? null, position: 0, isPlaying: !!item && isPlaying })
  if (!item) return { ok: true, playback: true }
  room.history = [item.track, ...room.history.filter(t => t.id !== item.track.id)].slice(0, LIMITS.history)
  return { ok: true, playback: true, history: true }
}

export const canControl = (room: Room, actorId: string) =>
  room.settings.playbackControl === 'everyone' || room.hostId === actorId

export function applyPlayback(room: Room, actorId: string, cmd: PlaybackCommand, now: number): Result {
  if (cmd.type !== 'ENDED' && !canControl(room, actorId)) return fail('Only the host can control playback.')
  // Optimistic concurrency: two people pressing at once — first wins, second is told it was stale.
  if (cmd.baseVersion !== room.playback.version) return fail('stale')

  const pb = room.playback
  const items = room.queue.items
  const idx = indexOfCurrent(room)

  switch (cmd.type) {
    case 'PLAY': {
      if (!current(room)) return items[0] ? setItem(room, items[0], true, now) : fail('The queue is empty.')
      const d = current(room)!.track.duration
      const pos = d && pb.position >= d - 0.5 ? 0 : pb.position // finished track restarts
      setPlayback(room, now, { isPlaying: true, position: pos })
      return { ok: true, playback: true }
    }
    case 'PAUSE':
      if (!pb.isPlaying) return { ok: true }
      setPlayback(room, now, { isPlaying: false, position: clampToTrack(room, positionAt(pb, now)) })
      return { ok: true, playback: true }
    case 'SEEK':
      if (!current(room)) return fail('Nothing is playing.')
      setPlayback(room, now, { position: clampToTrack(room, cmd.position) })
      return { ok: true, playback: true }
    case 'NEXT':
      if (idx + 1 >= items.length) return fail('This is the last song in the queue.')
      return setItem(room, items[idx + 1], pb.isPlaying || idx === -1, now)
    case 'PREVIOUS':
      if (idx <= 0 || positionAt(pb, now) > LIMITS.previousRestart) {
        if (idx === -1) return fail('Nothing is playing.')
        setPlayback(room, now, { position: 0 })
        return { ok: true, playback: true }
      }
      return setItem(room, items[idx - 1], pb.isPlaying, now)
    case 'PLAY_ITEM': {
      const item = items.find(i => i.id === cmd.itemId)
      return item ? setItem(room, item, true, now) : fail('That song is no longer in the queue.')
    }
    case 'ENDED': {
      if (cmd.itemId !== pb.itemId || !pb.isPlaying) return fail('stale')
      if (items[idx + 1]) return setItem(room, items[idx + 1], true, now)
      setPlayback(room, now, { isPlaying: false, position: current(room)?.track.duration ?? 0 })
      return { ok: true, playback: true }
    }
  }
}

// ---------- queue ----------

export const canEditQueue = (room: Room, actorId: string, item?: QueueItem) =>
  room.settings.queueEditing === 'everyone' || room.hostId === actorId || item?.addedBy === actorId

export function applyQueue(room: Room, actorId: string, cmd: QueueCommand, now: number, newId: () => string): Result {
  const q = room.queue
  const bump = (extra: Partial<{ playback: boolean; history: boolean }> = {}): Result => {
    q.version++
    room.updatedAt = now
    return { ok: true, queue: true, ...extra }
  }

  if (cmd.type === 'ADD') {
    // Everyone may add, in both permission modes.
    if (q.items.length + cmd.tracks.length > LIMITS.queue) return fail('The queue is full.')
    const added = cmd.tracks.map(track => ({ id: newId(), track, addedBy: actorId, addedAt: now }))
    q.items.push(...added)
    if (!current(room)) {
      const r = setItem(room, added[0], false, now)
      return bump(r.ok ? { playback: true, history: r.history } : {})
    }
    return bump()
  }

  if (cmd.type === 'CLEAR') {
    if (!canEditQueue(room, actorId)) return fail('Only the host can edit the queue.')
    q.items = q.items.filter(i => i.id === room.playback.itemId)
    return bump()
  }

  const from = q.items.findIndex(i => i.id === cmd.itemId)
  if (from === -1) return fail('That song is no longer in the queue.')
  const item = q.items[from]
  if (!canEditQueue(room, actorId, cmd.type === 'REMOVE' ? item : undefined)) {
    return fail('Only the host can edit the queue.')
  }

  switch (cmd.type) {
    case 'REMOVE': {
      q.items.splice(from, 1)
      if (item.id !== room.playback.itemId) return bump()
      // Removing what's playing: move on to the next (or previous) song, keeping play/pause as-is.
      const r = setItem(room, q.items[from] ?? q.items[from - 1], room.playback.isPlaying, now)
      return bump(r.ok ? { playback: true, history: r.history } : {})
    }
    case 'MOVE': {
      if (cmd.baseVersion !== q.version) return fail('stale')
      const to = Math.min(Math.max(0, cmd.toIndex), q.items.length - 1)
      if (to === from) return { ok: true }
      q.items.splice(from, 1)
      q.items.splice(to, 0, item)
      return bump()
    }
    case 'PLAY_NEXT': {
      if (item.id === room.playback.itemId) return { ok: true }
      q.items.splice(from, 1)
      q.items.splice(indexOfCurrent(room) + 1, 0, item)
      return bump()
    }
  }
}

// ---------- settings & chat ----------

export function applySettings(room: Room, actorId: string, patch: Partial<RoomSettings> & { name?: string; emoji?: string }, now: number): Result {
  if (room.hostId !== actorId) return fail('Only the host can change room settings.')
  const { name, emoji, ...settings } = patch
  Object.assign(room.settings, settings)
  if (name !== undefined) room.name = name
  if (emoji !== undefined) room.emoji = emoji
  room.updatedAt = now
  return { ok: true }
}

export function addChat(room: Room, authorId: string, text: string, now: number, id: string): ChatMessage | string {
  if (!room.settings.allowChat) return 'Chat is turned off in this room.'
  if (!text) return 'Message is empty.'
  const msg: ChatMessage = { id, authorId, text, at: now, reactions: {} }
  room.chat.push(msg)
  if (room.chat.length > LIMITS.chat) room.chat.splice(0, room.chat.length - LIMITS.chat)
  return msg
}

/** Toggle a participant's emoji reaction on a message. */
export function reactToMessage(room: Room, actorId: string, messageId: string, emoji: string): ChatMessage | null {
  const msg = room.chat.find(m => m.id === messageId)
  if (!msg || !room.settings.allowReactions) return null
  const who = msg.reactions[emoji] ?? []
  msg.reactions[emoji] = who.includes(actorId) ? who.filter(id => id !== actorId) : [...who, actorId]
  if (!msg.reactions[emoji].length) delete msg.reactions[emoji]
  return msg
}
