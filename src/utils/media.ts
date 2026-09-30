import { useEffect, useState } from 'preact/hooks'

/** Live `matchMedia` result, for layout decisions CSS alone can't make (like which panels to mount). */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const on = () => setMatch(mq.matches)
    mq.addEventListener('change', on)
    addEventListener('resize', on) // some emulated/embedded viewports resize without a 'change' event
    on()
    return () => {
      mq.removeEventListener('change', on)
      removeEventListener('resize', on)
    }
  }, [query])
  return match
}

/** ←/→/Home/End between tabs in a role="tablist" (standard ARIA tabs keyboard pattern). */
export function tabKeys(e: KeyboardEvent) {
  const tabs = [...(e.currentTarget as HTMLElement).querySelectorAll<HTMLElement>('[role=tab]')]
  const i = tabs.indexOf(document.activeElement as HTMLElement)
  if (i === -1) return
  const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: tabs.length - 1 }[e.key]
  if (next === undefined) return
  e.preventDefault()
  const t = tabs[(next + tabs.length) % tabs.length]
  t.focus()
  t.click()
}
