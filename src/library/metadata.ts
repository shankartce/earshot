// Read tags + embedded artwork from a local file, entirely in the browser.
// The tag parser is loaded lazily so it costs nothing until someone imports music.

export interface Tags {
  title: string
  artist: string
  album: string
  albumArtist: string
  trackNo: number | null
  duration: number // 0 if unknown
  picture: { data: Uint8Array; format: string } | null
}

/** "03 - Artist - Title.mp3" → { artist, title }; otherwise the filename is the title. */
export function guessFromFilename(name: string): { title: string; artist: string } {
  const base = name.replace(/\.[^.]+$/, '').replace(/_/g, ' ').replace(/^\d{1,3}[\s.\-]+/, '').trim()
  const m = base.match(/^(.+?)\s+[-–—]\s+(.+)$/)
  return m ? { artist: m[1].trim(), title: m[2].trim() } : { title: base || 'Untitled', artist: '' }
}

/** Never throws: unreadable or untagged files fall back to what the filename says. */
export async function readTags(blob: Blob, fileName: string): Promise<Tags> {
  const guess = guessFromFilename(fileName)
  const fallback: Tags = { ...guess, album: '', albumArtist: '', trackNo: null, duration: 0, picture: null }
  try {
    const { parseBlob } = await import('music-metadata')
    const { common, format } = await parseBlob(blob, { duration: false })
    const pic = common.picture?.[0]
    return {
      title: common.title?.trim() || guess.title,
      artist: common.artist?.trim() || common.albumartist?.trim() || guess.artist,
      album: common.album?.trim() ?? '',
      albumArtist: common.albumartist?.trim() ?? '',
      trackNo: common.track?.no ?? null,
      duration: format.duration && Number.isFinite(format.duration) ? format.duration : 0,
      picture: pic ? { data: pic.data, format: pic.format } : null,
    }
  } catch {
    return fallback
  }
}

/** Shrink embedded artwork to a small JPEG so the library stays light. */
export async function thumbnail(pic: NonNullable<Tags['picture']>, size = 320): Promise<Blob | null> {
  try {
    const bmp = await createImageBitmap(new Blob([pic.data as BlobPart], { type: pic.format }))
    const scale = Math.min(1, size / Math.max(bmp.width, bmp.height))
    const canvas = new OffscreenCanvas(Math.round(bmp.width * scale), Math.round(bmp.height * scale))
    canvas.getContext('2d')!.drawImage(bmp, 0, 0, canvas.width, canvas.height)
    bmp.close()
    return await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.85 })
  } catch {
    return null // unusual image format: just use the generated cover
  }
}
