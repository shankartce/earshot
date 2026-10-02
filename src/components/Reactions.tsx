// Reactions to the music: a quick bar (plus any emoji via "+"), and a full-screen layer where
// everyone's reactions rise up the screen with the sender's name, Zoom-style.
import { useState } from 'preact/hooks'
import { REACTIONS } from '../../shared/types.ts'
import { participantById, room } from '../state/room.ts'
import { announcement, floats, sendReaction } from '../state/social.ts'
import { EmojiPicker } from './EmojiPicker.tsx'
import { Icon } from './icons.tsx'
import { Avatar } from './ui.tsx'

const NAMES: Record<string, string> = {
  '❤️': 'love', '🔥': 'fire', '😂': 'laughing', '😭': 'crying', '✨': 'sparkles', '🎵': 'music note', '🫶': 'heart hands',
}

export function ReactionBar() {
  const [picking, setPicking] = useState(false)
  if (!room.value?.settings.allowReactions) return null
  return (
    <div class="reactions">
      <div class="reaction-bar" role="group" aria-label="React to this song">
        {REACTIONS.map(e => (
          <button key={e} class="reaction-btn" aria-label={`React with ${NAMES[e] ?? e}`} onClick={() => sendReaction(e)}>{e}</button>
        ))}
        <button class="reaction-btn more" aria-label="More reactions" aria-haspopup="dialog" onClick={() => setPicking(true)}>
          <Icon name="plus" size={18} />
        </button>
      </div>
      <EmojiPicker open={picking} onClose={() => setPicking(false)} onPick={sendReaction} title="React with any emoji" />
    </div>
  )
}

/** Full-screen, purely visual (screen readers get <Announcer/>); never blocks taps. */
export function FloatingReactions() {
  return (
    <div class="reaction-layer" aria-hidden="true">
      {floats.value.map(f => {
        const who = participantById(f.participantId)
        return (
          <span key={f.id} class="rise" style={{ left: `${f.x}%`, '--sway': `${f.sway}px`, '--rise-dur': `${f.dur}ms` }}>
            <span class="rise-inner">
              <span class="rise-emoji">{f.emoji}</span>
              {who && <span class="rise-name"><Avatar avatar={who.avatar} size={16} /> {who.displayName}</span>}
            </span>
          </span>
        )
      })}
    </div>
  )
}

export function Announcer() {
  return <p class="sr-only" role="status" aria-live="polite">{announcement.value}</p>
}
