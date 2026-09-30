# Prompt for Claude

You are helping extend **Free Jam**, a small Spotify-Jam-style web app.

Repo structure:
- `server.js`: Express + Socket.IO room server
- `public/index.html`: UI
- `public/app.js`: local audio library + synchronization client
- `public/styles.css`: UI styling

Product goal:
Two friends should be able to open the same online room, select their own local copies of songs, and share the experience of listening together. Both can control play/pause/seek/next/previous. The server must synchronize state only; audio files must remain on the listeners' devices.

Current synchronization model:
- Server stores `queue`, `currentTrackId`, `position`, `isPlaying`, `changedAt`.
- `changedAt` is a server timestamp.
- Clients estimate server-clock offset and calculate effective playback position.
- Clients periodically correct drift.
- Local files are identified using SHA-256 so the same file can be matched across devices.

Constraints:
1. Do not upload or persist audio files on the server.
2. Do not add a music catalog or bypass Spotify's subscription/licensing controls.
3. Keep the existing simple Node/Express/Socket.IO stack unless there is a strong reason to change it.
4. Keep all room state authoritative on the server.
5. Preserve local-only file handling and browser playback.
6. Prefer accessible, mobile-friendly UI.

First feature to implement:
Add shared queue editing:
- Reorder tracks with drag-and-drop or accessible up/down buttons.
- Remove a track from the room.
- Broadcast the updated queue to everyone.
- If the current track is removed, move to a sensible next track without unexpectedly starting playback unless that was already the room's behavior.
- Avoid losing playback state during ordinary queue edits.

Then propose the next 3 features that would most improve the feeling of “being online together,” without transferring copyrighted audio.
