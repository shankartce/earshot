// The local library: audio files that live on this device only. Files are kept in the browser's
// origin-private storage (OPFS); the index (titles, playlists, confirmed matches) in local storage.
// Nothing here is ever sent to the server except Track metadata (hash id, title, artist, album, duration).
import { computed, signal } from '@preact/signals'
import type { License, Track } from '../../shared/types.ts'
import { read, write } from '../state/profile.ts'
import type { WorkerReq, WorkerRes } from './hash.worker.ts'
import { resolve, type Resolution } from './match.ts'
import { readTags, thumbnail } from './metadata.ts'

export interface LocalTrack extends Track {
  albumArtist: string
  trackNo: number | null
  fileName: string
  size: number
  addedAt: number
  hasArt: boolean
  hasLyrics?: boolean
  /** You attested you may share this exact file with friends (own work / openly licensed). */
  share?: { license: License; attestedAt: number }
  /** A temporary copy received from a friend: memory-only, never saved, never re-shared. */
  borrowed?: boolean
}

export interface Playlist { id: string; name: string; trackIds: string[]; createdAt: number }

interface SavedLibrary { v: 1; tracks: LocalTrack[]; playlists: Playlist[]; aliases: Record<string, string> }

export const localTracks = signal<ReadonlyMap<string, LocalTrack>>(new Map())
export const playlists = signal<Playlist[]>([])
/** room track id → your local track id, for copies you confirmed are the same song */
export const aliases = signal<Record<string, string>>({})
/** "roomId>localId" pairs you said are NOT the same song (this session) */
export const rejectedMatches = signal<ReadonlySet<string>>(new Set())
export const artUrls = signal<ReadonlyMap<string, string>>(new Map())
export const importing = signal<{ done: number; total: number } | null>(null)
export const libraryReady = signal(false)
/** false when the browser won't let us keep files (e.g. private browsing) — they last for this visit only */
export const persistentStorage = signal(true)

/** Your own library (borrowed copies are temporary and not part of it). */
export const sortedTracks = computed(() => [...localTracks.value.values()].filter(t => !t.borrowed).sort((a, b) => b.addedAt - a.addedAt))

const KEY = 'jam:library'
const memory = new Map<string, Blob>() // files we couldn't store on disk (this visit only)
const hexOf = (id: string) => id.replace(/^sha256:/, '')

async function dir(name: 'audio' | 'art' | 'lyrics') {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(name, { create: true })
}

// ---- persistence ----

let saveTimer: ReturnType<typeof setTimeout> | undefined
function save() {
  clearTimeout(saveTimer)
  saveTimer = setTimeout(() => write(KEY, {
    v: 1, tracks: [...localTracks.value.values()].filter(t => !t.borrowed), playlists: playlists.value, aliases: aliases.value,
  } satisfies SavedLibrary), 250)
}

/** Songs whose files the browser deleted since the last visit (it may evict non-persistent storage). */
export const lostTracks = signal<LocalTrack[]>([])
/** Whether the browser promised not to evict our storage (null = unknown / unsupported). */
export const storagePersisted = signal<boolean | null>(null)
navigator.storage?.persisted?.().then(p => { storagePersisted.value = p }).catch(() => {})

/** The index can outlive the files (browser eviction, cleared site data): keep only songs we can still play. */
async function keepPlayable(tracks: LocalTrack[]): Promise<LocalTrack[]> {
  let audio: FileSystemDirectoryHandle | null = null
  try { audio = await dir('audio') } catch { /* no OPFS at all */ }
  const ok = await Promise.all(tracks.map(async t => {
    if (!audio) return false
    try { return (await (await audio.getFileHandle(hexOf(t.id))).getFile()).size > 0 } catch { return false }
  }))
  const lost = tracks.filter((_, i) => !ok[i])
  if (lost.length) lostTracks.value = [...lostTracks.value, ...lost]
  return tracks.filter((_, i) => ok[i])
}

/** Drop songs from the index (their files are gone), keeping playlists and matches consistent. */
function dropFromIndex(ids: string[]) {
  if (!ids.length) return
  const gone = new Set(ids)
  localTracks.value = new Map([...localTracks.value].filter(([id]) => !gone.has(id)))
  aliases.value = Object.fromEntries(Object.entries(aliases.value).filter(([, v]) => !gone.has(v)))
  save()
}

async function load() {
  const saved = read<SavedLibrary | null>(KEY, null)
  if (saved?.v === 1) {
    const playable = await keepPlayable(saved.tracks)
    localTracks.value = new Map(playable.map(t => [t.id, t]))
    playlists.value = saved.playlists // playlists keep ids; songs reappear if you add them again
    aliases.value = Object.fromEntries(Object.entries(saved.aliases).filter(([, v]) => localTracks.value.has(v)))
    if (playable.length !== saved.tracks.length) save()
    const urls = new Map<string, string>()
    try {
      const art = await dir('art')
      await Promise.all(saved.tracks.filter(t => t.hasArt).map(async t => {
        try { urls.set(t.id, URL.createObjectURL(await (await art.getFileHandle(hexOf(t.id))).getFile())) } catch { /* art gone */ }
      }))
    } catch { /* no OPFS */ }
    artUrls.value = urls
  }
  libraryReady.value = true
}
load()

// ---- the worker (hashing + OPFS writes) ----

let worker: Worker | null = null
let chain: Promise<unknown> = Promise.resolve()
const WORKER_TIMEOUT_MS = 90_000
function ask(msg: WorkerReq): Promise<WorkerRes> {
  const run = () => new Promise<WorkerRes>(res => {
    const w = (worker ??= new Worker(new URL('./hash.worker.ts', import.meta.url), { type: 'module' }))
    // A worker that dies silently (e.g. out of memory on a huge file) must not freeze every later import.
    const timer = setTimeout(() => {
      w.terminate()
      if (worker === w) worker = null
      res({ ok: false })
    }, WORKER_TIMEOUT_MS)
    w.onmessage = e => { clearTimeout(timer); res(e.data) }
    w.onerror = () => { clearTimeout(timer); res({ ok: false }) }
    w.postMessage(msg)
  })
  const p = chain.then(run, run) // one request at a time keeps replies in order
  chain = p
  return p
}

/** Does the browser actually decode this? Also gives the duration the <audio> element will use. */
function probeDuration(blob: Blob): Promise<number> {
  return new Promise((ok, fail) => {
    const probe = new Audio()
    const url = URL.createObjectURL(blob)
    const done = (fn: () => void) => { URL.revokeObjectURL(url); probe.removeAttribute('src'); fn() }
    const timer = setTimeout(() => done(() => fail(new Error('timeout'))), 15_000)
    probe.preload = 'metadata'
    probe.onloadedmetadata = () => { clearTimeout(timer); done(() => ok(Number.isFinite(probe.duration) ? probe.duration : 0)) }
    probe.onerror = () => { clearTimeout(timer); done(() => fail(new Error('undecodable'))) }
    probe.src = url
  })
}

// ---- import ----

const AUDIO_EXT = /\.(mp3|m4a|m4b|aac|flac|ogg|oga|opus|wav|webm|aiff?|alac)$/i
export const isAudioFile = (f: File) => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name)
const isLrc = (f: File) => /\.lrc$/i.test(f.name)
const baseName = (name: string) => name.replace(/\.[^.]+$/, '').toLowerCase()

/** tracks = every readable file from this import, in order (new ones and ones already in the library). */
export interface ImportResult { tracks: LocalTrack[]; added: number; duplicates: number; failed: string[] }

// Imports run one after another: two at once (a folder drop while "Add file" is busy) used to
// trample each other's progress and artwork.
let importChain: Promise<unknown> = Promise.resolve()
export function importFiles(files: File[]): Promise<ImportResult> {
  const p = importChain.then(() => importNow(files))
  importChain = p.catch(() => {})
  return p
}

async function importNow(files: File[]): Promise<ImportResult> {
  const audio = files.filter(isAudioFile)
  const result: ImportResult = { tracks: [], added: 0, duplicates: 0, failed: files.filter(f => !isAudioFile(f) && !isLrc(f) && !f.name.startsWith('.')).map(f => f.name) }
  // "Song.lrc" next to "Song.mp3" (same folder drop / multi-select) becomes that song's lyrics.
  const lrcByName = new Map(files.filter(isLrc).map(f => [baseName(f.name), f]))
  if (!audio.length) return result
  navigator.storage?.persist?.().catch(() => {})
  let done = 0
  importing.value = { done, total: audio.length }

  for (const file of audio) {
    try {
      const h = await ask({ kind: 'audio', file })
      if (!h.ok) throw new Error('hash')
      const existing = localTracks.value.get(h.id)
      if (existing) {
        result.duplicates++
        result.tracks.push(existing)
      } else {
        if (!h.stored) { memory.set(h.id, file); persistentStorage.value = false }
        const [playable, tags] = await Promise.all([probeDuration(file), readTags(file, file.name)])
        let hasArt = false
        if (tags.picture) {
          const thumb = await thumbnail(tags.picture)
          if (thumb) {
            hasArt = true
            artUrls.value = new Map(artUrls.value).set(h.id, URL.createObjectURL(thumb))
            await ask({ kind: 'store', dir: 'art', name: hexOf(h.id), blob: thumb })
          }
        }
        const t: LocalTrack = {
          id: h.id, title: tags.title, artist: tags.artist, album: tags.album, albumArtist: tags.albumArtist,
          trackNo: tags.trackNo, duration: playable || tags.duration, fileName: file.name, size: file.size,
          addedAt: Date.now(), hasArt,
        }
        const lrc = lrcByName.get(baseName(file.name))
        if (lrc) t.hasLyrics = await saveLyrics(t.id, lrc)
        // Publish each track as soon as it's ready so big imports feel alive.
        localTracks.value = new Map(localTracks.value).set(t.id, t)
        save() // debounced; keeps the index in step with stored files if the page closes mid-import
        result.tracks.push(t)
        result.added++
      }
    } catch {
      result.failed.push(file.name)
    }
    importing.value = { done: ++done, total: audio.length }
  }
  importing.value = null
  save()
  return result
}

/** Files and whole folders from a drag-and-drop. */
export async function filesFromDrop(dt: DataTransfer): Promise<File[]> {
  const entries = [...dt.items].map(i => i.webkitGetAsEntry?.()).filter(Boolean) as FileSystemEntry[]
  if (!entries.length) return [...dt.files]
  const out: File[] = []
  const walk = async (e: FileSystemEntry): Promise<void> => {
    if (e.isFile) out.push(await new Promise<File>((ok, fail) => (e as FileSystemFileEntry).file(ok, fail)))
    else if (e.isDirectory) {
      const reader = (e as FileSystemDirectoryEntry).createReader()
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((ok, fail) => reader.readEntries(ok, fail))
        if (!batch.length) break
        for (const child of batch) await walk(child)
      }
    }
  }
  for (const e of entries) await walk(e).catch(() => {})
  return out
}

// ---- lookup ----

/** Is the room's song on this device? (exact file, a confirmed copy, or a probable match to confirm) */
export function resolveLocal(track: Track): Resolution<LocalTrack> {
  return resolve(track, localTracks.value, aliases.value, rejectedMatches.value)
}

export async function getFile(localId: string): Promise<Blob | null> {
  if (memory.has(localId)) return memory.get(localId)!
  try {
    return await (await (await dir('audio')).getFileHandle(hexOf(localId))).getFile()
  } catch {
    // The file vanished mid-session: stop claiming we have it, so every screen says "missing".
    const t = localTracks.value.get(localId)
    if (t) {
      lostTracks.value = [...lostTracks.value, t]
      dropFromIndex([localId])
    }
    return null
  }
}

export const toTrack = ({ id, title, artist, album, duration }: LocalTrack): Track => ({ id, title, artist, album, duration })

/** Record (or clear) your attestation that you may share this file. */
export function setShare(localId: string, license: License | null) {
  const t = localTracks.value.get(localId)
  if (!t || t.borrowed) return
  const { share: _old, ...rest } = t
  localTracks.value = new Map(localTracks.value).set(localId, license ? { ...rest, share: { license, attestedAt: Date.now() } } : rest)
  save()
}

/** Keep a verified copy a friend sent, for this visit only (never written to disk or the library). */
export function addBorrowed(track: Track, blob: Blob) {
  memory.set(track.id, blob)
  if (localTracks.value.has(track.id)) return
  const t: LocalTrack = {
    ...track, albumArtist: '', trackNo: null, fileName: '', size: blob.size, addedAt: Date.now(), hasArt: false, borrowed: true,
  }
  localTracks.value = new Map(localTracks.value).set(track.id, t)
}

export function confirmMatch(roomTrackId: string, localId: string) {
  aliases.value = { ...aliases.value, [roomTrackId]: localId }
  save()
}

export function rejectMatch(roomTrackId: string, localId: string) {
  rejectedMatches.value = new Set(rejectedMatches.value).add(`${roomTrackId}>${localId}`)
}

// ---- editing ----

export async function removeTrack(id: string) {
  const next = new Map(localTracks.value)
  next.delete(id)
  localTracks.value = next
  playlists.value = playlists.value.map(p => ({ ...p, trackIds: p.trackIds.filter(t => t !== id) }))
  aliases.value = Object.fromEntries(Object.entries(aliases.value).filter(([, v]) => v !== id))
  const url = artUrls.value.get(id)
  if (url) {
    URL.revokeObjectURL(url)
    const urls = new Map(artUrls.value)
    urls.delete(id)
    artUrls.value = urls
  }
  memory.delete(id)
  save()
  for (const d of ['audio', 'art', 'lyrics'] as const) {
    try { await (await dir(d)).removeEntry(hexOf(id)) } catch { /* already gone */ }
  }
}

export function createPlaylist(name: string, trackIds: string[] = []): Playlist {
  const p: Playlist = { id: crypto.randomUUID(), name: name.trim() || 'New playlist', trackIds, createdAt: Date.now() }
  playlists.value = [...playlists.value, p]
  save()
  return p
}

export function updatePlaylist(id: string, patch: Partial<Pick<Playlist, 'name' | 'trackIds'>>) {
  playlists.value = playlists.value.map(p => (p.id === id ? { ...p, ...patch } : p))
  save()
}

export function addToPlaylist(id: string, trackIds: string[]) {
  const p = playlists.value.find(x => x.id === id)
  if (p) updatePlaylist(id, { trackIds: [...p.trackIds, ...trackIds.filter(t => !p.trackIds.includes(t))] })
}

export function deletePlaylist(id: string) {
  playlists.value = playlists.value.filter(p => p.id !== id)
  save()
}

export async function storageUsage(): Promise<{ used: number; quota: number } | null> {
  try {
    const e = await navigator.storage.estimate()
    return { used: e.usage ?? 0, quota: e.quota ?? 0 }
  } catch {
    return null
  }
}

// ---- lyrics files (.lrc), stored next to the audio ----

const lyricsMemory = new Map<string, string>()

async function saveLyrics(localId: string, file: Blob): Promise<boolean> {
  const r = await ask({ kind: 'store', dir: 'lyrics', name: hexOf(localId), blob: file })
  if (!r.ok || !r.stored) lyricsMemory.set(localId, await file.text())
  return true
}

/** Attach an .lrc file to a song in your library. */
export async function setLyrics(localId: string, file: File) {
  await saveLyrics(localId, file)
  const t = localTracks.value.get(localId)
  if (t) {
    localTracks.value = new Map(localTracks.value).set(localId, { ...t, hasLyrics: true })
    save()
  }
}

export async function readLyricsText(localId: string): Promise<string | null> {
  if (lyricsMemory.has(localId)) return lyricsMemory.get(localId)!
  try {
    return await (await (await (await dir('lyrics')).getFileHandle(hexOf(localId))).getFile()).text()
  } catch {
    return null
  }
}
