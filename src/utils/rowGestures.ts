// Touch gestures for list rows (the queue): swipe a row sideways for an action, or press and hold
// to pick it up and drag it to a new spot. Vertical scrolling stays native until a row is held.
import { useEffect, useRef } from 'preact/hooks'

/** Where a dragged row lands: how many of the other rows' midpoints lie above the finger. */
export function dropIndex(mids: number[], y: number, from: number): number {
  let to = 0
  mids.forEach((m, i) => { if (i !== from && y > m) to++ })
  return to
}

export type SwipeDir = 'left' | 'right'
export interface RowGestureOptions {
  canDrag: (key: string) => boolean
  canSwipe: (key: string, dir: SwipeDir) => boolean
  onSwipe: (key: string, dir: SwipeDir) => void
  onDrop: (from: number, to: number) => void
}

const HOLD_MS = 380
const SWIPE_AT = 80

/**
 * Attach to an <ol>/<ul> (via its ref) whose rows are `li[data-key]`. Mouse users keep native drag
 * and drop. `mounted` re-binds when the list appears (e.g. after the queue was empty).
 */
export function useRowGestures(ref: { current: HTMLElement | null }, opts: RowGestureOptions, mounted: boolean) {
  const o = useRef(opts)
  o.current = opts
  useEffect(() => {
    const list = ref.current
    if (!list) return
    type State = { row: HTMLElement; key: string; x: number; y: number; id: number; mode: 'pending' | 'swipe' | 'drag' | 'scroll' }
    let s: State | null = null
    let hold: ReturnType<typeof setTimeout> | undefined
    let rows: HTMLElement[] = []
    let mids: number[] = []
    let from = -1
    let step = 0

    const swallowClick = () => {
      const stop = (e: Event) => { e.preventDefault(); e.stopPropagation() }
      list.addEventListener('click', stop, { capture: true, once: true })
      setTimeout(() => list.removeEventListener('click', stop, { capture: true }), 400)
    }
    const reset = () => {
      clearTimeout(hold)
      for (const r of rows) { r.style.transform = ''; r.classList.remove('lifted', 'shifting') }
      if (s) { s.row.style.removeProperty('--sx'); s.row.classList.remove('swiping', 'swipe-left', 'swipe-right', 'armed') }
      rows = []
      s = null
    }

    const down = (e: PointerEvent) => {
      if (!e.isPrimary || e.button !== 0 || e.pointerType === 'mouse') return
      const row = (e.target as HTMLElement).closest<HTMLElement>('li[data-key]')
      if (!row || !list.contains(row) || (e.target as HTMLElement).closest('.q-more')) return
      s = { row, key: row.dataset.key!, x: e.clientX, y: e.clientY, id: e.pointerId, mode: 'pending' }
      if (o.current.canDrag(s.key)) {
        hold = setTimeout(() => {
          if (!s || s.mode !== 'pending') return
          s.mode = 'drag'
          rows = [...list.querySelectorAll<HTMLElement>(':scope > li[data-key]')]
          from = rows.indexOf(s.row)
          const rects = rows.map(r => r.getBoundingClientRect())
          mids = rects.map(r => r.top + r.height / 2)
          step = rects.length > 1 ? Math.abs(rects[1].top - rects[0].top) : rects[0].height
          s.row.classList.add('lifted')
          for (const r of rows) if (r !== s.row) r.classList.add('shifting')
          try { s.row.setPointerCapture(s.id) } catch { /* pointer gone */ }
        }, HOLD_MS)
      }
    }
    const move = (e: PointerEvent) => {
      if (!s || e.pointerId !== s.id) return
      const dx = e.clientX - s.x
      const dy = e.clientY - s.y
      if (s.mode === 'pending') {
        if (Math.abs(dx) > 12 && Math.abs(dx) > Math.abs(dy) * 1.2) {
          clearTimeout(hold)
          s.mode = 'swipe'
          s.row.classList.add('swiping')
          try { s.row.setPointerCapture(s.id) } catch { /* pointer gone */ }
        } else if (Math.abs(dy) > 8 || Math.abs(dx) > 8) {
          clearTimeout(hold)
          s.mode = 'scroll'
          return
        } else return
      }
      if (s.mode === 'swipe') {
        const dir: SwipeDir = dx < 0 ? 'left' : 'right'
        const allowed = o.current.canSwipe(s.key, dir)
        const shown = allowed ? Math.max(-140, Math.min(140, dx)) : dx / 6 // resist when not allowed
        s.row.style.setProperty('--sx', `${shown}px`)
        s.row.classList.toggle('swipe-left', dx < 0)
        s.row.classList.toggle('swipe-right', dx > 0)
        s.row.classList.toggle('armed', allowed && Math.abs(dx) > SWIPE_AT)
      } else if (s.mode === 'drag') {
        s.row.style.transform = `translateY(${dy}px)`
        const to = dropIndex(mids, mids[from] + dy, from)
        rows.forEach((r, j) => {
          if (r === s!.row) return
          const shift = from < to && j > from && j <= to ? -step : to < from && j >= to && j < from ? step : 0
          r.style.transform = shift ? `translateY(${shift}px)` : ''
        })
      }
    }
    const up = (e: PointerEvent) => {
      if (!s || e.pointerId !== s.id) return
      const dx = e.clientX - s.x
      const dy = e.clientY - s.y
      const { key, mode } = s
      if (mode === 'swipe') {
        swallowClick()
        const dir: SwipeDir = dx < 0 ? 'left' : 'right'
        reset()
        if (Math.abs(dx) > SWIPE_AT && o.current.canSwipe(key, dir)) o.current.onSwipe(key, dir)
        return
      }
      if (mode === 'drag') {
        swallowClick()
        const to = dropIndex(mids, mids[from] + dy, from)
        const f = from
        reset()
        if (to !== f) o.current.onDrop(f, to)
        return
      }
      reset()
    }
    // While a row is held, the page mustn't scroll under the finger (and no long-press menu).
    const touchmove = (e: TouchEvent) => { if (s?.mode === 'drag') e.preventDefault() }
    const context = (e: Event) => { if (s && s.mode !== 'scroll') e.preventDefault() }

    list.addEventListener('pointerdown', down)
    list.addEventListener('pointermove', move)
    list.addEventListener('pointerup', up)
    list.addEventListener('pointercancel', reset)
    list.addEventListener('touchmove', touchmove, { passive: false })
    list.addEventListener('contextmenu', context)
    return () => {
      reset()
      list.removeEventListener('pointerdown', down)
      list.removeEventListener('pointermove', move)
      list.removeEventListener('pointerup', up)
      list.removeEventListener('pointercancel', reset)
      list.removeEventListener('touchmove', touchmove)
      list.removeEventListener('contextmenu', context)
    }
  }, [mounted])
}
