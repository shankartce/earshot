// Who's here, whether each person can hear the current song, and their profile card.
import { signal } from '@preact/signals'
import { useState } from 'preact/hooks'
import type { Participant, Profile } from '../../shared/types.ts'
import { profile as myProfile } from '../state/profile.ts'
import { currentItem, isHost, makeHost, me, removePerson, room, shownPlaying, toast, updateProfile } from '../state/room.ts'
import { Icon } from './icons.tsx'
import { ProfileFields } from './ProfileForm.tsx'
import { Avatar, Empty, Equalizer, Sheet } from './ui.tsx'

/** Whose profile card is open (tap anyone's avatar or name, in the people list, chat or header). */
const openId = signal<string | null>(null)
export const openProfile = (pid: string) => { openId.value = pid }

function statusOf(p: Participant, hasSong: boolean, playing: boolean) {
  if (!p.isOnline) return { text: 'Reconnecting…', cls: 'faint' }
  if (!hasSong) return { text: p.isAway ? 'Away' : 'Here', cls: p.isAway ? 'warn' : '' }
  switch (p.readiness) {
    case 'ready': return { text: p.isAway ? 'Listening · away' : playing ? 'Listening' : 'Ready', cls: 'ok' }
    case 'missing': return { text: 'Local file missing', cls: 'warn', icon: true }
    case 'loading': return { text: 'Getting ready…', cls: 'faint' }
    case 'needs-tap': return { text: 'Needs a tap to listen', cls: 'warn' }
    default: return { text: 'Joining…', cls: 'faint' }
  }
}

export function Participants({ onInvite }: { onInvite: () => void }) {
  const r = room.value!
  const hasSong = !!currentItem.value
  const playing = shownPlaying.value
  const online = r.participants.filter(p => p.isOnline).sort((a, b) => a.joinedAt - b.joinedAt)
  const alone = online.length <= 1

  return (
    <section class="panel" aria-labelledby="people-h">
      <header class="panel-head">
        <h2 id="people-h">In the room <span class="count">{online.length}</span></h2>
        <button class="btn ghost sm" onClick={onInvite}><Icon name="plus" size={16} /> Invite</button>
      </header>
      <ul class="people" role="list">
        {online.map(p => {
          const s = statusOf(p, hasSong, playing)
          const listening = playing && hasSong && p.readiness === 'ready'
          return (
            <li key={p.id} class="person">
              <button class="person-open" onClick={() => openProfile(p.id)} aria-label={`${p.displayName}${p.id === me.value ? ' (you)' : ''}: open profile`} />
              <span class={`presence ${p.isAway ? 'away' : 'on'}`}>
                <Avatar avatar={p.avatar} size={38} ring={listening} />
              </span>
              <div class="grow">
                <p class="person-name">
                  {p.displayName}
                  {p.id === me.value && <span class="tag">you</span>}
                  {p.id === r.hostId && <span class="tag host" title="Host"><Icon name="crown" size={12} /> host</span>}
                </p>
                <p class={`person-status ${s.cls}`}>
                  {s.icon && <Icon name="warn" size={13} />} {s.text}
                </p>
              </div>
              {listening && <Equalizer label={`${p.displayName} is listening`} />}
            </li>
          )
        })}
      </ul>
      {alone && (
        <Empty icon="users" title="Your room is quiet.">
          <p>Invite someone to start listening together.</p>
          <button class="btn sm" onClick={onInvite}><Icon name="link" size={16} /> Copy invite</button>
        </Empty>
      )}
    </section>
  )
}

const minutes = (ms: number) => {
  const m = Math.max(1, Math.round(ms / 60_000))
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`
}

/** Mounted once per room: the card for whoever's avatar was tapped. */
export function ProfileSheet() {
  const r = room.value
  const p = r?.participants.find(x => x.id === openId.value)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState<Profile | null>(null)
  const [confirmRemove, setConfirmRemove] = useState(false)
  if (!r || !p) return null
  const close = () => { openId.value = null; setEditing(false); setConfirmRemove(false) }
  const mine = p.id === me.value
  const s = statusOf(p, !!currentItem.value, shownPlaying.value)
  const value = draft ?? myProfile.value ?? { displayName: p.displayName, avatar: p.avatar }

  return (
    <Sheet open onClose={close} title={mine ? 'Your profile' : p.displayName}>
      {editing ? (
        <form class="profile-edit" onSubmit={async e => {
          e.preventDefault()
          const res = await updateProfile(value)
          if (res.ok) { toast('Profile updated'); setEditing(false); setDraft(null) }
        }}>
          <ProfileFields value={value} onChange={setDraft} autoFocus />
          <div class="row end">
            <button type="button" class="btn ghost" onClick={() => { setEditing(false); setDraft(null) }}>Cancel</button>
            <button class="btn primary" disabled={!value.displayName.trim()}>Save</button>
          </div>
        </form>
      ) : (
        <div class="profile-card">
          <Avatar avatar={p.avatar} size={88} ring={s.cls === 'ok' && shownPlaying.value} />
          <p class="profile-name">
            {p.displayName}
            {mine && <span class="tag">you</span>}
            {p.id === r.hostId && <span class="tag host"><Icon name="crown" size={12} /> host</span>}
          </p>
          <p class={`person-status ${s.cls}`}>{s.text}</p>
          <p class="muted small">In the room for {minutes(Date.now() - p.joinedAt)}</p>
          <div class="profile-actions">
            {mine && <button class="btn primary" onClick={() => setEditing(true)}><Icon name="settings" size={16} /> Edit profile</button>}
            {mine && <a class="btn ghost" href="/settings" onClick={close}>App settings</a>}
            {!mine && isHost.value && p.isOnline && (
              <button class="btn" onClick={async () => { if ((await makeHost(p.id)).ok) { toast(`${p.displayName} is now the host`); close() } }}>
                <Icon name="crown" size={16} /> Make host
              </button>
            )}
            {!mine && isHost.value && (confirmRemove ? (
              <div class="confirm-row">
                <span class="small">Remove {p.displayName}? They can rejoin with the link.</span>
                <button class="btn ghost sm" onClick={() => setConfirmRemove(false)}>Cancel</button>
                <button class="btn danger sm" onClick={async () => { if ((await removePerson(p.id)).ok) close() }}>Remove</button>
              </div>
            ) : (
              <button class="btn ghost danger-text" onClick={() => setConfirmRemove(true)}><Icon name="leave" size={16} /> Remove from room</button>
            ))}
          </div>
        </div>
      )}
    </Sheet>
  )
}
