// Canvas visualizer + the small stage toolbar (visualizer style, lyrics toggle).
import { useEffect, useRef } from 'preact/hooks'
import { enableAnalyser, getAnalyser, readiness } from '../audio/player.ts'
import {
  drawBars, drawRing, drawWave, energy, idleFrame, setVizStyle, VIZ_LABELS, vizStyle, type Frame, type VizStyle,
} from '../audio/visualizer.ts'
import { room } from '../state/room.ts'
import { stageView } from '../state/ui.ts'
import { Icon } from './icons.tsx'

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches

// The analyser needs a user gesture to start; any tap in the room will do.
const kick = () => { if (vizStyle.value !== 'off' && room.value) enableAnalyser() }
document.addEventListener('pointerdown', kick, true)
document.addEventListener('keydown', kick, true)

/** placement "ring" draws around the artwork (Ring / Glow); "strip" draws under it (Bars / Waveform). */
export function Visualizer({ placement }: { placement: 'ring' | 'strip' }) {
  const style = vizStyle.value
  const active = placement === 'ring' ? style === 'radial' || style === 'glow' : style === 'bars' || style === 'wave'
  const ref = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = ref.current
    if (!active || !canvas) return
    const g = canvas.getContext('2d')!
    const host = canvas.parentElement!
    const freq = new Uint8Array(512)
    const wave = new Uint8Array(512)
    let raf = 0

    const still = reducedMotion()
    const fit = () => {
      const dpr = Math.min(2, devicePixelRatio || 1)
      canvas.width = Math.round(canvas.clientWidth * dpr) // resizing clears the canvas…
      canvas.height = Math.round(canvas.clientHeight * dpr)
      if (still) frame(0) // …so a reduced-motion still frame must be redrawn
    }
    const ro = new ResizeObserver(fit)

    const frame = (t: number) => {
      const playing = !!room.value?.playback.isPlaying
      const an = playing && readiness.value === 'ready' ? getAnalyser() : null
      let f: Frame
      if (an) {
        an.getByteFrequencyData(freq)
        an.getByteTimeDomainData(wave)
        f = { freq, wave }
      } else f = idleFrame(t / 1000, playing)

      const { width: w, height: h } = canvas
      g.clearRect(0, 0, w, h)
      if (style === 'bars') drawBars(g, w, h, f)
      else if (style === 'wave') drawWave(g, w, h, f)
      else if (style === 'radial') drawRing(g, w, h, f, Math.min(w, h) * 0.36)
      if (style === 'glow') host.style.setProperty('--energy', energy(f.freq).toFixed(2)) // only Glow's CSS reads it
    }

    ro.observe(canvas)
    fit()
    // Draw only while on screen: a scrolled-away visualizer still repainting every frame makes phones stutter.
    const loop = (t: number) => { frame(t); raf = requestAnimationFrame(loop) }
    const io = new IntersectionObserver(([e]) => {
      cancelAnimationFrame(raf)
      if (e.isIntersecting && !still) raf = requestAnimationFrame(loop)
    })
    io.observe(canvas)
    return () => {
      cancelAnimationFrame(raf)
      ro.disconnect()
      io.disconnect()
      host.style.removeProperty('--energy')
    }
  }, [active, style])

  if (!active) return null
  return <canvas ref={ref} class={`viz viz-${placement}`} aria-hidden="true" />
}

export function StageTools({ hasTrack }: { hasTrack: boolean }) {
  const lyrics = stageView.value === 'lyrics'
  return (
    <div class="stage-tools">
      <label class="tool-select">
        <Icon name="wave" size={16} />
        <span class="sr-only">Visualizer</span>
        <select value={vizStyle.value} aria-label="Visualizer style"
          onChange={e => { setVizStyle(e.currentTarget.value as VizStyle); enableAnalyser() }}>
          {(Object.keys(VIZ_LABELS) as VizStyle[]).map(k => <option key={k} value={k}>{VIZ_LABELS[k]}</option>)}
        </select>
      </label>
      <button class={`tool-btn${lyrics ? ' on' : ''}`} aria-pressed={lyrics} disabled={!hasTrack}
        onClick={() => { stageView.value = lyrics ? 'art' : 'lyrics' }}>
        <Icon name="lyrics" size={16} /> Lyrics
      </button>
    </div>
  )
}
