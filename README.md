# Free Jam — local-file shared listening

A small Spotify-Jam-style prototype for friends who already have the same audio files locally.

## What it does

- Create a 6-character room or join with a code.
- Each person selects their own local audio files.
- The browser hashes each file with SHA-256 so identical files can be matched across devices.
- The room shares queue metadata and playback commands: play, pause, seek, next, previous.
- Playback is synchronized using a server-clock offset and periodic drift correction.
- Audio is **never uploaded to the server**.

## Run locally

Requires Node.js 18+.

```bash
npm install
npm start
```

Open http://localhost:3000 in two browser windows/devices. For devices on another machine, run the server on a LAN-accessible host and use that host's address; for internet use, deploy the Node server to a host that supports WebSockets.

## Important limitation

This prototype intentionally does not transfer songs between listeners. Everyone needs the corresponding local file. This keeps the server as a synchronization service rather than a music distributor.

## Natural next features

- Host/DJ permissions
- Remove/reorder tracks in the shared queue
- Better metadata parsing (ID3)
- Per-user presence and avatars
- Reactions/chat synced to the room
- Persistent rooms using Redis/Postgres
- Better clock sync (NTP-style multiple samples)
- PWA/mobile install
- Optional WebRTC audio streaming for files the host chooses to share, subject to rights and applicable law
