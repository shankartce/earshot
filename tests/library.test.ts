import { describe, expect, it } from 'vitest'
import type { Track } from '../shared/types.ts'
import { looksLikeSameSong, normalize, resolve } from '../src/library/match.ts'
import { guessFromFilename, readTags } from '../src/library/metadata.ts'

const id = (n: number) => `sha256:${String(n).padStart(64, '0')}`
const t = (n: number, title: string, artist: string, duration: number): Track => ({ id: id(n), title, artist, album: '', duration })

describe('normalize', () => {
  it('ignores case, accents, punctuation and edition noise', () => {
    expect(normalize('Beyoncé')).toBe('beyonce')
    expect(normalize('Midnight City (Remastered 2011)')).toBe('midnight city')
    expect(normalize('Let It Happen - Radio Edit')).toBe('let it happen')
    expect(normalize('Blinding Lights [feat. Someone]')).toBe('blinding lights')
    expect(normalize('Song feat. Guest Star')).toBe('song')
    expect(normalize("Don't Stop Me Now!")).toBe('don t stop me now')
    expect(normalize('Simon & Garfunkel')).toBe('simon and garfunkel')
  })
})

describe('track matching', () => {
  const lib = new Map([
    [id(1), t(1, 'Midnight City', 'M83', 243.1)],
    [id(2), t(2, 'Midnight City - Remastered', 'M83', 244.0)],
    [id(3), t(3, 'Intro', 'The xx', 127)],
  ])

  it('matching file: same hash is ready regardless of tags', () => {
    expect(resolve(t(3, 'Whatever', 'Nobody', 1), lib)).toMatchObject({ status: 'ready', local: { id: id(3) } })
  })

  it('different rip of the same song is a probable match (closest duration wins)', () => {
    const r = resolve(t(99, 'midnight city', 'm83', 243.9), lib)
    expect(r).toMatchObject({ status: 'probable', local: { id: id(2) } })
  })

  it('missing file: nothing close', () => {
    expect(resolve(t(99, 'Midnight City', 'M83', 300), lib).status).toBe('missing') // way off in length
    expect(resolve(t(99, 'Midnight City', 'Someone Else', 243), lib).status).toBe('missing')
    expect(resolve(t(99, 'Unknown Song', 'M83', 243), lib).status).toBe('missing')
  })

  it('a confirmed copy becomes ready; a rejected one is never suggested again', () => {
    const wanted = t(99, 'Midnight City', 'M83', 243.5)
    expect(resolve(wanted, lib, { [id(99)]: id(1) })).toMatchObject({ status: 'ready', local: { id: id(1) } })
    const rejected = new Set([`${id(99)}>${id(1)}`, `${id(99)}>${id(2)}`])
    expect(resolve(wanted, lib, {}, rejected).status).toBe('missing')
  })

  it('without durations, title alone is not enough', () => {
    expect(looksLikeSameSong(t(1, 'Intro', '', 0), t(2, 'Intro', '', 0))).toBe(false)
    expect(looksLikeSameSong(t(1, 'Intro', 'The xx', 0), t(2, 'Intro', 'the XX', 0))).toBe(true)
    expect(looksLikeSameSong(t(1, 'Intro', '', 127), t(2, 'Intro', 'The xx', 128))).toBe(true)
  })
})

// ---- metadata extraction on real (generated) files ----

const ascii = (s: string) => [...s].map(c => c.charCodeAt(0))
const u32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const synchsafe = (n: number) => [(n >> 21) & 127, (n >> 14) & 127, (n >> 7) & 127, n & 127]
const frame = (fid: string, body: number[]) => [...ascii(fid), ...u32(body.length), 0, 0, ...body]
const text = (fid: string, s: string) => frame(fid, [0, ...ascii(s)])
const PNG_1PX = [137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6, 0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 248, 207, 192, 240, 31, 0, 5, 0, 1, 255, 137, 153, 61, 29, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130]

function mp3WithTags(): Blob {
  const frames = [
    ...text('TIT2', 'Midnight City'), ...text('TPE1', 'M83'), ...text('TALB', "Hurry Up, We're Dreaming"),
    ...text('TPE2', 'M83'), ...text('TRCK', '2/22'),
    ...frame('APIC', [0, ...ascii('image/png'), 0, 3, 0, ...PNG_1PX]),
  ]
  const header = [...ascii('ID3'), 3, 0, 0, ...synchsafe(frames.length)]
  // 50 silent MPEG-1 Layer III frames, 128 kbps @ 44.1 kHz (417 bytes each)
  const mpeg: number[] = []
  for (let i = 0; i < 50; i++) mpeg.push(0xff, 0xfb, 0x90, 0x00, ...new Array(413).fill(0))
  return new Blob([new Uint8Array([...header, ...frames, ...mpeg])], { type: 'audio/mpeg' })
}

function wav(secs: number): Blob {
  const rate = 8000, n = rate * secs
  const v = new DataView(new ArrayBuffer(44 + n))
  const s = (o: number, str: string) => [...str].forEach((c, i) => v.setUint8(o + i, c.charCodeAt(0)))
  s(0, 'RIFF'); v.setUint32(4, 36 + n, true); s(8, 'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true)
  v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, rate, true); v.setUint32(28, rate, true)
  v.setUint16(32, 1, true); v.setUint16(34, 8, true); s(36, 'data'); v.setUint32(40, n, true)
  return new Blob([v], { type: 'audio/wav' })
}

describe('metadata extraction', () => {
  it('reads ID3 tags and embedded artwork', async () => {
    const tags = await readTags(mp3WithTags(), 'whatever.mp3')
    expect(tags).toMatchObject({ title: 'Midnight City', artist: 'M83', album: "Hurry Up, We're Dreaming", albumArtist: 'M83', trackNo: 2 })
    expect(tags.picture?.format).toBe('image/png')
    expect(tags.picture?.data.length).toBe(PNG_1PX.length)
  })

  it('untagged file: duration from the container, title from the filename', async () => {
    const tags = await readTags(wav(3), '07 - Tame Impala - Let It Happen.wav')
    expect(tags).toMatchObject({ title: 'Let It Happen', artist: 'Tame Impala', picture: null })
    expect(tags.duration).toBeCloseTo(3, 1)
  })

  it('corrupted file never throws; falls back to the filename', async () => {
    const junk = new Blob([new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9])])
    await expect(readTags(junk, 'Broken Song.mp3')).resolves.toMatchObject({ title: 'Broken Song', artist: '', duration: 0 })
  })

  it('filename guesses', () => {
    expect(guessFromFilename('03. Artist Name - Song Title.flac')).toEqual({ artist: 'Artist Name', title: 'Song Title' })
    expect(guessFromFilename('just_a_title.mp3')).toEqual({ artist: '', title: 'just a title' })
    expect(guessFromFilename('.mp3')).toEqual({ artist: '', title: 'Untitled' })
  })
})
