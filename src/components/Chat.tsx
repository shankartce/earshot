// Room chat, Instagram-style: bubbles (yours on the right), double-tap to ❤️, press and hold for
// reactions / reply / copy, swipe right to reply, "Seen", and big emoji-only messages.
import { createPortal } from 'preact/compat'
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { REACTIONS, type ChatMessage } from '../../shared/types.ts'
import { unlockAudio } from '../audio/player.ts'
import { artUrls, resolveLocal } from '../library/library.ts'
import { canControl, currentItem, mayControl, me, participantById, room, shownPlaying, toast, togglePlay } from '../state/room.ts'
import { chatOpen, draft, notifyTyping, pending, reactToMessage, readUpTo, replyingTo, sendChat, typingNames } from '../state/social.ts'
import { leaveChat } from '../state/ui.ts'
import { firstNewIndex, focusLayout, groupMessages, needsSeparator, seenText, separatorLabel, typingText } from '../utils/chat.ts'
import { isJumbo } from '../utils/emoji.ts'
import { EmojiPicker } from './EmojiPicker.tsx'
import { Icon } from './icons.tsx'
import { openProfile } from './Participants.tsx'
import { Avatar, Cover, Empty, Sheet } from './ui.tsx'

const QUICK = REACTIONS.slice(0, 6)
const nameOf = (id: string) => (id === me.value ? 'You' : participantById(id)?.displayName ?? 'Someone')

/** `full`: the phone's full-screen chat (own top bar, no dock, composer riding on the keyboard). */
export function Chat({ full = false }: { full?: boolean }) {
  const r = room.value!
  const listRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const atBottomRef = useRef(true)
  atBottomRef.current = atBottom
  // Where you'd read up to before opening the chat: the "New messages" line goes there.
  const [dividerAt] = useState(() => readUpTo.peek())
  const [newBelow, setNewBelow] = useState(false)
  const typers = typingNames.value
  const count = r.chat.length + pending.value.length + typers.length

  // While mounted, the chat is "open": new messages don't count as unread.
  useEffect(() => {
    chatOpen.value = true
    return () => { chatOpen.value = false }
  }, [])

  // Stick to the bottom unless you've scrolled up to read history.
  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    if (atBottom) el.scrollTop = el.scrollHeight
    else setNewBelow(true)
  }, [count])

  // The list shrinks when the keyboard opens: stay pinned to the newest message if you were there.
  useEffect(() => {
    const el = listRef.current
    if (!el) return
    const ro = new ResizeObserver(() => { if (atBottomRef.current) el.scrollTop = el.scrollHeight })
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Full screen: size to the visible viewport (keyboard-aware where the browser doesn't resize for it).
  useEffect(() => {
    const vv = window.visualViewport
    if (!full || !vv) return
    const set = () => document.documentElement.style.setProperty('--vvh', `${vv.height}px`)
    set()
    vv.addEventListener('resize', set)
    return () => { vv.removeEventListener('resize', set); document.documentElement.style.removeProperty('--vvh') }
  }, [full])

  const toBottom = () => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
    setNewBelow(false)
  }

  if (!r.settings.allowChat) {
    return (
      <section class={full ? 'chat chat-full' : 'panel chat'}>
        {full && <ChatTopBar />}
        <Empty icon="users" title="Chat is turned off in this room." />
      </section>
    )
  }

  const many = r.participants.length > 2
  const last = r.chat.at(-1)
  // "Seen" sits under your newest message, once it's the latest thing in the chat.
  const others = r.participants.filter(p => p.id !== me.value)
  const seenBy = last && last.authorId === me.value
    ? others.filter(p => (p.seenAt ?? 0) >= last.at).map(p => p.displayName) : []
  const firstNew = r.chat[firstNewIndex(r.chat, dividerAt, me.value)]?.id
  const groups = groupMessages(r.chat, undefined, firstNew) // the "New messages" line starts a fresh run

  return (
    <section class={full ? 'chat chat-full' : 'panel chat'} aria-labelledby="chat-h">
      {full ? <ChatTopBar /> : <header class="panel-head"><h2 id="chat-h">Chat</h2></header>}
      <div class="chat-scroll" ref={listRef} role="log" aria-live="polite" aria-label="Chat messages"
        onScroll={e => {
          const el = e.currentTarget
          const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
          setAtBottom(bottom)
          if (bottom) setNewBelow(false)
        }}>
        {groups.length === 0 && pending.value.length === 0 && (
          <p class="chat-empty">Say hi 👋 — messages stay in this room.</p>
        )}
        {groups.map((g, gi) => {
          const who = participantById(g.authorId)
          const mine = g.authorId === me.value
          const prevAt = gi ? groups[gi - 1].messages.at(-1)!.at : null
          return (
            <div key={g.messages[0].id} class="msg-run-wrap">
              {needsSeparator(prevAt, g.at) && <p class="chat-sep"><span>{separatorLabel(g.at)}</span></p>}
              {g.messages[0].id === firstNew && <p class="chat-new" role="separator"><span>New messages</span></p>}
              <div class={`msg-run${mine ? ' mine' : ''}`}>
                {!mine && (
                  <button class="run-avatar" onClick={() => who && openProfile(who.id)} aria-label={`${who?.displayName ?? 'Someone'}'s profile`} tabIndex={-1}>
                    {who ? <Avatar avatar={who.avatar} size={28} /> : <span class="avatar-gap" />}
                  </button>
                )}
                <div class="msg-col">
                  {!mine && many && <p class="msg-name">{who?.displayName ?? 'Someone'}</p>}
                  {g.messages.map((m, i) => (
                    <Message key={m.id} m={m} mine={mine}
                      pos={g.messages.length === 1 ? 'single' : i === 0 ? 'first' : i === g.messages.length - 1 ? 'last' : 'middle'} />
                  ))}
                </div>
              </div>
            </div>
          )
        })}
        {pending.value.map(p => (
          <div key={`p${p.key}`} class="msg-run mine sending">
            <div class="msg-col"><div class="msg"><p class="bubble">{p.text}</p></div></div>
          </div>
        ))}
        {seenBy.length > 0 && !pending.value.length && <p class="seen">{seenText(seenBy, others.length)}</p>}
        {typers.length > 0 && <TypingBubble />}
      </div>
      {newBelow && <button class="pill new-below" onClick={toBottom}><Icon name="down" size={14} /> New messages</button>}
      <p class="sr-only" aria-live="polite">{typingText(typers)}</p>
      <Composer />
    </section>
  )
}

/** Full-screen chat's top bar: back, the room, who's here, and a now-playing chip. */
function ChatTopBar() {
  const r = room.value!
  const online = r.participants.filter(p => p.isOnline).length
  const t = currentItem.value?.track
  const local = t ? resolveLocal(t) : null
  const art = local?.status === 'ready' ? artUrls.value.get(local.local.id) : null
  const playing = shownPlaying.value
  return (
    <header class="chat-top">
      <button class="icon-btn" onClick={leaveChat} aria-label="Back to the player"><Icon name="arrowLeft" /></button>
      <span class="room-emoji" aria-hidden="true">{r.emoji}</span>
      <div class="chat-top-text">
        <h2 id="chat-h" class="chat-top-name">{r.name}</h2>
        <p class="chat-top-sub">{online <= 1 ? 'Just you' : `${online} listening`}</p>
      </div>
      {t && (
        <div class="np-chip">
          <button class="np-chip-open" onClick={leaveChat} aria-label={`Now playing: ${t.title}. Back to the player`}>
            <Cover id={t.id} art={art} size={28} />
            <span class="np-chip-title">{t.title}</span>
          </button>
          <button class="np-chip-play" aria-label={playing ? 'Pause' : 'Play'} aria-disabled={!canControl.value || undefined}
            onClick={() => { if (!mayControl()) return; unlockAudio(); togglePlay() }}>
            <span class="pp" data-state={playing ? 'playing' : 'paused'} aria-hidden="true">
              <Icon name="play" size={16} />
              <Icon name="pause" size={16} />
            </span>
          </button>
        </div>
      )}
    </header>
  )
}

function TypingBubble() {
  const first = room.value!.participants.find(p => p.displayName === typingNames.value[0])
  return (
    <div class="msg-run typing-run" aria-hidden="true">
      <span class="run-avatar">{first && <Avatar avatar={first.avatar} size={28} />}</span>
      <div class="bubble typing-dots"><i /><i /><i /></div>
    </div>
  )
}

type Pos = 'single' | 'first' | 'middle' | 'last'

function Message({ m, mine, pos }: { m: ChatMessage; mine: boolean; pos: Pos }) {
  const [focus, setFocus] = useState<DOMRect | null>(null)
  const [picking, setPicking] = useState(false)
  const [showWho, setShowWho] = useState(false)
  const [pop, setPop] = useState(0)
  const allow = room.value!.settings.allowReactions
  const jumbo = isJumbo(m.text)
  const ref = useRef<HTMLDivElement>(null)

  const heart = () => {
    if (!allow) return
    if (!(m.reactions['❤️'] ?? []).includes(me.value)) reactToMessage(m.id, '❤️') // double-tap only ever adds
    setPop(p => p + 1)
  }
  const reply = () => { replyingTo.value = m; setFocus(null); document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus() }
  const open = () => { const b = ref.current?.querySelector('.bubble'); if (b) setFocus(b.getBoundingClientRect()) }
  useGestures(ref, { onDouble: heart, onLong: open, onSwipe: reply })

  const entries = Object.entries(m.reactions).sort((a, b) => b[1].length - a[1].length)
  const total = entries.reduce((n, [, who]) => n + who.length, 0)
  return (
    <div id={`msg-${m.id}`} class={`msg pos-${pos}${jumbo ? ' jumbo' : ''}${entries.length ? ' has-reacts' : ''}${focus ? ' focused' : ''}`} ref={ref}>
      {m.replyTo && (
        <button class="reply-quote" onClick={() => jumpTo(m.replyTo!.id)}>
          <span class="reply-who">{mine ? 'You' : nameOf(m.authorId)} replied to {m.replyTo.authorId === m.authorId ? (mine ? 'yourself' : 'themself') : m.replyTo.authorId === me.value ? 'you' : nameOf(m.replyTo.authorId)}</span>
          <span class="reply-text">{m.replyTo.text}</span>
        </button>
      )}
      <div class="bubble-row">
        <span class="swipe-hint" aria-hidden="true"><Icon name="reply" size={16} /></span>
        <p class="bubble">{m.text}</p>
        <button class="msg-more" aria-label="Message options" aria-haspopup="dialog" onClick={open}>
          <Icon name="more" size={16} />
        </button>
        {pop > 0 && <span key={pop} class="heart-pop" aria-hidden="true">❤️</span>}
      </div>
      {entries.length > 0 && (
        <button class="react-pill" onClick={() => setShowWho(true)}
          aria-label={`Reactions: ${entries.map(([e, who]) => `${e} ${who.length}`).join(', ')}. Show who reacted`}>
          {entries.slice(0, 3).map(([e]) => <span key={e}>{e}</span>)}
          {total > 1 && <span class="react-count">{total}</span>}
        </button>
      )}
      {focus && (
        <FocusLayer m={m} rect={focus} mine={mine} jumbo={jumbo} allow={allow} onClose={() => setFocus(null)} onReply={reply}
          onMore={() => { setFocus(null); setPicking(true) }} />
      )}
      <EmojiPicker open={picking} onClose={() => setPicking(false)} onPick={e => reactToMessage(m.id, e)} title="React to this message" />
      {showWho && <WhoReacted m={m} onClose={() => setShowWho(false)} />}
    </div>
  )
}

/**
 * Instagram-style focus mode: everything dims, the message lifts in place, emojis above it and
 * Reply / Copy below. Rendered on <body> so no transformed ancestor can trap or clip it.
 */
function FocusLayer({ m, rect, mine, jumbo, allow, onClose, onReply, onMore }: {
  m: ChatMessage; rect: DOMRect; mine: boolean; jumbo: boolean; allow: boolean; onClose: () => void; onReply: () => void; onMore: () => void
}) {
  const first = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const back = document.activeElement as HTMLElement | null
    first.current?.focus({ preventScroll: true })
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); onClose() } }
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('keydown', esc); back?.focus?.({ preventScroll: true }) }
  }, [])
  const lay = focusLayout(rect, innerHeight, innerWidth)
  const mineReacted = (e: string) => (m.reactions[e] ?? []).includes(me.value)
  return createPortal(
    <div class="focus-layer" role="dialog" aria-label="Message options" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      {allow && (
        <div class="focus-bar" role="menu" aria-label="React" style={{ top: lay.barTop, left: lay.barLeft }}>
          {QUICK.map((e, i) => (
            <button key={e} ref={i === 0 ? first : undefined} role="menuitem" class={mineReacted(e) ? 'on' : ''} aria-label={`React ${e}`}
              onClick={() => { reactToMessage(m.id, e); onClose() }}>{e}</button>
          ))}
          <button role="menuitem" class="focus-plus" aria-label="More reactions" onClick={onMore}><Icon name="plus" size={18} /></button>
        </div>
      )}
      <p class={`bubble focus-bubble${mine ? ' mine' : ''}${jumbo ? ' jumbo' : ''}`} style={{ top: rect.top, left: rect.left, width: rect.width }} aria-hidden="true">{m.text}</p>
      <div class="focus-card" role="menu" style={{ top: lay.cardTop, left: lay.cardLeft }}>
        <button ref={allow ? undefined : first} role="menuitem" onClick={onReply}>Reply <Icon name="reply" size={18} /></button>
        <button role="menuitem" onClick={() => {
          navigator.clipboard?.writeText(m.text).then(() => toast('Copied'), () => toast("Couldn't copy", { tone: 'error' }))
          onClose()
        }}>Copy <Icon name="copy" size={18} /></button>
      </div>
    </div>,
    document.body,
  )
}

function WhoReacted({ m, onClose }: { m: ChatMessage; onClose: () => void }) {
  const entries = Object.entries(m.reactions)
  return (
    <Sheet open onClose={onClose} title="Reactions">
      <ul class="who-reacted">
        {entries.flatMap(([emoji, who]) => who.map(pid => {
          const p = participantById(pid)
          const mine = pid === me.value
          return (
            <li key={emoji + pid}>
              {p ? <Avatar avatar={p.avatar} size={32} /> : <span class="avatar-gap" />}
              <span class="grow">{mine ? 'You' : p?.displayName ?? 'Someone'}{mine && <span class="hint">Tap to remove</span>}</span>
              {mine
                ? <button class="who-emoji" aria-label={`Remove your ${emoji}`} onClick={() => { reactToMessage(m.id, emoji); if (entries.length === 1 && who.length === 1) onClose() }}>{emoji}</button>
                : <span class="who-emoji">{emoji}</span>}
            </li>
          )
        }))}
      </ul>
    </Sheet>
  )
}

/** Scroll to a quoted message and flash it. */
function jumpTo(id: string) {
  const el = document.getElementById(`msg-${id}`)
  if (!el) return toast('That message is no longer in the chat.')
  el.scrollIntoView({ block: 'center', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' })
  el.classList.remove('flash')
  void el.offsetWidth // restart the animation
  el.classList.add('flash')
}

/**
 * Touch/mouse gestures on a message: double-tap, press-and-hold (or right-click), and a swipe to the
 * right. Vertical scrolling stays native (touch-action: pan-y in CSS).
 */
function useGestures(ref: { current: HTMLElement | null }, h: { onDouble: () => void; onLong: () => void; onSwipe: () => void }) {
  const handlers = useRef(h)
  handlers.current = h
  useEffect(() => {
    const el = ref.current?.querySelector<HTMLElement>('.bubble-row')
    if (!el) return
    let start: { x: number; y: number; id: number } | null = null
    let swiping = false
    let longTimer: ReturnType<typeof setTimeout> | undefined
    let longFired = false
    let lastTap = 0
    const set = (dx: number) => el.style.setProperty('--dx', `${dx}px`)
    const reset = () => { clearTimeout(longTimer); el.classList.remove('dragging'); set(0) }

    const down = (e: PointerEvent) => {
      if (!e.isPrimary || e.button !== 0 || (e.target as HTMLElement).closest('button')) return
      start = { x: e.clientX, y: e.clientY, id: e.pointerId }
      swiping = longFired = false
      longTimer = setTimeout(() => { longFired = true; handlers.current.onLong() }, 450)
    }
    const move = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return
      const dx = e.clientX - start.x
      const dy = e.clientY - start.y
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) clearTimeout(longTimer)
      if (!swiping) {
        if (Math.abs(dy) > 10) { start = null; return }
        if (dx < 12) return
        swiping = true
        el.classList.add('dragging')
        try { el.setPointerCapture(e.pointerId) } catch { /* pointer already gone */ }
      }
      set(Math.min(80, Math.max(0, dx)))
    }
    const up = (e: PointerEvent) => {
      if (!start || e.pointerId !== start.id) return
      const dx = e.clientX - start.x
      const wasSwipe = swiping
      start = null
      swiping = false
      reset()
      if (wasSwipe) { if (dx > 56) handlers.current.onSwipe(); return }
      if (longFired) return
      const now = Date.now()
      if (now - lastTap < 320) { lastTap = 0; handlers.current.onDouble() } else lastTap = now
    }
    const context = (e: Event) => { e.preventDefault(); clearTimeout(longTimer); if (!longFired) handlers.current.onLong(); longFired = true }
    el.addEventListener('pointerdown', down)
    el.addEventListener('pointermove', move)
    el.addEventListener('pointerup', up)
    el.addEventListener('pointercancel', () => { start = null; swiping = false; reset() })
    el.addEventListener('contextmenu', context)
    return () => {
      reset()
      el.removeEventListener('pointerdown', down)
      el.removeEventListener('pointermove', move)
      el.removeEventListener('pointerup', up)
      el.removeEventListener('contextmenu', context)
    }
  }, [])
}

function Composer() {
  const text = draft.value
  const setText = (t: string) => { draft.value = t }
  const ref = useRef<HTMLTextAreaElement>(null)
  const [picking, setPicking] = useState(false)
  const reply = replyingTo.value
  const send = async (t: string) => {
    if (!t.trim()) return
    if (t === text) setText('')
    if (!(await sendChat(t)) && t === text) setText(t) // keep what you wrote if it didn't send
    ref.current?.focus()
  }
  // The emoji picker inserts where the caret was.
  const insert = (e: string) => {
    const el = ref.current
    const at = el?.selectionStart ?? text.length
    const end = el?.selectionEnd ?? text.length
    setText(text.slice(0, at) + e + text.slice(end))
    requestAnimationFrame(() => { el?.focus(); el?.setSelectionRange(at + e.length, at + e.length) })
  }
  return (
    <div class="composer-wrap">
      {reply && (
        <div class="reply-bar">
          <Icon name="reply" size={16} />
          <span class="grow"><span class="reply-who">Replying to {nameOf(reply.authorId)}</span><span class="reply-text">{reply.text}</span></span>
          <button class="icon-btn sm" aria-label="Cancel reply" onClick={() => { replyingTo.value = null }}><Icon name="close" size={16} /></button>
        </div>
      )}
      <form class="composer" onSubmit={e => { e.preventDefault(); send(text) }}>
        <button type="button" class="icon-btn emoji-btn" aria-label="Insert emoji" aria-haspopup="dialog" onClick={() => setPicking(true)}>
          <Icon name="smile" size={20} />
        </button>
        <textarea ref={ref} class="input" rows={1} maxLength={500} value={text} placeholder="Message…" aria-label="Message the room"
          onInput={e => { setText(e.currentTarget.value); notifyTyping() }}
          onKeyDown={e => {
            if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
              e.preventDefault()
              send(text)
            }
            if (e.key === 'Escape' && replyingTo.value) replyingTo.value = null
          }} />
        {text.trim()
          ? <button class="icon-btn send" aria-label="Send message"><Icon name="send" size={18} /></button>
          : <button type="button" class="icon-btn send heart" aria-label="Send a heart" onClick={() => send('❤️')}>❤️</button>}
      </form>
      <EmojiPicker open={picking} onClose={() => setPicking(false)} onPick={insert} title="Add an emoji" />
    </div>
  )
}
