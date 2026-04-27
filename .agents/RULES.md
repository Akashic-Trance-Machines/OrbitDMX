---
description: Project-wide rules and conventions for the AYRA DMX Controller app
---

# AYRA DMX Controller — Agent Rules

## Project Vision

A macOS desktop application (Electron + React) to control AYRA stage lights over USB-DMX.  
Core capabilities: define rooms with multiple light rigs, set DMX addresses, create scenes, fade between them, chain them for auto-play or music sync.

## Architecture Overview

```
Electron (main process)
  └─ USB-DMX driver (node-dmx or serialport)        ← hardware layer
  └─ DMX Engine                                      ← universe state, fading, scene runner
  └─ IPC bridge (contextBridge)

Electron (renderer process)
  └─ React + Zustand                                 ← UI + state
  └─ Room / Rig / Scene editors
  └─ Music BPM sync engine (Web Audio API)
```

**Separation rule**: hardware I/O only happens in the main process. The renderer only sends intent via IPC. Never import `serialport`, `node-dmx`, or Node built-ins (`fs`, `path`) directly in renderer code.

---

## Operating Principles

### 1. Understand before writing
Before touching any file:
- Read the relevant existing code
- Understand the DMX universe state at that moment (which channels are owned by which fixture)
- Check if a utility, hook, or store slice already does what you need
- Never duplicate DMX channel logic — one source of truth: the DMX Engine

### 2. Self-anneal when things break
1. Read the error message, stack trace, or IPC rejection
2. Reproduce it (add a console log or DMX monitor trace if needed)
3. Fix and verify — never comment out broken code and move on
4. A bug is only fixed when the channel output is provably correct again

### 3. DMX is physical — be conservative
- **Never send unverified channel values** to a real universe without a safety check (0–255 range clamp)
- **Always blackout on app close** — the DMX engine must zero all channels on `app.before-quit`
- **Never skip address validation** — overlapping fixture addresses corrupt the light show; always detect and warn
- Log every universe write in debug mode so the agent (and developer) can trace what went wrong

### 4. Lint after every change
After modifying any `.js` / `.jsx` / `.ts` / `.tsx` file, run:
```
npx eslint src/ --fix
```
Fix all remaining errors before finishing. No exceptions.

### 5. Use Context7 for library docs
Pre-resolved IDs for this project:

| Library | Context7 ID | Use for |
|---------|-------------|---------|
| Electron | `/electron/electron` | Main/renderer IPC, contextBridge, app lifecycle |
| React | `/facebook/react` | Hooks, component patterns |
| Zustand | `/pmndrs/zustand` | State slices, subscriptions |
| serialport | resolve `serialport` | USB-DMX raw serial access |
| Web Audio API | n/a (MDN) | BPM detection, beat sync |

---

## Domain Model

Always use these canonical terms. Never invent synonyms.

| Term | Definition |
|------|------------|
| **Universe** | One DMX512 universe — 512 channels, sent over one USB-DMX dongle |
| **Fixture** | A single physical light unit (e.g. one AYRA Compar Jr) |
| **Rig** | A predefined fixture *type* (brand + model + channel layout). Rigs are templates. |
| **Instance** | A Rig placed in a Room with a specific start address. A Fixture = Rig × Address |
| **Channel** | A single DMX slot (1–512). A fixture occupies N consecutive channels from its start address |
| **Room** | A named collection of fixture instances sharing one DMX universe |
| **Scene** | A snapshot of DMX values for every channel in a room |
| **Cue** | A Scene plus transition metadata (fade duration, hold time, next cue) |
| **Playlist** | An ordered list of Cues — can be manual, auto-play, or BPM-synced |

---

## Predefined Rigs (built-in library)

Add new rigs only in `src/rigs/` as named JSON files. Never hardcode fixture channel maps elsewhere.

### AYRA Compar Kit Jr
- **Channels**: 3 (RGB) or 6 (R, G, B, Speed, Mode, Dimmer) — selectable at instance time
- **File**: `src/rigs/ayra-compar-jr.json`

### AYRA Compar Kit 3
- **Channels**: same as Jr but 3× repeated (strobe + program channels may differ per firmware)
- **File**: `src/rigs/ayra-compar-kit3.json`

When adding a rig:
1. Document every channel index (0-based offset from start address) with its function and value range
2. Include `minChannels` and `maxChannels` to support personality switching
3. Never guess channel functions — verify against the AYRA manual

---

## File Organization

```
src/
  main/                  ← Electron main process only
    dmx/                 ← DMX engine (universe, fading, scene runner)
    ipc/                 ← IPC handlers (bridge to renderer)
    serial/              ← USB-DMX adapter driver
  renderer/              ← React app (no Node APIs allowed here)
    components/          ← UI components
    pages/               ← Top-level views (Room, Scene, Playlist editor)
    store/               ← Zustand slices (room, scene, playlist, dmx-preview)
    hooks/               ← Custom React hooks
  rigs/                  ← Rig definition JSON files
  shared/                ← Types and constants shared between main and renderer
    constants.js         ← DMX_UNIVERSE_SIZE = 512, MAX_VALUE = 255, etc.
    rigSchema.js         ← Zod/JSON Schema for rig validation
```

---

## Code Conventions

- **Language**: JavaScript (ESM, `"type": "module"`) — migrate to TypeScript only if the team agrees
- **Variables**: `const`/`let` only, never `var`
- **Async**: `async`/`await` + `try`/`catch`; never `.then()` chains
- **Equality**: Always `===`
- **IPC**: all channel names in `shared/ipcChannels.js` — never use magic strings inline
- **DMX values**: always integers 0–255; clamp with `Math.max(0, Math.min(255, v))` before writing
- **Naming**:
  - Files: `kebab-case.js`
  - React components: `PascalCase.jsx`
  - Zustand store files: `use<Name>Store.js`
  - Constants: `SCREAMING_SNAKE_CASE`
  - Everything else: `camelCase`

---

## State Management Rules

- **Single source of truth**: the Zustand `dmxStore` owns the live DMX preview (what the UI shows). The actual hardware output lives in the main-process DMX engine. They must stay in sync via IPC.
- **No prop-drilling beyond 2 levels** — lift state to the appropriate Zustand slice
- **Scene edits are non-destructive** — always work on a draft copy until the user explicitly saves
- **Address conflicts**: the room store must detect and surface fixture overlap before allowing save

---

## IPC Design Rules

- All IPC calls go through `src/shared/ipcChannels.js` — named constants only
- Every invoke must have a corresponding handler that returns `{ success: boolean, data?, error? }`
- Renderer-to-main: use `ipcRenderer.invoke` (request/response)
- Main-to-renderer: use `webContents.send` for push events (DMX feedback, BPM tick)
- Never expose raw Node APIs via `contextBridge` — only expose specific, typed functions

---

## DMX Engine Rules

- The engine maintains a `Uint8Array(512)` per universe — the "live buffer"
- Scenes are merged into the live buffer via priority layering (later scenes win, unless masked)
- Fades use linear interpolation by default; easing functions go in `src/main/dmx/easing.js`
- The engine ticks at a configurable refresh rate (default 40 Hz / 25 ms) — never block the tick loop
- Scene runner state machine: `IDLE → PLAYING → FADING → HOLDING → NEXT`

---

## Error Handling

- All IPC handlers: wrap in `try`/`catch`, return `{ success: false, error: message }`
- DMX write errors: log to console + emit an IPC event so the UI can show a hardware warning banner
- Invalid rig JSON: reject on load with a clear validation error — never silently skip a broken rig
- Address conflicts: surface as a named error type `DMX_ADDRESS_CONFLICT` with details

---

## Hardware Safety

- **Blackout on exit**: `app.on('before-quit')` must zero all 512 channels and flush the serial port
- **Reconnect on unplug**: watch the serial port and attempt reconnection; show connection status in UI
- **Value clamping**: the DMX engine's write function must clamp all values — never trust upstream callers
- **No auto-play on startup**: always start in a safe blackout state. User must explicitly play a scene

---

## Workflow — How to Approach Changes

Never skip directly to writing code. Always follow this sequence:

### Step 1: Gather
- Identify which part of the stack is affected (rig library, room state, DMX engine, IPC, UI)
- Read the relevant files before proposing any change
- Check if the fixture type/address logic already handles the case

### Step 2: Architect
- Plan exactly which files change and which new files are needed
- Confirm no DMX address conflicts are introduced
- Consider what happens when hardware is not connected (degrade gracefully)

### Step 3: Implement
- Match existing patterns (IPC channel naming, store slice structure, engine tick format)
- Write a test or at minimum a debug log that proves the DMX output is correct
- Run `npx eslint src/ --fix` and resolve all warnings

---

## Code Health

- **One responsibility per file** — the DMX engine should not import React; the store should not import serialport
- **No magic numbers** — `512`, `255`, `40` are constants, not inline literals
- **Dead code is deleted**, not commented out
- **Rig definitions are data**, not code — keep them as JSON, not JS objects
- **Small functions** — if a function exceeds ~30 lines, consider splitting it
- **Explicit over clever** — a clear 5-line interpolation loop beats a one-liner nobody can debug at 2am during a show

---

## Change Checklist

Before considering any change complete:

- [ ] Code follows existing patterns and file organization
- [ ] `npx eslint src/ --fix` passes clean
- [ ] DMX values are clamped 0–255 before any hardware write
- [ ] Address conflict detection is not bypassed
- [ ] Blackout-on-exit is preserved
- [ ] IPC channel names use constants from `shared/ipcChannels.js`
- [ ] No Node APIs imported in renderer code
- [ ] New rig JSON validated against `shared/rigSchema.js`
- [ ] No dead code or commented-out blocks remain

---

> **⚠️ Real hardware is connected. A bug in the DMX engine does not just crash the app — it can ruin a live show. When in doubt, blackout first, then debug.**
