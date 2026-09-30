// Pure pieces of the peer-to-peer file transfer (no WebRTC here, so they're unit-tested in Node).
import type { License } from '../../shared/types.ts'
import { parseLicense, parseTrackId } from '../../shared/validate.ts'

export const CHUNK = 64 * 1024
export const MAX_SIZE = 250 * 1024 * 1024

/** First message on the data channel: what's coming. Everything after it is raw file bytes. */
export interface Header {
  kind: 'header'
  trackId: string
  size: number
  license: License
}

export function parseHeader(text: string): Header | null {
  try {
    const h = JSON.parse(text)
    const trackId = parseTrackId(h?.trackId)
    const license = parseLicense(h?.license)
    if (h?.kind !== 'header' || !trackId || !license) return null
    if (!Number.isInteger(h.size) || h.size <= 0 || h.size > MAX_SIZE) return null
    return { kind: 'header', trackId, size: h.size, license }
  } catch {
    return null
  }
}

/** [start, end) byte ranges for sending a file of `size` bytes. */
export function chunkRanges(size: number, chunk = CHUNK): [number, number][] {
  const out: [number, number][] = []
  for (let at = 0; at < size; at += chunk) out.push([at, Math.min(size, at + chunk)])
  return out
}

// ---- auto-fetch planning (which shared song to get next, from whom, and when to retry) ----

export const BACKOFF_MS = [15_000, 45_000, 120_000]
export const MAX_ATTEMPTS = BACKOFF_MS.length

export interface FetchMemo { attempts: number; nextAt: number; lastPeer?: string }

/**
 * Pick the next song to fetch: current song first, then the ones after it, then earlier ones.
 * Skips songs you have, songs nobody offers, and songs waiting out a retry backoff. After a failure,
 * prefers someone other than the peer who just failed.
 */
export function planFetch(opts: {
  queue: string[] // trackIds in queue order
  currentIndex: number
  have: (trackId: string) => boolean
  offers: (trackId: string) => string[] // participant ids offering it (online, not you)
  memo: ReadonlyMap<string, FetchMemo>
  now: number
}): { trackId: string; from: string } | null {
  const { queue, have, offers, memo, now } = opts
  const start = Math.max(0, opts.currentIndex)
  const order = [...queue.slice(start), ...queue.slice(0, start)]
  const seen = new Set<string>()
  for (const trackId of order) {
    if (seen.has(trackId)) continue
    seen.add(trackId)
    if (have(trackId)) continue
    const peers = offers(trackId)
    if (!peers.length) continue
    const m = memo.get(trackId)
    if (m && (m.attempts >= MAX_ATTEMPTS || now < m.nextAt)) continue
    const from = peers.find(p => p !== m?.lastPeer) ?? peers[0]
    return { trackId, from }
  }
  return null
}

export function afterFailure(prev: FetchMemo | undefined, peer: string, now: number): FetchMemo {
  const attempts = (prev?.attempts ?? 0) + 1
  return { attempts, nextAt: now + BACKOFF_MS[Math.min(attempts, BACKOFF_MS.length) - 1], lastPeer: peer }
}

export async function sha256Id(data: Blob | ArrayBuffer): Promise<string> {
  const buf = data instanceof Blob ? await data.arrayBuffer() : data
  const digest = await crypto.subtle.digest('SHA-256', buf)
  return 'sha256:' + [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
}

/**
 * Put the received chunks back together and accept them only if they are exactly the promised
 * file: right size and the SHA-256 the room knows this song by. Anything else is discarded.
 */
export async function assembleVerified(parts: ArrayBuffer[], header: Header): Promise<Blob | null> {
  const blob = new Blob(parts)
  if (blob.size !== header.size) return null
  return (await sha256Id(blob)) === header.trackId ? blob : null
}
