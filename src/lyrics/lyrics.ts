// Where synced lyrics come from. Today: an .lrc file the listener added for their own copy of a song.
// Nothing is scraped. A licensed lyrics API can be added later as another provider in `providers`,
// and the panel won't need to change.
import type { Track } from '../../shared/types.ts'
import { readLyricsText, resolveLocal } from '../library/library.ts'
import { parseLrc, type LyricLine } from './lrc.ts'

export interface LyricsProvider {
  name: string
  find(track: Track): Promise<LyricLine[] | null>
}

const localLrc: LyricsProvider = {
  name: 'your .lrc file',
  async find(track) {
    const local = resolveLocal(track)
    if (local.status !== 'ready' || !local.local.hasLyrics) return null
    const text = await readLyricsText(local.local.id)
    return text ? parseLrc(text) : null
  },
}

export const providers: LyricsProvider[] = [localLrc]

export async function findLyrics(track: Track): Promise<{ lines: LyricLine[]; source: string } | null> {
  for (const p of providers) {
    const lines = await p.find(track).catch(() => null)
    if (lines?.length) return { lines, source: p.name }
  }
  return null
}
