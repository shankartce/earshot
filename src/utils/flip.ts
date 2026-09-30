// FLIP: when list items change position, animate them from where they were to where they are.
import { useLayoutEffect, useRef } from 'preact/hooks'

const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches

export function useFlip<T extends HTMLElement>(dep: unknown) {
  const ref = useRef<T>(null)
  const last = useRef(new Map<string, number>())
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const next = new Map<string, number>()
    for (const child of el.children as HTMLCollectionOf<HTMLElement>) {
      const key = child.dataset.key
      if (!key) continue
      const top = child.getBoundingClientRect().top
      next.set(key, top)
      const before = last.current.get(key)
      if (before !== undefined && Math.abs(before - top) > 1 && !reduced()) {
        child.animate([{ transform: `translateY(${before - top}px)` }, { transform: 'none' }],
          { duration: 280, easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)' })
      }
    }
    last.current = next
  }, [dep])
  return ref
}
