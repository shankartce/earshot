// Cross-cutting user actions that touch both the local library and the room.
import { effect } from '@preact/signals'
import { applyAutoShare, importFiles, localTracks, lostTracks, toTrack, type ImportResult, type LocalTrack } from '../library/library.ts'
import type { QueueItem, Track } from '../../shared/types.ts'
import { me, queue, room, toast } from './room.ts'

// If the browser cleared stored songs, say so once instead of silently showing them as missing.
let lostSeen = 0
effect(() => {
  const n = lostTracks.value.length
  if (n > lostSeen) {
    const k = n - lostSeen
    toast(`Your browser cleared ${k} song${k === 1 ? '' : 's'} from its storage — add ${k === 1 ? 'it' : 'them'} again in your library.`, { tone: 'error' })
  }
  lostSeen = n
})

export function reportImport(res: ImportResult) {
  const n = res.failed.length
  if (n) toast(n === 1 ? "We couldn't read this audio file." : `We couldn't read ${n} of those files.`, { tone: 'error' })
}

/** Share songs' metadata (never the audio) to the room queue. */
export async function queueTracks(tracks: LocalTrack[]) {
  if (!tracks.length || !room.value) return
  const batch = tracks.slice(0, 100)
  applyAutoShare(batch)
  const r = await queue({ type: 'ADD', tracks: batch.map(toTrack) })
  if (r.ok) toast(batch.length === 1 ? `Added “${batch[0].title}”` : `Added ${batch.length} songs`)
}

/** Add a song from the room's history again (yours or not). */
export function requeue(t: Track) {
  const own = localTracks.value.get(t.id)
  if (own) applyAutoShare([own])
  return queue({ type: 'ADD', tracks: [t] })
}

/** Import local files, then add them to the room's queue. */
export async function importAndQueue(files: File[]) {
  const res = await importFiles(files)
  reportImport(res)
  await queueTracks(res.tracks)
  return res
}

/** Remove a song from the queue, with an Undo that puts it back where it was. */
export async function removeFromQueue(item: QueueItem) {
  const at = room.value?.queue.items.findIndex(i => i.id === item.id) ?? -1
  const r = await queue({ type: 'REMOVE', itemId: item.id })
  if (!r.ok) return
  toast(`Removed “${item.track.title}”`, {
    action: {
      label: 'Undo',
      run: async () => {
        if (!(await queue({ type: 'ADD', tracks: [item.track] })).ok) return
        const back = room.value?.queue.items.findLast(i => i.track.id === item.track.id && i.addedBy === me.value)
        if (back && at > -1) queue({ type: 'MOVE', itemId: back.id, toIndex: at })
      },
    },
  })
}

/** Add songs from your library so they play right after the current one (in this order). */
export async function playNext(tracks: LocalTrack[]) {
  if (!tracks.length || !room.value) return
  applyAutoShare(tracks)
  if (!(await queue({ type: 'ADD', tracks: tracks.map(toTrack) })).ok) return
  // PLAY_NEXT puts each right after the current song, so go in reverse to keep their order.
  for (const t of [...tracks].reverse()) {
    const added = room.value?.queue.items.findLast(i => i.track.id === t.id && i.addedBy === me.value)
    if (added) await queue({ type: 'PLAY_NEXT', itemId: added.id })
  }
  toast(tracks.length === 1 ? `“${tracks[0].title}” plays next` : `${tracks.length} songs play next`)
}
