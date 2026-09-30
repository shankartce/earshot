import { useState } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import type { Profile } from '../../shared/types.ts'
import { unlockAudio } from '../audio/player.ts'
import { Icon } from '../components/icons.tsx'
import { ProfileFields } from '../components/ProfileForm.tsx'
import { copyText, inviteLink } from '../components/RoomSheets.tsx'
import { profile, randomAvatar, ROOM_EMOJI, saveProfile } from '../state/profile.ts'
import { connection, createRoom, room } from '../state/room.ts'
import { BackLink } from './Join.tsx'

export function Create() {
  const { route } = useLocation()
  const [name, setName] = useState('')
  const [emoji, setEmoji] = useState('🌙')
  const [p, setP] = useState<Profile>(profile.value ?? { displayName: '', avatar: randomAvatar() })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<string | null>(null)

  if (created) {
    return (
      <main class="page center">
        <section class="card narrow created" aria-labelledby="created-h">
          <p class="eyebrow ok-text"><Icon name="check" size={16} /> Room created</p>
          <h1 id="created-h" class="display-sm">{room.value?.emoji} {room.value?.name}</h1>
          <div class="code-display big" aria-label={`Room code ${created.split('').join(' ')}`}>
            {created.split('').map((c, i) => <span key={i} style={{ '--i': i }}>{c}</span>)}
          </div>
          <p class="muted center-text mono small">{inviteLink(created)}</p>
          <div class="stack">
            <button class="btn big block" onClick={() => copyText(inviteLink(created), 'Invite link copied')}>
              <Icon name="copy" /> Copy invite link
            </button>
            <button class="btn primary big block" onClick={() => route(`/room/${created}`)}>Enter room</button>
          </div>
        </section>
      </main>
    )
  }

  return (
    <main class="page center">
      <form class="card narrow" onSubmit={async e => {
        e.preventDefault()
        unlockAudio()
        setBusy(true)
        setError(null)
        saveProfile(p)
        const r = await createRoom(name.trim() || 'Listening room', emoji, p)
        setBusy(false)
        if (r.ok) setCreated(r.code)
        else setError(r.error)
      }}>
        <BackLink />
        <h1 class="display-sm">Create a room</h1>
        <label class="field">
          <span class="label">Room name</span>
          <input class="input" value={name} maxLength={40} placeholder="Late Night Drive" onInput={e => setName(e.currentTarget.value)} />
        </label>
        <fieldset class="field">
          <legend class="label">Room emoji</legend>
          <div class="chip-grid" role="radiogroup" aria-label="Room emoji">
            {ROOM_EMOJI.map(x => (
              <button type="button" key={x} role="radio" aria-checked={emoji === x} aria-label={`Room emoji ${x}`}
                class={`chip emoji${emoji === x ? ' on' : ''}`} onClick={() => setEmoji(x)}>{x}</button>
            ))}
          </div>
        </fieldset>
        <hr class="sep" />
        <ProfileFields value={p} onChange={setP} />
        {error && <p class="form-error" role="alert">{error}</p>}
        <button class="btn primary big block" disabled={busy || !p.displayName.trim() || connection.value !== 'online'}>
          {busy ? 'Creating…' : connection.value !== 'online' ? 'Connecting…' : 'Create room'}
        </button>
      </form>
    </main>
  )
}
