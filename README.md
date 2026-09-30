# Free Jam

**Listen together, wherever you are.** Create a room, invite a friend, press play. Everyone hears the same moment of the same song, each from their **own** copy on their own device.

The server only coordinates the room: who's here, what's queued, what's playing and where. **Audio is never uploaded, streamed or stored on the server.** No upload endpoint exists.

## Quick start

Requires **Node.js 22.18+**. The server runs TypeScript directly, with no build step for the server.

```bash
npm install
npm run dev        # http://localhost:5173 (app + realtime server in one process)
```

Try it as two people on one computer:

1. Create a room.
2. Open **Invite → Demo mode → "Open as Sam in a new tab"**. Demo tabs get their own identity and their own library.
3. Add a few audio files in each tab. Songs whose files match are recognized automatically.

Other commands:

```bash
npm test           # 73 unit + multi-client integration tests (Vitest)
npm run typecheck
npm run build      # client → dist/
npm start          # production server on http://localhost:3000
```

| Env var | Default | |
|---|---|---|
| `PORT` | `3000` | HTTP + WebSocket port |
| `DATA_FILE` | `data/rooms.json` | where room memory is saved (the dev server uses `data/rooms.dev.json`) |

### Phones and other devices: use HTTPS

Browsers only enable the APIs this app needs on secure origins: file hashing (`crypto.subtle`), the private file store (OPFS) and Web Audio. `localhost` counts as secure. `http://192.168.x.x` from your phone does **not**, and importing music there will fail. To test on a phone, use an HTTPS tunnel (for example `cloudflared tunnel --url http://localhost:5173`) or deploy it.

### Deploying

- It needs a host with long-lived WebSockets and **a single instance**, because rooms live in memory and are snapshotted to one JSON file. Render, Fly.io and Railway all work.
- Serverless platforms (for example Vercel Functions) are not a fit.
- Put `DATA_FILE` on a persistent disk if rooms should survive redeploys.
- Serve the app over HTTPS (see above).

## What's in it

- **Rooms:**
  - A 5-character code like `F7K9Q` and an invite link at `/room/F7K9Q`.
  - The room name and emoji, your display name, and an emoji avatar.
  - A join preview ("🌙 Late Night Drive · Alex is listening").
  - "Jump back in" on the home page to resume rooms you've been in.
- **Synced playback:** play, pause, seek, next and previous, and "Tap to tune in" when the browser blocks autoplay. Lock-screen and media-key controls also work.
- **Presence:** who's online or away, and whether each person can hear the current song (Ready / Local file missing / Needs a tap). Joined and left notices appear, with a 30-second grace period for quick reconnects.
- **Host or collaborative:** the host decides who controls playback and who edits the queue, and can turn chat and reactions on or off. Everyone can always add songs and remove their own. If the host leaves, control passes to whoever has been there longest.
- **Local library** (`/library`):
  - Add files or whole folders, or drag and drop.
  - Tags and embedded artwork are read in the browser.
  - Search, sort by title/artist/album/recently added, playlists, and removal. Storage usage is shown.
  - Files are kept in the browser's private storage, so the library survives reloads.
- **Queue:** drag to reorder, or use the "⋯" sheet (Play now / Play next / Move / Remove). Alt+↑/↓ moves a song. Clear, "Recently played", and instant updates that the server then confirms.
- **Social:** chat (typing indicator, unread count, reactions on messages) and reactions to the music that float over the artwork for everyone.
- **Now playing:** artwork (a generated cover if you don't have the file), elapsed and remaining time, and visualizers (Ring, Bars, Waveform, Glow) analysed locally. Synced lyrics come from your own `.lrc` files.
- **Phones:** bottom tabs (Room / Queue / Chat / Library) and a persistent mini-player.
- **Accessibility:** keyboard shortcuts (Space/K, J/L, N/P), focus management, screen-reader announcements, and support for `prefers-reduced-motion`.

## How synchronization works

The **room state on the server is authoritative**. The local `<audio>` element is only the playback mechanism.

1. **Server timeline.** `PlaybackState = { itemId, isPlaying, position, serverTimestamp, version }`. The room's playhead at any server time `t` is `position + (t − serverTimestamp)` while playing ([shared/playback.ts](shared/playback.ts)). Every timestamp is the server's; client times are never trusted. Pause positions are computed by the server, and seeks are clamped to the song length.
2. **Clock sync.** Each client pings the server 5 times and keeps the fastest round trip: `offset = serverNow − (t0 + t1) / 2`. It repeats every 30 s, on reconnect and when a tab wakes up ([src/sync/clock.ts](src/sync/clock.ts)).
3. **Drift correction** runs about once a second while playing ([src/sync/drift.ts](src/sync/drift.ts), [src/audio/player.ts](src/audio/player.ts)):

   | drift | action |
   |---|---|
   | < 50 ms | nothing |
   | 50–250 ms | nudge `playbackRate` (at most ±5%, pitch preserved) until within 25 ms (hysteresis) |
   | > 250 ms | seek, aiming ahead by a per-device *learned* seek delay, then a 1.5 s cooldown |

   Thresholds and a **speaker delay** (for Bluetooth) are adjustable in `/settings`.
4. **Conflicts.** Playback commands carry `baseVersion`. If two people act at once, the first wins and the second is told it was stale. Queue edits target item ids, and moves are version-checked. When a song ends, every client reports it but only the first report counts. If no one reports it (for example, nobody has the file), a server timer moves to the next song.
5. **Reconnects.** Socket.IO reconnects automatically. The client re-syncs its clock, rejoins with its private session token, takes a fresh snapshot, reloads the local file, seeks and resumes.

In testing, two tabs stayed within about 10–30 ms of the room timeline.

## Track identity

- A song's id is `sha256:<hash of the file>`, computed in a Web Worker. Filenames don't matter.
- If you don't have that exact file, the app looks for a **probable match**: same normalized title and artist, and length within 2 s. It asks *"Is this the same song?"*, and remembers "Use my copy". "Not the same" is remembered until you reload.
- Only `{ id, title, artist, album, duration }` is ever sent. Artwork stays local; people without the file see a cover generated from the hash.

## Project layout

```
shared/        types, typed Socket.IO events, payload validators, playhead math (used by both sides)
server/
  app.ts       Express: static client, SPA routes, security headers (CSP etc.), no upload routes
  index.ts     production entry        vite-plugin.ts  dev: realtime inside Vite's server
  state/room.ts        pure room reducer (playback, queue, presence, chat), also used by the client
                       to predict queue edits instantly
  rooms/store.ts       rooms in memory + debounced JSON snapshot, 7-day expiry
  websocket/handlers.ts  validate → rate-limit → apply → broadcast changed slice
  rateLimit.ts         token buckets per socket
src/
  audio/       player.ts (sync engine), visualizer.ts (drawing)
  sync/        clock.ts, drift.ts
  library/     library.ts (OPFS + index), hash.worker.ts, metadata.ts, match.ts
  lyrics/      lrc.ts (parser), lyrics.ts (provider list, ready for a licensed API)
  state/       room.ts (server mirror + commands), social.ts, profile.ts, ui.ts, actions.ts
  components/  pages/  styles/ (tokens.css design tokens, app.css)
tests/         room reducer, validators, sync math, library matching, metadata, LRC,
               HTTP surface, and multi-client Socket.IO scenarios
```

## Realtime events

| Client → server | | Server → client | |
|---|---|---|---|
| `clock:ping` | clock sync | `room:state` | full snapshot (join / reconnect) |
| `room:create` / `room:join` / `room:peek` / `room:leave` | rooms | `room:patch` | only the changed slice (`playback`, `queue`, `participants`, `settings`, `meta`, `history`) |
| `playback:command` | `PLAY` `PAUSE` `SEEK` `NEXT` `PREVIOUS` `PLAY_ITEM` `ENDED` + `baseVersion` | `presence:joined` / `presence:left` | |
| `queue:command` | `ADD` `REMOVE` `MOVE` `PLAY_NEXT` `CLEAR` | `chat:message` / `chat:reactions` / `chat:typing` | |
| `room:settings`, `status:update` | host settings, your readiness | `reaction` | floating reaction |
| `chat:send` / `chat:typing` / `chat:react` / `reaction:send` | social | | |

Types are in [shared/events.ts](shared/events.ts). Every payload is validated ([shared/validate.ts](shared/validate.ts)) and rate-limited per socket.

## Security notes

- Chat text has control and bidi-override characters stripped, is length-capped, and is rendered as text, never HTML.
- Session tokens are secret and never broadcast; public participant ids can't be used to impersonate someone.
- Socket messages are capped at 256 KB. Only GET and HEAD are served over HTTP.
- CSP, `nosniff`, `no-referrer` and a restrictive `Permissions-Policy` are set on every response.

## Testing

`npm test` covers the room reducer (every playback and queue operation, permissions, host handoff, stale and conflicting commands), clock and drift math, validators, rate limits, fuzzy matching, tag parsing on generated MP3/WAV/corrupted files, and the LRC parser. It also runs real Socket.IO scenarios with 2–3 clients, simulated latency, clocks set up to 90 s wrong, reconnects, restarts with persistence, concurrent queue edits, chat and reactions.

Browser-only behaviour (the private file store, `<audio>`, Web Audio, layout) was verified by hand in Chrome. There are no automated browser tests.

## Known limits

- One server instance. Scaling out would need shared room state (for example Redis) and sticky sessions.
- No accounts. Your seat in a room is a private token kept in this browser.
- Room codes (about 33 million combinations) are guessable at scale. Joins and peeks are rate-limited per connection, not per IP.
- iOS may pause background audio. The app re-syncs when you come back, and asks for a tap if needed.
- Lyrics come only from your own `.lrc` files. Nothing is scraped.
