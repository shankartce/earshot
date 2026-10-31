// The room's AI DJ: the parts both sides need. Pure, so it's unit-tested.
// The DJ is not a real participant: it has no token, no seat and no powers of its own. Everything it
// does runs through the room reducer as the person who asked, so the room's permissions still apply.
import { cleanText } from './validate.ts'

export { DJ_DEFAULT_NAME, DJ_ID, DJ_NAME_RE } from './types.ts'

export const DJ_LIMITS = { actions: 4, tracksPerAction: 10, reply: 300, playlist: 50, playlistName: 40 }

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

/** If `text` mentions `@name` (any case, as a whole word), the request without the mention; else null. */
export function mentionOf(text: string, name: string): string | null {
  const re = new RegExp(`(^|[^\\p{L}\\p{N}_@])@${escape(name)}(?![\\p{L}\\p{N}_-])[,:]?`, 'iu')
  if (!re.test(text)) return null
  return text.replace(re, '$1').replace(/\s+/g, ' ').trim()
}

export type DjAction =
  | { type: 'queue' | 'play_next'; tracks: string[] }
  | { type: 'skip' | 'pause' | 'play' }
  | { type: 'remove'; item: string }

export interface DjPlan { reply: string; actions: DjAction[] }

type Obj = Record<string, unknown>
const isObj = (x: unknown): x is Obj => typeof x === 'object' && x !== null && !Array.isArray(x)

/** The first JSON object in a model's answer, tolerating ```json fences and chatter around it. */
export function extractJson(text: string): unknown {
  const start = text.indexOf('{')
  if (start === -1) return null
  // Walk to the matching brace, skipping strings, so trailing prose (or a second object) is ignored.
  let depth = 0
  let inString = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (ch === '\\') i++
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}' && --depth === 0) {
      try { return JSON.parse(text.slice(start, i + 1)) } catch { return null }
    }
  }
  return null
}

/**
 * The model's answer → a plan we're willing to run. Only ids we handed it survive (`tracks` are the
 * short ids of candidate songs, `items` of queue entries), with everything capped. Never throws.
 */
export function parseDjPlan(x: unknown, known: { tracks: ReadonlySet<string>; items: ReadonlySet<string> }): DjPlan {
  if (!isObj(x)) return { reply: '', actions: [] }
  const actions: DjAction[] = []
  for (const a of Array.isArray(x.actions) ? x.actions : []) {
    if (!isObj(a) || actions.length >= DJ_LIMITS.actions) continue
    switch (a.type) {
      case 'queue': case 'play_next': {
        const ids = Array.isArray(a.tracks) ? a.tracks.filter((t): t is string => typeof t === 'string' && known.tracks.has(t)) : []
        const tracks = [...new Set(ids)].slice(0, DJ_LIMITS.tracksPerAction)
        if (tracks.length) actions.push({ type: a.type, tracks })
        break
      }
      case 'skip': case 'pause': case 'play':
        actions.push({ type: a.type })
        break
      case 'remove':
        if (typeof a.item === 'string' && known.items.has(a.item)) actions.push({ type: 'remove', item: a.item })
        break
    }
  }
  return { reply: cleanText(x.reply, DJ_LIMITS.reply), actions }
}

/** A playlist answer: a name and the short ids it picked, in order, only from those it was given. */
export function parsePlaylistPlan(x: unknown, known: ReadonlySet<string>): { name: string; tracks: string[] } {
  if (!isObj(x)) return { name: '', tracks: [] }
  const ids = Array.isArray(x.tracks) ? x.tracks.filter((t): t is string => typeof t === 'string' && known.has(t)) : []
  return { name: cleanText(x.name, DJ_LIMITS.playlistName), tracks: [...new Set(ids)].slice(0, DJ_LIMITS.playlist) }
}
