# Claude notes for Free Jam

You are extending a Node.js + Express + Socket.IO browser app.

Core design constraint: audio files remain local to each browser. The server stores only room state and track metadata/hashes.

Before adding a feature, preserve:
- local-only audio handling
- room state synchronization over Socket.IO
- server-authoritative `changedAt` timestamps
- client-side drift correction

Run `npm start` for manual testing. Keep the prototype dependency-light.

Suggested next task: add queue reordering/removal with a small drag/drop UI while keeping the server's queue authoritative.
