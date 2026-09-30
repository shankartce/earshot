// "+ Add music": from new files, your library (recently added first), or a playlist.
// Only metadata is published to the room; the audio stays here.
import { useState } from 'preact/hooks'
import { artUrls, playlists, sortedTracks, type LocalTrack } from '../library/library.ts'
import { normalize } from '../library/match.ts'
import { importAndQueue, queueTracks } from '../state/actions.ts'
import { fmtTime } from '../utils/format.ts'
import { Icon } from './icons.tsx'
import { Cover, DropZone, Empty, FileButton, Sheet } from './ui.tsx'

type Tab = 'library' | 'files' | 'playlists'

export function matchesSearch(t: LocalTrack, q: string) {
  if (!q) return true
  const hay = normalize(`${t.title} ${t.artist} ${t.album}`)
  return normalize(q).split(' ').every(w => hay.includes(w))
}

export function AddMusicSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const hasLibrary = sortedTracks.value.length > 0
  const [tab, setTab] = useState<Tab>(hasLibrary ? 'library' : 'files')
  const [q, setQ] = useState('')
  const [added, setAdded] = useState<ReadonlySet<string>>(new Set())
  const fromFiles = async (files: File[]) => {
    onClose()
    await importAndQueue(files)
  }
  const shown = sortedTracks.value.filter(t => matchesSearch(t, q)).slice(0, 200)

  return (
    <Sheet open={open} onClose={onClose} title="Add music">
      <div class="segmented tabs" role="tablist" aria-label="Add from">
        {([['library', 'Library'], ['files', 'Files'], ['playlists', 'Playlists']] as const).map(([k, label]) => (
          <button key={k} role="tab" aria-selected={tab === k} class={tab === k ? 'on' : ''} onClick={() => setTab(k)}>{label}</button>
        ))}
      </div>

      {tab === 'files' && (
        <DropZone onFiles={fromFiles} class="drop-big">
          <Icon name="folder" size={30} />
          <p class="strong">Drop songs or folders here</p>
          <p class="muted small">They're saved in this browser for next time — never uploaded.</p>
          <div class="row center-row">
            <FileButton class="btn primary" onFiles={fromFiles}><Icon name="plus" size={18} /> Choose files</FileButton>
            <FileButton class="btn" onFiles={fromFiles} folder><Icon name="folder" size={18} /> Choose folder</FileButton>
          </div>
        </DropZone>
      )}

      {tab === 'library' && (
        !hasLibrary ? (
          <Empty icon="music" title="Your local library is empty.">
            <p>Add some music to get started.</p>
            <button class="btn sm primary" onClick={() => setTab('files')}>Add files</button>
          </Empty>
        ) : (
          <>
            <label class="search">
              <Icon name="search" size={18} />
              <input class="input" type="search" placeholder="Search your library" value={q} onInput={e => setQ(e.currentTarget.value)} aria-label="Search your library" />
            </label>
            <p class="label">{q ? `${shown.length} match${shown.length === 1 ? '' : 'es'}` : 'Recently added'}</p>
            <ul class="pick-list" role="list">
              {shown.map(t => (
                <li key={t.id} class="pick">
                  <Cover id={t.id} art={artUrls.value.get(t.id)} size={40} />
                  <span class="q-text"><span class="q-title">{t.title}</span><span class="q-sub">{t.artist || 'Unknown artist'} · {fmtTime(t.duration)}</span></span>
                  <button class={`btn sm${added.has(t.id) ? '' : ' primary'}`} aria-label={`Add ${t.title} to the queue`}
                    onClick={() => { queueTracks([t]); setAdded(new Set(added).add(t.id)) }}>
                    {added.has(t.id) ? <><Icon name="check" size={16} /> Added</> : <><Icon name="plus" size={16} /> Add</>}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )
      )}

      {tab === 'playlists' && (
        playlists.value.length === 0 ? (
          <Empty icon="list" title="No playlists yet.">
            <p>Make one in your <a href="/library">library</a> to queue a whole set at once.</p>
          </Empty>
        ) : (
          <ul class="pick-list" role="list">
            {playlists.value.map(p => {
              const tracks = p.trackIds.map(id => sortedTracks.value.find(t => t.id === id)).filter(Boolean) as LocalTrack[]
              return (
                <li key={p.id} class="pick">
                  <span class="pl-icon"><Icon name="list" /></span>
                  <span class="q-text"><span class="q-title">{p.name}</span><span class="q-sub">{tracks.length} song{tracks.length === 1 ? '' : 's'}</span></span>
                  <button class="btn sm primary" disabled={!tracks.length} onClick={() => { queueTracks(tracks); onClose() }}>
                    <Icon name="plus" size={16} /> Add all
                  </button>
                </li>
              )
            })}
          </ul>
        )
      )}
    </Sheet>
  )
}
