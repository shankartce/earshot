// Emoji picker: search, recently used, and a curated set by category. Used for song reactions,
// message reactions and the chat composer.
import { useState } from 'preact/hooks'
import { EMOJI_GROUPS, noteEmoji, recentEmoji, searchEmoji } from '../utils/emoji.ts'
import { Sheet } from './ui.tsx'

export function EmojiPicker({ open, onClose, onPick, title = 'Pick an emoji' }: {
  open: boolean; onClose: () => void; onPick: (emoji: string) => void; title?: string
}) {
  const [q, setQ] = useState('')
  const pick = (e: string) => {
    noteEmoji(e)
    onPick(e)
    setQ('')
    onClose()
  }
  const found = q.trim() ? searchEmoji(q) : null
  const recent = recentEmoji()
  const grid = (list: string[], label: string) => (
    <div class="emoji-grid" role="group" aria-label={label}>
      {list.map(e => <button key={e} type="button" class="emoji-cell" onClick={() => pick(e)} aria-label={e}>{e}</button>)}
    </div>
  )
  return (
    <Sheet open={open} onClose={() => { setQ(''); onClose() }} title={title}>
      <input class="input emoji-search" type="search" placeholder="Search emoji" aria-label="Search emoji"
        value={q} onInput={e => setQ(e.currentTarget.value)} />
      <div class="emoji-scroll">
        {found ? (
          found.length ? grid(found.map(x => x.e), 'Results') : <p class="muted small emoji-none">No emoji for “{q}”. Your keyboard's emojis work in chat too.</p>
        ) : (
          <>
            {recent.length > 0 && <><h3 class="emoji-h">Recent</h3>{grid(recent, 'Recent')}</>}
            {EMOJI_GROUPS.map(g => (
              <section key={g.name}>
                <h3 class="emoji-h">{g.name}</h3>
                {grid(g.items.map(x => x.e), g.name)}
              </section>
            ))}
          </>
        )}
      </div>
    </Sheet>
  )
}
