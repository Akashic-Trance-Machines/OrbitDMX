# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [1.4.0] - 2026-06-06

### Added
- **Twinkle Colour Picker**: Twinkle FX now has a full colour picker (custom HtsColorPicker circle) — sparkles flash toward the chosen colour instead of always white.
- **Status Bar Navigation**: Clicking any active playlist or FX pill in the status bar navigates directly to the relevant page. Playlist pills also open the correct right-hand settings panel automatically.
- **Custom Colour Picker for All FX**: Replaced native `<input type="color">` in the FX panel with the custom hue-ring + triangle `HtsColorPicker` for both Strobe Color and Twinkle.

### Changed
- **Strobe / Strobe Color Intensity Blending**: Both strobe processors now implement a full symmetric blend. ON phase lerps scene → white/color at `intensity`; OFF phase lerps scene → black at `intensity`. At 0% intensity neither phase changes the scene; at 100% the output is pure white/color or pure black regardless of scene content. Previously the strobe ON phase left the scene unchanged and strobeColor OFF phase left the scene unchanged.
- **Twinkle Defaults**: Changed to intensity 100%, fade ≈250 ms, randomness 15%, amount 10% — better out-of-the-box sparkle behaviour.
- **Playlist / HSB Fade Loops**: Replaced `requestAnimationFrame` with `setTimeout(16 ms)` in both `useHsbPlaylistRunner` and `usePalettePlaylistRunner`. RAF is a visual rendering hint that the OS may pause when the window loses focus; `setTimeout` with `backgroundThrottling: false` is guaranteed to keep firing, ensuring playlists continue running while the app is in the background.
- **Electron Background Throttling**: Added `backgroundThrottling: false` to the main `BrowserWindow` `webPreferences` and Chromium command-line flags (`disable-renderer-backgrounding`, `disable-background-timer-throttling`) so renderer timers are not throttled when the app loses focus.

### Fixed
- **HSB & Palette Settings Not Saved**: `buildSnapshot()` and `snapshotKey()` only included classic scene playlists; changes to HSB or palette generators produced an identical snapshot key and hit the early-exit guard, silently skipping the autosave. Both stores are now included in the snapshot, and `restoreSnapshot()` / undo-redo also cover them.
- **Undo/Redo Missing HSB & Palette**: `RoomSnapshot` type extended with optional `palettePlayists` and `hsbPlaylists` fields; undo/redo now correctly restores generator state.
- **Twinkle Always White**: `buildConfig` was not passing `color` for the `twinkle` type, so the processor always fell back to `[255, 255, 255]`. Fixed — colour is now forwarded and used as the sparkle target.

## [1.3.0] - 2026-06-04

### Added
- **Hue Rotator FX**: New effect that continuously rotates the hue of each targeted spot's colour. Speed is BPM-syncable. Icon is a custom SVG rainbow circular arrow.
- **Multi-FX Architecture**: All FX effects can now run simultaneously. Active effects are visually indicated per card with a live dot. Processing order: breath → fire → candle → twinkle → strobe → strobeColor → hueRotator.
- **Per-FX Fixture Targeting**: Each FX type has its own independent fixture target (All / Include / Exclude) with per-LED spot sub-selection.
- **Palette & HSB Generator Playlists**: New generator types added to the Playlists page, each with independent playback controls.
- **Status Bar Playlist Indicators**: Running scene playlists, palette generators, and HSB generators are each shown as live pills in the bottom status bar.
- **Room Picker**: Clicking the room name in the sidebar opens a modal to switch between rooms or create a new one.

### Changed
- **FX Target Picker**: Replaced the flat chip list with the shared `FixtureTargetSelector` component — fixtures are grouped with expandable per-spot LED checkboxes and Select All / None shortcuts (same as Controls and Playlists).
- **MIDI Device Selector**: Redesigned to match the DMX Adapter section — status badge, labelled dropdown, and full-width Connect/Disconnect button.
- **DMX Status Bar**: Now shows "DMX connected" only, without the raw port path.
- **Controls Nav Icon**: Replaced `🎛` emoji (misaligned) with `⊞` geometric symbol to match all other nav icons.
- **Playlist Mutual Exclusion**: Starting any playlist type (scene, palette, HSB) now stops all other running playlist types. The room-switch flow also flushes a save and stops playback before loading the new room.

### Fixed
- **Palette / HSB Not Saved on Room Switch**: `useColourStore` was missing from the autosave subscription list, so palette edits never triggered a debounced save. Fixed.
- **Breath FX No Effect**: Fixed `processBreath` to correctly target per-type LED addresses instead of the deprecated global dimmer set.
- **Playlists Not Restored on Load**: Boot-time room loader was missing `setPaletteGenerators` and `setHsbGenerators` calls. Fixed.
- **FX Fixture Names Showing UUID**: Include/Exclude picker was reading `f.name` (undefined) instead of `f.label`, falling through to the raw UUID.

## [1.2.5] - 2026-05-11

### Changed
- **Baud-Rate BREAK Generation**: Replaced `ioctl(TIOCSBRK/TIOCCBRK)` with baud-rate switching for DMX BREAK signal. A `0x00` byte at 76800 baud produces a valid ~117μs BREAK through the normal serial data path, avoiding unreliable ioctl calls that caused intermittent signal drops on MacBook Air USB-C controllers.

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
