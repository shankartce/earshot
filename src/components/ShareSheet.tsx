// The rights gate: before a song can be copied to friends, its owner states the licence that allows it.
import { useEffect, useState } from 'preact/hooks'
import { LICENSES, type License } from '../../shared/types.ts'
import { setShare, type LocalTrack } from '../library/library.ts'
import { toast } from '../state/room.ts'
import { Icon } from './icons.tsx'
import { Sheet } from './ui.tsx'

export function ShareSheet({ track, onClose }: { track: LocalTrack; onClose: () => void }) {
  const [license, setLicense] = useState<License | ''>(track.share?.license ?? '')
  const [attested, setAttested] = useState(!!track.share)
  useEffect(() => { setAttested(!!track.share && license === track.share.license) }, [license])

  return (
    <Sheet open onClose={onClose} title="Let friends get a copy">
      <p class="muted">
        Friends in the room who don't have <strong>“{track.title}”</strong> will be able to get a temporary copy straight from
        your browser. It isn't uploaded to Earshot, and it disappears from their device when they leave.
      </p>
      <div class="note share-warn">
        <Icon name="warn" size={16} />
        <span>Only share music you have the right to share. Songs you bought, streamed or ripped from a CD usually <strong>can't</strong> be shared.</span>
      </div>
      <label class="field">
        <span class="label">Why can this be shared?</span>
        <select class="input" value={license} onChange={e => setLicense(e.currentTarget.value as License)}>
          <option value="" disabled>Choose a licence…</option>
          {(Object.keys(LICENSES) as License[]).map(k => <option key={k} value={k}>{LICENSES[k]}</option>)}
        </select>
      </label>
      <label class="check-row">
        <input type="checkbox" checked={attested} disabled={!license} onChange={e => setAttested(e.currentTarget.checked)} />
        <span>I have the right to share this recording, and I take responsibility for sharing it.</span>
      </label>
      <div class="row share-actions">
        {track.share && (
          <button class="btn ghost" onClick={() => { setShare(track.id, null); toast(`Stopped sharing “${track.title}”`); onClose() }}>
            Stop sharing
          </button>
        )}
        <button class="btn primary" disabled={!license || !attested}
          onClick={() => {
            setShare(track.id, license as License)
            toast(`Friends can now get a copy of “${track.title}”`)
            onClose()
          }}>
          <Icon name="share" size={18} /> {track.share ? 'Update' : 'Share with the room'}
        </button>
      </div>
    </Sheet>
  )
}

/** Small "Shared · CC BY" badge. */
export const SharedBadge = ({ license }: { license: License }) => (
  <span class="avail shared" title={`You let friends get a copy (${LICENSES[license]})`}>Shared · {LICENSES[license]}</span>
)
