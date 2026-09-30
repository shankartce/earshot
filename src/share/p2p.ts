// Peer-to-peer sharing of songs a listener attested they may share (own work / openly licensed).
// The server only relays the WebRTC handshake; file bytes go browser → browser over a DataChannel,
// are verified against the song's SHA-256, and are then kept in the receiver's "Shared with me".
// Missing shared songs are fetched automatically in the background, one at a time.
import { effect, signal } from '@preact/signals'
import type { Signal } from '../../shared/events.ts'
import type { License, Track } from '../../shared/types.ts'
import { getFile, keepShared, localTracks, resolveLocal } from '../library/library.ts'
import { socket } from '../realtime/socket.ts'
import { connection, currentItem, me, participantById, room, roomCode, toast } from '../state/room.ts'
import { afterFailure, assembleVerified, chunkRanges, MAX_SIZE, parseHeader, planFetch, type FetchMemo, type Header } from './transfer.ts'

// Public STUN only helps two browsers find each other. There is deliberately no TURN relay:
// that would route the audio through a server.
const ICE_SERVERS: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }]
const CONNECT_TIMEOUT_MS = 20_000
const MAX_SENDS = 2
const HIGH_WATER = 4 * 1024 * 1024
const LOW_WATER = 1024 * 1024

export type Receive =
  | { state: 'connecting' | 'receiving' | 'verifying'; progress: number; from: string; auto: boolean }
  | { state: 'done'; progress: 1; from: string; auto: boolean }
  | { state: 'failed'; progress: number; from: string; auto: boolean; error: string }

/** Progress of copies you're receiving, by room trackId. */
export const receiving = signal<Record<string, Receive>>({})
export const isActive = (r?: Receive) => !!r && r.state !== 'failed' && r.state !== 'done'

// ---- preference: fetch shared songs automatically (default on) ----
const readAuto = () => { try { return localStorage.getItem('jam:autofetch') !== 'off' } catch { return true } }
export const autoFetch = signal(readAuto())
export function setAutoFetch(on: boolean) {
  autoFetch.value = on
  try { localStorage.setItem('jam:autofetch', on ? 'on' : 'off') } catch { /* ignore */ }
}

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
const cantConnect = (pid: string) => `Couldn't connect directly to ${nameOf(pid)}'s device — some networks block direct connections.`

function setReceive(trackId: string, r: Receive) {
  receiving.value = { ...receiving.value, [trackId]: r }
}

function setTimer(s: Session, ms: number, fn: () => void) {
  clearTimeout(s.timer)
  s.timer = setTimeout(fn, ms)
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
  setReceive(s.trackId, { state: 'failed', progress: cur?.progress ?? 0, from: s.peer, auto: cur?.auto ?? false, error })
  close(id)
  finished(s.trackId, false, s.peer)
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
    if (pc.connectionState !== 'failed' && pc.connectionState !== 'closed') return
    if (s.role === 'receive') failReceive(id, cantConnect(s.peer))
    else close(id)
  }
  return pc
}

async function flushIce(s: Session) {
  for (const c of s.pendingIce.splice(0)) await s.pc!.addIceCandidate(c).catch(() => {})
}

// ---------- receiving ----------

/** Ask a friend who offers this exact song for a copy. */
export function requestCopy(track: Track, from: string, auto = false) {
  if (isActive(receiving.value[track.id])) return
  const id = crypto.randomUUID()
  const s: Session = { role: 'receive', peer: from, trackId: track.id, pendingIce: [] }
  sessions.set(id, s)
  setTimer(s, CONNECT_TIMEOUT_MS, () => {
    if (receiving.value[track.id]?.state === 'connecting') failReceive(id, cantConnect(from))
  })
  setReceive(track.id, { state: 'connecting', progress: 0, from, auto })
  send(from, { type: 'request', transferId: id, trackId: track.id })
}

function receiveOn(id: string, s: Session, dc: RTCDataChannel) {
  dc.binaryType = 'arraybuffer'
  let header: Header | null = null
  const parts: ArrayBuffer[] = []
  let got = 0
  let lastShown = 0
  const auto = () => receiving.value[s.trackId]?.auto ?? false
  dc.onmessage = async e => {
    if (!header) {
      header = typeof e.data === 'string' ? parseHeader(e.data) : null
      if (!header || header.trackId !== s.trackId) return failReceive(id, "That wasn't the song we asked for.")
      // Stalled mid-transfer (sender's tab closed, network gone): give up after a quiet minute.
      setTimer(s, 60_000, () => failReceive(id, 'The transfer stalled. Please try again.'))
      setReceive(s.trackId, { state: 'receiving', progress: 0, from: s.peer, auto: auto() })
      return
    }
    if (!(e.data instanceof ArrayBuffer)) return
    parts.push(e.data)
    got += e.data.byteLength
    setTimer(s, 60_000, () => failReceive(id, 'The transfer stalled. Please try again.'))
    if (got > header.size) return failReceive(id, 'The transfer went wrong. Please try again.')
    if (got - lastShown > header.size / 50 || got === header.size) {
      lastShown = got
      setReceive(s.trackId, { state: 'receiving', progress: got / header.size, from: s.peer, auto: auto() })
    }
    if (got < header.size) return
    clearTimeout(s.timer)
    setReceive(s.trackId, { state: 'verifying', progress: 1, from: s.peer, auto: auto() })
    let blob: Blob | null = null
    try {
      blob = await assembleVerified(parts, header)
    } catch {
      return failReceive(id, "Couldn't check the copy on this device (it may be too large). Please try again.")
    }
    if (!blob) return failReceive(id, "The copy didn't match this song, so it was discarded.")
    const item = room.value?.queue.items.find(i => i.track.id === s.trackId)
    const track = item?.track ?? { id: s.trackId, title: 'Shared song', artist: '', album: '', duration: 0 }
    await keepShared(track, blob, { name: nameOf(s.peer), license: header.license, at: Date.now() })
    setReceive(s.trackId, { state: 'done', progress: 1, from: s.peer, auto: auto() })
    if (currentItem.value?.track.id === s.trackId) toast("You're ready — syncing with the room…")
    close(id)
    finished(s.trackId, true, s.peer)
  }
  dc.onclose = () => {
    if (sessions.has(id) && isActive(receiving.value[s.trackId])) failReceive(id, 'The connection dropped. Please try again.')
  }
}

// ---------- sending ----------

/** Your own (not received) copy of this exact file, which you attested you may share. */
function shareable(trackId: string) {
  const t = localTracks.value.get(trackId)
  return t && !t.sharedBy && t.share ? t : null
}

async function sendFile(id: string, s: Session, dc: RTCDataChannel, blob: Blob, license: License) {
  dc.bufferedAmountLowThreshold = LOW_WATER
  dc.send(JSON.stringify({ kind: 'header', trackId: s.trackId, size: blob.size, license } satisfies Header))
  for (const [a, b] of chunkRanges(blob.size)) {
    if (dc.readyState !== 'open') return close(id)
    if (dc.bufferedAmount > HIGH_WATER) await new Promise(r => dc.addEventListener('bufferedamountlow', r, { once: true }))
    dc.send(await blob.slice(a, b).arrayBuffer())
  }
  // The receiver closes the connection once it has verified the file; this is only a backstop.
  setTimer(s, 60_000, () => close(id))
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
  // If the receiver vanished before we connected, free the slot quickly (not after 10 minutes).
  setTimer(s, CONNECT_TIMEOUT_MS + 5000, () => close(id))
  const pc = newPeer(id, s)
  const dc = pc.createDataChannel('earshot-file', { ordered: true })
  dc.onopen = () => {
    setTimer(s, 10 * 60_000, () => close(id)) // hard stop for a transfer that never finishes
    if (s.trackId === currentItem.value?.track.id || document.visibilityState === 'visible') toast(`Sending “${t.title}” to ${nameOf(from)}…`)
    sendFile(id, s, dc, blob, t.share!.license).catch(() => close(id))
  }
  dc.onclose = () => close(id)
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
          ? `${nameOf(from)} is sending to others right now — trying again shortly.`
          : `${nameOf(from)} can't share this song right now.`)
    }
  } catch {
    if (s?.role === 'receive') failReceive(id, 'Something went wrong setting up the transfer. Please try again.')
    else close(id)
  }
})

// ---------- automatic background fetching ----------

function offerIds(trackId: string) {
  return offersFor(trackId).map(o => o.participantId)
}

let memo = new Map<string, FetchMemo>()
let inFlight: string | null = null

function finished(trackId: string, ok: boolean, peer: string) {
  if (!ok) memo = new Map(memo).set(trackId, afterFailure(memo.get(trackId), peer, Date.now()))
  if (inFlight === trackId) inFlight = null
  pump()
}

const saveData = () => !!(navigator as Navigator & { connection?: { saveData?: boolean } }).connection?.saveData

function pump() {
  const r = room.value
  if (inFlight || !autoFetch.value || saveData() || connection.value !== 'online' || !r) return
  const items = r.queue.items
  const pick = planFetch({
    queue: items.map(i => i.track.id),
    currentIndex: items.findIndex(i => i.id === r.playback.itemId),
    have: id => {
      const t = items.find(i => i.track.id === id)!.track
      return resolveLocal(t).status === 'ready' || isActive(receiving.value[id])
    },
    offers: offerIds,
    memo,
    now: Date.now(),
  })
  if (!pick) return
  inFlight = pick.trackId
  requestCopy(items.find(i => i.track.id === pick.trackId)!.track, pick.from, true)
}

// Re-plan whenever the queue, offers, your library or the setting change; the interval covers
// backoff timers expiring (it keeps running in background tabs, just less often).
effect(() => { room.value; localTracks.value; autoFetch.value; connection.value; pump() })
setInterval(pump, 5000)

// A different room starts with a clean slate.
effect(() => {
  roomCode.value
  memo = new Map()
  inFlight = null
  receiving.value = {}
})

// ---------- announcing what you share ----------
// Offer only songs that are in this room's queue, that you hold as the exact file, and that you
// attested you may share. Rather than assuming an offer arrived, compare with what the server says
// you're offering and fix any difference (offers vanish on reconnect, or a message can be dropped).

const lastSent = new Map<string, number>() // "offer:<id>" / "withdraw:<id>" → when, to avoid resending too often
const RESEND_MS = 5000

function reconcileOffers() {
  const r = room.value
  if (!r || connection.value !== 'online' || !me.value) return
  const wanted = new Map<string, License>()
  for (const item of r.queue.items) {
    const t = shareable(item.track.id)
    if (t) wanted.set(item.track.id, t.share!.license)
  }
  const onServer = new Map<string, License>()
  for (const [trackId, offers] of Object.entries(r.shares ?? {})) {
    const mine = offers.find(o => o.participantId === me.value)
    if (mine) onServer.set(trackId, mine.license)
  }
  const now = Date.now()
  const due = (key: string) => {
    if (now - (lastSent.get(key) ?? 0) < RESEND_MS) return false
    lastSent.set(key, now)
    return true
  }
  for (const [trackId, license] of wanted) {
    if (onServer.get(trackId) !== license && due(`offer:${trackId}`)) socket.emit('share:offer', { trackId, license })
  }
  for (const trackId of onServer.keys()) {
    if (!wanted.has(trackId) && due(`withdraw:${trackId}`)) socket.emit('share:withdraw', trackId)
  }
}
effect(() => { room.value; localTracks.value; connection.value; me.value; reconcileOffers() })
effect(() => { if (connection.value !== 'online') lastSent.clear() }) // a fresh connection sends right away
setInterval(reconcileOffers, RESEND_MS)

/** Offers from other people for this song (what the "Get a copy" button uses). */
export function offersFor(trackId: string) {
  return (room.value?.shares?.[trackId] ?? []).filter(o => o.participantId !== me.value && participantById(o.participantId)?.isOnline)
}

/** Best person to ask manually: after a failure, someone other than whoever just failed. */
export function bestOffer(trackId: string) {
  const offers = offersFor(trackId)
  const last = receiving.value[trackId]
  return (last?.state === 'failed' ? offers.find(o => o.participantId !== last.from) : undefined) ?? offers[0]
}

/** Is this song one you attested you may share (and hold as the exact file)? */
export const isSharing = (trackId: string) => !!shareable(trackId)

import.meta.hot?.dispose(() => location.reload())
