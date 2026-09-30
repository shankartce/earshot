const path = require('path');
const http = require('http');
const crypto = require('crypto');
const express = require('express');
const { Server } = require('socket.io');

const app = express();
const server = http.createServer(app);
const io = new Server(server);

const PORT = process.env.PORT || 3000;
const rooms = new Map();

function newRoomCode() {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code;
  do {
    code = Array.from(crypto.randomBytes(6), b => alphabet[b % alphabet.length]).join('');
  } while (rooms.has(code));
  return code;
}

function defaultRoom(code) {
  return {
    code,
    queue: [],
    currentTrackId: null,
    position: 0,
    isPlaying: false,
    changedAt: Date.now()
  };
}

function getRoom(code) {
  return rooms.get(String(code || '').toUpperCase());
}

function snapshot(room) {
  return {
    queue: room.queue,
    currentTrackId: room.currentTrackId,
    position: room.position,
    isPlaying: room.isPlaying,
    changedAt: room.changedAt,
    serverNow: Date.now()
  };
}

function broadcastState(room) {
  io.to(room.code).emit('state', snapshot(room));
}

app.use(express.static(path.join(__dirname, 'public')));

io.on('connection', socket => {
  socket.on('create-room', (_, reply) => {
    const code = newRoomCode();
    const room = defaultRoom(code);
    rooms.set(code, room);
    socket.join(code);
    socket.data.room = code;
    reply?.({ ok: true, code, state: snapshot(room) });
  });

  socket.on('join-room', (payload, reply) => {
    const code = String(payload?.code || '').trim().toUpperCase();
    const room = getRoom(code);
    if (!room) return reply?.({ ok: false, error: 'Room not found.' });
    if (socket.data.room) socket.leave(socket.data.room);
    socket.join(code);
    socket.data.room = code;
    reply?.({ ok: true, code, state: snapshot(room) });
    broadcastState(room);
  });

  socket.on('server-time', (_, reply) => {
    reply?.({ serverNow: Date.now() });
  });

  socket.on('set-queue', payload => {
    const room = getRoom(socket.data.room);
    if (!room) return;
    if (!Array.isArray(payload?.queue)) return;
    room.queue = payload.queue.map(track => ({
      id: String(track.id),
      name: String(track.name || 'Untitled'),
      artist: String(track.artist || ''),
      album: String(track.album || ''),
      duration: Number(track.duration || 0)
    }));
    if (!room.currentTrackId && room.queue[0]) {
      room.currentTrackId = room.queue[0].id;
      room.position = 0;
      room.changedAt = Date.now();
    }
    broadcastState(room);
  });

  socket.on('control', payload => {
    const room = getRoom(socket.data.room);
    if (!room) return;

    const action = payload?.action;
    const now = Date.now();
    const incomingTrack = payload?.trackId ? String(payload.trackId) : null;
    const hasTrack = incomingTrack && room.queue.some(t => t.id === incomingTrack);

    if (action === 'play') {
      if (hasTrack) room.currentTrackId = incomingTrack;
      if (!room.currentTrackId && room.queue[0]) room.currentTrackId = room.queue[0].id;
      room.position = Math.max(0, Number(payload.position || 0));
      room.isPlaying = true;
      room.changedAt = now;
    } else if (action === 'pause') {
      room.position = Math.max(0, Number(payload.position || 0));
      room.isPlaying = false;
      room.changedAt = now;
    } else if (action === 'seek') {
      room.position = Math.max(0, Number(payload.position || 0));
      room.changedAt = now;
    } else if (action === 'next' || action === 'previous') {
      if (!room.queue.length) return;
      const index = Math.max(0, room.queue.findIndex(t => t.id === room.currentTrackId));
      const delta = action === 'next' ? 1 : -1;
      const nextIndex = (index + delta + room.queue.length) % room.queue.length;
      room.currentTrackId = room.queue[nextIndex].id;
      room.position = 0;
      room.changedAt = now;
      room.isPlaying = payload.isPlaying !== false;
    }

    broadcastState(room);
  });

  socket.on('disconnect', () => {
    // Keep rooms alive so friends can reconnect. Empty rooms are cleaned up later.
  });
});

setInterval(() => {
  const activeRooms = new Set();
  for (const socket of io.sockets.sockets.values()) {
    if (socket.data.room) activeRooms.add(socket.data.room);
  }
  for (const [code] of rooms) {
    if (!activeRooms.has(code)) rooms.delete(code);
  }
}, 60_000);

server.listen(PORT, () => {
  console.log(`Free Jam running at http://localhost:${PORT}`);
});
