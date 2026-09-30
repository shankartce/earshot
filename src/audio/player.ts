// The local <audio> element is only the playback mechanism; the room state decides what plays and
// where. This module continuously reconciles the two: load the local file, seek, play/pause, and
// correct drift against the server clock.
import { computed, effect, signal } from '@preact/signals'
import { positionAt } from '../../shared/playback.ts'
import type { Readiness } from '../../shared/types.ts'
import { getFile, localTracks } from '../library/library.ts'
import { clock, socket } from '../realtime/socket.ts'
import { connection, currentItem, me, playback, room, toast } from '../state/room.ts'
import { DEFAULT_DRIFT, decide, learnSeekLead, type DriftConfig } from '../sync/drift.ts'

// ---- tunables (persisted; editable in /settings) ----
function load<T>(key: string, fallback: T): T {
  try { return { ...fallback, ...JSON.parse(localStorage.getItem(key) ?? '{}') } } catch { return fallback }
}
export interface PlayerPrefs extends DriftConfig { outputLatencyMs: number; volume: number }
export const prefs = signal<PlayerPrefs>(load('jam:player', { ...DEFAULT_DRIFT, outputLatencyMs: 0, volume: 0.8 }))
export function setPrefs(patch: Partial<PlayerPrefs>) {
  prefs.value = { ...prefs.value, ...patch }
  try { localStorage.setItem('jam:player', JSON.stringify(prefs.value)) } catch { /* ignore */ }
}

// ---- observable player state ----
export const readiness = signal<Readiness>('idle')
export const catchingUp = signal(false)
export const driftMs = signal(0)
export const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
export const syncStatus = computed<'synced' | 'catching-up' | 'reconnecting'>(() =>
  connection.value !== 'online' ? 'reconnecting'
    : catchingUp.value || readiness.value === 'loading' ? 'catching-up' : 'synced')

/** Server time, ticking 4×/s so progress bars move without per-frame renders. */
export const serverNow = signal(clock.serverNow())
setInterval(() => { serverNow.value = clock.serverNow() }, 250)

export const roomPosition = computed(() => {
  const r = room.value
  if (!r) return 0
  const d = currentItem.value?.track.duration || Infinity
  return Math.min(d, positionAt(r.playback, serverNow.value))
})

export const audio = new Audio()
audio.preload = 'auto'
audio.preservesPitch = true
effect(() => { audio.volume = prefs.value.volume })

const SILENT_WAV = (() => {
  const n = 800
  const v = new DataView(new ArrayBuffer(44 + n))
  const str = (o: number, s: string) => [...s].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  str(0, 'RIFF'); v.setUint32(4, 36 + n, true); str(8, 'WAVE'); str(12, 'fmt ')
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true)
  v.setUint32(24, 8000, true); v.setUint32(28, 8000, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true)
  str(36, 'data'); v.setUint32(40, n, true)
  for (let i = 0; i < n; i++) v.setUint8(44 + i, 128)
  return URL.createObjectURL(new Blob([v], { type: 'audio/wav' }))
})()

let loadedId: string | null = null
let objectUrl: string | null = null
let seq = 0
let lastSeekAt = 0
let seekLead = 0.03 // s; learned per device (see learnSeekLead)
let judgeSeek = false // next measurement is the result of a hard seek
let correcting = false

/**
 * Call synchronously inside a click handler (Create / Join / Play) so browsers that require a user
 * gesture (iOS Safari) let this element play later when the room says so.
 */
export function unlockAudio() {
  if (loadedId) return
  audio.src = SILENT_WAV
  audio.play().catch(() => {})
}

/** "Tap to tune in": the browser blocked autoplay, so play from inside this tap. */
export function tuneIn() {
  audio.play().then(() => apply()).catch(() => {})
}

function expected() {
  const r = room.value
  if (!r) return 0
  return positionAt(r.playback, clock.serverNow()) + prefs.value.outputLatencyMs / 1000
}

function seekTo(t: number) {
  try {
    audio.currentTime = Math.max(0, Number.isFinite(audio.duration) ? Math.min(t, audio.duration) : t)
    lastSeekAt = performance.now()
  } catch { /* not seekable yet */ }
}

function unload() {
  audio.pause()
  audio.removeAttribute('src')
  audio.load()
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = loadedId = null
}

function loadBlob(blob: Blob): Promise<boolean> {
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = URL.createObjectURL(blob)
  audio.src = objectUrl
  return new Promise(resolve => {
    const ok = () => { off(); resolve(true) }
    const fail = () => { off(); resolve(false) }
    const timer = setTimeout(fail, 15_000) // a decode that never finishes counts as unreadable
    const off = () => {
      clearTimeout(timer)
      audio.removeEventListener('loadedmetadata', ok)
      audio.removeEventListener('error', fail)
    }
    audio.addEventListener('loadedmetadata', ok)
    audio.addEventListener('error', fail)
  })
}

/** Bring the local element in line with the room. Safe to call any time; latest call wins. */
export async function apply() {
  const my = ++seq
  const r = room.value
  const item = currentItem.value
  if (!r || !item) {
    unload()
    readiness.value = 'idle'
    return
  }
  const blob = await getFile(item.track.id)
  if (my !== seq) return
  if (!blob) {
    if (loadedId) unload()
    readiness.value = 'missing'
    return
  }
  if (loadedId !== item.track.id) {
    readiness.value = 'loading'
    const ok = await loadBlob(blob)
    if (my !== seq) return
    if (!ok) {
      unload()
      readiness.value = 'missing'
      toast("We couldn't read this audio file.", { tone: 'error' })
      return
    }
    loadedId = item.track.id
  }

  const pb = r.playback
  if (pb.isPlaying) {
    const target = expected()
    if (Math.abs(audio.currentTime - target) > prefs.value.soft) {
      seekTo(target + seekLead)
      judgeSeek = true
    }
    try {
      await audio.play()
      if (my === seq) readiness.value = 'ready'
    } catch (err) {
      if (my === seq && (err as Error).name === 'NotAllowedError') readiness.value = 'needs-tap'
    }
  } else {
    audio.pause()
    audio.playbackRate = 1
    if (Math.abs(audio.currentTime - pb.position) > 0.05) seekTo(pb.position)
    readiness.value = 'ready'
  }
}

// Re-apply only when something that matters changes (not on chat/presence patches).
const applyKey = computed(() => {
  const r = room.value
  const item = currentItem.value
  return r ? `${r.code}|${r.playback.version}|${item?.track.id}|${item ? localTracks.value.has(item.track.id) : ''}` : ''
})
effect(() => { applyKey.value; apply() })

// Drift correction loop: compare, then nudge playbackRate or hard-seek.
function check() {
  const r = room.value
  if (!r?.playback.isPlaying || readiness.value !== 'ready' || !loadedId) {
    catchingUp.value = false
    return
  }
  if (audio.paused && !audio.ended) return void apply() // interrupted (call, headphones…); resume
  if (audio.seeking || performance.now() - lastSeekAt < prefs.value.seekCooldownMs) return
  const drift = audio.currentTime - expected()
  driftMs.value = Math.round(drift * 1000)
  if (judgeSeek) {
    seekLead = learnSeekLead(seekLead, drift)
    judgeSeek = false
  }
  const c = decide(drift, prefs.value, correcting)
  correcting = c.kind === 'rate'
  if (c.kind === 'seek') {
    catchingUp.value = true
    seekTo(expected() + seekLead)
    judgeSeek = true
  } else {
    catchingUp.value = false
    audio.playbackRate = c.kind === 'rate' ? c.rate : 1
  }
}
let loop = setInterval(check, prefs.value.checkMs)
effect(() => { clearInterval(loop); loop = setInterval(check, prefs.value.checkMs) })

audio.addEventListener('ended', () => {
  const r = room.value
  const item = currentItem.value
  if (r?.playback.isPlaying && item && loadedId === item.track.id) playback({ type: 'ENDED', itemId: item.id })
})

// Tab sleeping / device wake: timers were throttled and the clock may have jumped — resync.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState === 'visible' && socket.connected) {
    await clock.sync(3)
    apply()
  }
  reportStatus()
})
window.addEventListener('pageshow', e => { if (e.persisted) apply() })

// Tell the room how we're doing with the current song (never file names — just a status word).
function reportStatus() {
  if (room.value && socket.connected) socket.emit('status:update', { readiness: readiness.value, isAway: document.hidden })
}
effect(() => { readiness.value; me.value; connection.value; reportStatus() })

// Lock-screen / hardware media keys.
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession
  ms.setActionHandler('play', () => playback({ type: 'PLAY' }))
  ms.setActionHandler('pause', () => playback({ type: 'PAUSE' }))
  ms.setActionHandler('nexttrack', () => playback({ type: 'NEXT' }))
  ms.setActionHandler('previoustrack', () => playback({ type: 'PREVIOUS' }))
  effect(() => {
    const t = currentItem.value?.track
    ms.metadata = t ? new MediaMetadata({ title: t.title, artist: t.artist, album: t.album }) : null
    ms.playbackState = room.value?.playback.isPlaying ? 'playing' : 'paused'
  })
}

// Dev-only handle for inspecting sync from the console / tests.
if (import.meta.env.DEV) Object.assign(window, { __jam: { audio, clock, expected, driftMs, readiness, get seekLead() { return seekLead } } })

// Owns long-lived side effects (sockets, timers, <audio>); a full reload is safer than hot-swapping.
import.meta.hot?.dispose(() => location.reload())
