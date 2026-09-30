// Cross-cutting user actions that touch both the local library and the room.
import { importFiles, toTrack, type ImportResult, type LocalTrack } from '../library/library.ts'
import { queue, room, toast } from './room.ts'

export function reportImport(res: ImportResult) {
  const n = res.failed.length
  if (n) toast(n === 1 ? "We couldn't read this audio file." : `We couldn't read ${n} of those files.`, { tone: 'error' })
}

/** Share songs' metadata (never the audio) to the room queue. */
export async function queueTracks(tracks: LocalTrack[]) {
  if (!tracks.length || !room.value) return
  const batch = tracks.slice(0, 100)
  const r = await queue({ type: 'ADD', tracks: batch.map(toTrack) })
  if (r.ok) toast(batch.length === 1 ? `Added “${batch[0].title}”` : `Added ${batch.length} songs`)
}

/** Import local files, then add them to the room's queue. */
export async function importAndQueue(files: File[]) {
  const res = await importFiles(files)
  reportImport(res)
  await queueTracks(res.tracks)
  return res
}
