// Pure chat display helpers.
import type { ChatMessage } from '../../shared/types.ts'

/** Consecutive messages from one person within 3 minutes share one header; `breakAt` (a message id) starts a new run. */
export function groupMessages(msgs: ChatMessage[], gapMs = 3 * 60_000, breakAt?: string) {
  const groups: { authorId: string; at: number; messages: ChatMessage[] }[] = []
  for (const m of msgs) {
    const last = groups.at(-1)
    if (last && last.authorId === m.authorId && m.at - last.messages.at(-1)!.at < gapMs && m.id !== breakAt) last.messages.push(m)
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

/** Index of the first message after `since` written by someone else (the "New messages" line), or -1. */
export function firstNewIndex(msgs: ChatMessage[], since: number, me: string): number {
  return since ? msgs.findIndex(m => m.at > since && m.authorId !== me) : -1
}

/**
 * Where focus mode puts things around a pressed message: the emoji bar above it (or below when
 * there's no room above), the actions card below it (or above), all kept inside the viewport.
 */
export function focusLayout(r: { top: number; bottom: number; left: number; right: number }, vh: number, vw: number,
  bar = { h: 52, w: 300 }, card = { h: 104, w: 200 }, gap = 10, pad = 12) {
  const barAbove = r.top - gap - bar.h >= pad
  const barTop = barAbove ? r.top - gap - bar.h : Math.min(r.bottom + gap, vh - pad - bar.h)
  const cardBelow = r.bottom + gap + card.h + (barAbove ? 0 : bar.h + gap) <= vh - pad
  const cardTop = cardBelow ? r.bottom + gap + (barAbove ? 0 : bar.h + gap) : Math.max(pad, r.top - gap - card.h - (barAbove ? bar.h + gap : 0))
  const clampX = (x: number, w: number) => Math.max(pad, Math.min(x, vw - pad - w))
  const mid = (r.left + r.right) / 2
  return { barTop, barLeft: clampX(mid - bar.w / 2, bar.w), cardTop, cardLeft: clampX(mid - card.w / 2, card.w) }
}
