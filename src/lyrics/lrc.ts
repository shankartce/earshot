// Timestamped lyrics. The panel consumes LyricLine[]; where they come from is pluggable (see lyrics.ts).

export interface LyricLine {
  time: number // seconds into the song
  text: string
}

const STAMP = /\[(\d{1,3}):(\d{1,2}(?:[.:]\d{1,3})?)\]/g

/**
 * Parse an .lrc file: `[mm:ss.xx] text`, several stamps per line, `[offset:±ms]`,
 * metadata tags ([ar:], [ti:] …) ignored. Returns lines sorted by time; [] if nothing is timed.
 */
export function parseLrc(src: string): LyricLine[] {
  let offset = 0
  const out: LyricLine[] = []
  for (const raw of src.replace(/^﻿/, '').split(/\r?\n/)) {
    const off = raw.match(/^\s*\[offset:\s*([+-]?\d+)\s*\]/i)
    if (off) { offset = Number(off[1]) / 1000; continue }
    const stamps = [...raw.matchAll(STAMP)]
    if (!stamps.length) continue
    const text = raw.replace(STAMP, '').replace(/<\d{1,3}:\d{1,2}(?:[.:]\d{1,3})?>/g, '').trim() // strip word-level stamps
    for (const [, m, s] of stamps) out.push({ time: Number(m) * 60 + Number(s.replace(':', '.')), text })
  }
  // LRC offset: positive means lyrics should appear earlier.
  return out.map(l => ({ ...l, time: Math.max(0, l.time - offset) })).sort((a, b) => a.time - b.time)
}

/** Index of the line being sung at `t` (−1 before the first line). Binary search: called every frame. */
export function lineAt(lines: LyricLine[], t: number): number {
  let lo = 0
  let hi = lines.length - 1
  let ans = -1
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (lines[mid].time <= t) { ans = mid; lo = mid + 1 } else hi = mid - 1
  }
  return ans
}
