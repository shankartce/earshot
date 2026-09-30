// Peer-to-peer sharing of songs a listener attested they may share (own work / openly licensed).
// The server only relays the WebRTC handshake; file bytes go browser → browser over a DataChannel,
// are verified against the song's SHA-256, and are kept in memory only on the receiving side.
import { effect, signal } from '@preact/signals'
import type { Signal } from '../../shared/events.ts'
import type { License, Track } from '../../shared/types.ts'
import { addBorrowed, getFile, localTracks } from '../library/library.ts'
import { socket } from '../realtime/socket.ts'
import { connection, me, participantById, room, toast } from '../state/room.ts'
import { assembleVerified, chunkRanges, MAX_SIZE, parseHeader, type Header } from './transfer.ts'

// Public STUN only helps two browsers find each other. There is deliberately no TURN relay:
// that would route the audio through a server.
const ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
const CONNECT_TIMEOUT_MS = 20_000
const MAX_SENDS = 2
const HIGH_WATER = 4 * 1024 * 1024
const LOW_WATER = 1024 * 1024

export type Receive =
  | { state: 'connecting' | 'receiving' | 'verifying'; progress: number; from: string }
  | { state: 'done'; progress: 1; from: string }
  | { state: 'failed'; progress: number; from: string; error: string }

/** Progress of copies you're receiving, by room trackId. */
export const receiving = signal<Record<string, Receive>>({})

interface Session {
  role: 'send' | 'receive'
  peer: string
  trackId: string
  pc?: RTCPeerConnection
  timer?: ReturnType<typeof setTimeout>
  pendingIce: RTCIceCandidateInit[]
}
const sessions = new Map<string, Session>()
let activeSends = 0

const send = (to: string, data: Signal) => socket.emit('rtc:signal', { to, data })
const nameOf = (pid: string) => participantById(pid)?.displayName ?? 'your friend'

function setReceive(trackId: string, r: Receive) {
  receiving.value = { ...receiving.value, [trackId]: r }
}

function close(id: string) {
  const s = sessions.get(id)
  if (!s) return
  clearTimeout(s.timer)
  try { s.pc?.close() } catch { /* already closed */ }
  sessions.delete(id)
  if (s.role === 'send') activeSends = Math.max(0, activeSends - 1)
}

function failReceive(id: string, error: string) {
  const s = sessions.get(id)
  if (!s || s.role !== 'receive') return
  const cur = receiving.value[s.trackId]
  setReceive(s.trackId, { state: 'failed', progress: cur?.progress ?? 0, from: s.peer, error })
  close(id)
}

function newPeer(id: string, s: Session) {
  const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS })
  s.pc = pc
  pc.onicecandidate = e => {
    if (!e.candidate) return
    const c = e.candidate.toJSON()
    send(s.peer, { type: 'ice', transferId: id, candidate: { candidate: c.candidate ?? '', sdpMid: c.sdpMid ?? null, sdpMLineIndex: c.sdpMLineIndex ?? null } })
  }
  pc.onconnectionstatechange = () => {
    if (pc.connectionState !== 'failed') return
    if (s.role === 'receive') failReceive(id, `Couldn't connect directly to ${nameOf(s.peer)}'s device — some networks block direct connections.`)
    else close(id)
  }
  return pc
}

async function flushIce(s: Session) {
  for (const c of s.pendingIce.splice(0)) await s.pc!.addIceCandidate(c).catch(() => {})
}

// ---------- receiving ----------

/** Ask a friend who offers this exact song for a temporary copy. */
export function requestCopy(track: Track, from: string) {
  const busy = receiving.value[track.id]
  if (busy && busy.state !== 'failed' && busy.state !== 'done') return
  const id = crypto.randomUUID()
  const s: Session = { role: 'receive', peer: from, trackId: track.id, pendingIce: [] }
  s.timer = setTimeout(() => {
    if (receiving.value[track.id]?.state === 'connecting') failReceive(id, `Couldn't connect directly to ${nameOf(from)}'s device — some networks block direct connections.`)
  }, CONNECT_TIMEOUT_MS)
  sessions.set(id, s)
  setReceive(track.id, { state: 'connecting', progress: 0, from })
  send(from, { type: 'request', transferId: id, trackId: track.id })
}

function receiveOn(id: string, s: Session, dc: RTCDataChannel) {
  dc.binaryType = 'arraybuffer'
  let header: Header | null = null
  const parts: ArrayBuffer[] = []
  let got = 0
  let lastShown = 0
  dc.onmessage = async e => {
    if (!header) {
      header = typeof e.data === 'string' ? parseHeader(e.data) : null
      if (!header || header.trackId !== s.trackId) return failReceive(id, "That wasn't the song we asked for.")
      clearTimeout(s.timer)
      setReceive(s.trackId, { state: 'receiving', progress: 0, from: s.peer })
      return
    }
    if (!(e.data instanceof ArrayBuffer)) return
    parts.push(e.data)
    got += e.data.byteLength
    if (got > header.size) return failReceive(id, 'The transfer went wrong. Please try again.')
    if (got - lastShown > header.size / 50 || got === header.size) {
      lastShown = got
      setReceive(s.trackId, { state: 'receiving', progress: got / header.size, from: s.peer })
    }
    if (got < header.size) return
    setReceive(s.trackId, { state: 'verifying', progress: 1, from: s.peer })
    const blob = await assembleVerified(parts, header)
    if (!blob) return failReceive(id, "The copy didn't match this song, so it was discarded.")
    const item = room.value?.queue.items.find(i => i.track.id === s.trackId)
    addBorrowed(item?.track ?? { id: s.trackId, title: 'Shared song', artist: '', album: '', duration: 0 }, blob)
    setReceive(s.trackId, { state: 'done', progress: 1, from: s.peer })
    toast("You're ready — syncing with the room…")
    close(id)
  }
  dc.onclose = () => {
    if (sessions.has(id) && receiving.value[s.trackId]?.state === 'receiving') failReceive(id, 'The connection dropped. Please try again.')
  }
}

// ---------- sending ----------

/** A local, non-borrowed copy of this exact file that you attested you may share. */
function shareable(trackId: string) {
  const t = localTracks.value.get(trackId)
  return t && !t.borrowed && t.share ? t : null
}

async function sendFile(id: string, s: Session, dc: RTCDataChannel, blob: Blob, license: License) {
  dc.bufferedAmountLowThreshold = LOW_WATER
  dc.send(JSON.stringify({ kind: 'header', trackId: s.trackId, size: blob.size, license } satisfies Header))
  for (const [a, b] of chunkRanges(blob.size)) {
    if (dc.readyState !== 'open') return close(id)
    if (dc.bufferedAmount > HIGH_WATER) await new Promise(r => dc.addEventListener('bufferedamountlow', r, { once: true }))
    dc.send(await blob.slice(a, b).arrayBuffer())
  }
  // The receiver closes the connection once it has verified the file; this is just a backstop.
  s.timer = setTimeout(() => close(id), 60_000)
}

async function onRequest(from: string, id: string, trackId: string) {
  const t = shareable(trackId)
  if (!t) return send(from, { type: 'reject', transferId: id, reason: 'unavailable' })
  if (activeSends >= MAX_SENDS) return send(from, { type: 'reject', transferId: id, reason: 'busy' })
  const blob = await getFile(t.id)
  if (!blob || blob.size > MAX_SIZE) return send(from, { type: 'reject', transferId: id, reason: 'unavailable' })
  activeSends++
  const s: Session = { role: 'send', peer: from, trackId, pendingIce: [] }
  sessions.set(id, s)
  s.timer = setTimeout(() => close(id), 10 * 60_000) // hard stop for a stuck transfer
  const pc = newPeer(id, s)
  const dc = pc.createDataChannel('earshot-file', { ordered: true })
  dc.onopen = () => {
    toast(`Sending “${t.title}” to ${nameOf(from)}…`)
    sendFile(id, s, dc, blob, t.share!.license).catch(() => close(id))
  }
  pc.onconnectionstatechange = () => {
    if (pc.connectionState === 'failed' || pc.connectionState === 'closed') close(id)
  }
  await pc.setLocalDescription(await pc.createOffer())
  send(from, { type: 'offer', transferId: id, sdp: pc.localDescription!.sdp })
}

// ---------- handshake ----------

socket.on('rtc:signal', async ({ from, data }) => {
  const id = data.transferId
  const s = sessions.get(id)
  try {
    switch (data.type) {
      case 'request':
        return await onRequest(from, id, data.trackId)
      case 'offer': {
        // Only accept files we asked for, from the person we asked.
        if (!s || s.role !== 'receive' || s.peer !== from || s.pc) return
        const pc = newPeer(id, s)
        pc.ondatachannel = e => receiveOn(id, s, e.channel)
        await pc.setRemoteDescription({ type: 'offer', sdp: data.sdp })
        await flushIce(s)
        await pc.setLocalDescription(await pc.createAnswer())
        return send(from, { type: 'answer', transferId: id, sdp: pc.localDescription!.sdp })
      }
      case 'answer':
        if (!s || s.role !== 'send' || s.peer !== from || !s.pc) return
        await s.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp })
        return await flushIce(s)
      case 'ice':
        if (!s || s.peer !== from) return
        if (s.pc?.remoteDescription) await s.pc.addIceCandidate(data.candidate).catch(() => {})
        else s.pendingIce.push(data.candidate)
        return
      case 'reject':
        if (!s || s.peer !== from) return
        return failReceive(id, data.reason === 'busy'
          ? `${nameOf(from)} is sending to others right now — try again in a moment.`
          : `${nameOf(from)} can't share this song right now.`)
    }
  } catch {
    if (s?.role === 'receive') failReceive(id, 'Something went wrong setting up the transfer. Please try again.')
    else close(id)
  }
})

// ---------- announcing what you share ----------
// Offer only songs that are in this room's queue, that you hold as the exact file, and that you
// attested you may share. The server forgets offers when you disconnect, so re-announce on rejoin.

let announced = new Map<string, License>()
effect(() => {
  const r = room.value
  const online = connection.value === 'online' && !!me.value
  if (!r || !online) {
    announced = new Map()
    return
  }
  const wanted = new Map<string, License>()
  for (const item of r.queue.items) {
    const t = shareable(item.track.id)
    if (t) wanted.set(item.track.id, t.share!.license)
  }
  for (const [trackId, license] of wanted) {
    if (announced.get(trackId) !== license) socket.emit('share:offer', { trackId, license })
  }
  for (const trackId of announced.keys()) if (!wanted.has(trackId)) socket.emit('share:withdraw', trackId)
  announced = wanted
})

/** Offers from other people for this song (what the "Get a copy" button uses). */
export function offersFor(trackId: string) {
  return (room.value?.shares?.[trackId] ?? []).filter(o => o.participantId !== me.value && participantById(o.participantId)?.isOnline)
}

/** Is this song one you attested you may share (and hold as the exact file)? */
export const isSharing = (trackId: string) => !!shareable(trackId)

import.meta.hot?.dispose(() => location.reload())
