// The local <audio> element is only the playback mechanism; the room state decides what plays and
// where. This module continuously reconciles the two: load the local file, seek, play/pause, and
// correct drift against the server clock. Audio output always goes straight from the element to the
// speakers (never through Web Audio), so locking the phone or switching apps can't silence it.
import { computed, effect, signal } from '@preact/signals'
import { positionAt } from '../../shared/playback.ts'
import type { Readiness } from '../../shared/types.ts'
import { artUrls, getFile, resolveLocal } from '../library/library.ts'
import { clock, socket } from '../realtime/socket.ts'
import { canControl, connection, currentItem, me, playback, room, roomCode, toast } from '../state/room.ts'
import { DEFAULT_DRIFT, decide, learnSeekLead, migratePrefs, type DriftConfig } from '../sync/drift.ts'

// ---- tunables (persisted; editable in /settings) ----
function load<T>(key: string, fallback: T): T {
  try { return { ...fallback, ...migratePrefs(JSON.parse(localStorage.getItem(key) ?? '{}')) } } catch { return fallback }
}
export interface PlayerPrefs extends DriftConfig { outputLatencyMs: number; volume: number; v: 2 }
export const prefs = signal<PlayerPrefs>(load('jam:player', { ...DEFAULT_DRIFT, outputLatencyMs: 0, volume: 0.8, v: 2 }))
export function setPrefs(patch: Partial<PlayerPrefs>) {
  prefs.value = { ...prefs.value, ...patch, v: 2 }
  try { localStorage.setItem('jam:player', JSON.stringify(prefs.value)) } catch { /* ignore */ }
}

// ---- observable player state ----
export const readiness = signal<Readiness>('idle')
export const catchingUp = signal(false)
export const driftMs = signal(0)
/** Something outside Earshot paused us (headphones unplugged, a call, another app). Wait for a tap. */
export const heldHere = signal(false)
/** A guest silenced this device with their headset / lock-screen button (room playback is host-only). */
export const mutedHere = signal(false)
/** Your copy of the current song exists but this browser can't decode it. */
export const unplayable = signal(false)
export const isIOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)

export const syncStatus = computed<'synced' | 'catching-up' | 'reconnecting' | 'not-playing'>(() => {
  if (connection.value !== 'online') return 'reconnecting'
  const playing = !!room.value?.playback.isPlaying && !!currentItem.value
  if (playing && (heldHere.value || readiness.value === 'missing' || readiness.value === 'needs-tap')) return 'not-playing'
  return catchingUp.value || readiness.value === 'loading' ? 'catching-up' : 'synced'
})

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
effect(() => { audio.muted = mutedHere.value })

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

let loadedId: string | null = null // "roomTrackId>localId" currently in the element
let objectUrl: string | null = null
let seq = 0
let lastSeekAt = 0
let seekLead = 0.03 // s; learned per device (see learnSeekLead)
let judgeSeek = false // next measurement is the result of a hard seek
let correcting = false
let strikes = 0 // consecutive readings past the threshold; one noisy reading shouldn't start a correction
const setRate = (rate: number) => { if (audio.playbackRate !== rate) audio.playbackRate = rate } // each change is audible
const failedKeys = new Set<string>() // local files this browser couldn't decode (don't retry on every action)

// A pause from outside Earshot (OS, headphones unplugged, a call, another app). We only ever pause
// the element ourselves while the room is paused or while a song is loading, so a pause that arrives
// while the room plays and this device is ready can't be ours. (Counting our own pause() calls
// doesn't work: changing the source discards the element's queued 'pause' events.)
const pauseAudio = () => { if (!audio.paused) audio.pause() }
audio.addEventListener('pause', () => {
  if (audio.ended || !loadedId || audio.src !== objectUrl) return
  if (room.value?.playback.isPlaying && readiness.value === 'ready') {
    heldHere.value = true
    readiness.value = 'needs-tap'
  }
})

/**
 * Call synchronously inside a click handler (Create / Join / Play) so browsers that require a user
 * gesture (iOS Safari) let this element play later when the room says so.
 * Never while a song is loading: swapping in the silent clip then would make it "end" instantly.
 */
export function unlockAudio() {
  if (loadedId || readiness.value === 'loading') return
  audio.src = SILENT_WAV
  audio.play().catch(() => {})
}

/** "Tap to tune in / resume": the browser (or the OS) stopped us, so play from inside this tap. */
export function tuneIn() {
  heldHere.value = false
  mutedHere.value = false
  ctx?.resume().catch(() => {})
  audio.play().then(() => apply()).catch(() => apply())
}

// ---- visualizer tap (analysis only) ----
// We listen to a *copy* of the audio (captureStream) rather than routing the element through Web
// Audio, so a suspended AudioContext only freezes the visualizer, never the music. Chromium only:
// Firefox's mozCaptureStream mutes the element (Mozilla bug 1178751) and Safari has no capture API;
// those browsers get the animated visualizer.
type CapturableAudio = HTMLAudioElement & { captureStream?: () => MediaStream }
const canCapture = typeof (audio as CapturableAudio).captureStream === 'function'
let ctx: AudioContext | null = null
let analyser: AnalyserNode | null = null
let tap: MediaStreamAudioSourceNode | null = null
let captured: MediaStream | null = null // one capture for the element's lifetime
let tappedTrack: MediaStreamTrack | null = null

export const getAnalyser = () => (ctx?.state === 'running' && tap ? analyser : null)

function connectTap() {
  if (!ctx || !analyser || !canCapture) return
  try {
    captured ??= (audio as CapturableAudio).captureStream!()
    const track = captured.getAudioTracks().find(t => t.readyState === 'live')
    if (!track || track === tappedTrack) return // nothing new (a seek or resume); song changes bring a new track
    tap?.disconnect()
    tap = ctx.createMediaStreamSource(new MediaStream([track]))
    tap.connect(analyser)
    tappedTrack = track
  } catch {
    tap = tappedTrack = null
  }
}
audio.addEventListener('playing', connectTap)

/** Call from a user gesture. Safe to call repeatedly. */
export function enableAnalyser() {
  if (!canCapture) return
  try {
    if (!ctx) {
      ctx = new AudioContext()
      analyser = ctx.createAnalyser()
      analyser.fftSize = 1024
      analyser.smoothingTimeConstant = 0.78
      const silent = ctx.createGain() // keeps the graph running without producing any sound
      silent.gain.value = 0
      analyser.connect(silent).connect(ctx.destination)
    }
    if (ctx.state !== 'running') ctx.resume().catch(() => {})
    if (!tap && !audio.paused) connectTap()
  } catch {
    /* no Web Audio: the visualizer just idles */
  }
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
  pauseAudio()
  audio.removeAttribute('src')
  audio.load()
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  objectUrl = loadedId = null
}

function loadBlob(blob: Blob): Promise<boolean> {
  pauseAudio()
  if (objectUrl) URL.revokeObjectURL(objectUrl)
  const url = (objectUrl = URL.createObjectURL(blob))
  audio.src = url
  return new Promise(resolve => {
    // Only this URL counts: metadata from anything else (e.g. the unlock clip) is not our song.
    const ok = () => { if (audio.src !== url) return; off(); resolve(true) }
    const fail = () => { if (audio.src !== url) return; off(); resolve(false) }
    const timer = setTimeout(() => { off(); resolve(false) }, 15_000) // a decode that never finishes
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
    unplayable.value = false
    readiness.value = 'idle'
    return
  }
  const local = resolveLocal(item.track)
  const localId = local.status === 'ready' ? local.local.id : null
  const key = `${item.track.id}>${localId}` // room song → which local file plays it
  unplayable.value = !!localId && failedKeys.has(key)
  const blob = localId && !unplayable.value ? await getFile(localId) : null
  if (my !== seq) return
  if (!blob) {
    if (loadedId) unload()
    readiness.value = 'missing'
    return
  }
  if (loadedId !== key) {
    readiness.value = 'loading'
    correcting = false
    setRate(1)
    const ok = await loadBlob(blob)
    if (my !== seq) return
    if (!ok) {
      unload()
      failedKeys.add(key)
      unplayable.value = true
      readiness.value = 'missing'
      toast("We couldn't play this audio file in this browser.", { tone: 'error' })
      return
    }
    loadedId = key
  }

  const pb = r.playback
  if (!pb.isPlaying) {
    pauseAudio()
    audio.playbackRate = 1
    if (Math.abs(audio.currentTime - pb.position) > 0.05) seekTo(pb.position)
    readiness.value = 'ready'
    return
  }
  // A seek before the element starts is silent, so start exactly in step. Once it's playing, only a
  // real jump (someone seeked, or we're way off) is worth an audible skip; the drift loop does the rest.
  const target = expected()
  if (Math.abs(audio.currentTime - target) > (audio.paused ? 0.05 : prefs.value.soft)) {
    seekTo(target + seekLead)
    judgeSeek = true
  }
  if (heldHere.value) { // paused from outside Earshot: stay quiet until the listener taps
    readiness.value = 'needs-tap'
    return
  }
  try {
    await audio.play()
    if (my === seq) readiness.value = 'ready'
  } catch (err) {
    // Blocked autoplay — including a hidden tab that isn't allowed to start the next song.
    if (my === seq && (err as Error).name === 'NotAllowedError') readiness.value = 'needs-tap'
  }
}

// Re-apply only when something that matters changes (not on chat/presence patches).
const applyKey = computed(() => {
  const r = room.value
  const item = currentItem.value
  const local = item ? resolveLocal(item.track) : null
  return r ? `${r.code}|${r.playback.version}|${item?.track.id}|${local?.status === 'ready' ? local.local.id : ''}` : ''
})
effect(() => { applyKey.value; apply() })

// Leaving or switching rooms clears anything that was specific to the old one.
effect(() => {
  roomCode.value
  heldHere.value = false
  mutedHere.value = false
})

// Drift correction loop: compare, then change speed slightly or (rarely) jump.
function check() {
  const r = room.value
  if (!r?.playback.isPlaying || readiness.value !== 'ready' || !loadedId) {
    catchingUp.value = false
    return
  }
  if (audio.paused && !audio.ended) return void apply() // our own pause/resume raced; re-apply
  if (audio.seeking || performance.now() - lastSeekAt < prefs.value.seekCooldownMs) return
  const drift = audio.currentTime - expected()
  driftMs.value = Math.round(drift * 1000)
  if (judgeSeek) {
    seekLead = learnSeekLead(seekLead, drift)
    judgeSeek = false
  }
  let c = decide(drift, prefs.value, correcting)
  strikes = c.kind === 'none' || correcting ? 0 : strikes + 1
  if (!correcting && c.kind !== 'none' && strikes < 2) c = { kind: 'none' }
  // In the background timers are throttled, so a speed change could run for minutes: only jump there.
  if (document.hidden && c.kind === 'rate') c = { kind: 'none' }
  correcting = c.kind === 'rate'
  if (c.kind === 'seek') {
    catchingUp.value = true
    setRate(1)
    seekTo(expected() + seekLead)
    judgeSeek = true
    strikes = 0
  } else {
    catchingUp.value = false
    setRate(c.kind === 'rate' ? c.rate : 1)
  }
}
let loop = setInterval(check, prefs.value.checkMs)
effect(() => { clearInterval(loop); loop = setInterval(check, prefs.value.checkMs) })

audio.addEventListener('ended', () => {
  const r = room.value
  const item = currentItem.value
  if (!r?.playback.isPlaying || !item || !loadedId?.startsWith(`${item.track.id}>`)) return
  // A "same song" copy can be up to 2 s shorter; don't let it cut the song short for everyone.
  // Report the end only for the exact file, or once the room itself has reached the end.
  const exact = loadedId === `${item.track.id}>${item.track.id}`
  const atEnd = positionAt(r.playback, clock.serverNow()) >= (item.track.duration || 0) - 0.5
  if (exact || atEnd) playback({ type: 'ENDED', itemId: item.id })
})

// Tab sleeping / device wake: timers were throttled and the clock may have jumped — resync.
document.addEventListener('visibilitychange', async () => {
  if (document.hidden) { // don't leave a speed change running while timers sleep
    correcting = false
    setRate(1)
  } else {
    ctx?.resume().catch(() => {})
    if (socket.connected) {
      await clock.sync(3)
      apply()
    }
  }
  reportStatus()
})
window.addEventListener('pageshow', e => { if (e.persisted) apply() })

// Tell the room how we're doing with the current song (never file names — just a status word).
function reportStatus() {
  if (room.value && socket.connected) socket.emit('status:update', { readiness: readiness.value, isAway: document.hidden })
}
effect(() => { readiness.value; me.value; connection.value; reportStatus() })

// ---- lock screen, notification and headset controls (Media Session) ----
if ('mediaSession' in navigator) {
  const ms = navigator.mediaSession
  const set = (action: MediaSessionAction, fn: MediaSessionActionHandler | null) => {
    try { ms.setActionHandler(action, fn) } catch { /* action not supported here */ }
  }
  const seekBy = (d: number) => playback({ type: 'SEEK', position: Math.max(0, roomPosition.value + d) })

  effect(() => {
    if (canControl.value) {
      set('play', () => { if (heldHere.value || readiness.value === 'needs-tap') tuneIn(); playback({ type: 'PLAY' }) })
      set('pause', () => playback({ type: 'PAUSE' }))
      set('nexttrack', () => playback({ type: 'NEXT' }))
      set('previoustrack', () => playback({ type: 'PREVIOUS' }))
      set('seekto', d => { if (d.seekTime != null) playback({ type: 'SEEK', position: d.seekTime }) })
      set('seekbackward', d => seekBy(-(d.seekOffset ?? 10)))
      set('seekforward', d => seekBy(d.seekOffset ?? 10))
    } else {
      // Guests can't pause the room; their headset/lock-screen button mutes just this device.
      set('play', () => { mutedHere.value = false; if (heldHere.value) tuneIn(); toast('Unmuted on this device') })
      set('pause', () => { mutedHere.value = true; toast('Muted on this device') })
      for (const a of ['nexttrack', 'previoustrack', 'seekto', 'seekbackward', 'seekforward'] as const) set(a, null)
    }
  })

  effect(() => {
    const t = currentItem.value?.track
    const local = t ? resolveLocal(t) : null
    const art = local?.status === 'ready' ? artUrls.value.get(local.local.id) : undefined
    ms.metadata = t ? new MediaMetadata({ title: t.title, artist: t.artist, album: t.album, artwork: art ? [{ src: art, sizes: '320x320', type: 'image/jpeg' }] : [] }) : null
    ms.playbackState = room.value?.playback.isPlaying && !mutedHere.value ? 'playing' : 'paused'
  })

  // Position on the lock screen: refresh on every playback change and every 5 s while playing.
  const updatePosition = () => {
    const r = room.value
    const d = currentItem.value?.track.duration
    if (!r || !d) return
    try {
      ms.setPositionState({ duration: d, playbackRate: 1, position: Math.min(d, Math.max(0, positionAt(r.playback, clock.serverNow()))) })
    } catch { /* not supported */ }
  }
  effect(() => { applyKey.value; updatePosition() })
  setInterval(() => { if (room.value?.playback.isPlaying) updatePosition() }, 5000)
}

// Dev-only handle for inspecting sync from the console / tests.
if (import.meta.env.DEV) {
  Object.assign(window, { __jam: { audio, clock, expected, driftMs, readiness, heldHere, getAnalyser, get seekLead() { return seekLead }, get correcting() { return correcting } } })
}

// Owns long-lived side effects (sockets, timers, <audio>); a full reload is safer than hot-swapping.
import.meta.hot?.dispose(() => location.reload())
