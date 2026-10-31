// AI on this device: whether this Earshot server has a model set up, your opt-in to let room DJs see
// your song list, and mood playlists. Only song details (title, artist, album, length) are ever sent,
// never audio, and only to this Earshot server, which passes them to the AI service its host chose.
import { computed, effect, signal } from '@preact/signals'
import type { Track } from '../../shared/types.ts'
import { createPlaylist, sortedTracks, toTrack, type Playlist } from '../library/library.ts'
import { socket } from '../realtime/socket.ts'
import { read, write } from './profile.ts'
import { joins, room, toast } from './room.ts'

export const aiAvailable = signal(false)
const checkStatus = () => socket.emit('ai:status', r => { aiAvailable.value = !!r?.available })
socket.on('connect', checkStatus)
if (socket.connected) checkStatus()

socket.on('ai:error', text => toast(text, { tone: 'error' }))

/** You let room DJs see your song list. Off by default. */
export const aiLibraryOptIn = signal(read('jam:ai-library', false))
export function setAiLibraryOptIn(on: boolean) {
  aiLibraryOptIn.value = on
  write('jam:ai-library', on)
}

const djOn = computed(() => aiAvailable.value && !!room.value?.settings.aiDj)

const CATALOG_MAX = 1000
const CATALOG_BYTES = 200 * 1024 // stay well under the server's 256 KB message cap

/** Newest songs first, as many as fit. */
function catalog(): Track[] {
  const out: Track[] = []
  let bytes = 0
  for (const t of sortedTracks.value) {
    const track = toTrack(t)
    bytes += JSON.stringify(track).length + 1
    if (bytes > CATALOG_BYTES || out.length >= CATALOG_MAX) break
    out.push(track)
  }
  return out
}

// Keep the server's copy of your song list current while the DJ is on and you've opted in;
// clear it the moment either turns off. The server forgets it whenever you leave or reconnect.
let sent = false
let timer: ReturnType<typeof setTimeout> | undefined
effect(() => {
  joins.value // re-send after every (re)join
  const want = djOn.value && aiLibraryOptIn.value && !!room.value
  sortedTracks.value // and when your library changes
  clearTimeout(timer)
  if (!want) {
    if (sent) socket.emit('ai:catalog', [])
    sent = false
    return
  }
  timer = setTimeout(() => {
    socket.emit('ai:catalog', catalog())
    sent = true
  }, 1000)
})

/** Ask the AI for a playlist from your own library. The song list is sent for this request only. */
export function makePlaylist(prompt: string): Promise<{ ok: true; playlist: Playlist } | { ok: false; error: string }> {
  if (!socket.connected) return Promise.resolve({ ok: false, error: 'Connection lost — reconnecting…' })
  return new Promise(resolve => {
    socket.timeout(60_000).emit('ai:playlist', { prompt, tracks: catalog() }, (err, r) => {
      if (err) return resolve({ ok: false, error: 'The AI took too long to answer. Please try again.' })
      if (!r.ok) return resolve(r)
      resolve({ ok: true, playlist: createPlaylist(r.name, r.trackIds) })
    })
  })
}

// Owns socket listeners and an effect; a full reload is safer than hot-swapping.
import.meta.hot?.dispose(() => location.reload())
