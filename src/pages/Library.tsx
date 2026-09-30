// ponytail: minimal library view; phase 3 replaces it with search/sort/playlists/OPFS persistence.
import { Icon } from '../components/icons.tsx'
import { Cover, Empty, FileButton } from '../components/ui.tsx'
import { importFiles, localTracks } from '../library/library.ts'
import { reportImport } from '../state/actions.ts'
import { fmtTime } from '../utils/format.ts'
import { BackLink } from './Join.tsx'

export function Library() {
  const tracks = [...localTracks.value.values()]
  return (
    <main class="page">
      <div class="card wide">
        <BackLink />
        <header class="panel-head">
          <h1 class="display-sm">Your library</h1>
          <FileButton class="btn primary" onFiles={async f => reportImport(await importFiles(f))}><Icon name="plus" /> Add music</FileButton>
        </header>
        {tracks.length === 0 ? (
          <Empty icon="music" title="Your local library is empty.">
            <p>Add some music to get started. Files stay on this device.</p>
          </Empty>
        ) : (
          <ul class="queue-list" role="list">
            {tracks.map(t => (
              <li key={t.id} class="q-item">
                <div class="q-main">
                  <span class="q-art"><Cover id={t.id} size={44} /></span>
                  <span class="q-text"><span class="q-title">{t.title}</span><span class="q-sub">{t.artist || 'Unknown artist'}</span></span>
                  <span class="q-side"><span class="q-dur">{fmtTime(t.duration)}</span></span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  )
}
