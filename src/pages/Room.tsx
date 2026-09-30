// /room/:code — joins (or shows a join gate), then renders the shared listening room.
import { useEffect, useState } from 'preact/hooks'
import { useLocation, useRoute } from 'preact-iso'
import type { RoomPeek } from '../../shared/events.ts'
import type { Profile } from '../../shared/types.ts'
import { parseCode } from '../../shared/validate.ts'
import { driftMs, readiness, unlockAudio } from '../audio/player.ts'
import { Icon } from '../components/icons.tsx'
import { NowPlaying } from '../components/NowPlaying.tsx'
import { Participants } from '../components/Participants.tsx'
import { ProfileFields } from '../components/ProfileForm.tsx'
import { Chat } from '../components/Chat.tsx'
import { Queue } from '../components/Queue.tsx'
import { Announcer } from '../components/Reactions.tsx'
import { unread } from '../state/social.ts'
import { useMedia } from '../utils/media.ts'
import { copyText, inviteLink, SettingsSheet, ShareSheet } from '../components/RoomSheets.tsx'
import { Avatar, ConnectionPill, Empty } from '../components/ui.tsx'
import { clock } from '../realtime/socket.ts'
import { profile, randomAvatar, saveProfile, tokenFor } from '../state/profile.ts'
import { connection, currentItem, joinRoom, leaveRoom, peekRoom, room } from '../state/room.ts'
import { hues } from '../utils/format.ts'

export function RoomPage() {
  const { params } = useRoute()
  const code = parseCode(params.code)
  const [error, setError] = useState<string | null>(code ? null : "That room isn't available.")
  const [joining, setJoining] = useState(false)
  const inRoom = room.value?.code === code

  // Returning to a room we have a token for (reload, reconnect, resume): rejoin without asking.
  useEffect(() => {
    if (!code || inRoom || !profile.value || !tokenFor(code) || connection.value !== 'online') return
    setJoining(true)
    joinRoom(code, profile.value).then(r => {
      setJoining(false)
      if (!r.ok) setError(r.error)
    })
  }, [code, connection.value])

  if (error) return <RoomUnavailable message={error} />
  if (inRoom) return <RoomView />
  if (joining || (code && tokenFor(code) && profile.value)) return <div class="page center"><p class="muted pulse">Joining the room…</p></div>
  return <JoinGate code={code!} onError={setError} />
}

function RoomUnavailable({ message }: { message: string }) {
  return (
    <main class="page center">
      <div class="card narrow">
        <Empty icon="warn" title={message}>
          <p>It may have expired, or the code might be mistyped.</p>
          <div class="row">
            <a class="btn" href="/join">Try another code</a>
            <a class="btn primary" href="/create">Create a room</a>
          </div>
        </Empty>
      </div>
    </main>
  )
}

function JoinGate({ code, onError }: { code: string; onError: (e: string) => void }) {
  const [peek, setPeek] = useState<RoomPeek | null>(null)
  const [p, setP] = useState<Profile>(profile.value ?? { displayName: '', avatar: randomAvatar() })
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (connection.value !== 'online') return
    peekRoom(code).then(r => (r.ok ? setPeek(r) : onError(r.error)))
  }, [code, connection.value])

  const listening = peek?.online ?? []
  return (
    <main class="page center">
      <form class="card narrow join-gate" onSubmit={async e => {
        e.preventDefault()
        unlockAudio()
        setBusy(true)
        saveProfile(p)
        const r = await joinRoom(code, p)
        setBusy(false)
        if (!r.ok) onError(r.error)
      }}>
        <p class="eyebrow">You're invited</p>
        <h1 class="display-sm">{peek ? <>{peek.emoji} {peek.name}</> : <span class="pulse">Finding the room…</span>}</h1>
        {peek && (
          <div class="who-listening">
            <span class="avatar-stack">{listening.slice(0, 5).map((x, i) => <Avatar key={i} avatar={x.avatar} size={30} />)}</span>
            <span class="muted">
              {listening.length === 0 ? 'Nobody is here yet — be the first.'
                : listening.length === 1 ? `${listening[0].displayName} is listening`
                  : `${listening[0].displayName} and ${listening.length - 1} other${listening.length > 2 ? 's' : ''} are listening`}
            </span>
          </div>
        )}
        <ProfileFields value={p} onChange={setP} autoFocus={!p.displayName} />
        <button class="btn primary big block" disabled={busy || !p.displayName.trim() || !peek}>
          {busy ? 'Joining…' : 'Join room'}
        </button>
      </form>
    </main>
  )
}

function RoomView() {
  const r = room.value!
  const { route } = useLocation()
  const [share, setShare] = useState(false)
  const [settings, setSettings] = useState(false)
  const [h1, h2] = hues(currentItem.value?.track.id)
  const debug = new URLSearchParams(location.search).has('debug')
  const online = r.participants.filter(p => p.isOnline)
  const wide = useMedia('(min-width: 1360px)')

  return (
    <div class={`room${r.playback.isPlaying ? ' playing' : ''}`} style={{ '--h1': h1, '--h2': h2 }}>
      <div class="room-glow" aria-hidden="true" />
      <header class="room-head">
        <div class="room-title">
          <span class="room-emoji" aria-hidden="true">{r.emoji}</span>
          <div>
            <h1 class="room-name">{r.name}</h1>
            <button class="code-chip" onClick={() => copyText(inviteLink(r.code), 'Invite link copied')} aria-label={`Room code ${r.code}. Copy invite link`}>
              {r.code} <Icon name="copy" size={13} />
            </button>
          </div>
        </div>
        <div class="room-actions">
          <ConnectionPill />
          <button class="avatar-stack as-btn" onClick={() => setShare(true)} aria-label={`${online.length} ${online.length === 1 ? 'person' : 'people'} in the room. Invite more`}>
            {online.slice(0, 4).map(p => <Avatar key={p.id} avatar={p.avatar} size={30} />)}
          </button>
          <button class="btn sm primary" onClick={() => setShare(true)}><Icon name="share" size={16} /> <span class="hide-sm">Invite</span></button>
          <button class="icon-btn" onClick={() => setSettings(true)} aria-label="Room settings"><Icon name="settings" /></button>
          <button class="icon-btn" onClick={() => { leaveRoom(); route('/') }} aria-label="Leave room"><Icon name="leave" /></button>
        </div>
      </header>

      <main class={`room-grid${wide ? ' three' : ''}`}>
        <NowPlaying />
        <aside class="room-side">
          <Participants onInvite={() => setShare(true)} />
          {wide ? <Queue /> : <QueueChatTabs />}
        </aside>
        {wide && <aside class="room-chat"><Chat /></aside>}
      </main>

      <ShareSheet open={share} onClose={() => setShare(false)} />
      <SettingsSheet open={settings} onClose={() => setSettings(false)} />
      <Announcer />
      {debug && (
        <pre class="debug" aria-hidden="true">
          {`offset ${clock.offset.toFixed(1)}ms  rtt ${clock.rtt.toFixed(1)}ms\n`}
          {`drift ${driftMs.value}ms  ${readiness.value}\n`}
          {`pb v${r.playback.version}  queue v${r.queue.version}`}
        </pre>
      )}
    </div>
  )
}

/** Below the wide breakpoint, queue and chat share one panel. */
function QueueChatTabs() {
  const [tab, setTab] = useState<'queue' | 'chat'>('queue')
  return (
    <div class="side-tabs">
      <div class="segmented tabs" role="tablist" aria-label="Queue and chat">
        <button role="tab" aria-selected={tab === 'queue'} class={tab === 'queue' ? 'on' : ''} onClick={() => setTab('queue')}>
          <Icon name="list" size={16} /> Queue
        </button>
        <button role="tab" aria-selected={tab === 'chat'} class={tab === 'chat' ? 'on' : ''} onClick={() => setTab('chat')}>
          <Icon name="chat" size={16} /> Chat
          {unread.value > 0 && <span class="badge" aria-label={`${unread.value} unread`}>{unread.value}</span>}
        </button>
      </div>
      {tab === 'queue' ? <Queue /> : <Chat />}
    </div>
  )
}
