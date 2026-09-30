# Claude notes for Earshot

Earshot ("Come listen with me.") is a set of shared listening rooms where each person plays their **own local copy** of each song. Stack: Vite + Preact + TypeScript client, Express + Socket.IO server that runs `.ts` directly on Node 22.18+.

## Invariants (don't break these)
- **Audio never touches the server.** No upload endpoints, no body parsers, no audio/artwork in socket payloads. Only `Track = { id: 'sha256:…', title, artist, album, duration }` is shared.
- **Peer-to-peer sharing is rights-gated.** Only tracks the owner attested (own / CC / public domain, `LocalTrack.share`) can be offered. The server relays only the WebRTC handshake, and only lets you `request` a track from someone offering it. Receivers verify the SHA-256 and keep the copy in their library (`LocalTrack.sharedBy`, shown under "Shared with me"); received songs are never re-offered. Transfers are pinned to one socket per side on the server. No TURN relay: it would route audio through a server.
- **Audio output never goes through Web Audio.** The visualizer taps `audio.captureStream()` (Chromium only); routing the element through an AudioContext would silence music whenever the context suspends (screen lock, app switch).
- **The server is authoritative.** All state changes go through the pure reducer in `server/state/room.ts`, using server time only (`serverTimestamp`). Client timestamps and positions are never trusted, apart from a clamped SEEK target.
- **Versioned commands.** Playback commands carry `baseVersion`; stale ones are rejected with `error: 'stale'`, which the client ignores silently. Queue ops target item ids; MOVE is version-checked.
- **Client drift correction** lives in `src/audio/player.ts` + `src/sync/drift.ts`. The playhead math is `shared/playback.ts#positionAt`, the same on both sides.
- **The Web Audio graph (visualizer) is gesture-gated.** A suspended AudioContext means silence, so the sync loop falls back to "Tap to tune in".

## Commands
- `npm run dev` runs app + realtime in one process on :5173. Demo mode: Invite sheet → "Open as Sam".
- `npm test`, `npm run typecheck`, `npm run build && npm start` (:3000, CSP enforced).

## Where things are
See the "Project layout" section in README.md. Adding a realtime feature means: types in `shared/events.ts` → validator in `shared/validate.ts` → reducer in `server/state/room.ts` → handler in `server/websocket/handlers.ts` → client in `src/state/*` → a test in `tests/`.

## Gotchas
- While the Vite dev server is running, edit files with the Write/Edit tools. Shell redirection (`cat > file`) can leave Vite serving an empty module on Windows; `touch` the file if exports vanish.
- `player.ts`, `state/room.ts`, `state/social.ts` and `realtime/socket.ts` own long-lived side effects and force a full reload on HMR (`import.meta.hot.dispose`).
- The client imports `applyQueue` from `server/state/room.ts` to predict queue edits. Keep that file free of Node-only imports.
- Browser-only features need a secure origin (localhost or HTTPS).
- Demo tabs (`?as=Name`) keep their identity and library index in sessionStorage. The OPFS blobs are shared but content-addressed.
