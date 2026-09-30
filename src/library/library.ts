// The local library: audio files that live on this device only. Nothing here is ever sent to the
// server except Track metadata (hash id, title, artist, album, duration).
// ponytail: in-memory for now; phase 3 swaps the internals for OPFS persistence + tag parsing,
// keeping this module's exports stable.
import { signal } from '@preact/signals'
import type { Track } from '../../shared/types.ts'

export interface LocalTrack extends Track {
  file: Blob
  addedAt: number
}

export const localTracks = signal<ReadonlyMap<string, LocalTrack>>(new Map())
export const importing = signal<{ done: number; total: number } | null>(null)

const AUDIO_EXT = /\.(mp3|m4a|aac|flac|ogg|oga|opus|wav|webm|aiff?)$/i
export const isAudioFile = (f: File) => f.type.startsWith('audio/') || AUDIO_EXT.test(f.name)

export async function hashBlob(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await blob.arrayBuffer())
  return 'sha256:' + [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/** Resolves the duration, or rejects if the browser can't decode the file. */
function probeDuration(blob: Blob): Promise<number> {
  return new Promise((resolve, reject) => {
    const probe = new Audio()
    const url = URL.createObjectURL(blob)
    const done = (fn: () => void) => { URL.revokeObjectURL(url); fn() }
    probe.preload = 'metadata'
    probe.onloadedmetadata = () => done(() => resolve(Number.isFinite(probe.duration) ? probe.duration : 0))
    probe.onerror = () => done(() => reject(new Error('undecodable')))
    probe.src = url
  })
}

/** "Artist - Title.mp3" → { artist, title }; otherwise the filename is the title. */
export function guessFromFilename(name: string): { title: string; artist: string } {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/^\d{1,3}[\s.\-]+/, '').trim()
  const m = base.match(/^(.+?)\s+[-–—]\s+(.+)$/)
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { title: base || 'Untitled', artist: '' }
}

/** tracks = every readable file from this import in order (new + already in library). */
export interface ImportResult { tracks: LocalTrack[]; added: number; duplicates: number; failed: string[] }

export async function importFiles(files: File[]): Promise<ImportResult> {
  const audio = files.filter(isAudioFile)
  const result: ImportResult = { tracks: [], added: 0, duplicates: 0, failed: files.filter(f => !isAudioFile(f)).map(f => f.name) }
  const next = new Map(localTracks.value)
  importing.value = { done: 0, total: audio.length }
  for (const file of audio) {
    try {
      const id = await hashBlob(file)
      if (next.has(id)) {
        result.duplicates++
        result.tracks.push(next.get(id)!)
      } else {
        const duration = await probeDuration(file)
        const t: LocalTrack = { id, ...guessFromFilename(file.name), album: '', duration, file, addedAt: Date.now() }
        next.set(id, t)
        result.tracks.push(t)
        result.added++
      }
    } catch {
      result.failed.push(file.name)
    }
    importing.value = { done: importing.value!.done + 1, total: audio.length }
  }
  localTracks.value = next
  importing.value = null
  return result
}

export const hasTrack = (id: string) => localTracks.value.has(id)
export const getFile = async (id: string): Promise<Blob | null> => localTracks.value.get(id)?.file ?? null
export const toTrack = ({ id, title, artist, album, duration }: LocalTrack): Track => ({ id, title, artist, album, duration })
