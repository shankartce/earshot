// Small realtime chat — deliberately secondary to the music.
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks'
import { REACTIONS } from '../../shared/types.ts'
import { me, participantById, room } from '../state/room.ts'
import { chatOpen, draft, notifyTyping, pending, reactToMessage, sendChat, typingNames } from '../state/social.ts'
import { groupMessages, typingText } from '../utils/chat.ts'
import { clockTime } from '../utils/format.ts'
import { Icon } from './icons.tsx'
import { Avatar, Empty } from './ui.tsx'

export function Chat() {
  const r = room.value!
  const listRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [newBelow, setNewBelow] = useState(false)
  const count = r.chat.length + pending.value.length

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
  const typing = typingText(typingNames.value)

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
        {groups.map(g => {
          const who = participantById(g.authorId)
          const mine = g.authorId === me.value
          return (
            <div key={g.messages[0].id} class={`msg-group${mine ? ' mine' : ''}`}>
              {who ? <Avatar avatar={who.avatar} size={28} /> : <span class="avatar-gap" />}
              <div class="msg-col">
                <p class="msg-meta"><strong>{mine ? 'You' : who?.displayName ?? 'Someone'}</strong> <time dateTime={new Date(g.at).toISOString()}>{clockTime(g.at)}</time></p>
                {g.messages.map(m => <Message key={m.id} id={m.id} text={m.text} reactions={m.reactions} />)}
              </div>
            </div>
          )
        })}
        {pending.value.map(p => (
          <div key={`p${p.key}`} class="msg-group mine sending">
            <span class="avatar-gap" />
            <div class="msg-col"><p class="bubble">{p.text}</p><p class="msg-meta">Sending…</p></div>
          </div>
        ))}
      </div>
      {newBelow && <button class="pill new-below" onClick={toBottom}><Icon name="down" size={14} /> New messages</button>}
      <p class="typing" aria-live="polite">{typing}</p>
      <Composer />
    </section>
  )
}

function Message({ id, text, reactions }: { id: string; text: string; reactions: Record<string, string[]> }) {
  const [picking, setPicking] = useState(false)
  const allow = room.value!.settings.allowReactions
  const entries = Object.entries(reactions)
  return (
    <div class="msg">
      <p class="bubble">{text}</p>
      {allow && (
        <button class="react-btn" aria-label="React to this message" aria-expanded={picking} onClick={() => setPicking(!picking)}>
          <span aria-hidden="true">☺</span>
        </button>
      )}
      {picking && (
        <div class="react-picker" role="group" aria-label="Pick a reaction">
          {REACTIONS.map(e => (
            <button key={e} aria-label={`React ${e}`} onClick={() => { reactToMessage(id, e); setPicking(false) }}>{e}</button>
          ))}
        </div>
      )}
      {entries.length > 0 && (
        <div class="msg-reactions">
          {entries.map(([emoji, who]) => {
            const mine = who.includes(me.value)
            const names = who.map(p => (p === me.value ? 'you' : participantById(p)?.displayName ?? 'someone')).join(', ')
            return (
              <button key={emoji} class={`chip-react${mine ? ' mine' : ''}`} aria-pressed={mine}
                aria-label={`${emoji} ${who.length}: ${names}. ${mine ? 'Remove your reaction' : 'Add yours'}`} title={names}
                onClick={() => allow && reactToMessage(id, emoji)}>
                {emoji} <span>{who.length}</span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

function Composer() {
  const text = draft.value
  const setText = (t: string) => { draft.value = t }
  const ref = useRef<HTMLTextAreaElement>(null)
  const submit = async () => {
    const t = text
    if (!t.trim()) return
    setText('')
    if (!(await sendChat(t))) setText(t) // keep what you wrote if it didn't send
    ref.current?.focus()
  }
  return (
    <form class="composer" onSubmit={e => { e.preventDefault(); submit() }}>
      <textarea ref={ref} class="input" rows={1} maxLength={500} value={text} placeholder="Message the room…" aria-label="Message the room"
        onInput={e => { setText(e.currentTarget.value); notifyTyping() }}
        onKeyDown={e => {
          if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) {
            e.preventDefault()
            submit()
          }
        }} />
      <button class="icon-btn send" disabled={!text.trim()} aria-label="Send message"><Icon name="send" size={18} /></button>
    </form>
  )
}
