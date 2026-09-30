// Display name + avatar picker. Avatars are emoji + color — no image upload anywhere in the app.
import type { Profile } from '../../shared/types.ts'
import { AVATAR_COLORS, AVATAR_EMOJI } from '../state/profile.ts'
import { Avatar } from './ui.tsx'

export function ProfileFields({ value, onChange, autoFocus }: { value: Profile; onChange: (p: Profile) => void; autoFocus?: boolean }) {
  const set = (patch: Partial<Profile['avatar']>) => onChange({ ...value, avatar: { ...value.avatar, ...patch } })
  return (
    <div class="profile-fields">
      <div class="profile-preview">
        <Avatar avatar={value.avatar} size={64} />
        <label class="field grow">
          <span class="label">Your name</span>
          <input class="input" value={value.displayName} maxLength={24} required autoFocus={autoFocus} autoComplete="nickname"
            placeholder="e.g. Alex" onInput={e => onChange({ ...value, displayName: e.currentTarget.value })} />
        </label>
      </div>
      <fieldset class="field">
        <legend class="label">Avatar</legend>
        <div class="chip-grid" role="radiogroup" aria-label="Avatar">
          {AVATAR_EMOJI.map(e => (
            <button type="button" key={e} role="radio" aria-checked={value.avatar.emoji === e} aria-label={`Avatar ${e}`}
              class={`chip emoji${value.avatar.emoji === e ? ' on' : ''}`} onClick={() => set({ emoji: e })}>{e}</button>
          ))}
        </div>
      </fieldset>
      <fieldset class="field">
        <legend class="label">Color</legend>
        <div class="chip-grid" role="radiogroup" aria-label="Avatar color">
          {AVATAR_COLORS.map(c => (
            <button type="button" key={c} role="radio" aria-checked={value.avatar.color === c} aria-label={`Color ${c}`}
              class={`chip swatch${value.avatar.color === c ? ' on' : ''}`} style={{ '--c': c }} onClick={() => set({ color: c })} />
          ))}
        </div>
      </fieldset>
    </div>
  )
}
