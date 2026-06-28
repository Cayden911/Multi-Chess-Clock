'use strict';

const http = require('http');
const path = require('path');
const express = require('express');
const cors = require('cors');
const { Server } = require('socket.io');

const PORT = Number(process.env.PORT) || 3000;
const ROOM_ID_RE = /^[a-zA-Z0-9_-]{1,64}$/;

const DEFAULT_PLAYERS = [
  { name: 'North', backgroundColor: '#1e3a5f', increment: 5, startTime: 10 },
  { name: 'East', backgroundColor: '#5f1e3a', increment: 5, startTime: 10 },
  { name: 'South', backgroundColor: '#3a5f1e', increment: 5, startTime: 10 },
  { name: 'West', backgroundColor: '#5f3a1e', increment: 5, startTime: 10 },
];

/** @type {Map<string, object>} */
const rooms = new Map();

function now() {
  return Date.now();
}

function isArray(val) {
  return Object.prototype.toString.call(val) === '[object Array]';
}

function isFiniteNumber(n) {
  return typeof n === 'number' && Number.isFinite(n);
}

function isIntegerNumber(n) {
  return isFiniteNumber(n) && Math.floor(n) === n;
}

function normalizePlayers(players) {
  if (!isArray(players) || players.length === 0) return null;
  return players.map((p) => ({
    name: String(p.name),
    backgroundColor: String(p.backgroundColor),
    increment: Number(p.increment),
    startTime: Number(p.startTime),
  }));
}

function validatePlayers(players) {
  for (let i = 0; i < players.length; i++) {
    const p = players[i];
    if (!isFiniteNumber(p.increment) || p.increment < 0) {
      return 'Player ' + (i + 1) + ': increment must be a non-negative number.';
    }
    if (!isFiniteNumber(p.startTime) || p.startTime < 0) {
      return 'Player ' + (i + 1) + ': startTime must be a non-negative number.';
    }
  }
  return null;
}

function makeZeroArray(n) {
  return Array.from({ length: n }, () => 0);
}

function clonePlayers(players) {
  return JSON.parse(JSON.stringify(players));
}

function createRoomState(roomId, players) {
  const normalized = normalizePlayers(players) || clonePlayers(DEFAULT_PLAYERS);
  const err = validatePlayers(normalized);
  if (err) throw new Error(err);

  return {
    roomId,
    playing: false,
    paused: false,
    players: normalized,
    remainingMs: normalized.map((p) => p.startTime * 1000),
    outOfTimeCounts: makeZeroArray(normalized.length),
    currentIndex: 0,
    lastTickAt: now(),
    undoStack: [],
  };
}

function sanitizeRoomId(roomId) {
  const id = String(roomId || 'default').trim() || 'default';
  if (!ROOM_ID_RE.test(id)) {
    throw new Error('Invalid room id. Use letters, numbers, underscore, or hyphen (max 64).');
  }
  return id;
}

function getRoom(roomId) {
  const id = sanitizeRoomId(roomId);
  if (!rooms.has(id)) {
    rooms.set(id, createRoomState(id, DEFAULT_PLAYERS));
  }
  return rooms.get(id);
}

function flushClock(state) {
  if (!state.playing || state.paused) return;

  const ts = now();
  const elapsed = Math.max(0, ts - state.lastTickAt);
  if (elapsed === 0) return;

  const idx = state.currentIndex;
  if (state.remainingMs[idx] > 0) {
    const before = state.remainingMs[idx];
    state.remainingMs[idx] = Math.max(0, before - elapsed);
    if (before > 0 && state.remainingMs[idx] === 0) {
      state.outOfTimeCounts[idx] = (state.outOfTimeCounts[idx] || 0) + 1;
    }
  }
  state.lastTickAt = ts;
}

function snapshotForUndo(state) {
  flushClock(state);
  return {
    remainingMs: state.remainingMs.slice(),
    outOfTimeCounts: state.outOfTimeCounts.slice(),
    currentIndex: state.currentIndex,
    lastTickAt: state.lastTickAt,
    paused: state.paused,
  };
}

function publicState(state) {
  flushClock(state);
  return {
    roomId: state.roomId,
    playing: state.playing,
    paused: state.paused,
    players: clonePlayers(state.players),
    remainingMs: state.remainingMs.slice(),
    outOfTimeCounts: state.outOfTimeCounts.slice(),
    currentIndex: state.currentIndex,
    lastTickAt: state.lastTickAt,
    canUndo: state.undoStack.length > 0,
  };
}

function broadcastState(io, roomId) {
  const state = getRoom(roomId);
  io.to(roomId).emit('state', {
    state: publicState(state),
    serverNow: now(),
  });
}

function applyStart(state, payload) {
  const players = normalizePlayers(payload && payload.players);
  if (!players) throw new Error('Start requires a non-empty players array.');
  const err = validatePlayers(players);
  if (err) throw new Error(err);

  const n = players.length;
  state.players = players;
  state.playing = true;
  state.paused = false;
  state.currentIndex = 0;
  state.undoStack = [];
  state.lastTickAt = now();

  if (payload.resume) {
    const resume = payload.resume;
    if (!isArray(resume.remainingMs) || resume.remainingMs.length !== n) {
      throw new Error('Resume requires remainingMs matching player count.');
    }
    const rem = resume.remainingMs.map(Number);
    if (rem.some((x) => !isFiniteNumber(x) || x < 0)) {
      throw new Error('remainingMs must be non-negative numbers.');
    }
    const ci = Number(resume.currentIndex);
    if (!isIntegerNumber(ci) || ci < 0 || ci >= n) {
      throw new Error('currentIndex is out of range.');
    }
    state.remainingMs = rem;
    state.currentIndex = ci;
    if (isArray(resume.outOfTimeCounts) && resume.outOfTimeCounts.length === n) {
      state.outOfTimeCounts = resume.outOfTimeCounts.map((x) => Number(x));
    } else {
      state.outOfTimeCounts = makeZeroArray(n);
    }
  } else {
    state.remainingMs = players.map((p) => p.startTime * 1000);
    state.outOfTimeCounts = makeZeroArray(n);
    state.currentIndex = 0;
  }
}

function applySetConfig(state, payload) {
  if (state.playing) {
    throw new Error('Cannot change config while a game is running. Reset first.');
  }
  const players = normalizePlayers(payload && payload.players);
  if (!players) throw new Error('Config requires a non-empty players array.');
  const err = validatePlayers(players);
  if (err) throw new Error(err);

  state.players = players;
  state.remainingMs = players.map((p) => p.startTime * 1000);
  state.outOfTimeCounts = makeZeroArray(players.length);
  state.currentIndex = 0;
  state.lastTickAt = now();
}

function applyPause(state) {
  if (!state.playing) throw new Error('Game is not running.');
  flushClock(state);
  state.paused = true;
}

function applyResume(state) {
  if (!state.playing) throw new Error('Game is not running.');
  state.paused = false;
  state.lastTickAt = now();
}

function applyTogglePause(state) {
  if (!state.playing) throw new Error('Game is not running.');
  if (state.paused) applyResume(state);
  else applyPause(state);
}

function applyReset(state) {
  const players = clonePlayers(state.players);
  state.playing = false;
  state.paused = false;
  state.players = players;
  state.remainingMs = players.map((p) => p.startTime * 1000);
  state.outOfTimeCounts = makeZeroArray(players.length);
  state.currentIndex = 0;
  state.undoStack = [];
  state.lastTickAt = now();
}

function applyEndTurn(state) {
  if (!state.playing) throw new Error('Game is not running.');
  if (state.paused) throw new Error('Clock is paused.');

  flushClock(state);
  state.undoStack.push(snapshotForUndo(state));

  const n = state.players.length;
  const p = state.players[state.currentIndex];
  state.remainingMs[state.currentIndex] += p.increment * 1000;
  state.currentIndex = (state.currentIndex + 1) % n;
  state.lastTickAt = now();
}

function applyUndo(state) {
  if (!state.playing) throw new Error('Game is not running.');
  if (state.paused) throw new Error('Clock is paused.');
  if (state.undoStack.length === 0) throw new Error('Nothing to undo.');

  flushClock(state);
  const snap = state.undoStack.pop();
  state.remainingMs = snap.remainingMs.slice();
  state.outOfTimeCounts = snap.outOfTimeCounts.slice();
  state.currentIndex = snap.currentIndex;
  state.paused = !!snap.paused;
  state.lastTickAt = snap.lastTickAt;
}

function handleAction(roomId, action, payload) {
  const state = getRoom(roomId);
  const type = String(action || '').trim();

  switch (type) {
    case 'start':
      applyStart(state, payload);
      break;
    case 'setConfig':
      applySetConfig(state, payload);
      break;
    case 'pause':
      applyPause(state);
      break;
    case 'resume':
      applyResume(state);
      break;
    case 'togglePause':
      applyTogglePause(state);
      break;
    case 'reset':
      applyReset(state);
      break;
    case 'endTurn':
    case 'nextPlayer':
      applyEndTurn(state);
      break;
    case 'undo':
      applyUndo(state);
      break;
    default:
      throw new Error('Unknown action: ' + type);
  }

  return publicState(state);
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: '256kb' }));
app.use(express.static(path.join(__dirname)));

app.get('/health', (req, res) => {
  res.json({ ok: true, rooms: rooms.size, now: now() });
});

app.get('/api/rooms/:roomId/state', (req, res) => {
  try {
    const roomId = sanitizeRoomId(req.params.roomId);
    const state = publicState(getRoom(roomId));
    res.json({ state, serverNow: now() });
  } catch (err) {
    res.status(400).json({ error: err.message });
  }
});

const httpServer = http.createServer(app);
const io = new Server(httpServer, {
  cors: { origin: true, methods: ['GET', 'POST'] },
  transports: ['polling', 'websocket'],
});

io.on('connection', (socket) => {
  let joinedRoom = null;

  socket.on('join', (msg, ack) => {
    try {
      const roomId = sanitizeRoomId(msg && msg.roomId);
      if (joinedRoom) socket.leave(joinedRoom);
      joinedRoom = roomId;
      socket.join(roomId);

      const payload = {
        state: publicState(getRoom(roomId)),
        serverNow: now(),
      };

      if (typeof ack === 'function') ack({ ok: true, ...payload });
      socket.emit('state', payload);
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  socket.on('action', (msg, ack) => {
    try {
      const roomId = sanitizeRoomId(msg && msg.roomId);
      const next = handleAction(roomId, msg.action, msg.payload || {});
      const payload = { state: next, serverNow: now() };
      io.to(roomId).emit('state', payload);
      if (typeof ack === 'function') ack({ ok: true, ...payload });
    } catch (err) {
      if (typeof ack === 'function') ack({ ok: false, error: err.message });
    }
  });

  socket.on('disconnect', () => {
    joinedRoom = null;
  });
});

httpServer.listen(PORT, () => {
  console.log('Multi-Chess-Clock server on port ' + PORT);
  console.log('Open http://localhost:' + PORT + '/?room=default');
});
