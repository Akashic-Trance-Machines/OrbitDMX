import { useEffect, useRef } from 'react';
import { useMidiStore } from '../store/useMidiStore';
import { useOrbitBridgeDeckStore } from '../store/useOrbitBridgeDeckStore';
import { useControlsStore, getWidgetKind, getChannelTypeForControl, getFxTypeForControl, isMomentary } from '../store/useControlsStore';
import { useRoomStore } from '../store/useRoomStore';
import { useFxStore } from '../store/useFxStore';
import { usePlaylistStore } from '../store/usePlaylistStore';
import { useTempoStore } from '../store/useTempoStore';
import type { ControlWidget, FxType } from '../../shared/types';

// ── OrbitBridgeDeck MIDI output for SysEx sending ────────────────────────────
// Module-level ref — not stored in Zustand to avoid serialization issues.
let _orbitOutput: WebMidi.MIDIOutput | null = null;

const ORBIT_DEVICE_NAME = 'OrbitBridgeDeck';

// OrbitBridgeDeck SysEx header: F0 7D 00 00
const SYSEX_HEADER = [0xF0, 0x7D, 0x00, 0x00];

/**
 * Send a SysEx command to the connected OrbitBridgeDeck.
 * @returns true if the output port was available and the message was sent.
 */
export function sendOrbitBridgeDeckSysEx(cmd: number, payload: number[]): boolean {
  if (!_orbitOutput) return false;
  try {
    _orbitOutput.send([...SYSEX_HEADER, cmd, ...payload, 0xF7]);
    return true;
  } catch {
    return false;
  }
}

/**
 * useMidiListener — app-level hook for Web MIDI API.
 *
 * Mounted once in App.tsx so MIDI works regardless of which page is active.
 *
 * Device selection model:
 *  - All available inputs are discovered and listed in the store.
 *  - Only the device whose id === connectedDeviceId receives midimessage events.
 *  - Auto-reconnect: when the connected device reappears, listener re-attaches.
 *  - connectedDeviceId is persisted in localStorage by the store.
 *
 * OrbitBridgeDeck detection:
 *  - When the connected device name contains 'OrbitBridgeDeck', the output port
 *    is found and stored in _orbitOutput for SysEx sending.
 *  - isOrbitBridgeDeckConnected is set in useMidiStore.
 */
export function useMidiListener() {
  const midiAccessRef = useRef<WebMidi.MIDIAccess | null>(null);
  // Single active handler — only one device at a time.
  const activeHandlerRef = useRef<{ inputId: string; fn: (e: WebMidi.MIDIMessageEvent) => void } | null>(null);

  // Detach any existing listener and re-attach to the currently connectedDeviceId.
  // Also locates the OrbitBridgeDeck output port if the connected device matches.
  function rewireListener(access: WebMidi.MIDIAccess) {
    // Detach old listener
    if (activeHandlerRef.current) {
      const { inputId, fn } = activeHandlerRef.current;
      const old = access.inputs.get(inputId);
      if (old) old.removeEventListener('midimessage', fn as EventListener);
      activeHandlerRef.current = null;
    }

    // Reset OrbitBridgeDeck output
    _orbitOutput = null;
    useMidiStore.getState().setIsOrbitBridgeDeckConnected(false);

    const connectedId = useMidiStore.getState().connectedDeviceId;
    if (!connectedId) return;

    const input = access.inputs.get(connectedId);
    if (!input) {
      console.log(`[MIDI] Selected device ${connectedId} not found — waiting for reconnect`);
      return;
    }

    const handler = (e: WebMidi.MIDIMessageEvent) => handleMidiMessage(e, input.name || input.id);
    input.addEventListener('midimessage', handler as EventListener);
    activeHandlerRef.current = { inputId: connectedId, fn: handler };
    console.log(`[MIDI] Active device: ${input.name || input.id}`);

    // Detect OrbitBridgeDeck: find matching output port
    if (input.name?.includes(ORBIT_DEVICE_NAME)) {
      access.outputs.forEach((output) => {
        if (output.name?.includes(ORBIT_DEVICE_NAME)) {
          _orbitOutput = output;
          console.log(`[MIDI] OrbitBridgeDeck output: ${output.name}`);
        }
      });
      useMidiStore.getState().setIsOrbitBridgeDeckConnected(true);
    }
  }

  useEffect(() => {
    let cancelled = false;
    let unsubDevice: (() => void) | null = null;

    async function init() {
      if (!navigator.requestMIDIAccess) {
        console.log('[MIDI] Web MIDI API not supported');
        return;
      }

      try {
        const access = await navigator.requestMIDIAccess({ sysex: true });
        if (cancelled) return;

        midiAccessRef.current = access;
        useMidiStore.getState().setIsListening(true);

        // Populate device list
        const devices: Array<{ id: string; name: string }> = [];
        access.inputs.forEach((input) => {
          devices.push({ id: input.id, name: input.name || input.id });
        });
        useMidiStore.getState().setDevices(devices);

        // Wire up to whichever device is already selected (e.g. restored from localStorage)
        rewireListener(access);

        // ── onstatechange: device plugged / unplugged ──────────────────────
        access.onstatechange = () => {
          const updatedDevices: Array<{ id: string; name: string }> = [];
          access.inputs.forEach((input) => {
            updatedDevices.push({ id: input.id, name: input.name || input.id });
          });
          useMidiStore.getState().setDevices(updatedDevices);
          // Auto-reconnect: re-attach if the selected device just reappeared.
          rewireListener(access);
        };

        // ── Subscribe to Connect / Disconnect actions from the UI ──────────
        unsubDevice = useMidiStore.subscribe((state, prev) => {
          if (state.connectedDeviceId === prev.connectedDeviceId) return;
          rewireListener(access);
        });

        console.log(`[MIDI] ${devices.length} input(s) available:`, devices.map((d) => d.name).join(', '));
      } catch (err) {
        console.error('[MIDI] Failed to access MIDI devices:', err);
      }
    }

    init();

    return () => {
      cancelled = true;
      unsubDevice?.();
      const access = midiAccessRef.current;
      if (access && activeHandlerRef.current) {
        const { inputId, fn } = activeHandlerRef.current;
        const input = access.inputs.get(inputId);
        if (input) input.removeEventListener('midimessage', fn as EventListener);
        activeHandlerRef.current = null;
      }
      useMidiStore.getState().setIsListening(false);
    };
  }, []);

  // ── Sync playlist/FX state → control button values ─────────────────────
  // When playback is started/stopped from the Playlists or FX page,
  // update matching control widget values so buttons stay in sync.
  useEffect(() => {
    const unsubPlaylist = usePlaylistStore.subscribe((state, prev) => {
      if (state.playbackState === prev.playbackState && state.activePlaylistId === prev.activePlaylistId) return;

      const widgets = useControlsStore.getState().widgets;
      for (const w of widgets) {
        if (w.controlType !== 'playlist') continue;

        const shouldBeOn = state.playbackState === 'playing' && state.activePlaylistId === w.playlistId;
        const newValue = shouldBeOn ? 255 : 0;
        if (w.value !== newValue) {
          useControlsStore.getState().updateControl(w.id, { value: newValue });
        }
      }
    });

    const unsubFx = useFxStore.subscribe((state, prev) => {
      if (state.fxStates === prev.fxStates) return;

      const widgets = useControlsStore.getState().widgets;
      for (const w of widgets) {
        const fxType = getFxTypeForControl(w.controlType);
        if (!fxType) continue;

        const isNowActive = state.fxStates[fxType as import('../../shared/types').FxType]?.isActive ?? false;
        const newValue = isNowActive ? 255 : 0;
        if (w.value !== newValue) {
          useControlsStore.getState().updateControl(w.id, { value: newValue });
        }
      }
    });

    return () => {
      unsubPlaylist();
      unsubFx();
    };
  }, []);
}

/**
 * Parse SysEx reply from OrbitBridgeDeck and update the config store.
 * Firmware SysEx format: F0 7D 00 00 <cmd> [payload…] F7
 *
 * Reply commands we handle:
 *   0x01  button config:  <idx> <ch_0idx> <cc>
 *   0x02  slider config:  <idx> <ch_0idx> <cc> <min> <max> <inv>
 *   0x7F  ACK:            <status>  (0x00 = OK, 0x01 = error)
 */
function handleSysExMessage(data: Uint8Array) {
  // Minimum: F0 7D 00 00 <cmd> F7 = 6 bytes
  if (data.length < 6) return;
  // Manufacturer ID check
  if (data[1] !== 0x7D || data[2] !== 0x00 || data[3] !== 0x00) return;

  const cmd = data[4];
  const store = useOrbitBridgeDeckStore.getState();

  if (cmd === 0x01) {
    // Button config reply: <idx> <ch_0idx> <cc>
    if (data.length < 9) return;
    const idx     = data[5];
    const channel = data[6] + 1;  // 0-indexed → 1-indexed for display
    const cc      = data[7];
    if (idx < 6) store.updateButton(idx, { channel, cc });

  } else if (cmd === 0x02) {
    // Slider config reply: <idx> <ch_0idx> <cc> <min> <max> <inv>
    if (data.length < 12) return;
    const idx    = data[5];
    const channel = data[6] + 1;
    const cc     = data[7];
    const minVal = data[8];
    const maxVal = data[9];
    const invert = data[10] !== 0;
    if (idx < 2) store.updateSlider(idx, { channel, cc, minVal, maxVal, invert });

  } else if (cmd === 0x7F) {
    // ACK — loading complete after GET_ALL response triggers this
    store.setIsLoading(false);
  }
}

/**
 * Process an incoming MIDI message.
 * Handles: System Real-Time, SysEx replies from OrbitBridgeDeck, CC messages.
 */
function handleMidiMessage(event: WebMidi.MIDIMessageEvent, deviceName: string) {
  const data = event.data;
  if (!data || data.length < 1) return;

  const status = data[0];

  // ── System Real-Time messages (single byte) ───────────────────────────
  if (status === 0xF8) {
    useTempoStore.getState().handleMidiClock();
    return;
  }
  if (status === 0xFA || status === 0xFB || status === 0xFC) return;

  // ── SysEx messages from OrbitBridgeDeck ──────────────────────────────
  if (status === 0xF0) {
    handleSysExMessage(data);
    return;
  }

  // ── Channel Voice messages ────────────────────────────────────────────
  if (data.length < 3) return;
  // CC messages only: 0xB0–0xBF
  if (status < 0xB0 || status > 0xBF) return;

  const channel = (status - 0xB0) + 1;  // 1–16
  const cc = data[1];                     // 0–127
  const rawValue = data[2];               // 0–127

  // Scale 0–127 → 0–255
  const value = Math.round((rawValue / 127) * 255);

  // Update last message for visual feedback
  useMidiStore.getState().setLastMessage({ channel, cc, value: rawValue });

  // Check "Learn" mode first
  const learnTargetId = useMidiStore.getState().learnTargetId;
  if (learnTargetId) {
    useControlsStore.getState().updateControl(learnTargetId, {
      midi: { channel, cc, deviceName },
    });
    useMidiStore.getState().setLearnTarget(null);
    console.log(`[MIDI] Learned: control=${learnTargetId} → ch=${channel} cc=${cc} (${deviceName})`);
    return;
  }

  // Route to matching controls
  const widgets = useControlsStore.getState().widgets;
  for (const widget of widgets) {
    if (!widget.midi) continue;
    if (widget.midi.channel !== channel || widget.midi.cc !== cc) continue;

    const kind = getWidgetKind(widget.controlType);
    if (kind === 'button') {
      // For buttons: value > 64 = press, <= 64 = release
      if (rawValue > 64) {
        if (!isMomentary(widget.controlType) && widget.value > 0) {
          // Toggle button already on → turn off
          applyButtonRelease(widget);
        } else {
          applyButtonPress(widget);
        }
      } else {
        // MIDI release: only affects momentary buttons
        if (isMomentary(widget.controlType)) {
          applyButtonRelease(widget);
        }
      }
    } else {
      // Sliders: apply value 0–255
      applyControlValue(widget.id, value);
    }
  }
}

// ── Action dispatchers ──────────────────────────────────────────────────────

/**
 * Apply a scalar value (0–255) to a control. Dispatches based on controlType.
 */
function applyControlValue(controlId: string, value: number) {
  const widget = useControlsStore.getState().widgets.find((w) => w.id === controlId);
  if (!widget) return;

  useControlsStore.getState().updateControl(controlId, { value });

  if (typeof window.dmx === 'undefined') return;

  switch (widget.controlType) {
    // ── Channel controls: write directly to DMX ──
    case 'channel-dimmer':
    case 'channel-red':
    case 'channel-green':
    case 'channel-blue':
    case 'channel-white':
    case 'channel-strobe':
    case 'channel-other': {
      const addresses = useControlsStore.getState().getTargetAddresses(widget);
      if (addresses.length === 0) return;
      window.dmx.setChannelBatch(addresses.map((address) => ({ address, value })));
      break;
    }

    // ── Room dimmer: global master fader ──
    case 'room-dimmer': {
      useRoomStore.getState().setRoomDimmer(value);
      break;
    }

    // ── LED dimmer: per-LED color channel scaling ──
    case 'led-dimmer': {
      const rgbAddrs = useControlsStore.getState().getTargetRGBAddresses(widget);
      const allAddresses: number[] = [];
      for (const a of rgbAddrs) {
        allAddresses.push(a.r, a.g, a.b);
      }
      // Also include white, amber, UV channels for targeted fixtures
      // Use getTargetAddresses with a temporary channel-white/amber/uv widget
      const store = useControlsStore.getState();
      for (const chType of ['white', 'amber', 'uv'] as const) {
        // Create a minimal channel widget to resolve addresses
        const tempWidget: ControlWidget = {
          ...widget,
          controlType: 'channel-other',
          channelSubType: chType,
        };
        const addrs = store.getTargetAddresses(tempWidget);
        allAddresses.push(...addrs);
      }

      if (allAddresses.length > 0) {
        const factor = value / 255;
        window.dmx.setLedDimmer(widget.id, allAddresses, factor);
      }
      break;
    }

    // ── Color shift: hue rotation ──
    case 'color-shift': {
      const rgbAddrs = useControlsStore.getState().getTargetRGBAddresses(widget);
      if (rgbAddrs.length > 0) {
        const degrees = (value / 255) * 360;
        window.dmx.setColorShift(widget.id, rgbAddrs, degrees);
      }
      break;
    }

    default:
      break;
  }
}

/**
 * Apply an RGB color to a control's targeted DMX channels.
 */
function applyControlRGB(controlId: string, rgb: [number, number, number]) {
  const widget = useControlsStore.getState().widgets.find((w) => w.id === controlId);
  if (!widget) return;

  useControlsStore.getState().updateControl(controlId, { colorValue: rgb });

  const rgbAddresses = useControlsStore.getState().getTargetRGBAddresses(widget);
  if (rgbAddresses.length === 0 || typeof window.dmx === 'undefined') return;

  const updates = rgbAddresses.flatMap((addr) => [
    { address: addr.r, value: rgb[0] },
    { address: addr.g, value: rgb[1] },
    { address: addr.b, value: rgb[2] },
  ]);
  window.dmx.setChannelBatch(updates);
}

/**
 * Handle a button press (MIDI CC > 64, or UI mousedown/click).
 */
function applyButtonPress(widget: ControlWidget) {
  const fxType = getFxTypeForControl(widget.controlType);

  if (fxType) {
    // FX button: start this specific FX type with this button's target
    const fxStore = useFxStore.getState();
    const fixtures = useRoomStore.getState().fixtures;

    // Apply this button's target to that FX type
    fxStore.setFxParam(fxType as import('../../shared/types').FxType, 'target', widget.target);
    fxStore.syncLedAddresses(fxType as import('../../shared/types').FxType, fixtures);
    fxStore.setFxActive(fxType as import('../../shared/types').FxType, true);

    useControlsStore.getState().updateControl(widget.id, { value: 255 });
    return;
  }

  if (widget.controlType === 'playlist') {
    // Playlist button: toggle playback
    const playlistStore = usePlaylistStore.getState();
    const currentlyPlaying = playlistStore.playbackState === 'playing';
    const currentPlaylistId = playlistStore.activePlaylistId;

    if (currentlyPlaying && currentPlaylistId === widget.playlistId) {
      // Same playlist is playing → stop it
      playlistStore.setPlaybackState('stopped');
      useControlsStore.getState().updateControl(widget.id, { value: 0 });
    } else if (widget.playlistId) {
      // Start the selected playlist (selectPlaylist resets index to 0)
      playlistStore.selectPlaylist(widget.playlistId);
      playlistStore.setPlaybackState('playing');
      useControlsStore.getState().updateControl(widget.id, { value: 255 });
    }
    return;
  }
}

/**
 * Handle a button release / toggle-off.
 * For momentary buttons: called on mouseup / MIDI CC ≤ 64.
 * For toggle buttons: called explicitly when toggling off.
 */
function applyButtonRelease(widget: ControlWidget) {
  const fxType = getFxTypeForControl(widget.controlType);
  if (fxType) {
    const fxStore = useFxStore.getState();
    fxStore.setFxActive(fxType as import('../../shared/types').FxType, false);
    useControlsStore.getState().updateControl(widget.id, { value: 0 });
    return;
  }

  if (widget.controlType === 'playlist') {
    const playlistStore = usePlaylistStore.getState();
    playlistStore.setPlaybackState('stopped');
    useControlsStore.getState().updateControl(widget.id, { value: 0 });
  }
}

// Export helpers so the Controls UI can also call them directly (not only via MIDI)
export { applyControlValue, applyControlRGB, applyButtonPress, applyButtonRelease };
