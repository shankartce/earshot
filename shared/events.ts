import type {
  ChatMessage, Participant, PlaybackState, Profile, QueueState, Readiness, RoomMeta,
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

export type Ack<T = object> = ({ ok: true } & T) | { ok: false; error: string }

export interface Joined {
  code: string
  token: string // secret; restores identity on reconnect
  you: string // your participant id
  state: RoomSnapshot
}

export interface RoomPatch {
  playback?: PlaybackState
  queue?: QueueState
  settings?: RoomSettings
  participants?: Participant[]
  meta?: RoomMeta
  history?: Track[]
}

export interface ClientToServer {
  'clock:ping': (reply: (serverNow: number) => void) => void
  'room:create': (p: { name: string; emoji: string; profile: Profile }, reply: (r: Ack<Joined>) => void) => void
  'room:join': (p: { code: string; token?: string; profile: Profile }, reply: (r: Ack<Joined>) => void) => void
  'room:leave': () => void
  'room:settings': (p: Partial<RoomSettings> & { name?: string; emoji?: string }, reply: (r: Ack) => void) => void
  'playback:command': (cmd: PlaybackCommand, reply: (r: Ack) => void) => void
  'queue:command': (cmd: QueueCommand, reply: (r: Ack) => void) => void
  'status:update': (p: { readiness: Readiness; isAway: boolean }) => void
  'chat:send': (text: string, reply: (r: Ack) => void) => void
  'chat:typing': () => void
  'chat:react': (p: { messageId: string; emoji: string }) => void
  'reaction:send': (emoji: string) => void
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
}
