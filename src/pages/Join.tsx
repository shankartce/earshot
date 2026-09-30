import { useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import type { Profile } from '../../shared/types.ts'
import { CODE_LENGTH, parseCode } from '../../shared/validate.ts'
import { unlockAudio } from '../audio/player.ts'
import { Icon } from '../components/icons.tsx'
import { ProfileFields } from '../components/ProfileForm.tsx'
import { profile, randomAvatar, saveProfile } from '../state/profile.ts'
import { connection, joinRoom } from '../state/room.ts'

export const BackLink = () => <a href="/" class="back-link"><Icon name="arrowLeft" size={16} /> Back</a>

export function Join() {
  const { route, query } = useLocation()
  const [code, setCode] = useState((query.code ?? '').toUpperCase())
  const [p, setP] = useState<Profile>(profile.value ?? { displayName: '', avatar: randomAvatar() })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const valid = parseCode(code)

  return (
    <main class="page center">
      <form class="card narrow" onSubmit={async e => {
        e.preventDefault()
        if (!valid) return setError('Room codes are 5 letters and numbers, like F7K9Q.')
        unlockAudio()
        setBusy(true)
        setError(null)
        saveProfile(p)
        const r = await joinRoom(valid, p)
        setBusy(false)
        if (r.ok) route(`/room/${r.code}`)
        else setError(r.error)
      }}>
        <BackLink />
        <h1 class="display-sm">Join a room</h1>
        <label class="field">
          <span class="label">Room code</span>
          <input class="input code-input" value={code} maxLength={CODE_LENGTH} autoFocus autoComplete="off" autoCapitalize="characters"
            spellcheck={false} placeholder="F7K9Q" aria-describedby="code-hint"
            onInput={e => setCode(e.currentTarget.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))} />
          <span id="code-hint" class="hint">Or just open the invite link your friend sent.</span>
        </label>
        <hr class="sep" />
        <ProfileFields value={p} onChange={setP} />
        {error && <p class="form-error" role="alert">{error}</p>}
        <button class="btn primary big block" disabled={busy || !p.displayName.trim() || code.length < CODE_LENGTH || connection.value !== 'online'}>
          {busy ? 'Joining…' : 'Join room'}
        </button>
      </form>
    </main>
  )
}
