// Music visuals: Ambient (a soft full-screen colour wash behind everything) or a Ring hugging the
// cover, plus the small tools on the cover's corner (lyrics, visual style).
import { useEffect, useRef, useState } from 'preact/hooks'
import { enableAnalyser, getAnalyser, readiness } from '../audio/player.ts'
import { drawAmbient, drawRing, idleFrame, setVizStyle, VIZ_LABELS, vizStyle, type Frame, type VizStyle } from '../audio/visualizer.ts'
import { room, shownPlaying } from '../state/room.ts'
import { songHues } from '../state/theme.ts'
import { stageView } from '../state/ui.ts'
import { Icon } from './icons.tsx'

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// The analyser needs a user gesture to start; any tap in the room will do.
const kick = () => { if (vizStyle.value !== 'off' && room.value) enableAnalyser() }
document.addEventListener('pointerdown', kick, true)
document.addEventListener('keydown', kick, true)

const freq = new Uint8Array(512)
const wave = new Uint8Array(512)
/** This frame's levels: the real analyser when we have one, else a gentle stand-in. */
function frameAt(t: number): Frame {
  const playing = shownPlaying.value
  const an = playing && readiness.value === 'ready' ? getAnalyser() : null
  if (!an) return idleFrame(t / 1000, playing)
  an.getByteFrequencyData(freq)
  an.getByteTimeDomainData(wave)
  return { freq, wave }
}

/**
 * Draw into a canvas every frame while it's on screen (at most `fps`), sized to its box × `scale`.
 * Reduced motion: one still frame, redrawn on resize.
 */
function useCanvas(draw: (g: CanvasRenderingContext2D, w: number, h: number, t: number) => void, { scale = 1, fps = 60 } = {}) {
  const ref = useRef<HTMLCanvasElement>(null)
  const drawRef = useRef(draw)
  drawRef.current = draw
  useEffect(() => {
    const canvas = ref.current
    if (!canvas) return
    const g = canvas.getContext('2d')!
    const still = reducedMotion()
    let raf = 0
    let last = 0
    const paint = (t: number) => drawRef.current(g, canvas.width, canvas.height, t)
    const fit = () => {
      const dpr = Math.min(2, devicePixelRatio || 1) * scale
      canvas.width = Math.max(1, Math.round(canvas.clientWidth * dpr)) // resizing clears the canvas…
      canvas.height = Math.max(1, Math.round(canvas.clientHeight * dpr))
      if (still) paint(0) // …so a still frame must be redrawn
    }
    const loop = (t: number) => {
      if (t - last >= 1000 / fps - 2) { last = t; paint(t) }
      raf = requestAnimationFrame(loop)
    }
    const ro = new ResizeObserver(fit)
    ro.observe(canvas)
    fit()
    // Only animate while on screen: a hidden or scrolled-away canvas costs nothing.
    const io = new IntersectionObserver(([e]) => {
      cancelAnimationFrame(raf)
      if (e.isIntersecting && !still) raf = requestAnimationFrame(loop)
    })
    io.observe(canvas)
    return () => { cancelAnimationFrame(raf); ro.disconnect(); io.disconnect() }
  }, [])
  return ref
}

/** Bars radiating from just outside the cover, in the song's colours. */
export function RingVisualizer() {
  const ref = useCanvas((g, w, h, t) => {
    g.clearRect(0, 0, w, h)
    drawRing(g, w, h, frameAt(t), Math.min(w, h) * 0.385, songHues.value)
  })
  return <canvas ref={ref} class="viz viz-ring" aria-hidden="true" />
}

/** A soft, full-screen wash in the song's colours that swells with the music. */
export function Ambient() {
  const ref = useCanvas((g, w, h, t) => drawAmbient(g, w, h, frameAt(t), t / 1000, songHues.value), { scale: 1 / 8, fps: 30 })
  return <canvas ref={ref} class="ambient" aria-hidden="true" />
}

/** Lyrics and visual-style buttons, pinned to the cover's (or the lyrics') top-right corner. */
export function CoverTools({ hasTrack }: { hasTrack: boolean }) {
  const lyrics = stageView.value === 'lyrics'
  const [menu, setMenu] = useState(false)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (!menu) return
    const off = (e: Event) => { if (!box.current?.contains(e.target as Node)) setMenu(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setMenu(false) }
    document.addEventListener('pointerdown', off, true)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', esc) }
  }, [menu])
  return (
    <div class="cover-tools" ref={box}>
      <button class={`cover-btn${lyrics ? ' on' : ''}`} aria-pressed={lyrics} disabled={!hasTrack} aria-label="Lyrics" title="Lyrics"
        onClick={() => { stageView.value = lyrics ? 'art' : 'lyrics' }}>
        <Icon name="lyrics" size={18} />
      </button>
      <button class={`cover-btn${menu ? ' on' : ''}`} aria-haspopup="menu" aria-expanded={menu} aria-label={`Visuals: ${VIZ_LABELS[vizStyle.value]}`} title="Visuals"
        onClick={() => setMenu(!menu)}>
        <Icon name="wave" size={18} />
      </button>
      {menu && (
        <div class="cover-menu" role="menu" aria-label="Visuals">
          {(Object.keys(VIZ_LABELS) as VizStyle[]).map(k => (
            <button key={k} role="menuitemradio" aria-checked={vizStyle.value === k} class={vizStyle.value === k ? 'on' : ''}
              onClick={() => { setVizStyle(k); enableAnalyser(); setMenu(false) }}>
              {VIZ_LABELS[k]} {vizStyle.value === k && <Icon name="check" size={16} />}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
