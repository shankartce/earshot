// Deciding whether you have the room's song. Pure, so it's unit-tested.
//   ready    — you have the exact file (same SHA-256), or you already confirmed a copy of yours
//   probable — a different file that looks like the same song (title/artist/duration); ask first
//   missing  — nothing close
import type { Track } from '../../shared/types.ts'

export type Resolution<T extends Track> =
  | { status: 'ready'; local: T }
  | { status: 'probable'; local: T }
  | { status: 'missing' }

export const DURATION_TOLERANCE = 2 // seconds

/** Lowercase, strip accents, "(feat. …)", "[Remastered 2011]", " - Radio Edit", punctuation. */
export function normalize(s: string): string {
  return s
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s*[([{][^)\]}]*[)\]}]/g, ' ')
    .replace(/\s+[-–—]\s+.*\b(remaster(ed)?|edit|version|mix|live|mono|stereo|bonus)\b.*$/, '')
    .replace(/\b(feat|ft|featuring)\.?\s.*$/, '')
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

export function looksLikeSameSong(a: Track, b: Track): boolean {
  if (!normalize(a.title) || normalize(a.title) !== normalize(b.title)) return false
  const artistA = normalize(a.artist)
  const artistB = normalize(b.artist)
  if (artistA && artistB && artistA !== artistB) return false
  if (a.duration > 0 && b.duration > 0) return Math.abs(a.duration - b.duration) <= DURATION_TOLERANCE
  return !!(artistA && artistB) // no durations to compare: need title *and* artist to agree
}

export function resolve<T extends Track>(
  wanted: Track,
  library: ReadonlyMap<string, T>,
  aliases: Readonly<Record<string, string>> = {},
  rejected: ReadonlySet<string> = new Set(),
): Resolution<T> {
  const exact = library.get(wanted.id) ?? (aliases[wanted.id] ? library.get(aliases[wanted.id]) : undefined)
  if (exact) return { status: 'ready', local: exact }
  let best: T | null = null
  for (const t of library.values()) {
    if (rejected.has(`${wanted.id}>${t.id}`) || !looksLikeSameSong(wanted, t)) continue
    if (!best || Math.abs(t.duration - wanted.duration) < Math.abs(best.duration - wanted.duration)) best = t
  }
  return best ? { status: 'probable', local: best } : { status: 'missing' }
}
