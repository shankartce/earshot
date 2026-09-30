// Shared data model. Everything here is metadata — audio bytes never appear in these types.

export interface Track {
  id: string // "sha256:<64 hex>" of the audio file
  title: string
  artist: string
  album: string
  duration: number // seconds
}

export interface QueueItem {
  id: string // unique per queue entry; the same track may be queued twice
  track: Track
  addedBy: string // participant id
  addedAt: number
}

export interface QueueState {
  items: QueueItem[]
  version: number
}

export interface PlaybackState {
  itemId: string | null
  isPlaying: boolean
  position: number // seconds, as of serverTimestamp
  serverTimestamp: number // server ms when position was true
  version: number
}

export type Readiness = 'idle' | 'ready' | 'missing' | 'loading' | 'needs-tap'

export interface Avatar {
  emoji: string
  color: string // #rrggbb
}

export interface Profile {
  displayName: string
  avatar: Avatar
}

export interface Participant extends Profile {
  id: string
  isOnline: boolean
  isAway: boolean // tab hidden
  joinedAt: number
  lastSeen: number
  readiness: Readiness // for the current queue item only
}

export type Permission = 'host' | 'everyone'

export interface RoomSettings {
  playbackControl: Permission
  queueEditing: Permission
  allowChat: boolean
  allowReactions: boolean
}

export interface ChatMessage {
  id: string
  authorId: string
  text: string
  at: number
  reactions: Record<string, string[]> // emoji -> participant ids
}

export interface RoomMeta {
  name: string
  emoji: string
  hostId: string | null
}

/** Licences under which a listener may attest they can share a recording peer-to-peer. */
export const LICENSES = {
  own: 'My own music',
  'cc-by': 'CC BY',
  'cc-by-sa': 'CC BY-SA',
  'cc-by-nc': 'CC BY-NC',
  cc0: 'CC0 / Public domain',
  other: 'Other licence that allows sharing',
} as const
export type License = keyof typeof LICENSES

/** Someone online in the room who attested they may share this exact file (trackId). */
export interface ShareOffer {
  participantId: string
  license: License
}

export interface RoomSnapshot extends RoomMeta {
  code: string
  settings: RoomSettings
  participants: Participant[]
  queue: QueueState
  playback: PlaybackState
  history: Track[] // recently played, newest first
  chat: ChatMessage[]
  shares: Record<string, ShareOffer[]> // trackId -> offers (online sharers only)
  createdAt: number
  updatedAt: number
}

export const REACTIONS = ['❤️', '🔥', '😂', '😭', '✨', '🎵', '🫶'] as const
