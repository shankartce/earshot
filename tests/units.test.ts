import { describe, expect, it } from 'vitest'
import { rateLimiter } from '../server/rateLimit.ts'
import {
  cleanText, parseCode, parsePlaybackCommand, parseProfile, parseQueueCommand, parseReaction, parseTrack,
} from '../shared/validate.ts'
import { Clock, estimate } from '../src/sync/clock.ts'
import { DEFAULT_DRIFT, decide } from '../src/sync/drift.ts'

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

  it('rate deviation is capped and thresholds are configurable', () => {
    const r = decide(0.2, { ...DEFAULT_DRIFT, gain: 10 })
    expect(r.kind === 'rate' && r.rate).toBeCloseTo(0.95)
    expect(decide(0.2, { ...DEFAULT_DRIFT, soft: 0.1 })).toEqual({ kind: 'seek' })
  })
})
