import { describe, expect, it } from 'vitest'
import { rateLimiter } from '../server/rateLimit.ts'
import {
  cleanText, parseCode, parseLicense, parsePlaybackCommand, parseProfile, parseQueueCommand, parseReaction, parseSignal, parseTrack,
} from '../shared/validate.ts'
import { Clock, estimate, shouldAccept } from '../src/sync/clock.ts'
import { DEFAULT_DRIFT, decide, learnSeekLead, migratePrefs } from '../src/sync/drift.ts'
import { groupMessages, needsSeparator, seenText, separatorLabel, typingText } from '../src/utils/chat.ts'
import { EMOJI_GROUPS, isJumbo, searchEmoji } from '../src/utils/emoji.ts'
import { dominantHues } from '../src/utils/palette.ts'
import { normalizeViz } from '../src/audio/visualizer.ts'
import { lineAt, parseLrc } from '../src/lyrics/lrc.ts'
import { afterFailure, assembleVerified, autoShares, chunkRanges, parseHeader, planFetch, sha256Id } from '../src/share/transfer.ts'

const HASH = 'sha256:' + 'a'.repeat(64)

describe('validation', () => {
  it('room codes', () => {
    expect(parseCode(' f7k9q ')).toBe('F7K9Q')
    expect(parseCode('F7K9')).toBeNull()
    expect(parseCode('F7K9O')).toBeNull() // O is not in the alphabet
    expect(parseCode({})).toBeNull()
  })

  it('text is stripped of control and bidi characters and capped', () => {
    expect(cleanText('  hi\u0000 there\u202E  ', 50)).toBe('hi there')
    expect(cleanText('a\n\n\n\nb', 50, true)).toBe('a\n\nb')
    expect(cleanText('x'.repeat(900), 500)).toHaveLength(500)
    expect(cleanText(42, 10)).toBe('')
  })

  it('tracks require a sha256 id and never carry extra fields', () => {
    const t = parseTrack({ id: HASH, title: 'Midnight City', artist: 'M83', duration: 243, path: 'C:/secret.mp3' })
    expect(t).toEqual({ id: HASH, title: 'Midnight City', artist: 'M83', album: '', duration: 243 })
    expect(parseTrack({ id: 'abc' })).toBeNull()
    expect(parseTrack({ id: HASH, duration: -1 })!.duration).toBe(0)
  })

  it('profiles need a name, emoji and hex color', () => {
    expect(parseProfile({ displayName: 'Sam', avatar: { emoji: '🦊', color: '#aabbcc' } })).toBeTruthy()
    expect(parseProfile({ displayName: '', avatar: { emoji: '🦊', color: '#aabbcc' } })).toBeNull()
    expect(parseProfile({ displayName: 'Sam', avatar: { emoji: '🦊', color: 'red;}' } })).toBeNull()
  })

  it('commands', () => {
    expect(parsePlaybackCommand({ type: 'SEEK', position: 12, baseVersion: 3 })).toEqual({ type: 'SEEK', position: 12, baseVersion: 3 })
    expect(parsePlaybackCommand({ type: 'SEEK', position: 'x', baseVersion: 3 })).toBeNull()
    expect(parsePlaybackCommand({ type: 'PLAY' })).toBeNull() // baseVersion required
    expect(parsePlaybackCommand({ type: 'HACK', baseVersion: 1 })).toBeNull()
    expect(parseQueueCommand({ type: 'ADD', tracks: [{ id: HASH, title: 't' }] })).toBeTruthy()
    expect(parseQueueCommand({ type: 'ADD', tracks: [{ id: HASH }, { id: 'bad' }] })).toBeNull()
    expect(parseQueueCommand({ type: 'MOVE', itemId: 'x', toIndex: 1.5, baseVersion: 1 })).toBeNull()
    expect(parseReaction('🔥')).toBe('🔥')
    expect(parseReaction('<script>')).toBeNull()
  })
})

describe('rate limiter', () => {
  it('allows a burst up to capacity, then refills over time', () => {
    const allow = rateLimiter({ chat: [3, 3000] })
    expect([allow('chat', 0), allow('chat', 0), allow('chat', 0), allow('chat', 0)]).toEqual([true, true, true, false])
    expect(allow('chat', 999)).toBe(false)
    expect(allow('chat', 1000)).toBe(true)
  })
})

describe('clock sync', () => {
  it('picks the lowest-RTT sample', () => {
    const est = estimate([
      { t0: 0, server: 5100, t1: 200 }, // noisy
      { t0: 1000, server: 6010, t1: 1020 }, // clean
    ])
    expect(est).toEqual({ offset: 5000, rtt: 20 })
    expect(estimate([])).toBeNull()
  })

  it('recovers a large clock offset under asymmetric latency jitter', async () => {
    let local = 1_000_000
    const TRUE_OFFSET = -3_600_000 // client clock is an hour ahead
    const delays = [[80, 20], [15, 15], [40, 90], [12, 14], [200, 30]]
    let i = 0
    const clock = new Clock(async () => {
      const [up, down] = delays[i++]
      local += up
      const server = local + TRUE_OFFSET
      local += down
      return server
    }, () => local)
    await clock.sync(5)
    expect(Math.abs(clock.offset - TRUE_OFFSET)).toBeLessThanOrEqual(1) // (12,14) sample → 1ms error
    expect(clock.rtt).toBe(26)
    expect(clock.serverNow()).toBe(local + clock.offset)
  })
})

describe('clock offset acceptance', () => {
  it('keeps a clean estimate over a congested one, unless it is stale or forced', () => {
    expect(shouldAccept(null, 500, 0)).toBe(true)
    expect(shouldAccept({ rtt: 40, at: 0 }, 55, 1000)).toBe(true) // comparable
    expect(shouldAccept({ rtt: 40, at: 0 }, 300, 1000)).toBe(false) // congested sample
    expect(shouldAccept({ rtt: 40, at: 0 }, 300, 200_000)).toBe(true) // old estimate is stale
    expect(shouldAccept({ rtt: 1, at: 0 }, 3, 10)).toBe(true) // tiny localhost RTTs get slack
  })

  it('a congested resync does not move the offset; a forced one does', async () => {
    let local = 0
    let delay = [10, 10]
    const clock = new Clock(async () => { local += delay[0]; const s = local + 5000 + (delay[0] > 100 ? 400 : 0); local += delay[1]; return s }, () => local)
    await clock.sync(3)
    expect(clock.offset).toBe(5000)
    delay = [300, 20] // congested and asymmetric → a skewed estimate
    await clock.sync(3)
    expect(clock.offset).toBe(5000)
    await clock.sync(3, true)
    expect(clock.offset).not.toBe(5000)
  })
})

describe('drift correction', () => {
  it('leaves up to 300 ms alone, changes speed by a fixed 2% up to 2 s, jumps only beyond', () => {
    expect(decide(0.2)).toEqual({ kind: 'none' })
    expect(decide(-0.29)).toEqual({ kind: 'none' })
    expect(decide(0.4)).toEqual({ kind: 'rate', rate: 0.98 })
    expect(decide(1.9)).toEqual({ kind: 'rate', rate: 0.98 }) // fixed, not proportional: no per-second rate changes
    expect(decide(-0.4)).toEqual({ kind: 'rate', rate: 1.02 })
    expect(decide(2)).toMatchObject({ kind: 'rate' })
    expect(decide(2.1)).toEqual({ kind: 'seek' })
    expect(decide(-3)).toEqual({ kind: 'seek' })
  })

  it('hysteresis: once correcting, keeps going until inside 80 ms', () => {
    expect(decide(0.2, DEFAULT_DRIFT, true)).toMatchObject({ kind: 'rate' })
    expect(decide(0.09, DEFAULT_DRIFT, true)).toMatchObject({ kind: 'rate' })
    expect(decide(0.07, DEFAULT_DRIFT, true)).toEqual({ kind: 'none' })
  })

  it('old saved prefs lose their jumpy thresholds but keep volume and speaker delay', () => {
    const old = { ignore: 0.05, soft: 0.25, gain: 0.5, volume: 0.4, outputLatencyMs: 120 }
    const m = migratePrefs(old)
    expect(m).toMatchObject({ v: 2, volume: 0.4, outputLatencyMs: 120 })
    expect(m).not.toHaveProperty('ignore')
    expect(m).not.toHaveProperty('soft')
    expect(migratePrefs({ v: 2, ignore: 0.5 })).toEqual({ v: 2, ignore: 0.5 }) // chosen after the change: kept
  })

  it('learns seek latency: a seek that lands 60ms behind aims further ahead next time', () => {
    let lead = 0.03
    for (let i = 0; i < 6; i++) lead = learnSeekLead(lead, -0.06 + (lead - 0.03) * 1) // landing error shrinks as lead grows
    expect(lead).toBeGreaterThan(0.08)
    expect(lead).toBeLessThan(0.1)
    expect(learnSeekLead(0.01, 0.2)).toBe(0) // never negative
    expect(learnSeekLead(0.14, -1)).toBe(0.15) // capped: currentTime's own reporting lag must not be chased forever
  })

  it('thresholds are configurable', () => {
    expect(decide(0.5, { ...DEFAULT_DRIFT, maxRate: 0.01 })).toEqual({ kind: 'rate', rate: 0.99 })
    expect(decide(0.5, { ...DEFAULT_DRIFT, soft: 0.4 })).toEqual({ kind: 'seek' })
  })
})

describe('p2p sharing: validation and transfer', () => {
  it("auto-share: only when turned on, never a friend's copy, never overrides a licence you chose", () => {
    const on = { license: 'cc-by' as const, attestedAt: 1 }
    expect(autoShares({}, on)).toBe(true)
    expect(autoShares({}, null)).toBe(false) // off by default
    expect(autoShares({ sharedBy: { name: 'Sam', license: 'cc0', at: 1 } }, on)).toBe(false) // received copies are never passed on
    expect(autoShares({ share: { license: 'own', attestedAt: 1 } }, on)).toBe(false)
  })

  const T = 'sha256:' + 'b'.repeat(64)

  it('signals: known types only, bounded sizes, extras dropped', () => {
    expect(parseSignal({ type: 'request', transferId: 't1', trackId: T, evil: 1 })).toEqual({ type: 'request', transferId: 't1', trackId: T })
    expect(parseSignal({ type: 'request', transferId: 't1', trackId: 'not-a-hash' })).toBeNull()
    expect(parseSignal({ type: 'offer', transferId: 't1', sdp: 'v=0' })).toMatchObject({ type: 'offer' })
    expect(parseSignal({ type: 'offer', transferId: 't1', sdp: 'x'.repeat(16 * 1024 + 1) })).toBeNull()
    expect(parseSignal({ type: 'ice', transferId: 't1', candidate: { candidate: 'x'.repeat(1025) } })).toBeNull()
    expect(parseSignal({ type: 'ice', transferId: 't1', candidate: { candidate: 'c', sdpMid: '0', sdpMLineIndex: 0, junk: true } }))
      .toEqual({ type: 'ice', transferId: 't1', candidate: { candidate: 'c', sdpMid: '0', sdpMLineIndex: 0 } })
    expect(parseSignal({ type: 'reject', transferId: 't1', reason: 'nope' })).toBeNull()
    expect(parseSignal({ type: 'file', transferId: 't1' })).toBeNull()
    expect(parseLicense('cc-by')).toBe('cc-by')
    expect(parseLicense('commercial')).toBeNull()
    expect(parseLicense('toString')).toBeNull() // no prototype keys
  })

  it('chunk plan covers the file exactly', () => {
    expect(chunkRanges(10, 4)).toEqual([[0, 4], [4, 8], [8, 10]])
    expect(chunkRanges(0, 4)).toEqual([])
  })

  it('header parsing rejects bad or oversized headers', () => {
    expect(parseHeader(JSON.stringify({ kind: 'header', trackId: T, size: 10, license: 'own' }))).toMatchObject({ size: 10 })
    expect(parseHeader(JSON.stringify({ kind: 'header', trackId: T, size: 300 * 1024 * 1024, license: 'own' }))).toBeNull()
    expect(parseHeader(JSON.stringify({ kind: 'header', trackId: T, size: 10, license: 'stolen' }))).toBeNull()
    expect(parseHeader('{not json')).toBeNull()
  })

  it('only the exact promised file is accepted', async () => {
    const bytes = new TextEncoder().encode('an openly licensed recording')
    const id = await sha256Id(bytes.buffer)
    const header = { kind: 'header' as const, trackId: id, size: bytes.length, license: 'cc-by' as const }
    const parts = chunkRanges(bytes.length, 5).map(([a, b]) => bytes.slice(a, b).buffer)
    expect(await assembleVerified(parts, header)).toBeInstanceOf(Blob)
    const corrupted = parts.map((p, i) => (i === 2 ? new Uint8Array(p).map(x => x ^ 1).buffer : p))
    expect(await assembleVerified(corrupted, header)).toBeNull()
    expect(await assembleVerified(parts.slice(1), header)).toBeNull()
  })
})

describe('auto-fetch planning', () => {
  const q = ['a', 'b', 'c', 'd']
  const base = { queue: q, currentIndex: 2, have: () => false, offers: () => ['alex'], memo: new Map(), now: 0 }

  it('current song first, then upcoming, then earlier ones', () => {
    expect(planFetch(base)).toEqual({ trackId: 'c', from: 'alex' })
    expect(planFetch({ ...base, have: id => id === 'c' })!.trackId).toBe('d')
    expect(planFetch({ ...base, have: id => id === 'c' || id === 'd' })!.trackId).toBe('a')
    expect(planFetch({ ...base, currentIndex: -1 })!.trackId).toBe('a')
  })

  it('skips songs nobody offers, songs in backoff, and songs that failed too often', () => {
    expect(planFetch({ ...base, offers: id => (id === 'b' ? ['sam'] : []) })).toEqual({ trackId: 'b', from: 'sam' })
    const m1 = afterFailure(undefined, 'alex', 0) // retry in 15 s
    expect(m1).toMatchObject({ attempts: 1, nextAt: 15_000, lastPeer: 'alex' })
    expect(planFetch({ ...base, memo: new Map([['c', m1]]), now: 1000 })!.trackId).toBe('d')
    expect(planFetch({ ...base, memo: new Map([['c', m1]]), now: 15_000 })!.trackId).toBe('c')
    let m = m1
    m = afterFailure(m, 'alex', 0)
    m = afterFailure(m, 'alex', 0)
    expect(m.attempts).toBe(3)
    expect(planFetch({ ...base, memo: new Map([['c', m]]), now: 1e9 })!.trackId).toBe('d') // gave up on c
  })

  it('after a failure, tries a different sharer if there is one', () => {
    const memo = new Map([['c', { attempts: 1, nextAt: 0, lastPeer: 'alex' }]])
    expect(planFetch({ ...base, offers: () => ['alex', 'sam'], memo, now: 1 })).toEqual({ trackId: 'c', from: 'sam' })
    expect(planFetch({ ...base, offers: () => ['alex'], memo, now: 1 })).toEqual({ trackId: 'c', from: 'alex' })
  })
})

describe('lyrics (.lrc)', () => {
  it('parses stamps, multi-stamp lines, offsets and ignores tags', () => {
    const lines = parseLrc([
      '﻿[ti:Example Song]', '[ar:Example Artist]', '[offset:+500]',
      '[00:12.42]First line', '[00:20.00][01:05.5]Chorus', '[00:30:25] colon hundredths',
      '[00:40.00]<00:40.00>word <00:40.50>stamps', 'no stamp here', '[00:50.00]',
    ].join('\r\n'))
    expect(lines.map(l => [Number(l.time.toFixed(2)), l.text])).toEqual([
      [11.92, 'First line'], [19.5, 'Chorus'], [29.75, 'colon hundredths'],
      [39.5, 'word stamps'], [49.5, ''], [65, 'Chorus'],
    ])
    expect(parseLrc('just plain lyrics\nwithout times')).toEqual([])
  })

  it('finds the current line', () => {
    const lines = parseLrc('[00:10]a\n[00:20]b\n[00:30]c')
    expect([0, 10, 19.99, 20, 99].map(t => lineAt(lines, t))).toEqual([-1, 0, 0, 1, 2])
    expect(lineAt([], 5)).toBe(-1)
  })
})

describe('chat display', () => {
  const msg = (authorId: string, at: number) => ({ id: `${authorId}${at}`, authorId, text: 'x', at, reactions: {} })
  it('groups consecutive messages by author within 3 minutes', () => {
    const g = groupMessages([msg('a', 0), msg('a', 60_000), msg('b', 70_000), msg('b', 400_000), msg('a', 410_000)])
    expect(g.map(x => [x.authorId, x.messages.length])).toEqual([['a', 2], ['b', 1], ['b', 1], ['a', 1]])
  })
  it('typing text', () => {
    expect(typingText([])).toBe('')
    expect(typingText(['Sam'])).toBe('Sam is typing…')
    expect(typingText(['Sam', 'Kai'])).toBe('Sam and Kai are typing…')
    expect(typingText(['Sam', 'Kai', 'Noor'])).toBe('Several people are typing…')
  })
})

describe('emoji', () => {
  it('reactions accept any single emoji, never text or markup', () => {
    for (const e of ['👍🏽', '🫠', '❤️‍🔥', '🇮🇳', '👨‍👩‍👧', '❤️']) expect(parseReaction(e)).toBe(e)
    for (const x of ['lol', '<b>', '123', '#', '', ' ', '🔥'.repeat(9), 42, null]) expect(parseReaction(x)).toBeNull()
  })

  it('every curated picker emoji is accepted by the server', () => {
    const all = EMOJI_GROUPS.flatMap(g => g.items.map(i => i.e))
    expect(all.length).toBeGreaterThan(200)
    expect(all.filter(e => parseReaction(e) === null)).toEqual([])
  })

  it('search matches by name words', () => {
    expect(searchEmoji('fire').map(x => x.e)).toContain('🔥')
    expect(searchEmoji('broken heart').map(x => x.e)).toEqual(['💔'])
    expect(searchEmoji('   ')).toEqual([])
  })

  it('1 to 3 emojis (and nothing else) show jumbo', () => {
    expect(isJumbo('🔥')).toBe(true)
    expect(isJumbo('❤️‍🔥 🎵')).toBe(true)
    expect(isJumbo('😂😂😂')).toBe(true)
    expect(isJumbo('😂😂😂😂')).toBe(false)
    expect(isJumbo('lol 😂')).toBe(false)
    expect(isJumbo('3')).toBe(false)
  })
})

describe('chat display helpers', () => {
  it('a time separator starts the chat and follows a 10 minute lull', () => {
    expect(needsSeparator(null, 1000)).toBe(true)
    expect(needsSeparator(1000, 1000 + 9 * 60_000)).toBe(false)
    expect(needsSeparator(1000, 1000 + 10 * 60_000)).toBe(true)
  })

  it('separator labels name older days', () => {
    const now = new Date(2026, 9, 3, 15, 0).getTime()
    expect(separatorLabel(new Date(2026, 9, 3, 9, 5).getTime(), now)).not.toMatch(/Yesterday|Oct/)
    expect(separatorLabel(new Date(2026, 9, 2, 9, 5).getTime(), now)).toMatch(/^Yesterday/)
  })

  it('"Seen" wording', () => {
    expect(seenText([], 1)).toBe('')
    expect(seenText(['Sam'], 1)).toBe('Seen')
    expect(seenText(['Sam', 'Kim'], 2)).toBe('Seen by everyone')
    expect(seenText(['Sam'], 3)).toBe('Seen by Sam')
  })
})

describe('song colours and visual styles', () => {
  const image = (colors: [number, number, number][], each = 100) => {
    const px = new Uint8ClampedArray(colors.length * each * 4)
    colors.forEach(([r, g, b], c) => { for (let i = 0; i < each; i++) px.set([r, g, b, 255], (c * each + i) * 4) })
    return px
  }

  it('finds the two dominant, distinct hues of the artwork', () => {
    const [h1, h2] = dominantHues(image([[230, 40, 40], [230, 40, 40], [40, 90, 230]]))!
    expect(h1 < 15 || h1 > 345).toBe(true) // red wins (twice as much of it)
    expect(h2).toBeGreaterThan(205)
    expect(h2).toBeLessThan(235) // blue second
  })

  it('grey or near-white artwork has no song colour (falls back to the generated one)', () => {
    expect(dominantHues(image([[128, 128, 128], [250, 250, 250], [10, 10, 10]]))).toBeNull()
  })

  it('a single-colour cover still gets a second, neighbouring hue', () => {
    const [h1, h2] = dominantHues(image([[40, 200, 90]]))!
    expect(Math.abs(h2 - h1)).toBe(40)
  })

  it('old visual styles become Ambient', () => {
    expect(normalizeViz('bars')).toBe('ambient')
    expect(normalizeViz('wave')).toBe('ambient')
    expect(normalizeViz('glow')).toBe('ambient')
    expect(normalizeViz(null)).toBe('ambient')
    expect(normalizeViz('radial')).toBe('radial')
    expect(normalizeViz('off')).toBe('off')
  })
})
