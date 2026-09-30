// /library — your local music: import (files, folders, drag & drop), search, sort, playlists, remove.
import { useEffect, useState } from 'preact/hooks'
import { tabKeys } from '../utils/media.ts'
import { matchesSearch } from '../components/AddMusic.tsx'
import { Icon } from '../components/icons.tsx'
import { ConfirmButton, Cover, DropZone, Empty, FileButton } from '../components/ui.tsx'
import {
  addToPlaylist, artUrls, createPlaylist, deletePlaylist, importFiles, importing, libraryReady, localTracks, lostTracks,
  persistentStorage, storagePersisted, playlists, removeTrack, sortedTracks, storageUsage, updatePlaylist, type LocalTrack, type Playlist,
} from '../library/library.ts'
import { queueTracks, reportImport } from '../state/actions.ts'
import { room, toast } from '../state/room.ts'
import { fmtTime } from '../utils/format.ts'
import { ShareSheet, SharedBadge } from '../components/ShareSheet.tsx'
import { BackLink } from './Join.tsx'

type Sort = 'recent' | 'title' | 'artist' | 'album'
const byText = (a: string, b: string) => a.localeCompare(b, undefined, { sensitivity: 'base', numeric: true })
const SORTS: Record<Sort, (a: LocalTrack, b: LocalTrack) => number> = {
  recent: (a, b) => b.addedAt - a.addedAt,
  title: (a, b) => byText(a.title, b.title),
  artist: (a, b) => byText(a.artist, b.artist) || byText(a.album, b.album) || (a.trackNo ?? 0) - (b.trackNo ?? 0),
  album: (a, b) => byText(a.album, b.album) || (a.trackNo ?? 0) - (b.trackNo ?? 0) || byText(a.title, b.title),
}

const mb = (bytes: number) => (bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`)

async function onImport(files: File[]) {
  const res = await importFiles(files)
  reportImport(res)
  if (res.added) toast(`Added ${res.added} song${res.added === 1 ? '' : 's'} to your library`)
  else if (res.duplicates) toast('Those songs are already in your library')
}

export function Library() {
  const [tab, setTab] = useState<'songs' | 'playlists'>('songs')
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null)
  const count = sortedTracks.value.length
  useEffect(() => { storageUsage().then(setUsage) }, [count])

  return (
    <DropZone onFiles={onImport} class="page library-page">
      <div class="card wide">
        <div class="row between">
          <BackLink />
          {room.value && <a class="btn sm ghost" href={`/room/${room.value.code}`}>Back to {room.value.emoji} {room.value.name}</a>}
        </div>
        <header class="lib-head">
          <div>
            <h1 class="display-sm">Your library</h1>
            <p class="muted small">
              {count} song{count === 1 ? '' : 's'}{usage && count ? ` · ${mb(usage.used)} stored in this browser` : ''} · never uploaded
            </p>
          </div>
          <div class="row">
            <FileButton class="btn primary" onFiles={onImport}><Icon name="plus" /> Add files</FileButton>
            <FileButton class="btn" onFiles={onImport} folder><Icon name="folder" /> Add folder</FileButton>
          </div>
        </header>

        {!persistentStorage.value ? (
          <p class="note"><Icon name="warn" size={16} /> This browser won't keep your files after you leave (private browsing?). They'll work for this visit.</p>
        ) : storagePersisted.value === false && count > 0 && (
          <p class="note"><Icon name="warn" size={16} /> Your browser may clear stored songs if it runs low on space. Keep your original files — you can always add them again.</p>
        )}
        {lostTracks.value.length > 0 && (
          <p class="note"><Icon name="warn" size={16} /> Your browser cleared {lostTracks.value.length} song{lostTracks.value.length === 1 ? '' : 's'} since your last visit: {lostTracks.value.slice(0, 3).map(t => `“${t.title}”`).join(', ')}{lostTracks.value.length > 3 ? '…' : ''}. Add the files again to bring them back.</p>
        )}
        {importing.value && (
          <p class="import-progress" role="status">
            Reading your files… {importing.value.done}/{importing.value.total}
            <span class="bar" style={{ '--p': `${(importing.value.done / Math.max(1, importing.value.total)) * 100}%` }} />
          </p>
        )}

        <div class="segmented tabs" role="tablist" aria-label="Library sections" onKeyDown={tabKeys}>
          <button role="tab" aria-selected={tab === 'songs'} class={tab === 'songs' ? 'on' : ''} onClick={() => setTab('songs')}>Songs</button>
          <button role="tab" aria-selected={tab === 'playlists'} class={tab === 'playlists' ? 'on' : ''} onClick={() => setTab('playlists')}>
            Playlists {playlists.value.length > 0 && <span class="count">{playlists.value.length}</span>}
          </button>
        </div>

        {!libraryReady.value ? <p class="muted pulse">Opening your library…</p>
          : tab === 'songs' ? <Songs /> : <Playlists />}
      </div>
    </DropZone>
  )
}

function Songs() {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  if (!sortedTracks.value.length) {
    return (
      <Empty icon="music" title="Your local library is empty.">
        <p>Add some music to get started — drop files or a whole folder anywhere on this page.</p>
      </Empty>
    )
  }
  const shown = sortedTracks.value.filter(t => matchesSearch(t, q)).sort(SORTS[sort])
  return (
    <>
      <div class="lib-tools">
        <label class="search grow">
          <Icon name="search" size={18} />
          <input class="input" type="search" placeholder="Search songs" value={q}
            onInput={e => setQ(e.currentTarget.value)} aria-label="Search your library" />
        </label>
        <label class="sort">
          <span class="sr-only">Sort by</span>
          <select class="input" value={sort} onChange={e => setSort(e.currentTarget.value as Sort)}>
            <option value="recent">Recently added</option>
            <option value="title">Title</option>
            <option value="artist">Artist</option>
            <option value="album">Album</option>
          </select>
        </label>
      </div>
      {shown.length === 0 ? <p class="muted center-text">No songs match “{q}”.</p> : (
        <ul class="lib-list" role="list">
          {shown.map(t => <SongRow key={t.id} t={t} />)}
        </ul>
      )}
    </>
  )
}

function SongRow({ t }: { t: LocalTrack }) {
  const inRoom = !!room.value
  const [sharing, setSharing] = useState(false)
  return (
    <li class="lib-row">
      {sharing && <ShareSheet track={t} onClose={() => setSharing(false)} />}
      <Cover id={t.id} art={artUrls.value.get(t.id)} size={46} />
      <span class="q-text">
        <span class="q-title">{t.title}</span>
        <span class="q-sub">{[t.artist || 'Unknown artist', t.album].filter(Boolean).join(' · ')}</span>
        {t.share && <SharedBadge license={t.share.license} />}
      </span>
      <span class="q-dur">{fmtTime(t.duration)}</span>
      <div class="lib-actions">
        <button class={`icon-btn sm${t.share ? ' on' : ''}`} aria-label={t.share ? `Sharing ${t.title} with friends — change` : `Let friends get a copy of ${t.title}`}
          title={t.share ? 'Sharing with friends' : 'Let friends get a copy'} onClick={() => setSharing(true)}>
          <Icon name="share" size={17} />
        </button>
        {inRoom && (
          <button class="icon-btn sm" aria-label={`Add ${t.title} to the room queue`} title="Add to queue" onClick={() => queueTracks([t])}>
            <Icon name="plus" size={18} />
          </button>
        )}
        {playlists.value.length > 0 && (
          <select class="mini-select" aria-label={`Add ${t.title} to a playlist`} value=""
            onChange={e => {
              const id = e.currentTarget.value
              if (!id) return
              addToPlaylist(id, [t.id])
              toast(`Added to ${playlists.value.find(p => p.id === id)?.name}`)
              e.currentTarget.value = ''
            }}>
            <option value="">+ Playlist</option>
            {playlists.value.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select>
        )}
        <ConfirmButton class="icon-btn sm" label={`Remove ${t.title} from this device`} confirmLabel="Remove?"
          onConfirm={() => { removeTrack(t.id); toast(`Removed “${t.title}” from this device`) }}>
          <Icon name="trash" size={17} />
        </ConfirmButton>
      </div>
    </li>
  )
}

function Playlists() {
  const [name, setName] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  return (
    <>
      <form class="input-row pl-create" onSubmit={e => {
        e.preventDefault()
        const p = createPlaylist(name)
        setName('')
        setOpen(p.id)
      }}>
        <input class="input" placeholder="New playlist name" value={name} maxLength={60} onInput={e => setName(e.currentTarget.value)} aria-label="New playlist name" />
        <button class="btn primary" disabled={!name.trim()}><Icon name="plus" size={18} /> Create</button>
      </form>
      {playlists.value.length === 0 ? (
        <Empty icon="list" title="No playlists yet.">
          <p>Group songs for a mood or a night, then queue them in one tap.</p>
        </Empty>
      ) : (
        <ul class="lib-list" role="list">
          {playlists.value.map(p => <PlaylistRow key={p.id} p={p} open={open === p.id} onToggle={() => setOpen(open === p.id ? null : p.id)} />)}
        </ul>
      )}
    </>
  )
}

function PlaylistRow({ p, open, onToggle }: { p: Playlist; open: boolean; onToggle: () => void }) {
  const tracks = p.trackIds.map(id => localTracks.value.get(id)).filter(Boolean) as LocalTrack[]
  const total = tracks.reduce((s, t) => s + t.duration, 0)
  return (
    <li class="pl-row">
      <div class="lib-row">
        <span class="pl-icon"><Icon name="list" /></span>
        <button class="q-text pl-toggle" aria-expanded={open} onClick={onToggle}>
          <span class="q-title">{p.name}</span>
          <span class="q-sub">{tracks.length} song{tracks.length === 1 ? '' : 's'}{total ? ` · ${fmtTime(total)}` : ''}</span>
        </button>
        <div class="lib-actions">
          {room.value && <button class="btn sm" disabled={!tracks.length} onClick={() => queueTracks(tracks)}><Icon name="plus" size={16} /> Queue all</button>}
          <ConfirmButton class="icon-btn sm" label={`Delete playlist ${p.name}`} confirmLabel="Delete?"
            onConfirm={() => deletePlaylist(p.id)}><Icon name="trash" size={17} /></ConfirmButton>
        </div>
      </div>
      {open && (
        <ol class="pl-tracks" role="list">
          {tracks.length === 0 && <li class="muted small">Empty — use “+ Playlist” on any song to add it here.</li>}
          {tracks.map((t, i) => (
            <li key={t.id} class="pl-track">
              <span class="q-dur">{i + 1}</span>
              <span class="q-text"><span class="q-title">{t.title}</span><span class="q-sub">{t.artist}</span></span>
              <button class="icon-btn sm" aria-label={`Remove ${t.title} from ${p.name}`}
                onClick={() => updatePlaylist(p.id, { trackIds: p.trackIds.filter(id => id !== t.id) })}>
                <Icon name="close" size={15} />
              </button>
            </li>
          ))}
        </ol>
      )}
    </li>
  )
}
