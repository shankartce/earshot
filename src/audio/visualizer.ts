// Visualizer drawing. Audio analysis happens only in this browser (AnalyserNode); nothing is sent anywhere.
import { signal } from '@preact/signals'

export type VizStyle = 'off' | 'bars' | 'wave' | 'radial' | 'glow'
export const VIZ_LABELS: Record<VizStyle, string> = { off: 'Off', bars: 'Bars', wave: 'Waveform', radial: 'Ring', glow: 'Glow' }

const saved = (() => { try { return localStorage.getItem('jam:viz') as VizStyle | null } catch { return null } })()
export const vizStyle = signal<VizStyle>(saved && saved in VIZ_LABELS ? saved : 'radial')
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

export const energy = (freq: Uint8Array) => bands(freq, 8).slice(0, 3).reduce((a, b) => a + b, 0) / 3

function gradient(g: CanvasRenderingContext2D, w: number, h: number) {
  const grad = g.createLinearGradient(0, h, w, 0)
  grad.addColorStop(0, '#ffb454')
  grad.addColorStop(0.5, '#ff7a59')
  grad.addColorStop(1, '#f25f8e')
  return grad
}

export function drawBars(g: CanvasRenderingContext2D, w: number, h: number, f: Frame) {
  const n = 40
  const lv = bands(f.freq, n)
  const gap = w / n
  const bw = gap * 0.58
  g.fillStyle = gradient(g, w, h)
  lv.forEach((v, i) => {
    const bh = Math.max(3, v * h * 0.95)
    g.beginPath()
    g.roundRect(i * gap + (gap - bw) / 2, h - bh, bw, bh, bw / 2)
    g.fill()
  })
}

export function drawWave(g: CanvasRenderingContext2D, w: number, h: number, f: Frame) {
  g.lineWidth = Math.max(2, h / 22)
  g.lineCap = 'round'
  g.strokeStyle = gradient(g, w, h)
  g.beginPath()
  const n = f.wave.length
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * w
    const y = h / 2 + ((f.wave[i] - 128) / 128) * h * 0.9
    i ? g.lineTo(x, y) : g.moveTo(x, y)
  }
  g.stroke()
}

/** Bars radiating from a ring just outside the artwork. */
export function drawRing(g: CanvasRenderingContext2D, w: number, h: number, f: Frame, inner: number) {
  const n = 72
  const lv = bands(f.freq, n / 2)
  const cx = w / 2
  const cy = h / 2
  const room = Math.min(w, h) / 2 - inner
  g.lineCap = 'round'
  g.lineWidth = Math.max(2, (2 * Math.PI * inner) / n * 0.42)
  g.strokeStyle = gradient(g, w, h)
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
