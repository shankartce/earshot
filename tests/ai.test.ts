// The AI DJ and mood playlists: prompt building, parsing the model's answer, providers, and the
// whole round trip through a real Socket.IO server with a fake model.
import http from 'node:http'
import { io as connect, type Socket } from 'socket.io-client'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Ack, ClientToServer, Joined, RoomPatch, ServerToClient } from '../shared/events.ts'
import { DJ_ID, extractJson, mentionOf, parseDjPlan, parsePlaylistPlan } from '../shared/dj.ts'
import type { ChatMessage, RoomSnapshot, Track } from '../shared/types.ts'
import { parseSettingsPatch } from '../shared/validate.ts'
import { buildDjPrompt, buildPlaylistPrompt, rankCandidates } from '../server/ai/dj.ts'
import { aiFromEnv, type AiClient, type AiRequest } from '../server/ai/provider.ts'
import { RoomStore } from '../server/rooms/store.ts'
import { addParticipant, applyQueue, createRoom } from '../server/state/room.ts'
import { attachRealtime } from '../server/websocket/handlers.ts'

const track = (n: number, duration = 200): Track => ({
  id: `sha256:${String(n).padStart(64, '0')}`, title: `Song ${n}`, artist: 'A', album: '', duration,
})
const profile = (name: string) => ({ displayName: name, avatar: { emoji: '🙂', color: '#ff8844' } })
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

describe('mentions', () => {
  it('finds @name anywhere, in any case, as a whole word', () => {
    expect(mentionOf('@DJ play something mellow', 'DJ')).toBe('play something mellow')
    expect(mentionOf('hey @dj, skip this', 'DJ')).toBe('hey skip this')
    expect(mentionOf('queue more @Dj', 'DJ')).toBe('queue more')
    expect(mentionOf('@DJs are cool', 'DJ')).toBeNull()
    expect(mentionOf('mail me@dj.com', 'DJ')).toBeNull()
    expect(mentionOf('no mention here', 'DJ')).toBeNull()
  })
  it('works with a name the host picked', () => {
    expect(mentionOf('@Nova_2 something upbeat', 'Nova_2')).toBe('something upbeat')
    expect(mentionOf('@DJ hi', 'Nova_2')).toBeNull()
  })
  it('DJ names are one @-able word', () => {
    expect(parseSettingsPatch({ djName: 'Nova' })).toEqual({ djName: 'Nova' })
    expect(parseSettingsPatch({ djName: 'two words' })).toEqual({})
    expect(parseSettingsPatch({ djName: '<b>' })).toEqual({})
    expect(parseSettingsPatch({ aiDj: true })).toEqual({ aiDj: true })
    expect(parseSettingsPatch({ aiDj: 'yes' })).toEqual({})
  })
})

describe("reading the model's answer", () => {
  it('pulls JSON out of fences and chatter', () => {
    expect(extractJson('```json\n{"reply":"hi","actions":[]}\n```')).toEqual({ reply: 'hi', actions: [] })
    expect(extractJson('Sure! {"a": "has } brace"} and {"b":2}')).toEqual({ a: 'has } brace' })
    expect(extractJson('no json here')).toBeNull()
    expect(extractJson('{"broken": ')).toBeNull()
  })

  it('keeps only ids it was given, capped', () => {
    const known = { tracks: new Set(['t1', 't2']), items: new Set(['q1']) }
    const plan = parseDjPlan({
      reply: 'Here you go',
      actions: [
        { type: 'queue', tracks: ['t1', 't9', 't1', 'sha256:abc'] },
        { type: 'remove', item: 'q7' },
        { type: 'delete_room' },
        { type: 'skip' },
        { type: 'pause' },
        { type: 'play' },
        { type: 'play_next', tracks: ['t2'] },
      ],
    }, known)
    expect(plan.reply).toBe('Here you go')
    expect(plan.actions).toEqual([{ type: 'queue', tracks: ['t1'] }, { type: 'skip' }, { type: 'pause' }, { type: 'play' }])
    expect(parseDjPlan(null, known)).toEqual({ reply: '', actions: [] })
    expect(parseDjPlan({ reply: 'x'.repeat(1000) }, known).reply.length).toBe(300)
  })

  it('playlists only use songs from your library', () => {
    expect(parsePlaylistPlan({ name: 'Rainy', tracks: ['t2', 'x', 't1', 't2'] }, new Set(['t1', 't2']))).toEqual({ name: 'Rainy', tracks: ['t2', 't1'] })
  })
})

describe('prompts', () => {
  const setup = () => {
    const room = createRoom('ABCDE', 'Late Night', '🌙', 0)
    const alex = addParticipant(room, profile('Alex'), 0, 'pid-alex', 'secret-token-alex')
    addParticipant(room, profile('Sam'), 0, 'pid-sam', 'secret-token-sam')
    applyQueue(room, alex.id, { type: 'ADD', tracks: [track(1)] }, 0, () => 'item-1')
    return room
  }

  it('ranks songs by how many people here own them, skipping what is already coming up', () => {
    const room = setup()
    applyQueue(room, 'pid-alex', { type: 'ADD', tracks: [track(4)] }, 0, () => 'item-4')
    const ranked = rankCandidates(room, [[track(2), track(3), track(4)], [track(3)]])
    expect(ranked.map(c => [c.track.title, c.owners])).toEqual([['Song 3', 2], ['Song 2', 1], ['Song 1', 0]])
  })

  it('uses short ids and never leaks hashes, tokens or participant ids', () => {
    const room = setup()
    room.chat.push({ id: 'm1', authorId: 'pid-sam', text: 'something chill please', at: 0, reactions: {} })
    const p = buildDjPrompt(room, [[track(2)]], 'queue a chill one', 'Alex')
    const all = p.system + p.user
    expect(all).not.toMatch(/sha256|secret-token|pid-/)
    expect(all).toContain('Sam: something chill please')
    expect(all).toContain('REQUEST from Alex: queue a chill one')
    expect(p.tracks.get('t1')?.id).toBe(track(2).id)
    expect(p.items.get('q1')).toBe('item-1')
  })

  it('playlist prompts map short ids back to your tracks', () => {
    const p = buildPlaylistPrompt('rainy day', [track(1), track(2)])
    expect(p.user).toContain('MOOD: rainy day')
    expect(p.user).not.toContain('sha256')
    expect(p.tracks.get('t2')?.id).toBe(track(2).id)
  })
})

describe('providers', () => {
  const fakeFetch = (body: unknown, calls: { url: string; init: RequestInit }[]) =>
    (async (url: string, init: RequestInit) => {
      calls.push({ url, init })
      return new Response(JSON.stringify(body), { status: 200 })
    }) as unknown as typeof fetch

  it('is off without a model', () => {
    expect(aiFromEnv({})).toBeNull()
    expect(aiFromEnv({ AI_API_KEY: 'k' })).toBeNull()
  })

  it('speaks OpenAI-compatible chat completions (OpenAI, OpenRouter, Ollama…)', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const ai = aiFromEnv({ AI_MODEL: 'llama3.1', AI_BASE_URL: 'http://localhost:11434/v1/' },
      fakeFetch({ choices: [{ message: { content: 'hello' } }] }, calls))!
    expect(await ai.complete({ system: 'sys', user: 'hi', maxTokens: 50 })).toBe('hello')
    expect(calls[0].url).toBe('http://localhost:11434/v1/chat/completions')
    expect((calls[0].init.headers as any).authorization).toBeUndefined() // local server, no key
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({
      model: 'llama3.1', max_tokens: 50, messages: [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }],
    })
  })

  it('speaks the Anthropic Messages API', async () => {
    const calls: { url: string; init: RequestInit }[] = []
    const ai = aiFromEnv({ AI_PROVIDER: 'anthropic', AI_MODEL: 'claude-sonnet-5-5', AI_API_KEY: 'sk-test' },
      fakeFetch({ content: [{ type: 'text', text: 'hey' }] }, calls))!
    expect(await ai.complete({ system: 'sys', user: 'hi', maxTokens: 50 })).toBe('hey')
    expect(calls[0].url).toBe('https://api.anthropic.com/v1/messages')
    expect(calls[0].init.headers).toMatchObject({ 'x-api-key': 'sk-test', 'anthropic-version': '2023-06-01' })
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ model: 'claude-sonnet-5-5', system: 'sys', messages: [{ role: 'user', content: 'hi' }] })
  })

  it('turns HTTP errors into short messages', async () => {
    const ai = aiFromEnv({ AI_MODEL: 'm', AI_API_KEY: 'k' }, (async () => new Response('nope', { status: 429 })) as unknown as typeof fetch)!
    await expect(ai.complete({ system: '', user: '', maxTokens: 1 })).rejects.toThrow(/busy/)
  })
})

// ---------- end to end with a fake model ----------

type Client = Socket<ServerToClient, ClientToServer>

let server: http.Server
let url: string
let store: RoomStore
const clients: Client[] = []
/** The fake model: answers with whatever the test sets, and remembers what it was asked. */
const model = { answer: '{"reply":"","actions":[]}', asked: [] as AiRequest[], delay: 0 }
const fakeAi: AiClient = {
  async complete(req) {
    model.asked.push(req)
    await sleep(model.delay)
    return model.answer
  },
}

function client() {
  const s: Client = connect(url, { forceNew: true, transports: ['websocket'] })
  clients.push(s)
  const view = { state: null as RoomSnapshot | null, chat: [] as ChatMessage[], errors: [] as string[], patches: [] as RoomPatch[], you: '' }
  s.on('room:state', st => { view.state = st })
  s.on('room:patch', (p: RoomPatch) => {
    view.patches.push(p)
    if (!view.state) return
    const { meta, ...rest } = p
    Object.assign(view.state, rest, meta ?? {})
  })
  s.on('chat:message', m => view.chat.push(m))
  s.on('ai:error', t => view.errors.push(t))
  const call = <T,>(event: string, ...args: unknown[]) => new Promise<T>(resolve => (s.emit as any)(event, ...args, resolve))
  const adopt = (r: Ack<Joined>) => {
    if (r.ok) Object.assign(view, { state: r.state, you: r.you })
    return r
  }
  return {
    s, view, call,
    create: (name: string) => call<Ack<Joined>>('room:create', { name: 'Late Night', emoji: '🌙', profile: profile(name) }).then(adopt),
    join: (code: string, name: string) => call<Ack<Joined>>('room:join', { code, profile: profile(name) }).then(adopt),
    chat: (text: string) => call<Ack>('chat:send', text),
    settings: (p: object) => call<Ack>('room:settings', p),
  }
}

async function until(fn: () => boolean, ms = 2000) {
  const end = Date.now() + ms
  while (!fn()) {
    if (Date.now() > end) throw new Error('timed out waiting for condition')
    await sleep(10)
  }
}

async function start(ai: AiClient | null = fakeAi) {
  store = new RoomStore(null)
  server = http.createServer()
  attachRealtime(server, { store, graceMs: 150, ai })
  await new Promise<void>(r => server.listen(0, r))
  url = `http://localhost:${(server.address() as any).port}`
}

async function djRoom() {
  const alex = client()
  const sam = client()
  const r = await alex.create('Alex')
  if (!r.ok) throw new Error(r.error)
  await sam.join(r.code, 'Sam')
  expect(await alex.settings({ aiDj: true })).toEqual({ ok: true })
  return { alex, sam, code: r.code }
}

beforeEach(() => {
  Object.assign(model, { answer: '{"reply":"","actions":[]}', asked: [], delay: 0 })
  return start()
})
afterEach(async () => {
  for (const c of clients.splice(0)) c.disconnect()
  await new Promise(r => server.close(r))
})

describe('the room DJ', () => {
  it('reports whether this server has AI', async () => {
    const c = client()
    expect(await c.call('ai:status')).toEqual({ available: true })
  })

  it('queues songs people own and answers in the thread, for everyone', async () => {
    const { alex, sam } = await djRoom()
    sam.s.emit('ai:catalog', [track(1), track(2)])
    alex.s.emit('ai:catalog', [track(2)])
    await sleep(30)
    model.answer = 'Sure!\n```json\n{"reply":"Two mellow ones coming up 🎶","actions":[{"type":"queue","tracks":["t1","t2"]}]}\n```'
    expect(await sam.chat('@DJ queue something mellow')).toEqual({ ok: true })
    await until(() => alex.view.chat.some(m => m.authorId === DJ_ID))
    const reply = alex.view.chat.find(m => m.authorId === DJ_ID)!
    expect(reply.text).toBe('Two mellow ones coming up 🎶')
    expect(reply.replyTo?.text).toBe('@DJ queue something mellow')
    // The song Alex and Sam both own ranks first.
    expect(model.asked[0].user).toMatch(/t1: Song 2 by A .*\[owned by 2\/2\]/)
    await until(() => alex.view.state!.queue.items.length === 2)
    expect(alex.view.state!.queue.items.map(i => i.track.title)).toEqual(['Song 2', 'Song 1'])
    expect(alex.view.state!.queue.items[0].addedBy).toBe(sam.view.you) // it acted as Sam
  })

  it('stays quiet when it is off or not mentioned', async () => {
    const alex = client()
    await alex.create('Alex')
    await alex.chat('@DJ play something') // the DJ is off by default
    await sleep(50)
    expect(model.asked).toHaveLength(0)
    await alex.settings({ aiDj: true })
    await alex.chat('the dj is great')
    await sleep(50)
    expect(model.asked).toHaveLength(0)
  })

  it("follows the room's rules: it can't skip for someone who isn't allowed to", async () => {
    const { alex, sam } = await djRoom()
    await alex.call('queue:command', { type: 'ADD', tracks: [track(1), track(2)] })
    await alex.settings({ playbackControl: 'host' })
    const before = alex.view.state!.playback.itemId
    model.answer = '{"reply":"Skipping!","actions":[{"type":"skip"}]}'
    await sam.chat('@dj skip this')
    await until(() => sam.view.chat.some(m => m.authorId === DJ_ID))
    expect(sam.view.chat.find(m => m.authorId === DJ_ID)!.text).toBe("Skipping! I couldn't skip: Only the host can control playback.")
    expect(alex.view.state!.playback.itemId).toBe(before)
  })

  it('uses the name the host picked', async () => {
    const { alex } = await djRoom()
    await alex.settings({ djName: 'Nova' })
    await alex.chat('@DJ hello')
    await sleep(50)
    expect(model.asked).toHaveLength(0)
    model.answer = '{"reply":"Hi Alex!","actions":[]}'
    await alex.chat('@nova hello')
    await until(() => alex.view.chat.some(m => m.authorId === DJ_ID))
    expect(model.asked[0].system).toContain('You are Nova')
  })

  it("never shares anyone's song list with the room or saves it", async () => {
    const { alex, sam } = await djRoom()
    sam.s.emit('ai:catalog', [track(77)])
    await sleep(30)
    const room = [...store.rooms.values()][0]
    expect(JSON.stringify(room)).not.toContain(track(77).id)
    expect(JSON.stringify(alex.view.patches)).not.toContain(track(77).id)
    // It is used for the DJ while Sam is here, and forgotten when Sam leaves.
    model.answer = '{"reply":"ok","actions":[]}'
    await alex.chat('@DJ what do we have?')
    await until(() => model.asked.length === 1)
    expect(model.asked[0].user).toContain('Song 77')
    sam.s.emit('room:leave')
    await sleep(30)
    await until(() => alex.view.chat.some(m => m.authorId === DJ_ID))
    await alex.chat('@DJ and now?')
    await until(() => model.asked.length === 2)
    expect(model.asked[1].user).not.toContain('Song 77')
  })

  it('one request at a time per room, and a per-person limit', async () => {
    const { alex, sam } = await djRoom()
    model.delay = 150
    await alex.chat('@DJ one')
    await sam.chat('@DJ two')
    await until(() => sam.view.errors.length === 1)
    expect(sam.view.errors[0]).toMatch(/still working/)
    model.delay = 0
    const replies = () => alex.view.chat.filter(m => m.authorId === DJ_ID).length
    await until(() => replies() === 1)
    await alex.chat('@DJ again')
    await until(() => replies() === 2)
    await alex.chat('@DJ and again') // Alex's third request this minute
    await until(() => replies() === 3)
    await alex.chat('@DJ once more')
    await until(() => alex.view.errors.length === 1)
    expect(alex.view.errors[0]).toMatch(/a lot of requests/)
    expect(model.asked).toHaveLength(3) // one, again, and again ("two" was refused as busy)
  })

  it('builds a playlist from the songs you send, and only those', async () => {
    const c = client()
    model.answer = '{"name":"Rainy Sunday","tracks":["t2","t9","t1"]}'
    const r = await c.call<any>('ai:playlist', { prompt: 'rainy sunday coffee', tracks: [track(1), track(2)] })
    expect(r).toEqual({ ok: true, name: 'Rainy Sunday', trackIds: [track(2).id, track(1).id] })
    expect(await c.call<any>('ai:playlist', { prompt: '', tracks: [track(1)] })).toMatchObject({ ok: false })
  })
})

describe('without AI configured', () => {
  beforeEach(async () => {
    await new Promise(r => server.close(r))
    await start(null)
  })

  it('says so and ignores mentions', async () => {
    const alex = client()
    expect(await alex.call('ai:status')).toEqual({ available: false })
    await alex.create('Alex')
    await alex.settings({ aiDj: true })
    await alex.chat('@DJ play')
    await sleep(50)
    expect(alex.view.chat.filter(m => m.authorId === DJ_ID)).toHaveLength(0)
    expect(await alex.call<any>('ai:playlist', { prompt: 'x', tracks: [track(1)] })).toEqual({ ok: false, error: 'AI is not set up on this server.' })
  })
})
