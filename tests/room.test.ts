import { describe, expect, it } from 'vitest'
import { positionAt } from '../shared/playback.ts'
import type { Profile, Track } from '../shared/types.ts'
import {
  addChat, addParticipant, applyPlayback, applyQueue, applySettings, createRoom, ensureHost, isOffering, kick, makeHost,
  markSeen, offerShare, reactToMessage, resumeParticipant, setOffline, snapshot, updateProfile, withdrawShare, type Room,
} from '../server/state/room.ts'

const profile = (name: string): Profile => ({ displayName: name, avatar: { emoji: '🙂', color: '#ff8844' } })
const track = (n: number, duration = 200): Track => ({
  id: `sha256:${String(n).padStart(64, '0')}`, title: `Song ${n}`, artist: 'A', album: '', duration,
})
let ids = 0
const newId = () => `item-${++ids}`

function setup(tracks = 3) {
  const room = createRoom('ABCDE', 'Late Night', '🌙', 1000)
  addParticipant(room, profile('Alex'), 1000, 'alex', 'tok-alex')
  addParticipant(room, profile('Sam'), 1001, 'sam', 'tok-sam')
  if (tracks) applyQueue(room, 'alex', { type: 'ADD', tracks: Array.from({ length: tracks }, (_, i) => track(i + 1)) }, 1000, newId)
  return room
}
const play = (room: Room, who: string, cmd: any, now: number) =>
  applyPlayback(room, who, { baseVersion: room.playback.version, ...cmd }, now)
const itemIds = (room: Room) => room.queue.items.map(i => i.track.title)

describe('playback', () => {
  it('first add selects the first item paused', () => {
    const room = setup()
    expect(room.playback.itemId).toBe(room.queue.items[0].id)
    expect(room.playback.isPlaying).toBe(false)
    expect(room.history[0].title).toBe('Song 1')
  })

  it('play / pause uses the server clock, not the client', () => {
    const room = setup()
    play(room, 'sam', { type: 'PLAY' }, 10_000)
    expect(room.playback).toMatchObject({ isPlaying: true, position: 0, serverTimestamp: 10_000 })
    expect(positionAt(room.playback, 22_500)).toBeCloseTo(12.5)
    play(room, 'alex', { type: 'PAUSE' }, 22_500)
    expect(room.playback).toMatchObject({ isPlaying: false, position: 12.5 })
    expect(positionAt(room.playback, 99_999)).toBe(12.5)
  })

  it('seek clamps to the track', () => {
    const room = setup()
    play(room, 'alex', { type: 'SEEK', position: 73.42 }, 2000)
    expect(room.playback.position).toBe(73.42)
    play(room, 'alex', { type: 'SEEK', position: 9999 }, 2000)
    expect(room.playback.position).toBe(200)
    play(room, 'alex', { type: 'SEEK', position: -5 }, 2000)
    expect(room.playback.position).toBe(0)
  })

  it('next / previous move through the queue and keep play state', () => {
    const room = setup()
    play(room, 'alex', { type: 'PLAY' }, 1000)
    play(room, 'alex', { type: 'NEXT' }, 2000)
    expect(room.playback).toMatchObject({ itemId: room.queue.items[1].id, isPlaying: true, position: 0 })
    // previous within 3s goes back a song
    play(room, 'alex', { type: 'PREVIOUS' }, 3000)
    expect(room.playback.itemId).toBe(room.queue.items[0].id)
    // previous after 3s restarts the current song
    play(room, 'alex', { type: 'PREVIOUS' }, 10_000)
    expect(room.playback).toMatchObject({ itemId: room.queue.items[0].id, position: 0 })
  })

  it('next at the end of the queue is refused', () => {
    const room = setup(1)
    expect(play(room, 'alex', { type: 'NEXT' }, 1000)).toMatchObject({ ok: false })
  })

  it('track completion advances once; duplicate ENDED reports are stale', () => {
    const room = setup(2)
    play(room, 'alex', { type: 'PLAY' }, 0)
    const first = room.queue.items[0].id
    const v = room.playback.version
    const a = applyPlayback(room, 'alex', { type: 'ENDED', itemId: first, baseVersion: v }, 200_000)
    const b = applyPlayback(room, 'sam', { type: 'ENDED', itemId: first, baseVersion: v }, 200_010)
    expect(a.ok).toBe(true)
    expect(b).toEqual({ ok: false, error: 'stale' })
    expect(room.playback).toMatchObject({ itemId: room.queue.items[1].id, isPlaying: true })
  })

  it('completion of the last song stops at its end; PLAY restarts it', () => {
    const room = setup(1)
    play(room, 'alex', { type: 'PLAY' }, 0)
    play(room, 'alex', { type: 'ENDED', itemId: room.playback.itemId }, 200_000)
    expect(room.playback).toMatchObject({ isPlaying: false, position: 200 })
    play(room, 'alex', { type: 'PLAY' }, 201_000)
    expect(room.playback).toMatchObject({ isPlaying: true, position: 0 })
  })

  it('conflicting actions: first wins, second is stale', () => {
    const room = setup()
    play(room, 'alex', { type: 'PLAY' }, 0)
    const v = room.playback.version
    expect(applyPlayback(room, 'alex', { type: 'PAUSE', baseVersion: v }, 5000).ok).toBe(true)
    expect(applyPlayback(room, 'sam', { type: 'SEEK', position: 60, baseVersion: v }, 5001)).toEqual({ ok: false, error: 'stale' })
    expect(room.playback).toMatchObject({ isPlaying: false, position: 5 })
  })

  it('host-only playback blocks guests', () => {
    const room = setup()
    applySettings(room, 'alex', { playbackControl: 'host' }, 0)
    expect(play(room, 'sam', { type: 'PLAY' }, 0).ok).toBe(false)
    expect(play(room, 'alex', { type: 'PLAY' }, 0).ok).toBe(true)
    // ENDED is not a user action and is always allowed
    expect(play(room, 'sam', { type: 'ENDED', itemId: room.playback.itemId }, 300_000).ok).toBe(true)
  })

  it('play item jumps and records history', () => {
    const room = setup()
    play(room, 'sam', { type: 'PLAY_ITEM', itemId: room.queue.items[2].id }, 0)
    expect(room.playback).toMatchObject({ itemId: room.queue.items[2].id, isPlaying: true })
    expect(room.history.map(t => t.title)).toEqual(['Song 3', 'Song 1'])
  })
})

describe('queue', () => {
  it('add / remove / move / play next / clear', () => {
    const room = setup(4)
    expect(itemIds(room)).toEqual(['Song 1', 'Song 2', 'Song 3', 'Song 4'])
    const [, s2, s3, s4] = room.queue.items
    applyQueue(room, 'alex', { type: 'MOVE', itemId: s4.id, toIndex: 1, baseVersion: room.queue.version }, 0, newId)
    expect(itemIds(room)).toEqual(['Song 1', 'Song 4', 'Song 2', 'Song 3'])
    applyQueue(room, 'alex', { type: 'PLAY_NEXT', itemId: s3.id }, 0, newId)
    expect(itemIds(room)).toEqual(['Song 1', 'Song 3', 'Song 4', 'Song 2'])
    applyQueue(room, 'alex', { type: 'REMOVE', itemId: s2.id }, 0, newId)
    expect(itemIds(room)).toEqual(['Song 1', 'Song 3', 'Song 4'])
    applyQueue(room, 'alex', { type: 'CLEAR' }, 0, newId)
    expect(itemIds(room)).toEqual(['Song 1']) // clearing keeps what's playing
  })

  it('every change bumps the queue version; stale MOVE is rejected', () => {
    const room = setup()
    const v = room.queue.version
    const [a, b] = room.queue.items
    expect(applyQueue(room, 'alex', { type: 'MOVE', itemId: a.id, toIndex: 2, baseVersion: v }, 0, newId).ok).toBe(true)
    expect(applyQueue(room, 'sam', { type: 'MOVE', itemId: b.id, toIndex: 0, baseVersion: v }, 0, newId)).toEqual({ ok: false, error: 'stale' })
    expect(room.queue.version).toBe(v + 1)
  })

  it('concurrent adds and removes by id both apply', () => {
    const room = setup(3)
    const target = room.queue.items[2].id
    applyQueue(room, 'alex', { type: 'ADD', tracks: [track(9)] }, 0, newId)
    applyQueue(room, 'sam', { type: 'REMOVE', itemId: target }, 0, newId)
    expect(itemIds(room)).toEqual(['Song 1', 'Song 2', 'Song 9'])
    expect(applyQueue(room, 'sam', { type: 'REMOVE', itemId: target }, 0, newId).ok).toBe(false)
  })

  it('removing the current song moves on without changing play/pause', () => {
    const room = setup(3)
    const [s1, s2] = room.queue.items
    applyQueue(room, 'alex', { type: 'REMOVE', itemId: s1.id }, 0, newId)
    expect(room.playback).toMatchObject({ itemId: s2.id, isPlaying: false })
    play(room, 'alex', { type: 'PLAY' }, 0)
    const last = room.queue.items.at(-1)!
    play(room, 'alex', { type: 'PLAY_ITEM', itemId: last.id }, 0)
    applyQueue(room, 'alex', { type: 'REMOVE', itemId: last.id }, 0, newId)
    expect(room.playback).toMatchObject({ itemId: s2.id, isPlaying: true }) // fell back to previous
  })

  it('removing a non-current song leaves playback untouched', () => {
    const room = setup(3)
    play(room, 'alex', { type: 'PLAY' }, 0)
    const before = { ...room.playback }
    applyQueue(room, 'alex', { type: 'REMOVE', itemId: room.queue.items[2].id }, 5000, newId)
    expect(room.playback).toEqual(before)
  })

  it('host-only queue editing: guests can still add and remove their own songs', () => {
    const room = setup(2)
    applySettings(room, 'alex', { queueEditing: 'host' }, 0)
    expect(applyQueue(room, 'sam', { type: 'REMOVE', itemId: room.queue.items[1].id }, 0, newId).ok).toBe(false)
    expect(applyQueue(room, 'sam', { type: 'ADD', tracks: [track(7)] }, 0, newId).ok).toBe(true)
    const mine = room.queue.items.at(-1)!
    expect(applyQueue(room, 'sam', { type: 'MOVE', itemId: mine.id, toIndex: 0, baseVersion: room.queue.version }, 0, newId).ok).toBe(false)
    expect(applyQueue(room, 'sam', { type: 'REMOVE', itemId: mine.id }, 0, newId).ok).toBe(true)
  })
})

describe('share offers (p2p metadata)', () => {
  it('can only offer songs in the queue; offers vanish when you go offline', () => {
    const room = setup(2)
    const queued = room.queue.items[0].track.id
    expect(offerShare(room, 'alex', track(99).id, 'own')).toBe(false) // not in the queue
    expect(offerShare(room, 'alex', queued, 'cc-by')).toBe(true)
    expect(offerShare(room, 'sam', queued, 'cc0')).toBe(true)
    expect(isOffering(room, 'alex', queued)).toBe(true)
    expect(room.shares[queued]).toHaveLength(2)
    offerShare(room, 'alex', queued, 'own') // re-offer replaces, doesn't duplicate
    expect(room.shares[queued]).toHaveLength(2)
    setOffline(room, 'alex', 5)
    expect(isOffering(room, 'alex', queued)).toBe(false)
    expect(withdrawShare(room, 'sam', queued)).toBe(true)
    expect(room.shares[queued]).toBeUndefined()
    expect(withdrawShare(room, 'sam', queued)).toBe(false)
  })

  it('snapshot carries offers but still no tokens', () => {
    const room = setup(1)
    offerShare(room, 'alex', room.queue.items[0].track.id, 'own')
    const s = snapshot(room)
    expect(Object.keys(s.shares)).toHaveLength(1)
    expect(JSON.stringify(s)).not.toContain('tok-')
  })
})

describe('presence, settings, chat', () => {
  it('first participant is host; host hands off to the longest-present online person', () => {
    const room = setup(0)
    addParticipant(room, profile('Jamie'), 2000, 'jamie', 'tok-j')
    expect(room.hostId).toBe('alex')
    setOffline(room, 'alex', 3000)
    expect(ensureHost(room)).toBe(true)
    expect(room.hostId).toBe('sam')
  })

  it('an empty room keeps its host', () => {
    const room = setup(0)
    setOffline(room, 'alex', 0)
    setOffline(room, 'sam', 0)
    expect(ensureHost(room)).toBe(false)
    expect(room.hostId).toBe('alex')
  })

  it('token resumes the same participant; unknown token does not', () => {
    const room = setup(0)
    setOffline(room, 'sam', 0)
    expect(resumeParticipant(room, 'tok-sam', profile('Sammy'), 5)?.id).toBe('sam')
    expect(room.participants.find(p => p.id === 'sam')).toMatchObject({ isOnline: true, displayName: 'Sammy' })
    expect(resumeParticipant(room, 'nope', profile('X'), 5)).toBeNull()
  })

  it('snapshot never leaks session tokens', () => {
    expect(JSON.stringify(snapshot(setup()))).not.toContain('tok-')
  })

  it('only the host changes settings', () => {
    const room = setup(0)
    expect(applySettings(room, 'sam', { allowChat: false }, 0).ok).toBe(false)
    expect(applySettings(room, 'alex', { allowChat: false, name: 'Sunday' }, 0).ok).toBe(true)
    expect(room).toMatchObject({ name: 'Sunday', settings: { allowChat: false } })
    expect(addChat(room, 'sam', 'hi', 0, 'm1')).toBe('Chat is turned off in this room.')
  })

  it('chat keeps a bounded history and toggles message reactions', () => {
    const room = setup(0)
    for (let i = 0; i < 120; i++) addChat(room, 'alex', `m${i}`, i, `id${i}`)
    expect(room.chat).toHaveLength(100)
    expect(room.chat[0].text).toBe('m20')
    reactToMessage(room, 'sam', 'id119', '❤️')
    expect(room.chat.at(-1)!.reactions).toEqual({ '❤️': ['sam'] })
    reactToMessage(room, 'sam', 'id119', '❤️')
    expect(room.chat.at(-1)!.reactions).toEqual({})
  })
})

describe('chat replies, seen and reactions', () => {
  it("a reply quotes the server's stored original, trimmed; unknown ids are ignored", () => {
    const room = setup(0)
    const orig = addChat(room, 'alex', 'x'.repeat(300), 1000, 'm1') as any
    const reply = addChat(room, 'sam', 'agreed', 2000, 'm2', orig.id) as any
    expect(reply.replyTo).toEqual({ id: 'm1', authorId: 'alex', text: 'x'.repeat(100) })
    expect((addChat(room, 'sam', 'hm', 3000, 'm3', 'nope') as any).replyTo).toBeUndefined()
  })

  it('a message holds at most 20 different reactions (existing ones can still be added to)', () => {
    const room = setup(0)
    addChat(room, 'alex', 'hi', 1000, 'm1')
    const emojis = ['😀', '😃', '😄', '😁', '😆', '😅', '🤣', '😂', '🙂', '🙃', '😉', '😊', '😇', '🥰', '😍', '🤩', '😘', '😗', '😚', '😙']
    for (const e of emojis) reactToMessage(room, 'alex', 'm1', e)
    expect(reactToMessage(room, 'alex', 'm1', '🫠')).toBeNull()
    expect(reactToMessage(room, 'sam', 'm1', '😀')!.reactions['😀']).toEqual(['alex', 'sam'])
  })

  it("seen only moves forward, using the message's server time", () => {
    const room = setup(0)
    addChat(room, 'alex', 'one', 1000, 'm1')
    addChat(room, 'alex', 'two', 2000, 'm2')
    expect(markSeen(room, 'sam', 'm2')).toBe(true)
    expect(markSeen(room, 'sam', 'm1')).toBe(false)
    expect(room.participants.find(p => p.id === 'sam')!.seenAt).toBe(2000)
  })
})

describe('people: profile, host, remove', () => {
  it('profile edits apply in place', () => {
    const room = setup(0)
    updateProfile(room, 'sam', profile('Samantha'))
    expect(room.participants.find(p => p.id === 'sam')!.displayName).toBe('Samantha')
  })

  it('only the host can hand over host, and only to someone here', () => {
    const room = setup(0)
    expect(makeHost(room, 'sam', 'sam').ok).toBe(false)
    expect(makeHost(room, 'alex', 'sam').ok).toBe(true)
    expect(room.hostId).toBe('sam')
    setOffline(room, 'alex', 5000)
    expect(makeHost(room, 'sam', 'alex').ok).toBe(false)
  })

  it("removing someone revokes their token and share offers; the host can't remove themselves", () => {
    const room = setup(1)
    offerShare(room, 'sam', room.queue.items[0].track.id, 'cc-by')
    expect(kick(room, 'sam', 'alex').ok).toBe(false)
    expect(kick(room, 'alex', 'alex').ok).toBe(false)
    expect(kick(room, 'alex', 'sam').ok).toBe(true)
    expect(room.participants.map(p => p.id)).toEqual(['alex'])
    expect(resumeParticipant(room, 'tok-sam', profile('Sam'), 6000)).toBeNull()
    expect(isOffering(room, 'sam', room.queue.items[0].track.id)).toBe(false)
  })
})
