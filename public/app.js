const socket = io();
const $ = id => document.getElementById(id);

const state = {
  roomCode: null,
  queue: [],
  currentTrackId: null,
  position: 0,
  isPlaying: false,
  changedAt: 0,
  serverOffset: 0,
  files: new Map(),
  urls: new Map(),
  durationCache: new Map(),
  currentLoadedId: null,
  lastLocalCommandAt: 0
};

const audio = $('audio');
audio.volume = 0.8;

function fmt(sec) {
  if (!Number.isFinite(sec)) return '0:00';
  sec = Math.max(0, Math.floor(sec));
  const m = Math.floor(sec / 60);
  const s = String(sec % 60).padStart(2, '0');
  return `${m}:${s}`;
}

function nowServer() { return Date.now() + state.serverOffset; }

function effectivePosition() {
  if (!state.currentTrackId) return 0;
  if (!state.isPlaying) return state.position;
  return state.position + Math.max(0, (nowServer() - state.changedAt) / 1000);
}

function setStatus(text) { $('status').textContent = text; }

function renderRoom() {
  const hasRoom = Boolean(state.roomCode);
  $('roomInfo').classList.toggle('hidden', !hasRoom);
  if (hasRoom) $('roomCode').textContent = state.roomCode;
}

function renderLibrary() {
  const list = $('libraryList');
  if (!state.files.size) {
    list.className = 'list empty';
    list.textContent = 'No local songs loaded yet.';
    $('addAllBtn').disabled = true;
    return;
  }
  list.className = 'list';
  list.innerHTML = '';
  for (const track of state.files.values()) {
    const row = document.createElement('div');
    row.className = 'track';
    row.innerHTML = `<div>♪</div><div class="grow"><div class="name"></div><div class="meta"></div></div>`;
    row.querySelector('.name').textContent = track.name;
    row.querySelector('.meta').textContent = `${fmt(track.duration)}${track.artist ? ` · ${track.artist}` : ''}`;
    list.appendChild(row);
  }
  $('addAllBtn').disabled = !state.roomCode;
}

function localTrack(id) { return state.files.get(id); }

function renderQueue() {
  const list = $('queueList');
  if (!state.roomCode) {
    list.className = 'list empty';
    list.textContent = 'Create or join a room.';
    return;
  }
  if (!state.queue.length) {
    list.className = 'list empty';
    list.textContent = 'Queue is empty. Add songs from your local library.';
    return;
  }
  list.className = 'list';
  list.innerHTML = '';
  state.queue.forEach(track => {
    const row = document.createElement('div');
    row.className = 'track';
    const local = localTrack(track.id);
    const playing = track.id === state.currentTrackId;
    row.innerHTML = `<div>${playing ? '▶' : '♪'}</div><div class="grow"><div class="name"></div><div class="meta"></div></div><button class="ghost playTrack" ${local ? '' : 'disabled'}>${playing ? 'Play' : 'Listen'}</button>`;
    row.querySelector('.name').textContent = track.name;
    row.querySelector('.meta').textContent = `${fmt(track.duration)}${!local ? ' · not on this device' : ''}`;
    row.querySelector('.playTrack').onclick = () => sendControl('play', { trackId: track.id, position: 0 });
    list.appendChild(row);
  });
}

function updatePlayerUI() {
  const track = state.queue.find(t => t.id === state.currentTrackId);
  $('nowTitle').textContent = track?.name || 'Nothing playing';
  $('nowMeta').textContent = track ? `${track.artist || 'Local audio'}${track.album ? ` · ${track.album}` : ''}` : 'Load your library, then add tracks to the room.';
  $('playBtn').textContent = state.isPlaying ? 'Ⅱ' : '▶';
  $('playBtn').disabled = !track || !localTrack(track.id);
  $('seek').disabled = !track || !localTrack(track.id);
  const d = Number(track?.duration || 0);
  $('seek').max = d || 100;
  const p = Math.min(d || Infinity, Math.max(0, effectivePosition()));
  $('seek').value = Number.isFinite(p) ? p : 0;
  $('currentTime').textContent = fmt(p);
  $('duration').textContent = fmt(d);
}

async function syncServerClock() {
  const sent = Date.now();
  socket.emit('server-time', {}, reply => {
    const received = Date.now();
    const midpoint = sent + (received - sent) / 2;
    state.serverOffset = reply.serverNow - midpoint;
  });
}

async function ensureAudio(trackId) {
  const file = localTrack(trackId);
  if (!file) return false;
  if (state.currentLoadedId !== trackId) {
    if (audio.src) URL.revokeObjectURL(audio.src);
    const url = URL.createObjectURL(file.file);
    state.urls.set(trackId, url);
    audio.src = url;
    state.currentLoadedId = trackId;
    await new Promise(resolve => {
      if (audio.readyState >= 1) return resolve();
      audio.addEventListener('loadedmetadata', resolve, { once: true });
    });
  }
  return true;
}

async function applyState() {
  const track = state.queue.find(t => t.id === state.currentTrackId);
  updatePlayerUI();
  if (!track) {
    audio.pause();
    return;
  }
  if (!localTrack(track.id)) {
    audio.pause();
    return;
  }
  const ok = await ensureAudio(track.id);
  if (!ok) return;
  const target = Math.max(0, effectivePosition());
  if (Math.abs(audio.currentTime - target) > 0.45) {
    try { audio.currentTime = Math.min(target, audio.duration || target); } catch {}
  }
  if (state.isPlaying) {
    await audio.play().catch(() => {
      setStatus('Click Play once to allow browser audio.');
    });
  } else {
    audio.pause();
  }
}

function sendControl(action, extra = {}) {
  if (!state.roomCode) return;
  socket.emit('control', {
    action,
    position: Number(audio.currentTime || effectivePosition() || 0),
    isPlaying: state.isPlaying,
    ...extra
  });
  state.lastLocalCommandAt = Date.now();
}

async function hashFile(file) {
  const buffer = await file.arrayBuffer();
  const digest = await crypto.subtle.digest('SHA-256', buffer);
  return [...new Uint8Array(digest)].map(b => b.toString(16).padStart(2, '0')).join('');
}

async function loadFiles(fileList) {
  setStatus('Indexing songs…');
  for (const file of fileList) {
    if (!file.type.startsWith('audio/')) continue;
    const id = await hashFile(file);
    const duration = await readDuration(file);
    state.files.set(id, { id, file, name: file.name.replace(/\.[^/.]+$/, ''), duration, artist: '', album: '' });
  }
  renderLibrary();
  renderQueue();
  updatePlayerUI();
  setStatus(state.roomCode ? `Ready · ${state.files.size} songs` : 'Ready');
}

function readDuration(file) {
  return new Promise(resolve => {
    const probe = new Audio();
    const url = URL.createObjectURL(file);
    probe.preload = 'metadata';
    probe.onloadedmetadata = () => {
      const d = Number.isFinite(probe.duration) ? probe.duration : 0;
      URL.revokeObjectURL(url);
      resolve(d);
    };
    probe.onerror = () => { URL.revokeObjectURL(url); resolve(0); };
    probe.src = url;
  });
}

socket.on('connect', async () => {
  setStatus('Connected');
  await syncServerClock();
  if (state.roomCode) socket.emit('join-room', { code: state.roomCode });
});
socket.on('disconnect', () => setStatus('Disconnected')); 
socket.on('state', incoming => {
  Object.assign(state, incoming);
  renderRoom();
  renderLibrary();
  renderQueue();
  applyState();
});

$('createBtn').onclick = () => socket.emit('create-room', {}, reply => {
  if (!reply.ok) return;
  state.roomCode = reply.code;
  Object.assign(state, reply.state);
  renderRoom(); renderLibrary(); renderQueue(); updatePlayerUI();
  setStatus('Room ready');
  history.replaceState(null, '', `#${state.roomCode}`);
});

$('joinForm').onsubmit = e => {
  e.preventDefault();
  const code = $('roomInput').value.trim().toUpperCase();
  socket.emit('join-room', { code }, reply => {
    if (!reply?.ok) return setStatus(reply?.error || 'Could not join.');
    state.roomCode = reply.code;
    Object.assign(state, reply.state);
    renderRoom(); renderLibrary(); renderQueue(); updatePlayerUI(); applyState();
    setStatus('Joined room');
    history.replaceState(null, '', `#${state.roomCode}`);
  });
};

$('copyBtn').onclick = async () => {
  await navigator.clipboard.writeText(state.roomCode);
  setStatus('Room code copied');
};

$('fileInput').onchange = e => loadFiles([...e.target.files]);
$('addAllBtn').onclick = () => {
  const queue = [...state.files.values()].map(t => ({ id: t.id, name: t.name, artist: t.artist, album: t.album, duration: t.duration }));
  socket.emit('set-queue', { queue });
};
$('playBtn').onclick = () => sendControl(state.isPlaying ? 'pause' : 'play');
$('nextBtn').onclick = () => sendControl('next');
$('prevBtn').onclick = () => sendControl('previous');
$('seek').onchange = () => sendControl('seek', { position: Number($('seek').value) });
$('volume').oninput = e => { audio.volume = Number(e.target.value); };

audio.addEventListener('timeupdate', updatePlayerUI);
audio.addEventListener('ended', () => sendControl('next'));

setInterval(() => {
  if (socket.connected) syncServerClock();
  const target = effectivePosition();
  if (state.isPlaying && Number.isFinite(audio.duration) && Math.abs(audio.currentTime - target) > 0.45) {
    try { audio.currentTime = Math.min(target, audio.duration); } catch {}
  }
  updatePlayerUI();
}, 2000);

const initialCode = location.hash.slice(1).toUpperCase();
if (initialCode) {
  $('roomInput').value = initialCode;
  setStatus('Ready to join');
}
renderRoom(); renderLibrary(); renderQueue(); updatePlayerUI();
