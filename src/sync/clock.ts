// NTP-style clock offset estimation. The room's timeline lives on the server clock; each client
// estimates `serverTime ≈ localNow() + offset` and never trusts its own wall clock for sync.

export interface Sample { t0: number; server: number; t1: number } // local send, server reply, local receive

/** Monotonic local time in epoch ms (immune to wall-clock jumps mid-session). */
export const localNow = () => performance.timeOrigin + performance.now()

/** The sample with the smallest round trip is the least distorted by queueing delay. */
export function estimate(samples: Sample[]): { offset: number; rtt: number } | null {
  let best: Sample | null = null
  for (const s of samples) if (!best || s.t1 - s.t0 < best.t1 - best.t0) best = s
  if (!best) return null
  return { offset: best.server - (best.t0 + best.t1) / 2, rtt: best.t1 - best.t0 }
}

/**
 * Should a new estimate replace the current one? A congested sync (bigger round trip) gives a worse
 * offset, so keep the old one unless the new sample is comparably clean — or the old one is stale.
 */
export function shouldAccept(prev: { rtt: number; at: number } | null, rtt: number, now: number, maxAgeMs = 120_000): boolean {
  return !prev || rtt <= prev.rtt * 1.5 + 2 || now - prev.at > maxAgeMs
}

export class Clock {
  offset = 0
  rtt = Infinity
  synced = false
  private ping: () => Promise<number>
  private now: () => number

  constructor(ping: () => Promise<number>, now = localNow) {
    this.ping = ping
    this.now = now
  }

  serverNow() {
    return this.now() + this.offset
  }

  private acceptedAt = 0

  /** `force`: always take the new estimate (e.g. after reconnecting, the server may have restarted). */
  async sync(rounds = 5, force = false, timeoutMs = 3000) {
    const samples: Sample[] = []
    for (let i = 0; i < rounds; i++) {
      const t0 = this.now()
      const server = await Promise.race([
        this.ping(),
        new Promise<null>(r => setTimeout(() => r(null), timeoutMs)),
      ])
      if (server !== null) samples.push({ t0, server, t1: this.now() })
    }
    const est = estimate(samples)
    const prev = this.synced && !force ? { rtt: this.rtt, at: this.acceptedAt } : null
    if (est && shouldAccept(prev, est.rtt, this.now())) {
      Object.assign(this, est, { synced: true })
      this.acceptedAt = this.now()
    }
    return est
  }
}
