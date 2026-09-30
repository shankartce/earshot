// The shared queue: everyone sees the same order; the server decides. Reorder by drag (desktop),
// by the item's action sheet (touch / keyboard), or with Alt+↑/↓ on a focused song.
import { useEffect, useState } from 'preact/hooks'
import type { QueueItem, Track } from '../../shared/types.ts'
import { artUrls, importing, localTracks, resolveLocal } from '../library/library.ts'
import { offersFor, receiving, requestCopy } from '../share/p2p.ts'
import { importAndQueue } from '../state/actions.ts'
import { canControl, canEditQueue, me, participantById, playback, queue, room, shownQueue } from '../state/room.ts'
import { useFlip } from '../utils/flip.ts'
import { fmtTime } from '../utils/format.ts'
import { AddMusicSheet } from './AddMusic.tsx'
import { ShareSheet } from './ShareSheet.tsx'
import { Icon } from './icons.tsx'
import { ConfirmButton, Cover, DropZone, Empty, Equalizer, Sheet } from './ui.tsx'

export function Availability({ track }: { track: Track }) {
  const r = resolveLocal(track)
  if (r.status === 'ready') return <span class="avail ok"><Icon name="check" size={13} /> Ready</span>
  if (r.status === 'probable') return <span class="avail match" title="A similar song is in your library">Match?</span>
  if (offersFor(track.id).length) return <span class="avail match" title="A friend can send you a copy">Missing · shared</span>
  return <span class="avail warn"><Icon name="warn" size={13} /> Missing</span>
}

export function Queue() {
  const r = room.value!
  const items = shownQueue.value.items
  const current = items.findIndex(i => i.id === r.playback.itemId)
  const [menu, setMenu] = useState<QueueItem | null>(null)
  const [adding, setAdding] = useState(false)
  const [drag, setDrag] = useState<{ id: string; over: number } | null>(null)
  const [focusId, setFocusId] = useState<string | null>(null)
  const listRef = useFlip<HTMLOListElement>(items.map(i => i.id).join())
  const reorder = canEditQueue.value
  const progress = importing.value

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

  return (
    <DropZone class="panel queue" onFiles={importAndQueue}>
      <section aria-labelledby="queue-h">
        <header class="panel-head">
          <h2 id="queue-h">Queue <span class="count">{items.length}</span></h2>
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
          <ol class="queue-list" role="list" ref={listRef} onDragEnd={() => setDrag(null)}>
            {items.map((item, i) => {
              const isCurrent = i === current
              const who = participantById(item.addedBy)
              const local = resolveLocal(item.track)
              const art = local.status === 'ready' ? artUrls.value.get(local.local.id) : undefined
              const dropCls = drag && drag.id !== item.id ? (drag.over === i ? ' drop-above' : drag.over === i + 1 && i === items.length - 1 ? ' drop-below' : '') : ''
              return (
                <li key={item.id} data-key={item.id}
                  class={`q-item${isCurrent ? ' current' : ''}${current > -1 && i < current ? ' played' : ''}${drag?.id === item.id ? ' dragging' : ''}${dropCls}`}
                  draggable={reorder}
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
                    const from = items.findIndex(x => x.id === drag.id)
                    const to = drag.over > from ? drag.over - 1 : drag.over
                    if (from > -1 && to !== from) move(items[from], to)
                    setDrag(null)
                  }}>
                  {reorder && <span class="q-grip" aria-hidden="true"><Icon name="grip" size={16} /></span>}
                  <button class="q-main" aria-disabled={!canControl.value || undefined}
                    aria-label={`${isCurrent ? 'Now playing: ' : 'Play '}${item.track.title}${item.track.artist ? ` by ${item.track.artist}` : ''}. Position ${i + 1} of ${items.length}`}
                    aria-current={isCurrent ? 'true' : undefined}
                    aria-keyshortcuts={reorder ? 'Alt+ArrowUp Alt+ArrowDown' : undefined}
                    onClick={() => { if (canControl.value) playback({ type: 'PLAY_ITEM', itemId: item.id }) }}
                    onKeyDown={e => {
                      if (!reorder || !e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
                      e.preventDefault()
                      setFocusId(item.id)
                      move(item, i + (e.key === 'ArrowUp' ? -1 : 1))
                    }}>
                    <span class="q-art">
                      <Cover id={item.track.id} art={art} size={44} />
                      {isCurrent && <span class="q-eq"><Equalizer playing={r.playback.isPlaying} /></span>}
                    </span>
                    <span class="q-text">
                      <span class="q-title">{item.track.title}</span>
                      <span class="q-sub">
                        {item.track.artist || 'Unknown artist'}
                        {who && <> · Added by {who.id === me.value ? 'you' : who.displayName}</>}
                      </span>
                    </span>
                    <span class="q-side">
                      <Availability track={item.track} />
                      <span class="q-dur">{fmtTime(item.track.duration)}</span>
                    </span>
                  </button>
                  <button class="icon-btn sm" aria-label={`More options for ${item.track.title}`} onClick={() => setMenu(item)}>
                    <Icon name="more" size={18} />
                  </button>
                </li>
              )
            })}
          </ol>
        )}
        <RecentlyPlayed />
      </section>

      {menu && <ItemMenu item={menu} onClose={() => setMenu(null)} />}
      <AddMusicSheet open={adding} onClose={() => setAdding(false)} />
    </DropZone>
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
  const canShare = !!own && !own.borrowed
  const offer = resolveLocal(item.track).status === 'ready' ? undefined : offersFor(item.track.id)[0]
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
          <button class="menu-item danger" onClick={act(() => queue({ type: 'REMOVE', itemId: item.id }))}><Icon name="trash" /> Remove from queue</button>
        )}
        {offer && (!busy || busy.state === 'failed') && (
          <button class="menu-item" onClick={act(() => requestCopy(item.track, offer.participantId))}>
            <Icon name="download" /> Get a temporary copy from {participantById(offer.participantId)?.displayName}
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
              onClick={() => queue({ type: 'ADD', tracks: [t] })}><Icon name="plus" size={16} /></button>
          </li>
        ))}
      </ul>
    </details>
  )
}
