// The shared queue. (Phase 3 adds drag-to-reorder, move/play-next, clear and animations.)
import { importing, localTracks } from '../library/library.ts'
import { importAndQueue } from '../state/actions.ts'
import { canControl, canEditQueue, me, participantById, playback, queue, room } from '../state/room.ts'
import { fmtTime } from '../utils/format.ts'
import { Icon } from './icons.tsx'
import { Cover, Empty, Equalizer, FileButton } from './ui.tsx'

export function Queue() {
  const r = room.value!
  const items = r.queue.items
  const progress = importing.value

  return (
    <section class="panel queue" aria-labelledby="queue-h">
      <header class="panel-head">
        <h2 id="queue-h">Queue <span class="count">{items.length}</span></h2>
        <FileButton class="btn sm primary" onFiles={importAndQueue} label="Add music from your device">
          <Icon name="plus" size={16} /> Add music
        </FileButton>
      </header>
      {progress && (
        <p class="import-progress" role="status">
          Reading your files… {progress.done}/{progress.total}
          <span class="bar" style={{ '--p': `${(progress.done / Math.max(1, progress.total)) * 100}%` }} />
        </p>
      )}
      {items.length === 0 ? (
        <Empty icon="music" title="Add a few songs and build the night together.">
          <p>Only song details are shared — your audio files stay on your device.</p>
        </Empty>
      ) : (
        <ol class="queue-list" role="list">
          {items.map((item, i) => {
            const current = item.id === r.playback.itemId
            const local = localTracks.value.has(item.track.id)
            const who = participantById(item.addedBy)
            const canRemove = canEditQueue.value || item.addedBy === me.value
            return (
              <li key={item.id} class={`q-item${current ? ' current' : ''}`}>
                <button class="q-main" disabled={!canControl.value}
                  aria-label={`Play ${item.track.title}${item.track.artist ? ` by ${item.track.artist}` : ''}`}
                  aria-current={current ? 'true' : undefined}
                  onClick={() => playback({ type: 'PLAY_ITEM', itemId: item.id })}>
                  <span class="q-art">
                    <Cover id={item.track.id} size={44} />
                    {current && r.playback.isPlaying && <span class="q-eq"><Equalizer /></span>}
                  </span>
                  <span class="q-text">
                    <span class="q-title">{item.track.title}</span>
                    <span class="q-sub">
                      {item.track.artist || 'Unknown artist'}
                      {who && <> · Added by {who.id === me.value ? 'you' : who.displayName}</>}
                    </span>
                  </span>
                  <span class="q-side">
                    <span class={`avail ${local ? 'ok' : 'warn'}`}>
                      <Icon name={local ? 'check' : 'warn'} size={13} /> {local ? 'Ready' : 'Missing'}
                    </span>
                    <span class="q-dur">{fmtTime(item.track.duration)}</span>
                  </span>
                </button>
                {canRemove && (
                  <button class="icon-btn sm q-remove" aria-label={`Remove ${item.track.title} from the queue`}
                    onClick={() => queue({ type: 'REMOVE', itemId: item.id })}><Icon name="close" size={16} /></button>
                )}
                <span class="sr-only">Position {i + 1} of {items.length}</span>
              </li>
            )
          })}
        </ol>
      )}
    </section>
  )
}
