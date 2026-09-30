// Token bucket per event class. One limiter per socket.
export type Rules = Record<string, [capacity: number, perMs: number]>

export const RULES: Rules = {
  chat: [5, 5_000],
  reaction: [10, 5_000],
  control: [10, 1_000],
  queue: [20, 5_000],
  typing: [1, 1_000],
  join: [5, 10_000],
  signal: [60, 10_000], // WebRTC handshake messages (ICE candidates come in bursts)
  share: [100, 10_000], // tiny metadata messages; clients reconcile against server state
}

export function rateLimiter(rules: Rules = RULES) {
  const buckets = new Map<string, { tokens: number; at: number }>()
  return (key: string, now = Date.now()): boolean => {
    const [cap, per] = rules[key]
    const b = buckets.get(key) ?? { tokens: cap, at: now }
    b.tokens = Math.min(cap, b.tokens + ((now - b.at) * cap) / per)
    b.at = now
    buckets.set(key, b)
    if (b.tokens < 1) return false
    b.tokens--
    return true
  }
}
