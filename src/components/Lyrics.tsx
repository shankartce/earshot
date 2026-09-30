// Synced lyrics, driven by the room clock (not the local <audio>), so everyone's highlight moves together —
// even for listeners who are still waiting on their file.
import { useEffect, useRef, useState } from 'preact/hooks'
import type { Track } from '../../shared/types.ts'
import { positionAt } from '../../shared/playback.ts'
import { resolveLocal, setLyrics } from '../library/library.ts'
import { lineAt, type LyricLine } from '../lyrics/lrc.ts'
import { findLyrics } from '../lyrics/lyrics.ts'
import { clock } from '../realtime/socket.ts'
import { canControl, playback, room, toast } from '../state/room.ts'
import { Icon } from './icons.tsx'
import { Empty, FileButton } from './ui.tsx'

const LEAD = 0.15 // s: light a line up a hair early, the way people read ahead

export function Lyrics({ track }: { track: Track }) {
  const local = resolveLocal(track)
  const localId = local.status === 'ready' ? local.local.id : null
  const hasLyrics = local.status === 'ready' && !!local.local.hasLyrics
  const [data, setData] = useState<{ lines: LyricLine[]; source: string } | null | 'loading'>('loading')
  const [current, setCurrent] = useState(-1)
  const box = useRef<HTMLDivElement>(null)

  useEffect(() => {
    let alive = true
    setData('loading')
    findLyrics(track).then(d => { if (alive) setData(d) })
    return () => { alive = false }
  }, [track.id, localId, hasLyrics])

  // Follow the room clock every frame; re-render only when the line changes.
  useEffect(() => {
    if (!data || data === 'loading') return
    let raf = 0
    let last = -2
    const tick = () => {
      const pb = room.value?.playback
      const i = pb ? lineAt(data.lines, positionAt(pb, clock.serverNow()) + LEAD) : -1
      if (i !== last) { last = i; setCurrent(i) }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [data])

  // Keep the current line centred (scroll only the lyrics box, never the page).
  useEffect(() => {
    const el = box.current
    const line = el?.querySelector<HTMLElement>(`[data-i="${current}"]`)
    if (!el || !line) return
    const top = line.offsetTop - el.clientHeight / 2 + line.clientHeight / 2
    el.scrollTo({ top, behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  }, [current])

  if (data === 'loading') return <div class="lyrics"><p class="muted pulse">Looking for lyrics…</p></div>

  if (!data) {
    return (
      <div class="lyrics">
        <Empty icon="lyrics" title={localId ? 'No lyrics for this song yet.' : 'Lyrics come from your own copy of this song.'}>
          {localId ? (
            <>
              <p>Add a timed <code>.lrc</code> file — it stays on your device.</p>
              <FileButton class="btn sm" multiple={false} label="Add a lyrics file" accept=".lrc,text/plain"
                onFiles={async ([f]) => {
                  await setLyrics(localId, f)
                  const d = await findLyrics(track)
                  if (!d) toast("That file doesn't have timed lyrics.", { tone: 'error' })
                }}>
                <Icon name="plus" size={16} /> Add .lrc file
              </FileButton>
            </>
          ) : <p>Once this song is on your device you can add a lyrics file for it.</p>}
        </Empty>
      </div>
    )
  }

  const seekable = canControl.value
  return (
    <div class="lyrics" ref={box} aria-label="Lyrics">
      <ol class="lyric-lines" role="list">
        {data.lines.map((l, i) => (
          <li key={i} data-i={i} class={i === current ? 'now' : i < current ? 'past' : ''} aria-current={i === current ? 'true' : undefined}>
            {seekable
              ? <button onClick={() => playback({ type: 'SEEK', position: l.time })} aria-label={`Jump to “${l.text || '♪'}”`}>{l.text || '♪'}</button>
              : <span>{l.text || '♪'}</span>}
          </li>
        ))}
      </ol>
      <p class="lyrics-source">Lyrics from {data.source}</p>
    </div>
  )
}
