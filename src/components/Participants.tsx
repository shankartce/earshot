// Who's here, and whether each person can hear the current song.
import type { Participant } from '../../shared/types.ts'
import { currentItem, me, room } from '../state/room.ts'
import { Icon } from './icons.tsx'
import { Avatar, Empty, Equalizer } from './ui.tsx'

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
  const playing = r.playback.isPlaying
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
