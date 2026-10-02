// The shared queue: everyone sees the same order; the server decides. Reorder by drag (desktop),
// press-and-hold drag or swipes (touch), the item's action sheet, or Alt+↑/↓ on a focused song.
import { useEffect, useState } from 'preact/hooks'
import type { QueueItem, Track } from '../../shared/types.ts'
import { artUrls, importing, localTracks, resolveLocal } from '../library/library.ts'
import { bestOffer, isActive, offersFor, receiving, requestCopy } from '../share/p2p.ts'
import { importAndQueue, removeFromQueue, requeue } from '../state/actions.ts'
import { canControl, canEditQueue, mayControl, me, participantById, playback, queue, room, shownPlaying, shownQueue, toast } from '../state/room.ts'
import { mobileTab, transition } from '../state/ui.ts'
import { useRowGestures } from '../utils/rowGestures.ts'
import { useFlip } from '../utils/flip.ts'
import { fmtTime } from '../utils/format.ts'
import { AddMusicSheet } from './AddMusic.tsx'
import { ShareSheet } from './ShareSheet.tsx'
import { Icon } from './icons.tsx'
import { Avatar, ConfirmButton, Cover, DropZone, Empty, Equalizer, Sheet } from './ui.tsx'

export function Availability({ track }: { track: Track }) {
  const r = resolveLocal(track)
  if (r.status === 'ready') return <span class="avail ok"><Icon name="check" size={13} /> Ready</span>
  if (r.status === 'probable') return <span class="avail match" title="A similar song is in your library">Match?</span>
  const got = receiving.value[track.id]
  if (isActive(got)) {
    return <span class="avail match" role="status">{got.state === 'receiving' ? `Getting a copy… ${Math.round(got.progress * 100)}%` : 'Getting a copy…'}</span>
  }
  if (offersFor(track.id).length) return <span class="avail match" title="A friend can send you a copy">Missing · shared</span>
  return <span class="avail warn"><Icon name="warn" size={13} /> Missing</span>
}

/** "6 songs · 21 min" / "1 h 5 min" */
const totalTime = (secs: number) => {
  const m = Math.round(secs / 60)
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

export function Queue() {
  const r = room.value!
  const items = shownQueue.value.items
  const current = items.findIndex(i => i.id === r.playback.itemId)
  const now = current > -1 ? items[current] : null
  const offset = current + 1 // queue index of the first "next up" song
  const upcoming = items.slice(offset)
  const earlier = current > -1 ? items.slice(0, current) : []
  const [menu, setMenu] = useState<QueueItem | null>(null)
  const [adding, setAdding] = useState(false)
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const listRef = useFlip<HTMLOListElement>(items.map(i => i.id).join())
  const reorder = canEditQueue.value
  const progress = importing.value
  const mayRemove = (item: QueueItem) => reorder || item.addedBy === me.value
  const byKey = (key: string) => items.find(i => i.id === key)

  // Phones: swipe left to remove (with Undo), right to play next; press and hold to drag.
  useRowGestures(listRef, {
    canDrag: () => reorder,
    canSwipe: (key, dir) => { const it = byKey(key); return !!it && (dir === 'left' ? mayRemove(it) : reorder) },
    onSwipe: (key, dir) => {
      const it = byKey(key)
      if (!it) return
      if (dir === 'left') removeFromQueue(it)
      else queue({ type: 'PLAY_NEXT', itemId: it.id }).then(res => { if (res.ok) toast(`“${it.track.title}” plays next`) })
    },
    onDrop: (from, to) => { const it = upcoming[from]; if (it) move(it, offset + to) },
  }, upcoming.length > 0)

  // Keep keyboard focus on a song after it moves.
  useEffect(() => {
    if (!focusId) return
    listRef.current?.querySelector<HTMLElement>(`[data-key="${focusId}"] .q-main`)?.focus()
    setFocusId(null)
  }, [items])

  const move = (item: QueueItem, to: number) => {
    if (to < 0 || to >= items.length) return
    queue({ type: 'MOVE', itemId: item.id, toIndex: to })
  }

  const row = (item: QueueItem, i: number, draggable: boolean) => {
    const isCurrent = i === current
    const who = participantById(item.addedBy)
    const local = resolveLocal(item.track)
    const art = local.status === 'ready' ? artUrls.value.get(local.local.id) : undefined
    const dropCls = drag && drag.id !== item.id ? (drag.over === i ? ' drop-above' : drag.over === i + 1 && i === items.length - 1 ? ' drop-below' : '') : ''
    const addedBy = who ? (who.id === me.value ? 'you' : who.displayName) : ''
    return (
      <li key={item.id} data-key={item.id}
        class={`q-item${isCurrent ? ' current' : ''}${current > -1 && i < current ? ' played' : ''}${drag?.id === item.id ? ' dragging' : ''}${dropCls}`}
        draggable={draggable}
        onDragStart={e => {
          e.dataTransfer!.setData('text/x-queue-item', item.id)
          e.dataTransfer!.effectAllowed = 'move'
          setDrag({ id: item.id, over: i })
        }}
        onDragOver={e => {
          if (!drag) return
          e.preventDefault()
          const box = e.currentTarget.getBoundingClientRect()
          const over = e.clientY > box.top + box.height / 2 ? i + 1 : i
          if (over !== drag.over) setDrag({ ...drag, over })
        }}
        onDrop={e => {
          if (!drag) return
          e.preventDefault()
          e.stopPropagation()
          const fromI = items.findIndex(x => x.id === drag.id)
          const to = drag.over > fromI ? drag.over - 1 : drag.over
          if (fromI > -1 && to !== fromI) move(items[fromI], to)
          setDrag(null)
        }}>
        <span class="swipe-bg swipe-bg-right" aria-hidden="true"><Icon name="next" size={18} /> Play next</span>
        <span class="swipe-bg swipe-bg-left" aria-hidden="true">Remove <Icon name="trash" size={18} /></span>
        {draggable && <span class="q-grip" aria-hidden="true"><Icon name="grip" size={16} /></span>}
        <button class="q-main" aria-disabled={!canControl.value || undefined}
          aria-label={`${isCurrent ? 'Now playing: ' : 'Play '}${item.track.title}${item.track.artist ? ` by ${item.track.artist}` : ''}${addedBy ? `, added by ${addedBy}` : ''}. Position ${i + 1} of ${items.length}`}
          aria-current={isCurrent ? 'true' : undefined}
          aria-keyshortcuts={reorder ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
          onClick={() => { if (mayControl()) playback({ type: 'PLAY_ITEM', itemId: item.id }) }}
          onKeyDown={e => {
            if (!reorder || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
            e.preventDefault()
            setFocusId(item.id)
            move(item, i + (e.key === 'ArrowUp' ? -1 : 1))
          }}>
          <span class="q-art">
            <Cover id={item.track.id} art={art} size={46} />
            {who && <span class="q-who" title={`Added by ${addedBy}`}><Avatar avatar={who.avatar} size={18} /></span>}
          </span>
          <span class="q-text">
            <span class="q-title">{item.track.title}</span>
            <span class="q-sub">{item.track.artist || 'Unknown artist'}</span>
          </span>
          <span class="q-side">
            <Availability track={item.track} />
            <span class="q-dur">{fmtTime(item.track.duration)}</span>
          </span>
        </button>
        <button class="icon-btn sm q-more" aria-label={`More options for ${item.track.title}`} onClick={() => setMenu(item)}>
          <Icon name="more" size={18} />
        </button>
      </li>
    )
  }

  return (
    <DropZone class="panel queue" onFiles={importAndQueue}>
      <section aria-labelledby="queue-h">
        <header class="panel-head q-head">
          <div>
            <h2 id="queue-h">Queue</h2>
            {items.length > 0 && (
              <p class="q-summary">{upcoming.length ? `${upcoming.length} up next · ${totalTime(upcoming.reduce((s, x) => s + x.track.duration, 0))}` : 'Nothing after this song'}</p>
            )}
          </div>
          <div class="row">
            {reorder && items.length > 1 && (
              <ConfirmButton onConfirm={() => queue({ type: 'CLEAR' })} confirmLabel="Clear queue?" label="Clear the queue (keeps the current song)">
                Clear
              </ConfirmButton>
            )}
            <button class="btn sm primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Add music</button>
          </div>
        </header>

        {progress && (
          <p class="import-progress" role="status">
            Reading your files… {progress.done}/{progress.total}
            <span class="bar" style={{ '--p': `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
          </p>
        )}

        {items.length === 0 ? (
          <Empty icon="music" title="Add a few songs and build the night together.">
            <p>Drop files here, or pick from your library. Only song details are shared — audio stays on your device.</p>
            <button class="btn sm primary" onClick={() => setAdding(true)}><Icon name="plus" size={16} /> Add music</button>
          </Empty>
        ) : (
          <>
            {now && <NowCard item={now} onMenu={() => setMenu(now)} />}
            {upcoming.length > 0 && <h3 class="q-section">Next up</h3>}
            <ol class="queue-list" role="list" ref={listRef} onDragEnd={() => setDrag(null)}>
              {upcoming.map((item, k) => row(item, offset + k, reorder))}
            </ol>
            {upcoming.length > 0 && reorder && <p class="q-hint">Swipe a song left to remove it, right to play it next. Press and hold to move it.</p>}
            {earlier.length > 0 && (
              <details class="recent">
                <summary>Earlier in the queue <span class="count">{earlier.length}</span></summary>
                <ol class="queue-list" role="list">{earlier.map((item, k) => row(item, k, false))}</ol>
              </details>
            )}
          </>
        )}
        <RecentlyPlayed />
      </section>

      {menu && <ItemMenu item={menu} onClose={() => setMenu(null)} />}
      <AddMusicSheet open={adding} onClose={() => setAdding(false)} />
    </DropZone>
  )
}

/** The song playing now, as a highlighted card above the list. Tapping it opens the player (phones). */
function NowCard({ item, onMenu }: { item: QueueItem; onMenu: () => void }) {
  const r = room.value!
  const who = participantById(item.addedBy)
  const local = resolveLocal(item.track)
  const art = local.status === 'ready' ? artUrls.value.get(local.local.id) : undefined
  const open = () => { if (matchMedia('(max-width: 999px)').matches) transition(() => { mobileTab.value = 'room' }) }
  return (
    <div class="q-now">
      <button class="q-now-main" onClick={open} aria-label={`Now playing: ${item.track.title}. Open the player`}>
        <span class="q-art">
          <Cover id={item.track.id} art={art} size={60} />
          <span class="q-eq"><Equalizer playing={shownPlaying.value} /></span>
        </span>
        <span class="q-text">
          <span class="q-eyebrow">{shownPlaying.value ? 'Now playing' : 'Paused'}</span>
          <span class="q-title">{item.track.title}</span>
          <span class="q-sub">{item.track.artist || 'Unknown artist'}{who && <> · added by {who.id === me.value ? 'you' : who.displayName}</>}</span>
        </span>
        <span class="q-side"><Availability track={item.track} /></span>
      </button>
      <button class="icon-btn sm q-more" aria-label={`More options for ${item.track.title}`} onClick={onMenu}><Icon name="more" size={18} /></button>
      {r.playback.isPlaying && <span class="q-now-glow" aria-hidden="true" />}
    </div>
  )
}

function ItemMenu({ item, onClose }: { item: QueueItem; onClose: () => void }) {
  const items = shownQueue.value.items
  const i = items.findIndex(x => x.id === item.id)
  const isCurrent = item.id === room.value?.playback.itemId
  const edit = canEditQueue.value
  const canRemove = edit || item.addedBy === me.value
  const act = (fn: () => void) => () => { fn(); onClose() }
  const [sharing, setSharing] = useState(false)
  const own = localTracks.value.get(item.track.id) // the exact file, held locally
  const canShare = !!own && !own.sharedBy
  const offer = resolveLocal(item.track).status === 'ready' ? undefined : bestOffer(item.track.id)
  const busy = receiving.value[item.track.id]
  if (i === -1) return null // removed by someone else meanwhile
  if (sharing && own) return <ShareSheet track={own} onClose={onClose} />
  return (
    <Sheet open onClose={onClose} title={item.track.title}>
      <p class="muted small sheet-sub">{item.track.artist || 'Unknown artist'} · <Availability track={item.track} /></p>
      <div class="menu-list">
        {canControl.value && !isCurrent && (
          <button class="menu-item" onClick={act(() => playback({ type: 'PLAY_ITEM', itemId: item.id }))}><Icon name="play" /> Play now</button>
        )}
        {edit && !isCurrent && (
          <button class="menu-item" onClick={act(() => queue({ type: 'PLAY_NEXT', itemId: item.id }))}><Icon name="next" /> Play next</button>
        )}
        {edit && i > 0 && (
          <button class="menu-item" onClick={act(() => queue({ type: 'MOVE', itemId: item.id, toIndex: i - 1 }))}><Icon name="up" /> Move up</button>
        )}
        {edit && i < items.length - 1 && (
          <button class="menu-item" onClick={act(() => queue({ type: 'MOVE', itemId: item.id, toIndex: i + 1 }))}><Icon name="down" /> Move down</button>
        )}
        {canRemove && (
          <button class="menu-item danger" onClick={act(() => removeFromQueue(item))}><Icon name="trash" /> Remove from queue</button>
        )}
        {offer && !isActive(busy) && (
          <button class="menu-item" onClick={act(() => requestCopy(item.track, offer.participantId))}>
            <Icon name="download" /> Get a copy from {participantById(offer.participantId)?.displayName}
          </button>
        )}
        {canShare && (
          <button class="menu-item" onClick={() => setSharing(true)}>
            <Icon name="share" /> {own!.share ? 'Sharing with friends — change…' : 'Let friends get a copy…'}
          </button>
        )}
        {!edit && !canRemove && <p class="muted small">Only the host can rearrange this room's queue.</p>}
      </div>
    </Sheet>
  )
}

/** Songs this room played before (kept with the room, so it's there when friends come back). */
function RecentlyPlayed() {
  const r = room.value
  const currentTrack = r?.queue.items.find(i => i.id === r.playback.itemId)?.track.id
  const history = (r?.history ?? []).filter(t => t.id !== currentTrack)
  if (!history.length) return null
  return (
    <details class="recent">
      <summary>Recently played <span class="count">{history.length}</span></summary>
      <ul class="queue-list" role="list">
        {history.map(t => (
          <li key={t.id} class="q-item">
            <div class="q-main">
              <span class="q-art"><Cover id={t.id} size={36} /></span>
              <span class="q-text"><span class="q-title">{t.title}</span><span class="q-sub">{t.artist || 'Unknown artist'}</span></span>
              <span class="q-side"><Availability track={t} /></span>
            </div>
            <button class="icon-btn sm" aria-label={`Add ${t.title} to the queue again`} title="Add again"
              onClick={() => requeue(t)}><Icon name="plus" size={16} /></button>
          </li>
        ))}
      </ul>
    </details>
  )
}
