import { useEffect, useState } from 'preact/hooks'

/** Live `matchMedia` result, for layout decisions CSS alone can't make (like which panels to mount). */
export function useMedia(query: string): boolean {
  const [match, setMatch] = useState(() => matchMedia(query).matches)
  useEffect(() => {
    const mq = matchMedia(query)
    const on = () => setMatch(mq.matches)
    mq.addEventListener('change', on)
    on()
    return () => mq.removeEventListener('change', on)
  }, [query])
  return match
}
