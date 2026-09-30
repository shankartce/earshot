export function fmtTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0
  const s = Math.floor(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** Two hues derived from a track hash, for generated covers and ambient room glow. */
export function hues(id: string | undefined): [number, number] {
  const hex = (id ?? '').replace(/^sha256:/, '') || '7a59ff'
  const a = parseInt(hex.slice(0, 4), 16) || 0
  const b = parseInt(hex.slice(4, 8), 16) || 0
  // bias toward warm hues so the room keeps its character
  return [((a % 110) + 270) % 360, ((b % 90) + 325) % 360]  // violet→amber, rose→orange
}

export const clockTime = (ms: number) => new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })
