// View state that isn't shared with the room.
import { effect, signal } from '@preact/signals'
import { roomCode } from './room.ts'

/** Phone layout: which part of the room fills the screen. */
export const mobileTab = signal<'room' | 'queue' | 'chat'>('room')

/** The stage shows artwork or synced lyrics. */
export const stageView = signal<'art' | 'lyrics'>('art')

// Entering or leaving a room starts from its main view.
effect(() => {
  roomCode.value
  mobileTab.value = 'room'
})

/** Smooth hand-off between views where the browser supports it (View Transitions API). */
export function transition(update: () => void) {
  const d = document as Document & { startViewTransition?: (cb: () => void) => unknown }
  if (d.startViewTransition && !matchMedia('(prefers-reduced-motion: reduce)').matches) d.startViewTransition(update)
  else update()
}
