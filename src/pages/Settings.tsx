import { useState } from 'preact/hooks'
import type { Profile } from '../../shared/types.ts'
import { prefs, setPrefs } from '../audio/player.ts'
import { ProfileFields } from '../components/ProfileForm.tsx'
import { DEFAULT_DRIFT } from '../sync/drift.ts'
import { profile, randomAvatar, saveProfile } from '../state/profile.ts'
import { toast } from '../state/room.ts'
import { autoFetch, setAutoFetch } from '../share/p2p.ts'
import { BackLink } from './Join.tsx'

function Num({ label, hint, value, min, max, step, unit, onChange }: {
  label: string; hint: string; value: number; min: number; max: number; step: number; unit: string; onChange: (v: number) => void
}) {
  return (
    <label class="field">
      <span class="label">{label} <span class="mono">{value}{unit}</span></span>
      <input type="range" class="range" min={min} max={max} step={step} value={value}
        style={{ '--p': `${((value - min) / (max - min)) * 100}%` }} onInput={e => onChange(Number(e.currentTarget.value))} />
      <span class="hint">{hint}</span>
    </label>
  )
}

export function Settings() {
  const [p, setP] = useState<Profile>(profile.value ?? { displayName: '', avatar: randomAvatar() })
  const d = prefs.value
  return (
    <main class="page center">
      <div class="card narrow">
        <BackLink />
        <h1 class="display-sm">Settings</h1>
        <form onSubmit={e => { e.preventDefault(); saveProfile(p); toast('Profile saved') }}>
          <h2 class="section-h">You</h2>
          <ProfileFields value={p} onChange={setP} />
          <button class="btn primary" disabled={!p.displayName.trim()}>Save profile</button>
          <p class="hint">Changes show up the next time you join a room.</p>
        </form>

        <hr class="sep" />
        <h2 class="section-h">Shared songs</h2>
        <label class="toggle-row">
          <span>
            Automatically get songs friends share
            <span class="hint">When someone in the room shares a song you don't have, fetch it in the background and keep it under “Shared with me”. Skipped when your browser's data saver is on.</span>
          </span>
          <input type="checkbox" role="switch" class="switch" checked={autoFetch.value} onChange={e => setAutoFetch(e.currentTarget.checked)} />
        </label>

        <hr class="sep" />
        <h2 class="section-h">Sync tuning</h2>
        <p class="muted small">Defaults work well. Adjust if your speakers add delay (Bluetooth usually does).</p>
        <Num label="Speaker delay" unit="ms" min={0} max={400} step={10} value={d.outputLatencyMs}
          hint="Plays this much earlier to make up for Bluetooth or wireless speaker lag."
          onChange={v => setPrefs({ outputLatencyMs: v })} />
        <Num label="Ignore drift below" unit="ms" min={10} max={200} step={10} value={Math.round(d.ignore * 1000)}
          hint="Smaller differences than this are left alone." onChange={v => setPrefs({ ignore: Math.min(v / 1000, d.soft - 0.02) })} />
        <Num label="Jump when drift exceeds" unit="ms" min={100} max={1000} step={25} value={Math.round(d.soft * 1000)}
          hint="Between the two, playback speed is nudged gently instead of jumping."
          onChange={v => setPrefs({ soft: Math.max(v / 1000, d.ignore + 0.02) })} />
        <button class="btn ghost" onClick={() => setPrefs({ ...DEFAULT_DRIFT, outputLatencyMs: 0 })}>Reset to defaults</button>

        <hr class="sep" />
        <h2 class="section-h">Keyboard shortcuts in a room</h2>
        <dl class="shortcuts">
          <dt><kbd>Space</kbd> or <kbd>K</kbd></dt><dd>Play / pause</dd>
          <dt><kbd>J</kbd> / <kbd>L</kbd></dt><dd>Back / forward 10 seconds</dd>
          <dt><kbd>N</kbd> / <kbd>P</kbd></dt><dd>Next / previous song</dd>
          <dt><kbd>Alt</kbd> + <kbd>↑</kbd> <kbd>↓</kbd></dt><dd>Move the focused song in the queue</dd>
        </dl>
      </div>
    </main>
  )
}
