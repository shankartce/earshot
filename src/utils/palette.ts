// The room takes on the current song's colours: the two strongest hues in its artwork.

/**
 * Two dominant, distinct hues (degrees) from RGBA pixels, or null when the image is basically grey.
 * Only reasonably saturated, mid-light pixels vote, weighted by saturation, so a big white or black
 * background doesn't drown out the actual colours.
 */
export function dominantHues(px: Uint8ClampedArray, bins = 24): [number, number] | null {
  const votes = new Float64Array(bins)
  const sums = new Float64Array(bins) // to average the exact hue inside each bin
  let total = 0
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] < 128) continue
    const r = px[i] / 255, g = px[i + 1] / 255, b = px[i + 2] / 255
    const max = Math.max(r, g, b), min = Math.min(r, g, b)
    const l = (max + min) / 2
    const d = max - min
    if (d < 0.08 || l < 0.12 || l > 0.92) continue
    const s = d / (1 - Math.abs(2 * l - 1))
    if (s < 0.25) continue
    let h = max === r ? ((g - b) / d) % 6 : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h = (h * 60 + 360) % 360
    const bin = Math.floor(h / (360 / bins)) % bins
    votes[bin] += s
    sums[bin] += h * s
    total += s
  }
  if (total < px.length / 4 * 0.04) return null // under ~4% colourful pixels: treat as grey
  const order = [...votes.keys()].sort((a, b) => votes[b] - votes[a])
  const hue = (bin: number) => Math.round(sums[bin] / votes[bin])
  const first = order[0]
  // second: the strongest bin at least 3 bins (45°) away; else a gentle neighbour of the first
  const far = order.find(b => votes[b] > 0 && Math.min(Math.abs(b - first), bins - Math.abs(b - first)) >= 3)
  return [hue(first), far !== undefined ? hue(far) : (hue(first) + 40) % 360]
}

const cache = new Map<string, Promise<[number, number] | null>>()

/** Dominant hues of an image URL (our own blob: thumbnails), cached per URL. */
export function artHues(url: string): Promise<[number, number] | null> {
  let p = cache.get(url)
  if (!p) {
    p = new Promise(resolve => {
      const img = new Image()
      img.onload = () => {
        try {
          const c = document.createElement('canvas')
          c.width = c.height = 32
          const g = c.getContext('2d', { willReadFrequently: true })!
          g.drawImage(img, 0, 0, 32, 32)
          resolve(dominantHues(g.getImageData(0, 0, 32, 32).data))
        } catch { resolve(null) }
      }
      img.onerror = () => resolve(null)
      img.src = url
    })
    cache.set(url, p)
  }
  return p
}
