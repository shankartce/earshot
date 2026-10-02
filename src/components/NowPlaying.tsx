// The stage: artwork, song info, progress, transport controls, and the local-readiness state.
import { useEffect, useRef, useState } from 'preact/hooks'
import { heldHere, isIOS, mutedHere, prefs, readiness, roomPosition, setPrefs, syncStatus, tuneIn, unlockAudio, unplayable } from '../audio/player.ts'
import { vizStyle } from '../audio/visualizer.ts'
import { mobileTab, stageView, transition } from '../state/ui.ts'
import { LICENSES, type ShareOffer, type Track } from '../../shared/types.ts'
import { autoFetch, bestOffer, isActive, offersFor, receiving, requestCopy } from '../share/p2p.ts'
import { Lyrics } from './Lyrics.tsx'
import { CoverTools, RingVisualizer } from './Visualizer.tsx'
import { songHues } from '../state/theme.ts'
import { artUrls, confirmMatch, importFiles, rejectMatch, resolveLocal } from '../library/library.ts'
import { reportImport } from '../state/actions.ts'
import { canControl, currentItem, mayControl, optimisticPlaying, participantById, playback, room, shownPlaying, toast, togglePlay } from '../state/room.ts'
import { fmtTime } from '../utils/format.ts'
import { Icon } from './icons.tsx'
import { ReactionBar } from './Reactions.tsx'
import { Avatar, Cover, Equalizer, FileButton } from './ui.tsx'

export function NowPlaying() {
  const r = room.value!
  const item = currentItem.value
  const t = item?.track
  const addedBy = item && participantById(item.addedBy)
  const local = t ? resolveLocal(t) : null
  const art = local?.status === 'ready' ? artUrls.value.get(local.local.id) : null
  const showLyrics = stageView.value === 'lyrics' && !!t
  const swipe = useSwipe(showLyrics) // the artwork remounts when lyrics toggle
  const playing = shownPlaying.value

  return (
    <section class={`stage${playing ? ' is-playing' : ''} viz-${vizStyle.value}${showLyrics ? ' with-lyrics' : ''}`} aria-label="Now playing">
      {showLyrics ? (
        <div class="lyrics-wrap">
          <CoverTools hasTrack={!!t} />
          <Lyrics track={t} />
        </div>
      ) : (
        <div class="art-wrap" ref={swipe}>
          {vizStyle.value === 'radial' && <RingVisualizer key={songHues.value.join()} />}
          <div class="vinyl" aria-hidden="true" />
          <Cover id={t?.id} art={art} class="art" key={t?.id} />
          <CoverTools hasTrack={!!t} />
        </div>
      )}

      <div class="np-meta">
        <p class="eyebrow np-state">
          {item ? playing ? <><Equalizer /> Playing together</> : 'Paused' : 'Nothing playing yet'}
        </p>
        <h2 class="np-title" key={t?.id}>{t?.title ?? 'Pick something to play'}</h2>
        <p class="np-artist">
          {t ? [t.artist || 'Unknown artist', t.album].filter(Boolean).join(' · ') : 'Add songs from your device to the queue.'}
        </p>
        {addedBy && <p class="np-added"><Avatar avatar={addedBy.avatar} size={18} /> Added by {addedBy.displayName}</p>}
      </div>

      <Readiness />
      {item && <Progress />}
      {syncStatus.value === 'catching-up' && readiness.value === 'ready' && <CatchingUp />}
      <Controls />
      <UpNext />
      <ReactionBar />
      {!isIOS && <Volume />}
    </section>
  )
}

function Readiness() {
  const item = currentItem.value
  const state = readiness.value
  if (!item) return null

  if (state === 'needs-tap') {
    return heldHere.value ? (
      <div class="banner accent">
        <button class="btn primary big" onClick={tuneIn}><Icon name="play" /> Resume listening</button>
        <p class="muted small">Paused on this device (headphones, a call or another app). The room kept playing.</p>
      </div>
    ) : (
      <div class="banner accent">
        <button class="btn primary big" onClick={tuneIn}><Icon name="tap" /> Tap to tune in</button>
        <p class="muted small">Your browser needs one tap before it can play audio.</p>
      </div>
    )
  }
  if (mutedHere.value && state === 'ready') {
    return (
      <p class="banner quiet" role="status">
        Muted on this device · <button class="link-btn" onClick={() => { mutedHere.value = false }}>Unmute</button>
      </p>
    )
  }
  if (state === 'missing' && unplayable.value) {
    return (
      <div class="banner warn" role="status">
        <Icon name="warn" />
        <div class="grow">
          <p class="strong">Your copy can't be played in this browser.</p>
          <p class="muted small">Try adding the song in another format (MP3 or AAC work almost everywhere).</p>
        </div>
      </div>
    )
  }
  if (state === 'missing') {
    const local = resolveLocal(item.track)
    if (local.status === 'probable') {
      const c = local.local
      return (
        <div class="banner warn" role="status">
          <Icon name="music" />
          <div class="grow">
            <p class="strong">Is this the same song?</p>
            <p class="muted small">Your library has “{c.title}”{c.artist ? ` by ${c.artist}` : ''} ({fmtTime(c.duration)}). It's a different file, so it may not line up perfectly.</p>
          </div>
          <div class="row">
            <button class="btn sm" onClick={() => rejectMatch(item.track.id, c.id)}>Not the same</button>
            <button class="btn sm primary" onClick={() => {
              confirmMatch(item.track.id, c.id)
              toast("You're ready — syncing with the room…")
            }}>Use my copy</button>
          </div>
        </div>
      )
    }
    const offer = offersFor(item.track.id)[0]
    if (offer) return <SharedCopy track={item.track} offer={offer} />
    const have = room.value!.participants.filter(p => p.isOnline && p.readiness === 'ready')
    return (
      <div class="banner warn" role="status">
        <Icon name="warn" />
        <div class="grow">
          <p class="strong">This song isn't available on your device yet.</p>
          <p class="muted small">
            {have.length ? `${have.map(p => p.displayName).join(', ')} ${have.length === 1 ? 'has' : 'have'} it. ` : ''}
            Add your copy and you'll join in right where they are.
          </p>
        </div>
        <FileButton class="btn" multiple={false} label="Add your copy of this song" onFiles={async files => {
          const res = await importFiles(files)
          reportImport(res)
          const now = resolveLocal(item.track).status
          if (now === 'ready') toast("You're ready — syncing with the room…")
          else if (now === 'missing' && res.tracks.length) toast("That file doesn't seem to be this song.", { tone: 'error' })
          // 'probable' → the banner above asks you to confirm
        }}>Add file</FileButton>
      </div>
    )
  }
  if (state === 'loading') return <p class="banner quiet" role="status">Getting your copy ready…</p>
  return null
}

function Progress() {
  const t = currentItem.value!.track
  const version = room.value!.playback.version
  const [scrub, setScrub] = useState<number | null>(null)
  // After a seek, hold the bar at the target until the room confirms it (no snap back to the old spot).
  const [held, setHeld] = useState<{ pos: number; version: number } | null>(null)
  useEffect(() => { if (held && held.version !== version) setHeld(null) }, [version])
  useEffect(() => {
    if (!held) return
    const timer = setTimeout(() => setHeld(null), 2000)
    return () => clearTimeout(timer)
  }, [held])
  const dur = t.duration || Math.max(roomPosition.value, 1)
  const pos = scrub ?? held?.pos ?? roomPosition.value
  const guest = !canControl.value
  const seek = (to: number) => {
    const p = Math.min(Math.max(0, to), dur)
    setHeld({ pos: p, version })
    playback({ type: 'SEEK', position: p })
  }
  const keys: Record<string, number> = { ArrowLeft: -5, ArrowDown: -5, ArrowRight: 5, ArrowUp: 5, PageDown: -30, PageUp: 30 }
  return (
    <div class={`progress${scrub !== null ? ' scrubbing' : ''}${guest ? ' guest' : ''}`} style={{ '--p': `${(pos / dur) * 100}%` }}>
      <div class="seek-wrap">
        <input type="range" class="range seek" min={0} max={dur} step={0.1} value={pos} disabled={guest}
          aria-label="Seek" aria-valuetext={`${fmtTime(pos)} of ${fmtTime(dur)}`}
          onInput={e => setScrub(Number(e.currentTarget.value))}
          onChange={e => { seek(Number(e.currentTarget.value)); setScrub(null) }}
          onKeyDown={e => {
            // One seek per key press (the native range would send a stream of tiny ones).
            const d = keys[e.key]
            const to = d !== undefined ? pos + d : e.key === 'Home' ? 0 : e.key === 'End' ? dur - 1 : null
            if (to === null) return
            e.preventDefault()
            seek(to)
          }} />
        {scrub !== null && <span class="seek-bubble" aria-hidden="true">{fmtTime(scrub)}</span>}
        {guest && <span class="seek-guard" onClick={mayControl} aria-hidden="true" />}
      </div>
      <div class="times">
        <span>{fmtTime(pos)}</span>
        <span aria-label={`${fmtTime(dur - pos)} remaining`}>-{fmtTime(dur - pos)}</span>
      </div>
    </div>
  )
}

/** True once a command has been waiting longer than `ms` (shows a soft "working on it" ring). */
function useSlow(pending: boolean, ms = 400) {
  const [slow, setSlow] = useState(false)
  useEffect(() => {
    if (!pending) return setSlow(false)
    const timer = setTimeout(() => setSlow(true), ms)
    return () => clearTimeout(timer)
  }, [pending])
  return slow
}

function Controls() {
  const r = room.value!
  const playing = shownPlaying.value
  const has = !!currentItem.value || r.queue.items.length > 0
  const guest = !canControl.value
  const slow = useSlow(optimisticPlaying.value !== null)
  // Guests can tap (and learn why nothing happens); with nothing queued the buttons are truly off.
  const act = (fn: () => void) => () => { if (mayControl()) fn() }
  const seekBy = (d: number) => playback({ type: 'SEEK', position: Math.max(0, roomPosition.value + d) })
  const common = { disabled: !has, 'aria-disabled': guest || undefined }
  return (
    <div class={`controls${guest ? ' guest' : ''}`} role="group" aria-label="Playback controls">
      <button class="icon-btn" {...common} onClick={act(() => seekBy(-10))} aria-label="Seek back 10 seconds"><Icon name="back10" size={22} /></button>
      <button class="icon-btn lg" {...common} onClick={act(() => playback({ type: 'PREVIOUS' }))} aria-label="Previous track"><Icon name="prev" size={26} /></button>
      <button class={`play-btn${slow ? ' pending' : ''}`} {...common} aria-label={playing ? 'Pause' : 'Play'} aria-keyshortcuts="Space K"
        onClick={act(() => {
          if (readiness.value === 'needs-tap') tuneIn()
          else unlockAudio()
          togglePlay()
        })}>
        <span class="pp" data-state={playing ? 'playing' : 'paused'} aria-hidden="true">
          <Icon name="play" size={30} />
          <Icon name="pause" size={30} />
        </span>
      </button>
      <button class="icon-btn lg" {...common} onClick={act(() => playback({ type: 'NEXT' }))} aria-label="Next track"><Icon name="next" size={26} /></button>
      <button class="icon-btn" {...common} onClick={act(() => seekBy(10))} aria-label="Seek forward 10 seconds"><Icon name="fwd10" size={22} /></button>
    </div>
  )
}

/** Swipe the artwork sideways for the next / previous song; vertical scrolling is left alone. */
function useSwipe(remountKey: unknown) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let start: { x: number; y: number; id: number } | null = null
    let swiping = false
    const set = (dx: number) => el.style.setProperty('--swipe', `${dx}px`)
    const down = (e: PointerEvent) => {
      if (!e.isPrimary || e.button !== 0 || (e.target as HTMLElement).closest('button')) return
      start = { x: e.clientX, y: e.clientY, id: e.pointerId }
      swiping = false
    }
    const move = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (!swiping) {
        if (Math.abs(dy) > 12) { start = null; return } // a scroll, not a swipe
        if (Math.abs(dx) < 12) return
        swiping = true
        el.classList.add('swiping')
        try { el.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
      }
      set(Math.max(-140, Math.min(140, dx)))
    }
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return
      const dx = e.clientX - start.x
      const was = swiping
      start = null
      swiping = false
      el.classList.remove('swiping')
      set(0)
      if (was && Math.abs(dx) > 70 && mayControl()) playback({ type: dx < 0 ? 'NEXT' : 'PREVIOUS' })
    }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', up)
    return () => {
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('pointercancel', up)
    }
  }, [remountKey])
  return ref
}

/** "Up next · Title — Artist": a peek at the queue; tapping opens it. */
function UpNext() {
  const r = room.value!
  const i = r.queue.items.findIndex(x => x.id === r.playback.itemId)
  const next = i > -1 ? r.queue.items[i + 1] : undefined
  if (!next) return null
  const open = () => {
    if (matchMedia('(max-width: 999px)').matches) return transition(() => { mobileTab.value = 'queue' })
    const q = document.querySelector<HTMLElement>('.queue')
    q?.scrollIntoView({ behavior: 'smooth', block: 'center' })
    q?.querySelector<HTMLElement>('button, [tabindex="0"]')?.focus({ preventScroll: true })
  }
  return (
    <button class="up-next" onClick={open} aria-label={`Up next: ${next.track.title}. Open the queue`}>
      <span class="up-next-label">Up next</span>
      <span class="up-next-title">{next.track.title}{next.track.artist ? ` — ${next.track.artist}` : ''}</span>
      <Icon name="list" size={15} />
    </button>
  )
}

function Volume() {
  const v = prefs.value.volume
  return (
    <label class="volume">
      <Icon name="volume" size={18} />
      <span class="sr-only">Volume (only on this device)</span>
      <input type="range" class="range" min={0} max={1} step={0.01} value={v} style={{ '--p': `${v * 100}%` }}
        aria-valuetext={`${Math.round(v * 100)}%`} onInput={e => setPrefs({ volume: Number(e.currentTarget.value) })} />
    </label>
  )
}

/** Only mention catching up if it lasts; brief corrections should stay invisible. */
function CatchingUp() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setShow(true), 3000)
    return () => clearTimeout(t)
  }, [])
  return show ? <p class="catching-up" role="status">Trying to catch up with the room…</p> : null
}

/** A friend attested they may share this song: offer to fetch a temporary, verified copy from them. */
function SharedCopy({ track, offer }: { track: Track; offer: ShareOffer }) {
  const r = receiving.value[track.id]
  const active = isActive(r)
  const from = active ? r.from : offer.participantId
  const who = participantById(from)?.displayName ?? 'A friend'
  const pct = Math.round((r?.progress ?? 0) * 100)
  return (
    <div class="banner accent-soft" role="status">
      <Icon name="download" />
      <div class="grow">
        <p class="strong">{who} shared this song <span class="muted">({LICENSES[offer.license]})</span></p>
        {active ? (
          <>
            <p class="muted small">{r.state === 'connecting' ? `Connecting to ${who}…` : r.state === 'verifying' ? 'Checking the copy…' : `Receiving… ${pct}%`}</p>
            <span class="bar" style={{ '--p': `${r.state === 'connecting' ? 0 : pct}%` }} aria-hidden="true" />
          </>
        ) : (
          <p class={`small ${r?.state === 'failed' ? 'fail-text' : 'muted'}`}>
            {r?.state === 'failed' ? r.error
              : autoFetch.value ? 'Getting it for you in the background…'
                : 'Get a copy straight from their browser — it stays in your library under “Shared with me”.'}
          </p>
        )}
      </div>
      {!active && (
        <button class="btn primary sm" onClick={() => { const o = bestOffer(track.id); if (o) requestCopy(track, o.participantId) }}>
          {r?.state === 'failed' ? 'Try again' : 'Get a copy'}
        </button>
      )}
    </div>
  )
}
