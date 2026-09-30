import { Icon } from '../components/icons.tsx'
import { Equalizer } from '../components/ui.tsx'

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
