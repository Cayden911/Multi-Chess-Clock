# Multi Chess Clock

A browser-based chess clock for **two or more** players, with a **shared server-authoritative** backend so everyone in the same room sees the same clock. One HTML frontend (TTS-compatible) plus a small Node.js server. Works in normal browsers and in the **Tabletop Simulator** tablet browser.

## Architecture

- **Frontend** (`index.html`) — vanilla HTML/CSS/JS, no build step. Renders clock state from the server and sends actions (start, pause, reset, end turn, undo, config).
- **Backend** (`server.js`) — Node.js + Express + Socket.IO. Holds authoritative game state per room and broadcasts updates to all connected clients. Socket.IO uses WebSockets with **polling fallback** for older embedded browsers.

## Run locally

Open a terminal **in the project folder** first:

```bash
cd C:\Users\cayde\Desktop\Multi-Chess-Clock
npm install
node server.js
```

On Windows PowerShell or Command Prompt, run those three lines in order. If you run `npm install` or `node server.js` from `C:\Users\cayde` (your home folder), you will get `ENOENT` because `package.json` and `server.js` live inside `Multi-Chess-Clock`.

Then open:

```
http://localhost:3000/?room=default
```

The server serves the frontend and the API on the same port. Open that URL in two browser tabs (or two machines on your LAN using your PC’s IP) to verify they stay in sync.

### Room URLs

Use any of these to pick a shared room:

| URL pattern | Example |
| --- | --- |
| Query param | `?room=abc123` |
| Path (when served by Express) | `/game/abc123` |
| Hash (static hosting) | `#room=abc123` |

Everyone using the **same room ID** on the **same backend** shares one clock.

### Backend URL (GitHub Pages / TTS)

When the frontend is hosted separately (e.g. GitHub Pages), point it at your backend with the `server` query param:

```
https://YOUR_USER.github.io/Multi-Chess-Clock/?room=default&server=https://YOUR-BACKEND.example.com
```

Set the **Backend server URL** field on the setup screen if you need to change it without editing the URL.

## Configure players

Edit the JSON in the **Config** field. Each player needs:

| Field | Description |
| --- | --- |
| `name` | Display name |
| `backgroundColor` | CSS color for that player’s panel |
| `increment` | Seconds added after each turn |
| `startTime` | Starting time in **seconds** |

- **Apply config to room** — pushes config to the server (setup only, before or after reset).
- **Start game** — starts (or resumes) the shared clock for everyone in the room.

See `players.json` for the same structure as a standalone example.

## During a game

- **Click or Space** — end the active player’s turn (applies increment, moves to next player)
- **Esc** — undo the last turn
- **Pause** (top right) — pause or resume for everyone
- **Reset** — return the room to setup for everyone

Connection status is shown in the top bar:

- **Connected to shared server** — live sync active
- **Reconnecting** — temporary disconnect, Socket.IO retrying
- **Offline / local only** — cannot reach the backend

When someone runs out of time, a siren plays locally and an “Out of time” count is shown. The clock keeps going so you can play casual or house rules.

## Deploy backend (public Node host)

Host `server.js` on any Node-capable platform (Render, Railway, Fly.io, a VPS, etc.).

1. Push this repo (or copy `server.js`, `package.json`, and `index.html`).
2. Set start command: `npm start`
3. Set `PORT` if the platform requires it (most set it automatically).
4. Note the public HTTPS URL, e.g. `https://multi-chess-clock.onrender.com`

Health check: `GET /health`  
Room state: `GET /api/rooms/:roomId/state`

CORS is enabled so a GitHub Pages frontend can connect cross-origin.

## Deploy frontend (GitHub Pages)

1. Enable GitHub Pages on the repo (root or `/docs`).
2. Share links that include **both** `room` and `server`:

```
https://YOUR_USER.github.io/Multi-Chess-Clock/?room=default&server=https://multi-chess-clock.onrender.com
```

3. In Tabletop Simulator, paste that full URL into the tablet.

All players must use the **same `room` and `server` values** to share one clock.

## API / socket protocol

**REST**

- `GET /health` — server status
- `GET /api/rooms/:roomId/state` — current authoritative state + `serverNow`

**Socket.IO**

- Client → `join` `{ roomId }` — join room, receive state
- Client → `action` `{ roomId, action, payload }` — mutate state
- Server → `state` `{ state, serverNow }` — broadcast to room

**Actions:** `start`, `setConfig`, `pause`, `resume`, `togglePause`, `reset`, `endTurn` / `nextPlayer`, `undo`

**Authoritative state fields:** `roomId`, `playing`, `paused`, `players`, `remainingMs`, `outOfTimeCounts`, `currentIndex`, `lastTickAt`, `canUndo`

The server advances the active player’s clock using `lastTickAt` and flushes elapsed time on every action and broadcast.
