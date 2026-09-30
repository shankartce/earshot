import type { PlaybackState } from './types.ts'

/** Where the room's playhead is at server time `now` (ms). Used by both server and clients. */
export function positionAt(pb: PlaybackState, now: number): number {
  if (!pb.isPlaying) return pb.position
  return pb.position + Math.max(0, now - pb.serverTimestamp) / 1000
}
