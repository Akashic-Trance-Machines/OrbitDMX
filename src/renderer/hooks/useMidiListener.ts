import { useEffect, useRef } from 'react';
import { useMidiStore } from '../store/useMidiStore';
import { useControlsStore, getWidgetKind, getChannelTypeForControl, getFxTypeForControl, isMomentary } from '../store/useControlsStore';
import { useRoomStore } from '../store/useRoomStore';
import { useFxStore } from '../store/useFxStore';
import { usePlaylistStore } from '../store/usePlaylistStore';
import type { ControlWidget, FxType } from '../../shared/types';

/**
 * useMidiListener — app-level hook for Web MIDI API.
 *
 * Mounted once in App.tsx (like usePlaylistRunner) so MIDI works
 * regardless of which page is active.
 *
 * - Auto-discovers MIDI input devices
 * - Routes CC messages to matching ControlWidgets
 * - Supports "Learn" mode for auto-mapping
 */
export function useMidiListener() {
  const midiAccessRef = useRef<WebMidi.MIDIAccess | null>(null);
  const listenersRef = useRef<Map<string, (e: WebMidi.MIDIMessageEvent) => void>>(new Map());

  useEffect(() => {
    let cancelled = false;

    async function init() {
      if (!navigator.requestMIDIAccess) {
        console.log('[MIDI] Web MIDI API not supported');
        return;
      }

      try {
        const access = await navigator.requestMIDIAccess({ sysex: false });
        if (cancelled) return;

        midiAccessRef.current = access;
        useMidiStore.getState().setIsListening(true);

        // Discover devices
        const devices: Array<{ id: string; name: string }> = [];
        access.inputs.forEach((input) => {
          devices.push({ id: input.id, name: input.name || input.id });
        });
        useMidiStore.getState().setDevices(devices);

        // Attach listeners to all inputs
        access.inputs.forEach((input) => {
          const handler = (e: WebMidi.MIDIMessageEvent) => handleMidiMessage(e, input.name || input.id);
          listenersRef.current.set(input.id, handler);
          input.addEventListener('midimessage', handler as EventListener);
        });

        // Listen for device connect/disconnect
        access.onstatechange = () => {
          const updatedDevices: Array<{ id: string; name: string }> = [];

          // Remove old listeners
          listenersRef.current.forEach((handler, inputId) => {
            const input = access.inputs.get(inputId);
            if (input) {
              input.removeEventListener('midimessage', handler as EventListener);
            }
          });
          listenersRef.current.clear();

          // Re-attach to all current inputs
          access.inputs.forEach((input) => {
            updatedDevices.push({ id: input.id, name: input.name || input.id });
            const handler = (e: WebMidi.MIDIMessageEvent) => handleMidiMessage(e, input.name || input.id);
            listenersRef.current.set(input.id, handler);
            input.addEventListener('midimessage', handler as EventListener);
          });

          useMidiStore.getState().setDevices(updatedDevices);
        };

        console.log(`[MIDI] Listening on ${devices.length} input(s):`, devices.map((d) => d.name).join(', '));
      } catch (err) {
        console.error('[MIDI] Failed to access MIDI devices:', err);
      }
    }

    init();

    return () => {
      cancelled = true;
      // Cleanup all listeners
      if (midiAccessRef.current) {
        midiAccessRef.current.inputs.forEach((input) => {
          const handler = listenersRef.current.get(input.id);
          if (handler) {
            input.removeEventListener('midimessage', handler as EventListener);
          }
        });
      }
      listenersRef.current.clear();
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
      if (state.isActive === prev.isActive && state.selectedType === prev.selectedType) return;

      const widgets = useControlsStore.getState().widgets;
      for (const w of widgets) {
        const fxType = getFxTypeForControl(w.controlType);
        if (!fxType) continue;

        const shouldBeOn = state.isActive && state.selectedType === fxType;
        const newValue = shouldBeOn ? 255 : 0;
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
 * Process an incoming MIDI message.
 * We only care about Control Change messages (status 0xB0–0xBF).
 */
function handleMidiMessage(event: WebMidi.MIDIMessageEvent, deviceName: string) {
  const data = event.data;
  if (!data || data.length < 3) return;

  const status = data[0];
  // CC messages: 0xB0 (channel 1) through 0xBF (channel 16)
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
    // FX button: use FX page settings but with this button's target
    const fxState = useFxStore.getState();
    const store = useControlsStore.getState();
    
    // Stop any running FX first
    fxState.stopFx();

    // Deactivate all other FX buttons (only one FX can run at a time)
    for (const w of store.widgets) {
      if (w.id !== widget.id && getFxTypeForControl(w.controlType) && w.value > 0) {
        store.updateControl(w.id, { value: 0 });
      }
    }

    // Set the FX type and start it
    fxState.setSelectedType(fxType as FxType);
    fxState.setIsActive(true);
    
    // Sync LED addresses with this button's target
    const fixtures = useRoomStore.getState().fixtures;
    fxState.setTarget(widget.target);
    fxState.syncLedAddresses(fixtures);

    store.updateControl(widget.id, { value: 255 });
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
    const fxState = useFxStore.getState();
    fxState.stopFx();
    // Reset FX target to "all" so the FX page isn't affected by this button's target
    fxState.setTarget({ mode: 'all', fixtureIds: [] });
    fxState.syncLedAddresses(useRoomStore.getState().fixtures);
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
