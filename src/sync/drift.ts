// Decide how to correct the gap between the local <audio> playhead and the room's expected position.
// Priority is sound, not precision: listeners a few hundred ms apart is fine, a skip or warble is not.

export interface DriftConfig {
  ignore: number // s — below this, leave it alone
  settle: number // s — once correcting, keep going until inside this
  soft: number // s — up to this, change speed slightly; above, jump
  maxRate: number // fixed speed change while correcting (0.02 = ±2%, pitch preserved)
  seekCooldownMs: number // after a jump, let the element settle before judging again
  checkMs: number // how often to compare while playing
}

export const DEFAULT_DRIFT: DriftConfig = {
  ignore: 0.3, settle: 0.08, soft: 2, maxRate: 0.02, seekCooldownMs: 1500, checkMs: 1000,
}

export type Correction = { kind: 'none' } | { kind: 'rate'; rate: number } | { kind: 'seek' }

/**
 * drift = local − expected, in seconds (positive means we're ahead of the room).
 * The rate is fixed, not proportional: every playbackRate change re-primes the time-stretcher and
 * can be heard, so a correction switches speed exactly twice (on, then off).
 */
export function decide(drift: number, cfg: DriftConfig = DEFAULT_DRIFT, correcting = false): Correction {
  const a = Math.abs(drift)
  if (a < (correcting ? cfg.settle : cfg.ignore)) return { kind: 'none' }
  if (a <= cfg.soft) return { kind: 'rate', rate: 1 - Math.sign(drift) * cfg.maxRate }
  return { kind: 'seek' }
}

/**
 * Seeking an <audio> element takes a moment, so a seek aimed at "now" lands slightly behind.
 * Learn that lag from the drift measured after each seek and aim that far ahead next time.
 */
export function learnSeekLead(lead: number, driftAfterSeek: number): number {
  return Math.min(0.15, Math.max(0, lead - driftAfterSeek * 0.3))
}

const DRIFT_KEYS = Object.keys(DEFAULT_DRIFT) as (keyof DriftConfig)[]

/** Saved player prefs from before v2 carry the old, jumpy thresholds; keep only volume and delay. */
export function migratePrefs(saved: Record<string, unknown>): Record<string, unknown> {
  if (saved.v === 2) return saved
  const out: Record<string, unknown> = { ...saved, v: 2 }
  for (const k of DRIFT_KEYS) delete out[k]
  return out
}
