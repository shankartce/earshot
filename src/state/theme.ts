// The room's colours follow the current song: its artwork's hues, or the generated cover's when
// there's no artwork. Written to the root so the dock and sheets are tinted too; CSS crossfades them.
import { effect, signal } from '@preact/signals'
import { artUrls, resolveLocal } from '../library/library.ts'
import { hues } from '../utils/format.ts'
import { artHues } from '../utils/palette.ts'
import { currentItem, roomCode } from './room.ts'

export const songHues = signal<[number, number]>(hues(undefined))

let seq = 0
effect(() => {
  const t = currentItem.value?.track
  const local = t ? resolveLocal(t) : null
  const art = local?.status === 'ready' ? artUrls.value.get(local.local.id) : undefined
  const fallback = hues(t?.id)
  const my = ++seq
  if (!art) { songHues.value = fallback; return }
  artHues(art).then(h => { if (my === seq) songHues.value = h ?? fallback })
})

effect(() => {
  const root = document.documentElement
  const [h1, h2] = songHues.value
  if (roomCode.value) {
    root.dataset.room = ''
    root.style.setProperty('--h1', String(h1))
    root.style.setProperty('--h2', String(h2))
  } else {
    delete root.dataset.room
    root.style.removeProperty('--h1')
    root.style.removeProperty('--h2')
  }
})
