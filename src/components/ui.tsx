// Small shared building blocks.
import type { ComponentChildren } from 'preact'
import { useEffect, useId, useRef, useState } from 'preact/hooks'
import type { Avatar as AvatarT } from '../../shared/types.ts'
import { syncStatus } from '../audio/player.ts'
import { filesFromDrop } from '../library/library.ts'
import { dismissToast, toasts } from '../state/room.ts'
import { hues } from '../utils/format.ts'
import { Icon } from './icons.tsx'

export function Avatar({ avatar, size = 36, label, ring }: { avatar: AvatarT; size?: number; label?: string; ring?: boolean }) {
  return (
    <span class={`avatar${ring ? ' ring' : ''}`} style={{ '--c': avatar.color, width: size, height: size, fontSize: size * 0.5 }}
      role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'}>
      {avatar.emoji}
    </span>
  )
}

/** Generated cover from the track hash (artwork stays local; this is what everyone can see). */
export function Cover({ id, art, size, spinning, class: cls = '' }: { id?: string; art?: string | null; size?: number; spinning?: boolean; class?: string }) {
  const [h1, h2] = hues(id)
  return (
    <div class={`cover ${spinning ? 'spinning' : ''} ${cls}`} style={{ '--h1': h1, '--h2': h2, width: size, height: size }} aria-hidden="true">
      {art ? <img src={art} alt="" /> : <Icon name="music" size={size ? size * 0.34 : 48} />}
    </div>
  )
}

export function Equalizer({ playing = true, label }: { playing?: boolean; label?: string }) {
  return (
    <span class={`eq${playing ? '' : ' paused'}`} role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : 'true'}>
      <i /><i /><i /><i />
    </span>
  )
}

export function Sheet({ open, onClose, title, children, wide }: {
  open: boolean; onClose: () => void; title: string; children: ComponentChildren; wide?: boolean
}) {
  const ref = useRef<HTMLDialogElement>(null)
  const id = useId()
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])
  return (
    <dialog ref={ref} class={`sheet${wide ? ' wide' : ''}`} aria-labelledby={id} onClose={onClose}
      // Esc fires 'cancel' synchronously; 'close' can arrive a frame later. Handle Esc ourselves so
      // the owner's open-state updates immediately and the sheet can always be reopened.
      onCancel={e => { e.preventDefault(); onClose() }}
      onClick={e => { if (e.target === ref.current) onClose() }}>
      <div class="sheet-body">
        <header class="sheet-head">
          <h2 id={id}>{title}</h2>
          <button class="icon-btn" onClick={onClose} aria-label="Close"><Icon name="close" /></button>
        </header>
        {children}
      </div>
    </dialog>
  )
}

export function Toasts() {
  return (
    <div class="toasts" role="status" aria-live="polite">
      {toasts.value.map(t => (
        <div key={t.id} class={`toast ${t.tone ?? ''}`}>
          {t.who ? <Avatar avatar={t.who.avatar} size={24} /> : t.tone === 'error' ? <Icon name="warn" size={18} /> : null}
          <span>{t.text}</span>
          {t.action && <button class="toast-action" onClick={() => { t.action!.run(); dismissToast(t.id) }}>{t.action.label}</button>}
        </div>
      ))}
    </div>
  )
}

const PILL = {
  synced: { label: 'Synced', cls: 'ok', hint: 'You hear the same moment as everyone else.' },
  'catching-up': { label: 'Catching up', cls: 'warn', hint: 'Getting back in step with the room.' },
  reconnecting: { label: 'Reconnecting', cls: 'bad', hint: 'Connection lost — reconnecting…' },
  'not-playing': { label: 'Not playing here', cls: 'muted-pill', hint: "The room is playing, but you can't hear it on this device yet." },
}

// Not a live region: sync can flicker on every correction; real disconnects have their own banner.
/** `compact`: just a dot while all is well; the words appear only when something needs attention. */
export function ConnectionPill({ compact }: { compact?: boolean }) {
  const s = PILL[syncStatus.value]
  if (compact && syncStatus.value === 'synced') {
    return <span class="sync-dot" title={s.hint} role="img" aria-label={`Sync: ${s.label}. ${s.hint}`} />
  }
  return (
    <span class={`pill conn ${s.cls}`} title={s.hint} aria-label={`Sync: ${s.label}. ${s.hint}`}>
      <span class="dot" aria-hidden="true" />{s.label}
    </span>
  )
}

export function Empty({ icon, title, children }: { icon: Parameters<typeof Icon>[0]['name']; title: string; children?: ComponentChildren }) {
  return (
    <div class="empty">
      <span class="empty-icon"><Icon name={icon} size={26} /></span>
      <p class="empty-title">{title}</p>
      {children && <div class="empty-body">{children}</div>}
    </div>
  )
}

/** A styled file picker. The real <input> stays focusable (visually hidden) for keyboard users. */
export function FileButton({ onFiles, children, class: cls = 'btn', multiple = true, label, folder, accept }: {
  onFiles: (files: File[]) => void; children: ComponentChildren; class?: string; multiple?: boolean; label?: string; folder?: boolean; accept?: string
}) {
  return (
    <label class={`${cls} file-btn`}>
      {children}
      <input type="file" accept={accept ?? 'audio/*,.mp3,.m4a,.flac,.ogg,.opus,.wav,.aac,.lrc'} multiple={multiple} class="sr-only" aria-label={label}
        {...(folder ? { webkitdirectory: '' } : {})}
        onChange={e => {
          const files = [...(e.currentTarget.files ?? [])]
          e.currentTarget.value = ''
          if (files.length) onFiles(files)
        }} />
    </label>
  )
}

/** Accepts dropped files and whole folders. */
export function DropZone({ onFiles, children, class: cls = '' }: { onFiles: (f: File[]) => void; children: ComponentChildren; class?: string }) {
  const [over, setOver] = useState(false)
  const hasFiles = (e: DragEvent) => !!e.dataTransfer?.types.includes('Files')
  return (
    <div class={`dropzone ${cls}${over ? ' over' : ''}`}
      onDragOver={e => { if (hasFiles(e)) { e.preventDefault(); setOver(true) } }}
      onDragLeave={e => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setOver(false) }}
      onDrop={async e => {
        if (!hasFiles(e)) return
        e.preventDefault()
        setOver(false)
        onFiles(await filesFromDrop(e.dataTransfer!))
      }}>
      {children}
    </div>
  )
}

/** Destructive action that needs a second press within 3s. */
export function ConfirmButton({ onConfirm, children, confirmLabel = 'Tap again to confirm', class: cls = 'btn sm ghost', label }: {
  onConfirm: () => void; children: ComponentChildren; confirmLabel?: string; class?: string; label?: string
}) {
  const [armed, setArmed] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = setTimeout(() => setArmed(false), 3000)
    return () => clearTimeout(t)
  }, [armed])
  return (
    <button type="button" class={`${cls}${armed ? ' danger' : ''}`} aria-label={armed ? confirmLabel : label}
      onClick={() => { if (armed) { setArmed(false); onConfirm() } else setArmed(true) }}>
      {armed ? confirmLabel : children}
    </button>
  )
}
