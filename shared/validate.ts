// Payload validators for the trust boundary. Each returns a clean value or null — never throws.
import type { PlaybackCommand, QueueCommand, Signal } from './events.ts'
import type { License, Profile, Readiness, RoomSettings, Track } from './types.ts'
import { LICENSES } from './types.ts'

export const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
export const CODE_LENGTH = 5
const CODE_RE = /^[A-HJ-NP-Z2-9]{5}$/
const TRACK_ID_RE = /^sha256:[0-9a-f]{64}$/
const COLOR_RE = /^#[0-9a-f]{6}$/i
const READINESS: Readiness[] = ['idle', 'ready', 'missing', 'loading', 'needs-tap']

type Obj = Record<string, unknown>
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x)
const isNum = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
const isId = (x: unknown): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64

/** Strip control/bidi-override chars, collapse whitespace (keeps newlines if multiline), trim, cap length. */
export function cleanText(x: unknown, max: number, multiline = false): string {
  if (typeof x !== 'string') return ''
  let s = x.replace(/[‪-‮⁦-⁩]/g, '')
  s = multiline
    ? s.replace(/[\u0000-\u0009\u000B-\u001F\u007F]/g, '').replace(/\n{3,}/g, '\n\n')
    : s.replace(/[\u0000-\u001F\u007F]+/g, ' ').replace(/\s+/g, ' ')
  return [...s.trim()].slice(0, max).join('')
}

export function parseCode(x: unknown): string | null {
  const code = typeof x === 'string' ? x.trim().toUpperCase() : ''
  return CODE_RE.test(code) ? code : null
}

export function parseProfile(x: unknown): Profile | null {
  if (!isObj(x) || !isObj(x.avatar)) return null
  const displayName = cleanText(x.displayName, 24)
  const emoji = cleanText(x.avatar.emoji, 4)
  const color = typeof x.avatar.color === 'string' && COLOR_RE.test(x.avatar.color) ? x.avatar.color : null
  if (!displayName || !emoji || !color) return null
  return { displayName, avatar: { emoji, color } }
}

export function parseTrack(x: unknown): Track | null {
  if (!isObj(x) || typeof x.id !== 'string' || !TRACK_ID_RE.test(x.id)) return null
  const duration = isNum(x.duration) && x.duration >= 0 && x.duration < 86_400 ? x.duration : 0
  return {
    id: x.id,
    title: cleanText(x.title, 200) || 'Untitled',
    artist: cleanText(x.artist, 200),
    album: cleanText(x.album, 200),
    duration,
  }
}

export function parsePlaybackCommand(x: unknown): PlaybackCommand | null {
  if (!isObj(x) || !Number.isInteger(x.baseVersion)) return null
  const baseVersion = x.baseVersion as number
  switch (x.type) {
    case 'PLAY': case 'PAUSE': case 'NEXT': case 'PREVIOUS':
      return { type: x.type, baseVersion }
    case 'SEEK':
      return isNum(x.position) ? { type: 'SEEK', position: x.position, baseVersion } : null
    case 'PLAY_ITEM': case 'ENDED':
      return isId(x.itemId) ? { type: x.type, itemId: x.itemId, baseVersion } : null
  }
  return null
}

export function parseQueueCommand(x: unknown): QueueCommand | null {
  if (!isObj(x)) return null
  switch (x.type) {
    case 'ADD': {
      if (!Array.isArray(x.tracks) || x.tracks.length === 0 || x.tracks.length > 100) return null
      const tracks = x.tracks.map(parseTrack)
      return tracks.every(Boolean) ? { type: 'ADD', tracks: tracks as Track[] } : null
    }
    case 'REMOVE': case 'PLAY_NEXT':
      return isId(x.itemId) ? { type: x.type, itemId: x.itemId } : null
    case 'MOVE':
      return isId(x.itemId) && Number.isInteger(x.toIndex) && Number.isInteger(x.baseVersion)
        ? { type: 'MOVE', itemId: x.itemId, toIndex: x.toIndex as number, baseVersion: x.baseVersion as number }
        : null
    case 'CLEAR':
      return { type: 'CLEAR' }
  }
  return null
}

export function parseSettingsPatch(x: unknown): (Partial<RoomSettings> & { name?: string; emoji?: string }) | null {
  if (!isObj(x)) return null
  const out: Partial<RoomSettings> & { name?: string; emoji?: string } = {}
  for (const k of ['playbackControl', 'queueEditing'] as const) {
    if (x[k] === 'host' || x[k] === 'everyone') out[k] = x[k]
  }
  for (const k of ['allowChat', 'allowReactions'] as const) {
    if (typeof x[k] === 'boolean') out[k] = x[k]
  }
  if (x.name !== undefined) out.name = cleanText(x.name, 40) || 'Listening room'
  if (x.emoji !== undefined) out.emoji = cleanText(x.emoji, 4)
  return out
}

export const parseTrackId = (x: unknown): string | null => (typeof x === 'string' && TRACK_ID_RE.test(x) ? x : null)

export const parseLicense = (x: unknown): License | null =>
  typeof x === 'string' && Object.hasOwn(LICENSES, x) ? (x as License) : null

const MAX_SDP = 16 * 1024
const MAX_CANDIDATE = 1024

/** WebRTC handshake messages: known types only, bounded sizes, nothing extra passed through. */
export function parseSignal(x: unknown): Signal | null {
  if (!isObj(x) || !isId(x.transferId)) return null
  const transferId = x.transferId
  switch (x.type) {
    case 'request': {
      const trackId = parseTrackId(x.trackId)
      return trackId ? { type: 'request', transferId, trackId } : null
    }
    case 'offer': case 'answer':
      return typeof x.sdp === 'string' && x.sdp.length > 0 && x.sdp.length <= MAX_SDP ? { type: x.type, transferId, sdp: x.sdp } : null
    case 'ice': {
      const c = x.candidate
      if (!isObj(c) || typeof c.candidate !== 'string' || c.candidate.length > MAX_CANDIDATE) return null
      const sdpMid = typeof c.sdpMid === 'string' && c.sdpMid.length <= 64 ? c.sdpMid : null
      const sdpMLineIndex = Number.isInteger(c.sdpMLineIndex) ? (c.sdpMLineIndex as number) : null
      return { type: 'ice', transferId, candidate: { candidate: c.candidate, sdpMid, sdpMLineIndex } }
    }
    case 'reject':
      return x.reason === 'busy' || x.reason === 'unavailable' || x.reason === 'failed' ? { type: 'reject', transferId, reason: x.reason } : null
  }
  return null
}

export const parseReadiness = (x: unknown): Readiness | null =>
  READINESS.includes(x as Readiness) ? (x as Readiness) : null

// One emoji: pictographs plus the joiners/modifiers/flags that build them. No letters, markup or text.
const EMOJI_RE = /^(?:\p{Extended_Pictographic}|\p{Emoji_Component})+$/u // components include ZWJ, VS16, skin tones, flags
const PICTO_RE = /\p{Extended_Pictographic}|\p{Regional_Indicator}/u

/** Any single emoji (👍🏽, ❤️‍🔥, 🇮🇳 …), up to 16 UTF-16 units. Keycaps and bare digits/#/* are refused. */
export const parseReaction = (x: unknown): string | null =>
  typeof x === 'string' && x.length <= 16 && EMOJI_RE.test(x) && PICTO_RE.test(x) && !/[#*0-9]/.test(x) ? x : null

/** chat:send payload: the original bare string, or `{ text, replyTo }`. */
export function parseChatSend(x: unknown): { text: string; replyTo?: string } | null {
  if (typeof x === 'string') return { text: cleanText(x, 500, true) }
  if (!isObj(x)) return null
  return { text: cleanText(x.text, 500, true), ...(isId(x.replyTo) ? { replyTo: x.replyTo } : {}) }
}
