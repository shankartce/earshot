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
