# Multi Chess Clock

A browser-based chess clock for **two or more** players. One HTML file—no build step or dependencies. Works in normal browsers and in the **Tabletop Simulator** tablet browser.

## Run it

Open `index.html` in a browser, host it on GitHub Pages, or point a TTS tablet at the same URL.

## Configure players

Edit the JSON in the **Config** field before starting. Each player needs:

| Field | Description |
| --- | --- |
| `name` | Display name |
| `backgroundColor` | CSS color for that player’s panel |
| `increment` | Seconds added after each turn |
| `startTime` | Starting time in **seconds** |

See `players.json` for the same structure as a standalone example.

## During a game

- **Click or Space** — end the active player’s turn (applies increment, moves to next player)
- **Esc** — undo the last turn
- **Pause button** (top right) — pause or resume

When someone runs out of time, a siren plays and an “Out of time” count is shown. The clock keeps going so you can play casual or house rules.

## Save and resume

After each turn, the current state is copied to the clipboard as JSON. To resume later, paste that into **Previous save state** and use a **Config** that matches the saved `config` (same players, order, and settings). Then click **Go**.
