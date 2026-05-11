# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.2.4] - 2026-05-11

### Fixed
- **Zero-Copy Frame Transfer**: Replaced per-frame `postMessage` (40×/sec structured-clone of 512-value arrays) with `SharedArrayBuffer`. The main thread writes directly to shared memory; the worker reads it — zero serialization, zero allocation, zero GC pressure. Eliminates periodic V8 garbage collection pauses that caused remaining intermittent flashes.
- **Pre-allocated Frame Buffer**: The worker's DMX frame buffer is now allocated once at startup and reused every tick, further eliminating per-frame memory allocation.

## [1.2.3] - 2026-05-11

### Fixed
- **DMX Timing Precision**: Replaced all `setTimeout` timing in the DMX worker with `Atomics.wait()` — a true kernel-level thread sleep that bypasses the event loop timer queue entirely. `setTimeout(1)` can fire 1–15ms late on macOS; `Atomics.wait(1)` blocks for exactly 1ms. This eliminates the remaining source of intermittent DMX signal gaps.

## [1.2.2] - 2026-05-11

### Changed
- **DMX Output Worker Thread**: Moved the 40 Hz DMX tick loop and serial I/O to a dedicated Node.js Worker Thread, completely isolating it from the Electron main process event loop. The worker continuously re-sends the latest frame — even if the main thread stalls, DMX output never drops.

### Fixed
- **MacBook Air Flicker**: The worker thread's uncontested event loop eliminates the intermittent all-lights-to-black flashing caused by main-thread congestion on slower machines.

## [1.2.1] - 2026-05-11

### Fixed
- **DMX Flicker on MacBook Air**: Added Electron `powerSaveBlocker` (`prevent-display-sleep`) to prevent macOS App Nap from throttling DMX tick timers — fixes intermittent all-lights-to-black flashing on battery-powered Macs.
- **DMX Frame Timing**: Replaced `Date.now()` with `process.hrtime.bigint()` for sub-millisecond tick loop precision.
- **sendFrame Latency**: Collapsed 4 separate async event-loop round-trips per DMX frame into a single nested-callback Promise, reducing per-frame overhead by 2–10 ms on slower machines.

### Added
- **Idle Sleep Prevention**: The system will not enter idle sleep while a DMX adapter is connected, ensuring unattended playlist playback continues indefinitely.
- **Auto-Reconnect on Wake**: After a system sleep/wake cycle (lid close → reopen), the serial port is automatically reconnected with up to 5 retries, resuming DMX output without user interaction.
- **Late Frame Watchdog**: Console warnings are logged when 20 consecutive frames exceed the tick budget by >10 ms, aiding performance diagnostics.

## [1.2.0] - 2026-04-29

### Added
- **Type-Driven Controls Page**: New Controls page with 18 control types across 4 categories (Channels, Global & Effects, FX Triggers, Actions). The control type automatically determines the widget (slider, button, or color wheel).
- **DMX Post-Processing Pipeline**: New signal chain in the DMX engine: `Base → Color Shift → LED Dimmer → FX → Room Dimmer → Output`.
- **Color Shift**: Rotates the hue of current RGB values through the spectrum for targeted LEDs, applied as a post-processing effect.
- **LED Dimmer**: Proportional scaling of R, G, B, W, Amber, and UV channels for targeted LEDs.
- **MIDI Learn & Auto-Link**: Controls support MIDI CC mapping with an auto-link mode that captures the first incoming CC message.
- **Playlist Control Buttons**: Playlists can be triggered via dedicated control buttons (and MIDI).
- **FX Control Buttons**: FX effects (strobe, breath, fire, candle, twinkle) can be triggered from the Controls page with per-button targeting.
- **Fixture Target Selector**: Include/Exclude mode with per-LED sub-filtering for fine-grained control over which LEDs are affected.
- **Expanded Rig Library**: Added 15+ new fixture profiles including Ayra Armageddon, Compar variants, DanceFX, ERO moving heads, and LED tri-bar.

### Changed
- **Room Dimmer**: Changed from dimmer-channel-only to a true master fader that scales all 512 DMX channels.
- **FX Targeting**: Removed the target selector from the FX page — targeting is now handled per-control on the Controls page.
- **Playlist Playback**: Collapsing the playlist sidebar no longer stops playback. Play controls are now visible on collapsed playlist cards.
- **FX Mutual Exclusion**: Only one FX can run at a time — activating a new FX automatically deactivates the previous one and updates all button states.

### Fixed
- **Room Dimmer Persistence**: The room dimmer slider no longer resets to 100% when navigating away from the Room page.
- **Target Mode Reset**: Switching the target selector to "All" now properly clears stale include/exclude selections.
- **Control Cleanup**: Changing a control's type or deleting it now clears its engine-side effects (room dimmer, LED dimmer, color shift, FX).
- **Strobe LED Bleed**: Strobe FX no longer affects the shared dimmer channel, preventing untargeted LEDs from partially flashing.
- **Playlist/FX State Sync**: Control button states now stay synchronized when playback is started/stopped from the Playlists or FX pages.

## [1.1.0] - 2026-04-29

### Added
- **Room Persistence**: Added the ability to save and load `.orbitdmx` room files via native File dialogs.
- **Autosave Engine**: Rooms are now automatically saved in the background with a 500ms debounce.
- **Undo/Redo Stack**: Added a 50-step history stack for room layouts, accessible via the Edit menu (`Cmd+Z` / `Cmd+Shift+Z`).
- **Physical Room View**: Added a new 2D interactive floor plan view where fixtures can be dragged and placed within user-defined room boundaries (in meters).
- **Floor Plan Rotation**: Fixtures on the floor plan can be rotated in 45° increments via right-click, represented by an orientation arrow.
- **Visual LED Feedback**: Floor plan fixtures dynamically render their current LED colours. Multi-LED fixtures (e.g. 4-LED RGBW pars) correctly display all LED states in a row layout.

### Changed
- **Fixture Control Panel Header**: Restructured the sidebar control panel to cleanly display the fixture title and setup icon alongside one another, with blackout and full-on actions positioned separately for clearer UX.
- **DMX Mode Setup**: Moved the fixture mode dropdown and start address configurations out of the active control panel into a dedicated "Edit Setup" modal to prevent accidental changes during live operation.

### Fixed
- **Address Overlap Detection**: Changing a fixture's DMX mode or start address now actively checks for channel overlaps and displays a visual warning if conflicts occur.
- **Universe Strip Visualization**: The universe strip at the bottom of the list view now renders overlapping fixture addresses in red, and visually indicates unused address gaps with a striped pattern.
