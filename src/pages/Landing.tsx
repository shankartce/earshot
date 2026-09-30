import { Icon } from '../components/icons.tsx'
import { Equalizer } from '../components/ui.tsx'
import { forgetRoom, recentRooms } from '../state/profile.ts'
import { room } from '../state/room.ts'

export function Landing() {
  return (
    <main class="landing">
      <div class="aurora" aria-hidden="true"><i /><i /><i /></div>
      <div class="rings" aria-hidden="true"><i /><i /><i /></div>

      <nav class="top-nav">
        <a href="/" class="brand" aria-label="Free Jam home"><span class="brand-mark"><Equalizer /></span> Free Jam</a>
        <div class="row">
          <a href="/library" class="btn ghost sm">Library</a>
          <a href="/settings" class="icon-btn" aria-label="Settings"><Icon name="settings" /></a>
        </div>
      </nav>

      <section class="hero">
        <p class="eyebrow">Shared listening, local music</p>
        <h1 class="display">Listen together,<br /><span class="grad">wherever you are.</span></h1>
        <p class="lede">Create a room. Invite a friend. Press play. Everyone hears the same moment of the same song — from their own files.</p>
        <div class="cta-row">
          <a href="/create" class="btn primary big"><Icon name="plus" /> Create a room</a>
          <a href="/join" class="btn big">Join a room</a>
        </div>
      </section>

      <RecentRooms />

      <section class="steps" aria-label="How it works">
        {[
          ['1', 'Open a room', 'Pick a name and a vibe. You get a short code to share.'],
          ['2', 'Bring your music', 'Everyone adds their own copies. Matching songs are recognised automatically.'],
          ['3', 'Hang out', 'Play, skip, react and chat — in sync, like you’re on the same couch.'],
        ].map(([n, t, d]) => (
          <article key={n} class="step">
            <span class="step-n">{n}</span>
            <h2>{t}</h2>
            <p>{d}</p>
          </article>
        ))}
      </section>

      <p class="privacy-note">
        <Icon name="check" size={16} /> Your audio never leaves your device. Rooms share only song details and play state.
      </p>
    </main>
  )
}

/** "Resume this room": rooms you've been in on this device (your seat is kept by a private token). */
function RecentRooms() {
  const rooms = recentRooms.value
  if (!rooms.length) return null
  const ago = (t: number) => {
    const m = Math.round((Date.now() - t) / 60000)
    return m < 1 ? 'just now' : m < 60 ? `${m} min ago` : m < 1440 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} d ago`
  }
  return (
    <section class="recent-rooms" aria-labelledby="recent-h">
      <h2 id="recent-h" class="section-h">Jump back in</h2>
      <ul role="list">
        {rooms.map(r => (
          <li key={r.code} class="recent-room">
            <a href={`/room/${r.code}`} class="recent-link">
              <span class="room-emoji" aria-hidden="true">{r.emoji}</span>
              <span class="q-text">
                <span class="q-title">{r.name}</span>
                <span class="q-sub">{room.value?.code === r.code ? 'You’re in this room' : `${r.code} · ${ago(r.at)}`}</span>
              </span>
              <span class="btn sm">{room.value?.code === r.code ? 'Open' : 'Resume'}</span>
            </a>
            <button class="icon-btn sm" aria-label={`Forget ${r.name}`} onClick={() => forgetRoom(r.code)}><Icon name="close" size={16} /></button>
          </li>
        ))}
      </ul>
    </section>
  )
}
