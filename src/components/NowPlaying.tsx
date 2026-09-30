// The stage: artwork, song info, progress, transport controls, and the local-readiness state.
import { useEffect, useState } from 'preact/hooks'
import { isIOS, prefs, readiness, roomPosition, setPrefs, syncStatus, tuneIn, unlockAudio } from '../audio/player.ts'
import { vizStyle } from '../audio/visualizer.ts'
import { stageView } from '../state/ui.ts'
import { Lyrics } from './Lyrics.tsx'
import { StageTools, Visualizer } from './Visualizer.tsx'
import { artUrls, confirmMatch, importFiles, rejectMatch, resolveLocal } from '../library/library.ts'
import { reportImport } from '../state/actions.ts'
import { canControl, currentItem, participantById, playback, room, toast } from '../state/room.ts'
import { fmtTime } from '../utils/format.ts'
import { Icon } from './icons.tsx'
import { FloatingReactions, ReactionBar } from './Reactions.tsx'
import { Avatar, Cover, Equalizer, FileButton } from './ui.tsx'

const HOST_ONLY = 'Only the host can control playback in this room'

export function NowPlaying() {
  const r = room.value!
  const item = currentItem.value
  const pb = r.playback
  const t = item?.track
  const addedBy = item && participantById(item.addedBy)
  const local = t ? resolveLocal(t) : null
  const art = local?.status === 'ready' ? artUrls.value.get(local.local.id) : null
  const showLyrics = stageView.value === 'lyrics' && !!t

  return (
    <section class={`stage${pb.isPlaying ? ' is-playing' : ''} viz-${vizStyle.value}${showLyrics ? ' with-lyrics' : ''}`} aria-label="Now playing">
      {showLyrics ? (
        <div class="lyrics-wrap">
          <FloatingReactions />
          <Lyrics track={t} />
        </div>
      ) : (
        <div class="art-wrap">
          <Visualizer placement="ring" />
          <div class="vinyl" aria-hidden="true" />
          <FloatingReactions />
          <Cover id={t?.id} art={art} class="art" key={t?.id} />
        </div>
      )}
      {!showLyrics && <Visualizer placement="strip" />}
      <StageTools hasTrack={!!t} />

      <div class="np-meta">
        <p class="eyebrow np-state">
          {item ? pb.isPlaying ? <><Equalizer /> Playing together</> : 'Paused' : 'Nothing playing yet'}
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
    return (
      <div class="banner accent">
        <button class="btn primary big" onClick={tuneIn}><Icon name="tap" /> Tap to tune in</button>
        <p class="muted small">Your browser needs one tap before it can play audio.</p>
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
  const [scrub, setScrub] = useState<number | null>(null)
  const pos = scrub ?? roomPosition.value
  const dur = t.duration || Math.max(pos, 1)
  const disabled = !canControl.value
  return (
    <div class="progress">
      <input type="range" class="range seek" min={0} max={dur} step={0.1} value={pos} disabled={disabled}
        aria-label="Seek" aria-valuetext={`${fmtTime(pos)} of ${fmtTime(dur)}`} title={disabled ? HOST_ONLY : undefined}
        style={{ '--p': `${(pos / dur) * 100}%` }}
        onInput={e => setScrub(Number(e.currentTarget.value))}
        onChange={e => { playback({ type: 'SEEK', position: Number(e.currentTarget.value) }); setScrub(null) }} />
      <div class="times">
        <span>{fmtTime(pos)}</span>
        <span aria-label={`${fmtTime(dur - pos)} remaining`}>-{fmtTime(dur - pos)}</span>
      </div>
    </div>
  )
}

function Controls() {
  const r = room.value!
  const playing = r.playback.isPlaying
  const has = !!currentItem.value || r.queue.items.length > 0
  const off = !canControl.value || !has
  const title = !canControl.value ? HOST_ONLY : undefined
  const seekBy = (d: number) => playback({ type: 'SEEK', position: Math.max(0, roomPosition.value + d) })
  return (
    <div class="controls" role="group" aria-label="Playback controls">
      <button class="icon-btn" onClick={() => seekBy(-10)} disabled={off} title={title} aria-label="Seek back 10 seconds"><Icon name="back10" size={22} /></button>
      <button class="icon-btn lg" onClick={() => playback({ type: 'PREVIOUS' })} disabled={off} title={title} aria-label="Previous track"><Icon name="prev" size={26} /></button>
      <button class="play-btn" disabled={off} title={title} aria-label={playing ? 'Pause' : 'Play'} aria-keyshortcuts="Space K"
        onClick={() => {
          if (readiness.value === 'needs-tap') tuneIn()
          else unlockAudio()
          playback({ type: playing ? 'PAUSE' : 'PLAY' })
        }}>
        <Icon name={playing ? 'pause' : 'play'} size={30} />
      </button>
      <button class="icon-btn lg" onClick={() => playback({ type: 'NEXT' })} disabled={off} title={title} aria-label="Next track"><Icon name="next" size={26} /></button>
      <button class="icon-btn" onClick={() => seekBy(10)} disabled={off} title={title} aria-label="Seek forward 10 seconds"><Icon name="fwd10" size={22} /></button>
    </div>
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
