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
