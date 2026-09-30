import { describe, expect, it } from 'vitest'
import { rateLimiter } from '../server/rateLimit.ts'
import {
  cleanText, parseCode, parseLicense, parsePlaybackCommand, parseProfile, parseQueueCommand, parseReaction, parseSignal, parseTrack,
} from '../shared/validate.ts'
import { Clock, estimate } from '../src/sync/clock.ts'
import { DEFAULT_DRIFT, decide, learnSeekLead } from '../src/sync/drift.ts'
import { groupMessages, typingText } from '../src/utils/chat.ts'
import { lineAt, parseLrc } from '../src/lyrics/lrc.ts'
import { assembleVerified, chunkRanges, parseHeader, sha256Id } from '../src/share/transfer.ts'

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

describe('drift correction', () => {
  it('ignores tiny drift, nudges rate for small drift, seeks for large drift', () => {
    expect(decide(0.03)).toEqual({ kind: 'none' })
    expect(decide(-0.049)).toEqual({ kind: 'none' })
    const ahead = decide(0.1)
    const behind = decide(-0.1)
    expect(ahead.kind === 'rate' && ahead.rate).toBeCloseTo(0.95)
    expect(behind.kind === 'rate' && behind.rate).toBeCloseTo(1.05)
    expect(decide(0.25)).toMatchObject({ kind: 'rate' })
    expect(decide(0.26)).toEqual({ kind: 'seek' })
    expect(decide(-3)).toEqual({ kind: 'seek' })
  })

  it('hysteresis: keeps correcting until well inside the threshold', () => {
    expect(decide(0.04)).toEqual({ kind: 'none' })
    expect(decide(0.04, DEFAULT_DRIFT, true)).toMatchObject({ kind: 'rate' })
    expect(decide(0.02, DEFAULT_DRIFT, true)).toEqual({ kind: 'none' })
  })

  it('learns seek latency: a seek that lands 60ms behind aims further ahead next time', () => {
    let lead = 0.03
    for (let i = 0; i < 6; i++) lead = learnSeekLead(lead, -0.06 + (lead - 0.03) * 1) // landing error shrinks as lead grows
    expect(lead).toBeGreaterThan(0.08)
    expect(lead).toBeLessThan(0.1)
    expect(learnSeekLead(0.01, 0.2)).toBe(0) // never negative
    expect(learnSeekLead(0.14, -1)).toBe(0.15) // capped: currentTime's own reporting lag must not be chased forever
  })

  it('rate deviation is capped and thresholds are configurable', () => {
    const r = decide(0.2, { ...DEFAULT_DRIFT, gain: 10 })
    expect(r.kind === 'rate' && r.rate).toBeCloseTo(0.95)
    expect(decide(0.2, { ...DEFAULT_DRIFT, soft: 0.1 })).toEqual({ kind: 'seek' })
  })
})

describe('p2p sharing: validation and transfer', () => {
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
