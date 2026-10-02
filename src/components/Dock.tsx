// Bottom dock: a persistent mini-player (whenever the full player isn't on screen) and, on phones,
// the Room / Queue / Chat / Library tabs. Lives at app level so music keeps going as you browse.
import { useEffect, useRef } from 'preact/hooks'
import { useLocation } from 'preact-iso'
import { heldHere, readiness, roomPosition, tuneIn, unlockAudio } from '../audio/player.ts'
import { artUrls, resolveLocal } from '../library/library.ts'
import { canControl, currentItem, mayControl, room, shownPlaying, shownQueue, togglePlay } from '../state/room.ts'
import { isActive, receiving } from '../share/p2p.ts'
import { unread } from '../state/social.ts'
import { mobileTab, transition } from '../state/ui.ts'
import { useMedia } from '../utils/media.ts'
import { Icon, type IconName } from './icons.tsx'
import { Cover } from './ui.tsx'

export const MOBILE = '(max-width: 999px)'

export function Dock() {
  const { path, route } = useLocation()
  const mobile = useMedia(MOBILE)
  const r = room.value
  const roomPath = r ? `/room/${r.code}` : ''
  const onRoomPage = !!r && path === roomPath
  // The phone chat is a full screen of its own (like a DM): no dock while you're in it.
  const inChat = onRoomPage && mobile && mobileTab.value === 'chat'
  const showMini = !!r && !inChat && (!onRoomPage || (mobile && mobileTab.value !== 'room'))
  const showNav = !!r && !inChat && mobile && (onRoomPage || path === '/library')
  const visible = showMini || showNav

  // Everything that must stay clear of the dock (page bottom, toasts, chat, reactions) reads its
  // real height from --dock-h, so nothing hides behind it whatever it currently contains.
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const card = ref.current?.firstElementChild as HTMLElement | null
    const root = document.documentElement
    if (!card) return
    const ro = new ResizeObserver(() => {
      root.style.setProperty('--dock-h', `${card.offsetHeight + 8}px`)
      document.body.style.paddingBottom = `calc(${card.offsetHeight + 16}px + var(--safe-bottom))`
    })
    ro.observe(card)
    return () => {
      ro.disconnect()
      root.style.removeProperty('--dock-h')
      document.body.style.paddingBottom = ''
    }
  }, [visible])

  if (!r || !visible) return null
  const go = (tab: typeof mobileTab.value) => transition(() => {
    mobileTab.value = tab
    if (!onRoomPage) route(roomPath)
  })
  const active = path === '/library' ? 3 : onRoomPage ? ['room', 'queue', 'chat'].indexOf(mobileTab.value) : -1

  return (
    <div class="dock" ref={ref}>
      <div class="dock-card">
        {showMini && <MiniPlayer onOpen={() => go('room')} />}
        {showNav && (
          <nav class="bottom-nav" aria-label="Room sections" style={{ '--i': active }}>
            {active > -1 && <span class="nav-pill" aria-hidden="true" />}
            <NavItem icon="home" label="Room" active={active === 0} onClick={() => go('room')} />
            <NavItem icon="list" label="Queue" active={active === 1} onClick={() => go('queue')} count={shownQueue.value.items.length} />
            <NavItem icon="chat" label="Chat" active={active === 2} onClick={() => go('chat')} badge={unread.value} />
            <NavItem icon="music" label="Library" active={active === 3} onClick={() => transition(() => route('/library'))} />
          </nav>
        )}
      </div>
    </div>
  )
}

function NavItem({ icon, label, active, onClick, badge, count }: {
  icon: IconName; label: string; active: boolean; onClick: () => void; badge?: number; count?: number
}) {
  return (
    <button class={`nav-item${active ? ' on' : ''}`} aria-current={active ? 'page' : undefined} onClick={onClick}
      aria-label={badge ? `${label}, ${badge} unread` : label}>
      <span class="nav-icon">
        <Icon name={icon} size={22} />
        {!!badge && <span class="badge" key={badge}>{badge}</span>}
        {!badge && !!count && <span class="nav-count">{count}</span>}
      </span>
      <span class="nav-label">{label}</span>
    </button>
  )
}

function MiniPlayer({ onOpen }: { onOpen: () => void }) {
  const r = room.value!
  const item = currentItem.value
  const t = item?.track
  const local = t ? resolveLocal(t) : null
  const art = local?.status === 'ready' ? artUrls.value.get(local.local.id) : null
  const playing = shownPlaying.value
  const pct = t?.duration ? (roomPosition.value / t.duration) * 100 : 0
  return (
    <div class="mini" role="region" aria-label="Mini player">
      <span class="mini-progress" style={{ '--p': `${pct}%` }} aria-hidden="true" />
      <button class="mini-open" onClick={onOpen} aria-label={t ? `Open player: ${t.title}${t.artist ? ` by ${t.artist}` : ''}` : `Open ${r.name}`}>
        <Cover id={t?.id} art={art} size={42} class="mini-art" />
        <span class="q-text">
          <span class="q-title">{t?.title ?? r.name}</span>
          <span class="q-sub">{!t ? 'Nothing playing yet'
            : local?.status === 'ready' ? t.artist || 'Unknown artist'
              : isActive(receiving.value[t.id]) ? `Getting a copy… ${Math.round(receiving.value[t.id].progress * 100)}%`
                : 'Not on this device'}</span>
        </span>
      </button>
      {item && playing && readiness.value === 'needs-tap' ? (
        // The room is playing but this device isn't: tapping here only starts *your* audio.
        <button class="btn sm primary mini-listen" onClick={tuneIn}>
          <Icon name={heldHere.value ? 'play' : 'tap'} size={16} /> {heldHere.value ? 'Resume' : 'Tap to listen'}
        </button>
      ) : item && (
        <button class="icon-btn mini-play" aria-disabled={!canControl.value || undefined} aria-label={playing ? 'Pause' : 'Play'}
          onClick={() => { if (!mayControl()) return; unlockAudio(); togglePlay() }}>
          <span class="pp" data-state={playing ? 'playing' : 'paused'} aria-hidden="true">
            <Icon name="play" size={24} />
            <Icon name="pause" size={24} />
          </span>
        </button>
      )}
    </div>
  )
}
