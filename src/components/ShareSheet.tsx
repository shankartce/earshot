// The rights gate: before a song can be copied to friends, its owner states the licence that allows it.
import { useEffect, useState } from 'preact/hooks'
import { LICENSES, type License } from '../../shared/types.ts'
import { setAutoShare, setShare, type LocalTrack } from '../library/library.ts'
import { toast } from '../state/room.ts'
import { Icon } from './icons.tsx'
import { Sheet } from './ui.tsx'

/** Warning + licence picker + attestation, shared by the per-song and the auto-share sheets. */
function RightsGate({ license, setLicense, attested, setAttested, statement }: {
  license: License | ''; setLicense: (l: License) => void; attested: boolean; setAttested: (v: boolean) => void; statement: string
}) {
  return (
    <>
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
        <span>{statement}</span>
      </label>
    </>
  )
}

export function ShareSheet({ track, onClose }: { track: LocalTrack; onClose: () => void }) {
  const [license, setLicense] = useState<License | ''>(track.share?.license ?? '')
  const [attested, setAttested] = useState(!!track.share)
  useEffect(() => { setAttested(!!track.share && license === track.share.license) }, [license])

  return (
    <Sheet open onClose={onClose} title="Let friends get a copy">
      <p class="muted">
        Friends in the room who don't have <strong>“{track.title}”</strong> will get a copy straight from your browser and
        can keep it in their library. It never passes through Earshot's server.
      </p>
      <RightsGate license={license} setLicense={setLicense} attested={attested} setAttested={setAttested}
        statement="I have the right to share this recording, friends may keep a copy, and I take responsibility for sharing it." />
      <p class="hint">Only add music you can share? Turn on <a href="/settings">Share songs I add automatically</a> in Settings.</p>
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

/** One-time attestation that turns on auto-share for every song you add from now on. */
export function AutoShareSheet({ onClose }: { onClose: () => void }) {
  const [license, setLicense] = useState<License | ''>('')
  const [attested, setAttested] = useState(false)
  return (
    <Sheet open onClose={onClose} title="Share songs you add automatically">
      <p class="muted">
        Every song you add to your library or a room's queue will be offered to friends in the room, who get a copy straight
        from your browser and can keep it. Songs friends shared with you are never passed on.
      </p>
      <RightsGate license={license} setLicense={setLicense} attested={attested} setAttested={setAttested}
        statement="I only add music I have the right to share (my own or openly licensed), friends may keep a copy, and I take responsibility for sharing it." />
      <div class="row share-actions">
        <button class="btn ghost" onClick={onClose}>Cancel</button>
        <button class="btn primary" disabled={!license || !attested}
          onClick={() => {
            setAutoShare({ license: license as License, attestedAt: Date.now() })
            toast('Songs you add will be shared with the room')
            onClose()
          }}>
          <Icon name="share" size={18} /> Turn on
        </button>
      </div>
    </Sheet>
  )
}

/** Small "Shared · CC BY" badge. */
export const SharedBadge = ({ license }: { license: License }) => (
  <span class="avail shared" title={`You let friends get a copy (${LICENSES[license]})`}>Shared · {LICENSES[license]}</span>
)
