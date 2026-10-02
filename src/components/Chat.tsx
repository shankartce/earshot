// Room chat, Instagram-style: bubbles (yours on the right), double-tap to ❤️, press and hold for
// reactions / reply / copy, swipe right to reply, "Seen", and big emoji-only messages.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { REACTIONS, type ChatMessage } from '../../shared/types.ts'
import { me, participantById, room, toast } from '../state/room.ts'
import { chatOpen, draft, notifyTyping, pending, reactToMessage, replyingTo, sendChat, typingNames } from '../state/social.ts'
import { groupMessages, needsSeparator, seenText, separatorLabel, typingText } from '../utils/chat.ts'
import { isJumbo } from '../utils/emoji.ts'
import { EmojiPicker } from './EmojiPicker.tsx'
import { Icon } from './icons.tsx'
import { openProfile } from './Participants.tsx'
import { Avatar, Empty, Sheet } from './ui.tsx'

const QUICK = REACTIONS.slice(0, 6)
const nameOf = (id: string) => (id === me.value ? 'You' : participantById(id)?.displayName ?? 'Someone')

export function Chat() {
  const r = room.value!
  const listRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
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

  const toBottom = () => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: 'smooth' })
    setNewBelow(false)
  }

  if (!r.settings.allowChat) {
    return <section class="panel chat"><Empty icon="users" title="Chat is turned off in this room." /></section>
  }

  const groups = groupMessages(r.chat)
  const many = r.participants.length > 2
  const last = r.chat.at(-1)
  // "Seen" sits under your newest message, once it's the latest thing in the chat.
  const others = r.participants.filter(p => p.id !== me.value)
  const seenBy = last && last.authorId === me.value
    ? others.filter(p => (p.seenAt ?? 0) >= last.at).map(p => p.displayName) : []

  return (
    <section class="panel chat" aria-labelledby="chat-h">
      <header class="panel-head"><h2 id="chat-h">Chat</h2></header>
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
  const [tray, setTray] = useState(false)
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
  const reply = () => { replyingTo.value = m; setTray(false); document.querySelector<HTMLTextAreaElement>('.composer textarea')?.focus() }
  useGestures(ref, { onDouble: heart, onLong: () => setTray(true), onSwipe: reply })

  // Close the tray on an outside tap or Esc.
  useEffect(() => {
    if (!tray) return
    const off = (e: Event) => { if (!ref.current?.contains(e.target as Node)) setTray(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setTray(false) }
    document.addEventListener('pointerdown', off, true)
    document.addEventListener('keydown', esc)
    return () => { document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', esc) }
  }, [tray])

  const entries = Object.entries(m.reactions).sort((a, b) => b[1].length - a[1].length)
  const total = entries.reduce((n, [, who]) => n + who.length, 0)
  return (
    <div id={`msg-${m.id}`} class={`msg pos-${pos}${jumbo ? ' jumbo' : ''}${entries.length ? ' has-reacts' : ''}`} ref={ref}>
      {m.replyTo && (
        <button class="reply-quote" onClick={() => jumpTo(m.replyTo!.id)}>
          <span class="reply-who">{mine ? 'You' : nameOf(m.authorId)} replied to {m.replyTo.authorId === m.authorId ? (mine ? 'yourself' : 'themself') : m.replyTo.authorId === me.value ? 'you' : nameOf(m.replyTo.authorId)}</span>
          <span class="reply-text">{m.replyTo.text}</span>
        </button>
      )}
      <div class="bubble-row">
        <span class="swipe-hint" aria-hidden="true"><Icon name="reply" size={16} /></span>
        <p class="bubble">{m.text}</p>
        <button class="msg-more" aria-label="Message options" aria-expanded={tray} onClick={() => setTray(!tray)}>
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
      {tray && (
        <div class="msg-tray" role="menu" aria-label="Message options">
          {allow && (
            <div class="tray-emojis">
              {QUICK.map(e => (
                <button key={e} role="menuitem" class={(m.reactions[e] ?? []).includes(me.value) ? 'on' : ''}
                  aria-label={`React ${e}`} onClick={() => { reactToMessage(m.id, e); setTray(false) }}>{e}</button>
              ))}
              <button role="menuitem" class="tray-plus" aria-label="More reactions" onClick={() => { setPicking(true); setTray(false) }}><Icon name="plus" size={16} /></button>
            </div>
          )}
          <div class="tray-actions">
            <button role="menuitem" onClick={reply}><Icon name="reply" size={16} /> Reply</button>
            <button role="menuitem" onClick={() => {
              navigator.clipboard?.writeText(m.text).then(() => toast('Copied'), () => toast("Couldn't copy", { tone: 'error' }))
              setTray(false)
            }}><Icon name="copy" size={16} /> Copy</button>
          </div>
        </div>
      )}
      <EmojiPicker open={picking} onClose={() => setPicking(false)} onPick={e => reactToMessage(m.id, e)} title="React to this message" />
      {showWho && <WhoReacted m={m} onClose={() => setShowWho(false)} />}
    </div>
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
