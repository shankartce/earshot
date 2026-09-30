// Off the main thread: hash an audio file (SHA-256 → stable track id) and, when the browser has
// origin-private storage (OPFS), keep a copy there so the library survives reloads. Nothing leaves
// the device. Sync access handles only exist in workers, and they're the one OPFS write API every
// target browser supports.

export type WorkerReq = { kind: 'audio'; file: Blob } | { kind: 'store'; dir: 'art' | 'lyrics'; name: string; blob: Blob }
export type WorkerRes = { ok: true; id: string; stored: boolean } | { ok: false }

async function store(dirName: string, name: string, buf: ArrayBuffer): Promise<boolean> {
  try {
    const root = await navigator.storage.getDirectory()
    const dir = await root.getDirectoryHandle(dirName, { create: true })
    const fh = await dir.getFileHandle(name, { create: true })
    // Audio is content-addressed (named by its hash), so same name + size = same bytes already stored.
    if (dirName === 'audio' && (await fh.getFile()).size === buf.byteLength) return true
    const h = await (fh as any).createSyncAccessHandle()
    try {
      h.truncate(0)
      h.write(new Uint8Array(buf), { at: 0 })
      h.flush()
    } finally {
      h.close()
    }
    return true
  } catch {
    return false // private mode / quota: the caller keeps the file in memory for this session
  }
}

self.onmessage = async (e: MessageEvent<WorkerReq>) => {
  const msg = e.data
  try {
    if (msg.kind === 'store') {
      const stored = await store(msg.dir, msg.name, await msg.blob.arrayBuffer())
      return self.postMessage({ ok: true, id: msg.name, stored } satisfies WorkerRes)
    }
    const buf = await msg.file.arrayBuffer()
    const digest = await crypto.subtle.digest('SHA-256', buf)
    const hex = [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('')
    const stored = await store('audio', hex, buf)
    self.postMessage({ ok: true, id: `sha256:${hex}`, stored } satisfies WorkerRes)
  } catch {
    self.postMessage({ ok: false } satisfies WorkerRes)
  }
}
