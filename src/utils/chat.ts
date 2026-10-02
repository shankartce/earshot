// Pure chat display helpers.
import type { ChatMessage } from '../../shared/types.ts'

/** Consecutive messages from one person within 3 minutes share one header. */
export function groupMessages(msgs: ChatMessage[], gapMs = 3 * 60_000) {
  const groups: { authorId: string; at: number; messages: ChatMessage[] }[] = []
  for (const m of msgs) {
    const last = groups.at(-1)
    if (last && last.authorId === m.authorId && m.at - last.messages.at(-1)!.at < gapMs) last.messages.push(m)
    else groups.push({ authorId: m.authorId, at: m.at, messages: [m] })
  }
  return groups
}

export function typingText(names: string[]) {
  if (!names.length) return ''
  if (names.length === 1) return `${names[0]} is typing…`
  if (names.length === 2) return `${names[0]} and ${names[1]} are typing…`
  return 'Several people are typing…'
}

/** A centered time label goes before a run that starts a new conversation (first, or after a 10 min lull). */
export const needsSeparator = (prevAt: number | null, at: number, gapMs = 10 * 60_000) => prevAt === null || at - prevAt >= gapMs

/** "14:05", or "Mon 14:05" / "3 Oct 14:05" for older days. */
export function separatorLabel(at: number, now = Date.now()) {
  const d = new Date(at)
  const time = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
  const days = Math.floor((new Date(now).setHours(0, 0, 0, 0) - new Date(at).setHours(0, 0, 0, 0)) / 86_400_000)
  if (days <= 0) return time
  if (days === 1) return `Yesterday ${time}`
  if (days < 7) return `${d.toLocaleDateString([], { weekday: 'short' })} ${time}`
  return `${d.toLocaleDateString([], { day: 'numeric', month: 'short' })} ${time}`
}

/** Under your latest message: "Seen", or "Seen by Sam, Kim" in bigger rooms. Empty if nobody has. */
export function seenText(names: string[], others: number) {
  if (!names.length) return ''
  if (others <= 1) return 'Seen'
  if (names.length === others) return 'Seen by everyone'
  return `Seen by ${names.slice(0, 3).join(', ')}${names.length > 3 ? ` +${names.length - 3}` : ''}`
}
