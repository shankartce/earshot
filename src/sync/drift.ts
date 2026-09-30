// Decide how to correct the gap between the local <audio> playhead and the room's expected position.

export interface DriftConfig {
  ignore: number // s — below this, leave it alone
  soft: number // s — up to this, nudge playbackRate; above, hard-seek
  maxRate: number // max playbackRate deviation (0.05 = ±5%, inaudible with preservesPitch)
  gain: number // rate deviation per second of drift
  seekCooldownMs: number // after a hard seek, let the element settle before judging again
  checkMs: number // how often to compare while playing
}

export const DEFAULT_DRIFT: DriftConfig = {
  ignore: 0.05, soft: 0.25, maxRate: 0.05, gain: 0.5, seekCooldownMs: 1500, checkMs: 1000,
}

export type Correction = { kind: 'none' } | { kind: 'rate'; rate: number } | { kind: 'seek' }

/** drift = local − expected, in seconds (positive means we're ahead of the room). */
export function decide(drift: number, cfg: DriftConfig = DEFAULT_DRIFT): Correction {
  const a = Math.abs(drift)
  if (a < cfg.ignore) return { kind: 'none' }
  if (a <= cfg.soft) return { kind: 'rate', rate: 1 - Math.sign(drift) * Math.min(cfg.maxRate, a * cfg.gain) }
  return { kind: 'seek' }
}
