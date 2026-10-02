// /library — your local music: import (files, folders, drag & drop), search, sort, playlists, remove.
// Tap a song for its sheet; the + adds it to the room in one tap; "Select" acts on many at once.
import { computed } from '@preact/signals'
import { useEffect, useState } from 'preact/hooks'
import { tabKeys } from '../utils/media.ts'
import { matchesSearch } from '../components/AddMusic.tsx'
import { Icon } from '../components/icons.tsx'
import { ConfirmButton, Cover, DropZone, Empty, FileButton, Sheet } from '../components/ui.tsx'
import {
  addToPlaylist, artUrls, createPlaylist, deletePlaylist, importFiles, importing, libraryReady, localTracks, lostTracks,
  ownTracks, persistentStorage, storagePersisted, playlists, removeTrack, resolveLocal, sharedWithMe, sortedTracks, storageUsage, updatePlaylist,
  type LocalTrack, type Playlist,
} from '../library/library.ts'
import { playNext, queueTracks, reportImport } from '../state/actions.ts'
import { room, toast } from '../state/room.ts'
import { fmtTime } from '../utils/format.ts'
import { LICENSE_URLS, LICENSES } from '../../shared/types.ts'
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

/** Your local songs that are in the room's queue right now (exact file or a confirmed match). */
const inQueue = computed(() => new Set((room.value?.queue.items ?? []).map(i => {
  const r = resolveLocal(i.track)
  return r.status === 'ready' ? r.local.id : i.track.id
})))

async function onImport(files: File[]) {
  const res = await importFiles(files)
  reportImport(res)
  if (res.added) toast(`Added ${res.added} song${res.added === 1 ? '' : 's'} to your library`)
  else if (res.duplicates) toast('Those songs are already in your library')
}

export function Library() {
  const [tab, setTab] = useState<'songs' | 'shared' | 'playlists'>('songs')
  const [usage, setUsage] = useState<{ used: number; quota: number } | null>(null)
  const count = sortedTracks.value.length
  useEffect(() => { storageUsage().then(setUsage) }, [count])

  return (
    <DropZone onFiles={onImport} class="page library-page">
      <div class="card wide lib-card">
        <div class="row between lib-nav">
          <BackLink />
          {room.value && <a class="btn sm ghost" href={`/room/${room.value.code}`}>Back to {room.value.emoji} {room.value.name}</a>}
        </div>
        <header class="lib-head">
          <div>
            <h1 class="display-sm">Library</h1>
            <p class="muted small">
              {count} song{count === 1 ? '' : 's'}{usage && count ? ` · ${mb(usage.used)} on this device` : ''} · never uploaded
            </p>
          </div>
          <div class="row lib-add">
            <FileButton class="btn primary" onFiles={onImport}><Icon name="plus" /> Add files</FileButton>
            <FileButton class="btn" onFiles={onImport} folder><Icon name="folder" /> Folder</FileButton>
          </div>
        </header>

        {!persistentStorage.value ? (
          <p class="note small"><Icon name="warn" size={16} /> This browser won't keep your files after you leave (private browsing?). They'll work for this visit.</p>
        ) : storagePersisted.value === false && count > 0 && (
          <p class="note small"><Icon name="warn" size={16} /> Keep your original files: the browser may clear stored songs if it runs low on space.</p>
        )}
        {lostTracks.value.length > 0 && (
          <p class="note small"><Icon name="warn" size={16} /> Your browser cleared {lostTracks.value.length} song{lostTracks.value.length === 1 ? '' : 's'}: {lostTracks.value.slice(0, 3).map(t => `“${t.title}”`).join(', ')}{lostTracks.value.length > 3 ? '…' : ''}. Add the files again to bring them back.</p>
        )}
        {importing.value && (
          <p class="import-progress" role="status">
            Reading your files… {importing.value.done}/{importing.value.total}
            <span class="bar" style={{ '--p': `${(importing.value.done / Math.max(1, importing.value.total)) * 100}%` }} />
          </p>
        )}

        <div class="segmented tabs lib-tabs" role="tablist" aria-label="Library sections" onKeyDown={tabKeys}>
          <button role="tab" aria-selected={tab === 'songs'} class={tab === 'songs' ? 'on' : ''} onClick={() => setTab('songs')}>Songs</button>
          <button role="tab" aria-selected={tab === 'shared'} class={tab === 'shared' ? 'on' : ''} onClick={() => setTab('shared')}>
            Shared {sharedWithMe.value.length > 0 && <span class="count">{sharedWithMe.value.length}</span>}
          </button>
          <button role="tab" aria-selected={tab === 'playlists'} class={tab === 'playlists' ? 'on' : ''} onClick={() => setTab('playlists')}>
            Playlists {playlists.value.length > 0 && <span class="count">{playlists.value.length}</span>}
          </button>
        </div>

        {!libraryReady.value ? <p class="muted pulse">Opening your library…</p>
          : tab === 'songs' ? <Songs /> : tab === 'shared' ? <SharedWithMe /> : <Playlists />}
      </div>
    </DropZone>
  )
}

function Songs() {
  const [q, setQ] = useState('')
  const [sort, setSort] = useState<Sort>('recent')
  const [open, setOpen] = useState<LocalTrack | null>(null)
  const [selected, setSelected] = useState<ReadonlySet<string> | null>(null) // null: not selecting
  if (!ownTracks.value.length) {
    return (
      <Empty icon="music" title="Your library is empty.">
        <p>Add some music to get started — drop files or a whole folder anywhere on this page.</p>
      </Empty>
    )
  }
  const shown = ownTracks.value.filter(t => matchesSearch(t, q)).sort(SORTS[sort])
  const toggle = (id: string) => setSelected(prev => { // functional: quick taps mustn't read a stale set
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })
  const allShown = !!selected && shown.length > 0 && shown.every(t => selected.has(t.id))
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
            <option value="recent">Recent</option>
            <option value="title">Title</option>
            <option value="artist">Artist</option>
            <option value="album">Album</option>
          </select>
        </label>
        {selected
          ? <button class="btn sm" onClick={() => setSelected(allShown ? new Set() : new Set(shown.map(t => t.id)))}>{allShown ? 'None' : 'All'}</button>
          : <button class="btn sm ghost" onClick={() => setSelected(new Set())}><Icon name="check" size={16} /> Select</button>}
      </div>
      {shown.length === 0 ? <p class="muted center-text">No songs match “{q}”.</p> : (
        <ul class={`lib-list${selected ? ' selecting' : ''}`} role="list">
          {shown.map(t => (
            <SongRow key={t.id} t={t} selected={selected ? selected.has(t.id) : null}
              onOpen={() => (selected ? toggle(t.id) : setOpen(t))} />
          ))}
        </ul>
      )}
      {selected && <SelectBar ids={selected} onDone={() => setSelected(null)} />}
      {open && <SongSheet t={open} onClose={() => setOpen(null)} />}
    </>
  )
}

/** One song. Tap: its sheet (or tick it while selecting). The + adds it to the room and becomes ✓. */
function SongRow({ t, selected, onOpen }: { t: LocalTrack; selected: boolean | null; onOpen: () => void }) {
  const queued = inQueue.value.has(t.id)
  const s = t.sharedBy
  return (
    <li class={`lib-row${selected ? ' picked' : ''}`}>
      <button class="lib-main" onClick={onOpen} aria-pressed={selected ?? undefined}
        aria-label={selected === null ? `${t.title}${t.artist ? ` by ${t.artist}` : ''}: options` : `${selected ? 'Unselect' : 'Select'} ${t.title}`}>
        {selected !== null && <span class={`tick${selected ? ' on' : ''}`} aria-hidden="true">{selected && <Icon name="check" size={14} />}</span>}
        <Cover id={t.id} art={artUrls.value.get(t.id)} size={48} />
        <span class="q-text">
          <span class="q-title">{t.title}</span>
          <span class="q-sub">{[t.artist || 'Unknown artist', t.album].filter(Boolean).join(' · ')}</span>
          {t.share && <SharedBadge license={t.share.license} />}
          {s && <span class="avail shared">Shared by {s.name} · {LICENSES[s.license]}</span>}
        </span>
        <span class="q-dur">{fmtTime(t.duration)}</span>
      </button>
      {room.value && selected === null && (
        <button class={`quick-add${queued ? ' done' : ''}`} aria-label={queued ? `${t.title} is in the queue` : `Add ${t.title} to the queue`}
          onClick={() => queued
            ? toast(`“${t.title}” is already in the queue`, { action: { label: 'Add again', run: () => queueTracks([t]) } })
            : queueTracks([t])}>
          <Icon name={queued ? 'check' : 'plus'} size={18} />
        </button>
      )}
    </li>
  )
}

/** Everything you can do with one song. */
function SongSheet({ t, onClose }: { t: LocalTrack; onClose: () => void }) {
  const [sharing, setSharing] = useState(false)
  const [picking, setPicking] = useState(false)
  const inRoom = !!room.value
  const act = (fn: () => void) => () => { fn(); onClose() }
  if (sharing) return <ShareSheet track={t} onClose={onClose} />
  if (picking) return <PlaylistPicker ids={[t.id]} onClose={onClose} />
  return (
    <Sheet open onClose={onClose} title={t.title}>
      <div class="song-sheet-head">
        <Cover id={t.id} art={artUrls.value.get(t.id)} size={64} />
        <div>
          <p class="muted small">{[t.artist || 'Unknown artist', t.album, fmtTime(t.duration)].filter(Boolean).join(' · ')}</p>
          {t.sharedBy && (
            <p class="avail shared">
              Shared by {t.sharedBy.name} · {LICENSE_URLS[t.sharedBy.license]
                ? <a href={LICENSE_URLS[t.sharedBy.license]} target="_blank" rel="noopener noreferrer">{LICENSES[t.sharedBy.license]}</a>
                : LICENSES[t.sharedBy.license]}
            </p>
          )}
        </div>
      </div>
      <div class="menu-list">
        {inRoom && <button class="menu-item" onClick={act(() => queueTracks([t]))}><Icon name="plus" /> Add to queue</button>}
        {inRoom && <button class="menu-item" onClick={act(() => playNext([t]))}><Icon name="next" /> Play next</button>}
        <button class="menu-item" onClick={() => setPicking(true)}><Icon name="list" /> Add to playlist…</button>
        {!t.sharedBy && (
          <button class="menu-item" onClick={() => setSharing(true)}><Icon name="share" /> {t.share ? 'Sharing with friends — change…' : 'Let friends get a copy…'}</button>
        )}
        <ConfirmButton class="menu-item danger" label={`Remove ${t.title} from this device`} confirmLabel="Tap again to remove from this device"
          onConfirm={act(() => { removeTrack(t.id); toast(`Removed “${t.title}” from this device`) })}>
          <Icon name="trash" /> Remove from this device
        </ConfirmButton>
      </div>
    </Sheet>
  )
}

/** Pick (or create) a playlist for one or more songs. */
function PlaylistPicker({ ids, onClose }: { ids: string[]; onClose: () => void }) {
  const [name, setName] = useState('')
  const add = (p: Playlist) => {
    addToPlaylist(p.id, ids)
    toast(`Added ${ids.length === 1 ? 'it' : `${ids.length} songs`} to ${p.name}`)
    onClose()
  }
  return (
    <Sheet open onClose={onClose} title="Add to playlist">
      <form class="input-row pl-create" onSubmit={e => { e.preventDefault(); if (name.trim()) add(createPlaylist(name)) }}>
        <input class="input" placeholder="New playlist name" value={name} maxLength={60} onInput={e => setName(e.currentTarget.value)} aria-label="New playlist name" />
        <button class="btn primary" disabled={!name.trim()}><Icon name="plus" size={18} /> Create</button>
      </form>
      <div class="menu-list">
        {playlists.value.map(p => (
          <button key={p.id} class="menu-item" onClick={() => add(p)}>
            <Icon name="list" /> {p.name} <span class="menu-hint">{p.trackIds.length}</span>
          </button>
        ))}
      </div>
    </Sheet>
  )
}

/** While selecting: what to do with the ticked songs. Sits just above the dock. */
function SelectBar({ ids, onDone }: { ids: ReadonlySet<string>; onDone: () => void }) {
  const [picking, setPicking] = useState(false)
  const tracks = [...ids].map(id => localTracks.value.get(id)).filter(Boolean) as LocalTrack[]
  const n = tracks.length
  const inRoom = !!room.value
  return (
    <div class="select-bar" role="toolbar" aria-label="Selected songs">
      <span class="select-count">{n ? `${n} selected` : 'Tap songs to select'}</span>
      <div class="row">
        {inRoom && <button class="btn sm primary" disabled={!n} onClick={() => { queueTracks(tracks); onDone() }}><Icon name="plus" size={16} /> Queue</button>}
        {inRoom && <button class="btn sm" disabled={!n} onClick={() => { playNext(tracks); onDone() }}><Icon name="next" size={16} /> Next</button>}
        <button class="icon-btn" disabled={!n} aria-label="Add to playlist" onClick={() => setPicking(true)}><Icon name="list" /></button>
        <ConfirmButton class="icon-btn danger-text" label={`Remove ${n} songs from this device`} confirmLabel="Remove?"
          onConfirm={() => { tracks.forEach(t => removeTrack(t.id)); toast(`Removed ${n} song${n === 1 ? '' : 's'} from this device`); onDone() }}>
          <Icon name="trash" />
        </ConfirmButton>
        <button class="icon-btn" aria-label="Done selecting" onClick={onDone}><Icon name="close" /></button>
      </div>
      {picking && <PlaylistPicker ids={tracks.map(t => t.id)} onClose={() => { setPicking(false); onDone() }} />}
    </div>
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
          {tracks.length === 0 && <li class="muted small">Empty — tap a song in Songs and choose “Add to playlist”.</li>}
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

/** Songs friends sent you after attesting they may share them. The licence travels with the song. */
function SharedWithMe() {
  const [open, setOpen] = useState<LocalTrack | null>(null)
  const tracks = sharedWithMe.value
  if (!tracks.length) {
    return (
      <Empty icon="download" title="Nothing shared with you yet.">
        <p>When a friend lets the room get a copy of their own or openly licensed music, it lands here — and stays.</p>
      </Empty>
    )
  }
  return (
    <>
      <ul class="lib-list" role="list">
        {tracks.map(t => <SongRow key={t.id} t={t} selected={null} onOpen={() => setOpen(t)} />)}
      </ul>
      {open && <SongSheet t={open} onClose={() => setOpen(null)} />}
    </>
  )
}
