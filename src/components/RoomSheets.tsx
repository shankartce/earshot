// Share (invite) and room-settings sheets.
import { useEffect, useState } from 'preact/hooks'
import type { Permission } from '../../shared/types.ts'
import { demoEnabled, ROOM_EMOJI } from '../state/profile.ts'
import { isHost, participantById, room, toast, updateSettings } from '../state/room.ts'
import { Icon } from './icons.tsx'
import { Sheet } from './ui.tsx'

export const inviteLink = (code: string) => `${location.origin}/room/${code}`

export async function copyText(text: string, done = 'Copied') {
  try {
    await navigator.clipboard.writeText(text)
    toast(done)
  } catch {
    toast('Copy failed — select the link and copy it manually.', { tone: 'error' })
  }
}

const DEMO_NAMES = ['Sam', 'Jamie', 'Riley', 'Kai', 'Noor']

export function ShareSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const r = room.value!
  const link = inviteLink(r.code)
  const [demoIdx, setDemoIdx] = useState(0)
  const nativeShare = typeof navigator.share === 'function'
  return (
    <Sheet open={open} onClose={onClose} title="Invite friends">
      <p class="muted">Anyone with this code can join <strong>{r.emoji} {r.name}</strong>. Each person plays their own copy of each song.</p>
      <div class="code-display" aria-label={`Room code ${r.code.split('').join(' ')}`}>
        {r.code.split('').map((c, i) => <span key={i}>{c}</span>)}
      </div>
      <label class="field">
        <span class="label">Invite link</span>
        <div class="input-row">
          <input class="input mono" readOnly value={link} onFocus={e => e.currentTarget.select()} />
          <button class="btn primary" onClick={() => copyText(link, 'Invite link copied')}><Icon name="copy" size={18} /> Copy</button>
        </div>
      </label>
      {nativeShare && (
        <button class="btn block" onClick={() => navigator.share({ title: `Come listen with me — ${r.emoji} ${r.name} on Earshot`, url: link }).catch(() => {})}>
          <Icon name="share" size={18} /> Share…
        </button>
      )}
      {demoEnabled && (
        <div class="demo-box">
          <p class="label">Demo mode</p>
          <p class="muted small">Open this room in a new tab as another person to test syncing on one computer.</p>
          <button class="btn block" onClick={() => {
            const name = DEMO_NAMES[demoIdx % DEMO_NAMES.length]
            setDemoIdx(demoIdx + 1)
            window.open(`/room/${r.code}?as=${encodeURIComponent(name)}`, '_blank', 'noopener')
          }}>
            <Icon name="tab" size={18} /> Open as {DEMO_NAMES[demoIdx % DEMO_NAMES.length]} in a new tab
          </button>
        </div>
      )}
    </Sheet>
  )
}

function Choice({ legend, value, disabled, onChange }: { legend: string; value: Permission; disabled: boolean; onChange: (v: Permission) => void }) {
  return (
    <fieldset class="field" disabled={disabled}>
      <legend class="label">{legend}</legend>
      <div class="segmented">
        {(['host', 'everyone'] as const).map(v => (
          <label key={v} class={value === v ? 'on' : ''}>
            <input type="radio" class="sr-only" name={legend} checked={value === v} onChange={() => onChange(v)} />
            {v === 'host' ? 'Host only' : 'Everyone'}
          </label>
        ))}
      </div>
    </fieldset>
  )
}

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <label class="toggle-row">
      <span>{label}</span>
      <input type="checkbox" role="switch" class="switch" checked={checked} disabled={disabled} onChange={e => onChange(e.currentTarget.checked)} />
    </label>
  )
}

export function SettingsSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const r = room.value!
  const s = r.settings
  const host = isHost.value
  const [name, setName] = useState(r.name)
  useEffect(() => { if (open) setName(r.name) }, [open, r.name])
  const saveName = () => { if (name.trim() && name !== r.name) updateSettings({ name }) }
  const hostName = r.hostId ? participantById(r.hostId)?.displayName : null

  return (
    <Sheet open={open} onClose={onClose} title="Room settings">
      {!host && <p class="note">Only the host{hostName ? ` (${hostName})` : ''} can change these.</p>}
      <fieldset class="field" disabled={!host}>
        <legend class="label">Room name</legend>
        <div class="input-row">
          <input class="input" value={name} maxLength={40} onInput={e => setName(e.currentTarget.value)}
            onBlur={saveName} onKeyDown={e => e.key === 'Enter' && saveName()} aria-label="Room name" />
        </div>
        <div class="chip-grid" role="radiogroup" aria-label="Room emoji">
          {ROOM_EMOJI.map(e => (
            <button type="button" key={e} role="radio" aria-checked={r.emoji === e} aria-label={`Room emoji ${e}`}
              class={`chip emoji${r.emoji === e ? ' on' : ''}`} onClick={() => updateSettings({ emoji: e })}>{e}</button>
          ))}
        </div>
      </fieldset>
      <Choice legend="Playback control" value={s.playbackControl} disabled={!host} onChange={v => updateSettings({ playbackControl: v })} />
      <Choice legend="Queue editing" value={s.queueEditing} disabled={!host} onChange={v => updateSettings({ queueEditing: v })} />
      <p class="muted small">Everyone can always add songs, and remove the ones they added.</p>
      <div class="field">
        <Toggle label="Allow chat" checked={s.allowChat} disabled={!host} onChange={v => updateSettings({ allowChat: v })} />
        <Toggle label="Allow reactions" checked={s.allowReactions} disabled={!host} onChange={v => updateSettings({ allowReactions: v })} />
      </div>
    </Sheet>
  )
}
