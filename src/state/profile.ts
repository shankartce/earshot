// Who you are on this device. Demo tabs (`?as=Sam`) keep a separate identity in sessionStorage so
// two tabs of one browser can be two different people.
import { signal } from '@preact/signals'
import type { Profile } from '../../shared/types.ts'

export const AVATAR_EMOJI = ['🦊', '🐼', '🐸', '🦉', '🐙', '🦄', '🐯', '🐧', '🌙', '🌻', '👾', '🎧']
export const AVATAR_COLORS = ['#ff7a59', '#ffb454', '#f25f8e', '#b388ff', '#4dd0c8', '#7ccf6a', '#6aa8ff', '#e8d5b0']
export const ROOM_EMOJI = ['🎧', '🌙', '🔥', '🌊', '🪩', '☕', '🚗', '🌧️', '✨', '🎸']

const demoParam = new URLSearchParams(location.search).get('as')
if (demoParam) {
  try { sessionStorage.setItem('jam:demo', demoParam.slice(0, 24)) } catch { /* private mode */ }
}
const demoName = (() => { try { return sessionStorage.getItem('jam:demo') } catch { return null } })()
export const isDemoTab = !!demoName
export const demoEnabled = import.meta.env.DEV || new URLSearchParams(location.search).has('demo')

const store: Storage | null = (() => {
  try { return isDemoTab ? sessionStorage : localStorage } catch { return null }
})()

function read<T>(key: string, fallback: T): T {
  try { return JSON.parse(store?.getItem(key) ?? 'null') ?? fallback } catch { return fallback }
}
function write(key: string, value: unknown) {
  try { store?.setItem(key, JSON.stringify(value)) } catch { /* quota / private mode: identity just won't persist */ }
}

const pick = <T,>(list: T[], seed: string) => list[[...seed].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % list.length]

function initialProfile(): Profile | null {
  if (demoName) {
    const saved = read<Profile | null>('jam:profile', null)
    return saved ?? { displayName: demoName, avatar: { emoji: pick(AVATAR_EMOJI, demoName), color: pick(AVATAR_COLORS, demoName + '!') } }
  }
  return read<Profile | null>('jam:profile', null)
}

export const profile = signal<Profile | null>(initialProfile())

export function saveProfile(p: Profile) {
  profile.value = p
  write('jam:profile', p)
}

export function randomAvatar() {
  return {
    emoji: AVATAR_EMOJI[Math.floor(Math.random() * AVATAR_EMOJI.length)],
    color: AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)],
  }
}

// ---- per-room session tokens (secret; lets you rejoin as the same person) ----

export interface RecentRoom { code: string; name: string; emoji: string; token: string; at: number }

export const recentRooms = signal<RecentRoom[]>(read('jam:rooms', []))

export const tokenFor = (code: string) => recentRooms.value.find(r => r.code === code)?.token

export function rememberRoom(r: Omit<RecentRoom, 'at'>) {
  recentRooms.value = [{ ...r, at: Date.now() }, ...recentRooms.value.filter(x => x.code !== r.code)].slice(0, 8)
  write('jam:rooms', recentRooms.value)
}

export function forgetRoom(code: string) {
  recentRooms.value = recentRooms.value.filter(x => x.code !== code)
  write('jam:rooms', recentRooms.value)
}
