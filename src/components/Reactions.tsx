// Quick reactions to the music, floated over the artwork for everyone in the room.
import { REACTIONS } from '../../shared/types.ts'
import { participantById, room } from '../state/room.ts'
import { announcement, floats, lastReaction, sendReaction } from '../state/social.ts'
import { Avatar } from './ui.tsx'

const NAMES: Record<string, string> = {
  '❤️': 'love', '🔥': 'fire', '😂': 'laughing', '😭': 'crying', '✨': 'sparkles', '🎵': 'music note', '🫶': 'heart hands',
}

export function ReactionBar() {
  if (!room.value?.settings.allowReactions) return null
  const last = lastReaction.value
  return (
    <div class="reactions">
      <div class="reaction-bar" role="group" aria-label="React to this song">
        {REACTIONS.map(e => (
          <button key={e} class="reaction-btn" aria-label={`React with ${NAMES[e] ?? e}`} onClick={() => sendReaction(e)}>{e}</button>
        ))}
      </div>
      <p class="reaction-note" aria-hidden="true">{last ? <span key={last.id}>{last.text}</span> : ' '}</p>
    </div>
  )
}

/** Rendered inside the artwork wrapper; purely visual (announcements go through <Announcer/>). */
export function FloatingReactions() {
  return (
    <div class="floats" aria-hidden="true">
      {floats.value.map(f => {
        const who = participantById(f.participantId)
        return (
          <span key={f.id} class="float" style={{ left: `${f.x}%` }}>
            {who && <Avatar avatar={who.avatar} size={22} />}
            <span class="float-emoji">{f.emoji}</span>
          </span>
        )
      })}
    </div>
  )
}

export function Announcer() {
  return <p class="sr-only" role="status" aria-live="polite">{announcement.value}</p>
}
