// Cross-cutting user actions that touch both the local library and the room.
import { importFiles, toTrack, type ImportResult } from '../library/library.ts'
import { queue, room, toast } from './room.ts'

export function reportImport(res: ImportResult) {
  const n = res.failed.length
  if (n) toast(n === 1 ? "We couldn't read this audio file." : `We couldn't read ${n} of those files.`, { tone: 'error' })
}

/** Import local files, then share their metadata (never the audio) to the room queue. */
export async function importAndQueue(files: File[]) {
  const res = await importFiles(files)
  reportImport(res)
  if (!res.tracks.length || !room.value) return res
  const r = await queue({ type: 'ADD', tracks: res.tracks.slice(0, 100).map(toTrack) })
  if (r.ok) toast(res.tracks.length === 1 ? `Added “${res.tracks[0].title}”` : `Added ${res.tracks.length} songs`)
  return res
}
