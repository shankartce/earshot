// Visualizer drawing. Audio analysis happens only in this browser (AnalyserNode); nothing is sent anywhere.
import { signal } from '@preact/signals'

export type VizStyle = 'ambient' | 'radial' | 'off'
export const VIZ_LABELS: Record<VizStyle, string> = { ambient: 'Ambient', radial: 'Ring', off: 'Off' }

/** Older saved styles (bars, waveform, glow) became Ambient; anything unknown does too. */
export const normalizeViz = (x: unknown): VizStyle => (x === 'radial' || x === 'off' ? x : 'ambient')

const saved = (() => { try { return localStorage.getItem('jam:viz') } catch { return null } })()
export const vizStyle = signal<VizStyle>(normalizeViz(saved))
export function setVizStyle(v: VizStyle) {
  vizStyle.value = v
  try { localStorage.setItem('jam:viz', v) } catch { /* ignore */ }
}

export interface Frame {
  freq: Uint8Array // 0..255 per bin
  wave: Uint8Array // 0..255, 128 = silence
}

/** Stand-in levels when there's no live audio: a slow, gentle breathing so the room never looks dead. */
export function idleFrame(t: number, playing: boolean, bins = 128): Frame {
  const speed = playing ? 1 : 0.25
  const amp = playing ? 70 : 28
  const freq = new Uint8Array(bins)
  const wave = new Uint8Array(bins)
  for (let i = 0; i < bins; i++) {
    const x = i / bins
    freq[i] = Math.max(0, amp * (1 - x) * (0.55 + 0.45 * Math.sin(t * 1.3 * speed + i * 0.35)) + 12)
    wave[i] = 128 + (amp / 5) * Math.sin(t * 2 * speed + x * Math.PI * 4)
  }
  return { freq, wave }
}

/** Log-spaced band levels (0..1), so bass doesn't hog every bar. */
export function bands(freq: Uint8Array, count: number): number[] {
  const out: number[] = []
  const max = freq.length * 0.72 // top of the spectrum is mostly empty for music
  for (let b = 0; b < count; b++) {
    const lo = Math.floor(Math.pow(max, b / count))
    const hi = Math.max(lo + 1, Math.floor(Math.pow(max, (b + 1) / count)))
    let sum = 0
    for (let i = lo; i < hi; i++) sum += freq[i] ?? 0
    out.push(sum / (hi - lo) / 255)
  }
  return out
}


/** A gradient in the song's colours. */
function gradient(g: CanvasRenderingContext2D, w: number, h: number, [h1, h2]: [number, number]) {
  const grad = g.createLinearGradient(0, h, w, 0)
  grad.addColorStop(0, `hsl(${h1 + 28} 90% 66%)`)
  grad.addColorStop(0.5, `hsl(${h1} 85% 64%)`)
  grad.addColorStop(1, `hsl(${h2} 80% 64%)`)
  return grad
}

/** Bars radiating from a ring just outside the artwork. */
export function drawRing(g: CanvasRenderingContext2D, w: number, h: number, f: Frame, inner: number, hues: [number, number]) {
  const n = 72
  const lv = bands(f.freq, n / 2)
  const cx = w / 2
  const cy = h / 2
  const room = Math.min(w, h) / 2 - inner
  g.lineCap = 'round'
  g.lineWidth = Math.max(1.5, (2 * Math.PI * inner) / n * 0.3)
  g.strokeStyle = gradient(g, w, h, hues)
  for (let i = 0; i < n; i++) {
    const v = lv[i < n / 2 ? i : n - 1 - i] // mirror so the ring is symmetric
    const a = (i / n) * Math.PI * 2 - Math.PI / 2
    const len = 4 + v * room * 0.95
    g.globalAlpha = 0.35 + v * 0.65
    g.beginPath()
    g.moveTo(cx + Math.cos(a) * inner, cy + Math.sin(a) * inner)
    g.lineTo(cx + Math.cos(a) * (inner + len), cy + Math.sin(a) * (inner + len))
    g.stroke()
  }
  g.globalAlpha = 1
}

/**
 * Ambient: three big soft blobs in the song's colours that drift slowly and swell with the music.
 * Drawn on a tiny canvas that CSS scales up to the whole screen, which blurs it for free.
 */
export function drawAmbient(g: CanvasRenderingContext2D, w: number, h: number, f: Frame, t: number, [h1, h2]: [number, number]) {
  const lv = bands(f.freq, 8)
  const avg = (from: number, to: number) => lv.slice(from, to).reduce((a, x) => a + x, 0) / (to - from)
  const [bass, mid, high] = [avg(0, 2), avg(2, 5), avg(5, 8)]
  g.clearRect(0, 0, w, h)
  const m = Math.max(w, h)
  const blob = (x: number, y: number, r: number, hue: number, alpha: number) => {
    const grad = g.createRadialGradient(x, y, 0, x, y, r)
    grad.addColorStop(0, `hsl(${hue} 80% 55% / ${alpha})`)
    grad.addColorStop(1, `hsl(${hue} 80% 55% / 0)`)
    g.fillStyle = grad
    g.fillRect(0, 0, w, h)
  }
  blob(w * (0.22 + 0.06 * Math.sin(t * 0.13)), h * (0.18 + 0.05 * Math.cos(t * 0.11)), m * (0.55 + bass * 0.35), h1, 0.34 + bass * 0.36)
  blob(w * (0.82 + 0.05 * Math.cos(t * 0.09)), h * (0.78 + 0.06 * Math.sin(t * 0.12)), m * (0.5 + mid * 0.3), h2, 0.28 + mid * 0.3)
  blob(w * (0.6 + 0.1 * Math.sin(t * 0.07)), h * (0.42 + 0.08 * Math.cos(t * 0.08)), m * (0.32 + high * 0.25), (h1 + h2) / 2, 0.12 + high * 0.25)
}
