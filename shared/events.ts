import type {
  ChatMessage, License, Participant, PlaybackState, Profile, QueueState, Readiness, RoomMeta,
  RoomSettings, RoomSnapshot, Track,
} from './types.ts'

export type PlaybackCommand = { baseVersion: number } & (
  | { type: 'PLAY' }
  | { type: 'PAUSE' }
  | { type: 'SEEK'; position: number }
  | { type: 'NEXT' }
  | { type: 'PREVIOUS' }
  | { type: 'PLAY_ITEM'; itemId: string }
  | { type: 'ENDED'; itemId: string }
)

export type QueueCommand =
  | { type: 'ADD'; tracks: Track[] }
  | { type: 'REMOVE'; itemId: string }
  | { type: 'MOVE'; itemId: string; toIndex: number; baseVersion: number }
  | { type: 'PLAY_NEXT'; itemId: string }
  | { type: 'CLEAR' }

/**
 * WebRTC handshake for peer-to-peer sharing of attested tracks. The server relays these messages
 * between two members of a room; the audio itself flows browser-to-browser over a DataChannel.
 */
export type Signal =
  | { type: 'request'; transferId: string; trackId: string } // receiver → sharer (server checks the offer exists)
  | { type: 'offer'; transferId: string; sdp: string } // sharer → receiver
  | { type: 'answer'; transferId: string; sdp: string } // receiver → sharer
  | { type: 'ice'; transferId: string; candidate: { candidate: string; sdpMid: string | null; sdpMLineIndex: number | null } }
  | { type: 'reject'; transferId: string; reason: 'busy' | 'unavailable' | 'failed' }

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: string }

export interface Joined {
  code: string
  token: string // secret; restores identity on reconnect
  you: string // your participant id
  state: RoomSnapshot
}

/** Public preview of a room, shown before joining. */
export interface RoomPeek {
  name: string
  emoji: string
  online: Profile[]
}

export interface RoomPatch {
  playback?: PlaybackState
  queue?: QueueState
  settings?: RoomSettings
  participants?: Participant[]
  meta?: RoomMeta
  history?: Track[]
  shares?: RoomSnapshot['shares']
}

export interface ClientToServer {
  'clock:ping': (reply: (serverNow: number) => void) => void
  'room:create': (p: { name: string; emoji: string; profile: Profile }, reply: (r: Ack<Joined>) => void) => void
  'room:join': (p: { code: string; token?: string; profile: Profile }, reply: (r: Ack<Joined>) => void) => void
  'room:peek': (code: string, reply: (r: Ack<RoomPeek>) => void) => void
  'room:leave': () => void
  'room:settings': (p: Partial<RoomSettings> & { name?: string; emoji?: string }, reply: (r: Ack) => void) => void
  'playback:command': (cmd: PlaybackCommand, reply: (r: Ack) => void) => void
  'queue:command': (cmd: QueueCommand, reply: (r: Ack) => void) => void
  'status:update': (p: { readiness: Readiness; isAway: boolean }) => void
  'chat:send': (p: string | { text: string; replyTo?: string }, reply: (r: Ack) => void) => void
  'chat:seen': (messageId: string) => void
  'chat:typing': () => void
  'chat:react': (p: { messageId: string; emoji: string }) => void
  'reaction:send': (emoji: string) => void
  'profile:update': (profile: Profile, reply: (r: Ack) => void) => void
  'participant:host': (participantId: string, reply: (r: Ack) => void) => void
  'participant:remove': (participantId: string, reply: (r: Ack) => void) => void
  'share:offer': (p: { trackId: string; license: License }) => void
  'share:withdraw': (trackId: string) => void
  'rtc:signal': (p: { to: string; data: Signal }) => void
  /** Whether this server has an AI model configured (the host still has to turn the DJ on per room). */
  'ai:status': (reply: (r: { available: boolean }) => void) => void
  /** Opt-in: your library's song details (never audio), so the room DJ can pick songs people own. [] clears. */
  'ai:catalog': (tracks: Track[]) => void
  /** Build a playlist from your own library for a mood. The list is used for this request only. */
  'ai:playlist': (p: { prompt: string; tracks: Track[] }, reply: (r: Ack<{ name: string; trackIds: string[] }>) => void) => void
}

export interface ServerToClient {
  'room:state': (s: RoomSnapshot) => void
  'room:patch': (p: RoomPatch) => void
  'presence:joined': (p: Participant) => void
  'presence:left': (p: Participant) => void
  'chat:message': (m: ChatMessage) => void
  'chat:reactions': (p: { messageId: string; reactions: ChatMessage['reactions'] }) => void
  'chat:typing': (participantId: string) => void
  'reaction': (p: { participantId: string; emoji: string; at: number }) => void
  'rtc:signal': (p: { from: string; data: Signal }) => void
  'room:removed': () => void // the host removed you; your token no longer works
  'ai:error': (text: string) => void // to the person whose @DJ request didn't work out
}
