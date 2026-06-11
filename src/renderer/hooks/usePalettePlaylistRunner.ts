import { useEffect, useRef, useCallback } from 'react';
import { usePlaylistStore } from '../store/usePlaylistStore';
import { useColourStore } from '../store/useColourStore';
import { useRoomStore } from '../store/useRoomStore';
import { useTempoStore } from '../store/useTempoStore';
import { useAudioStore } from '../store/useAudioStore';
import { collectFilteredLedAddresses } from '../utils/ledAddresses';
import type { LedAddress, PalettePlaylist, PlayDirection } from '../../shared/types';

/**
 * usePalettePlaylistRunner — drives Palette Generator playback.
 *
 * Each individual SPOT gets a different colour from the palette.
 * Spot i shows  colours[(baseIndex + i) % colours.length].
 * On each step, baseIndex advances by 1 — rotating all colours
 * across every spot like a chase/wash effect.
 *
 * Crossfade: each spot fades from its current colour to its next
 * colour independently using a single shared rAF loop.
 *
 * Supports three sync modes (auto / manual / music) matching the
 * scene playlist runner for a uniform UX.
 *
 * MUST be mounted exactly once at App level.
 */
export function usePalettePlaylistRunner() {
  const palettePlaybackState    = usePlaylistStore((s) => s.palettePlaybackState);
  const activePalettePlaylistId = usePlaylistStore((s) => s.activePalettePlaylistId);
  const palettePlayists         = usePlaylistStore((s) => s.palettePlayists);
  const setPaletteCurrentIndex  = usePlaylistStore((s) => s.setPaletteCurrentIndex);

  const palettes  = useColourStore((s) => s.palettes);
  const fixtures  = useRoomStore((s) => s.fixtures);
  const bpm       = useTempoStore((s) => s.bpm);

  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef      = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const audioRafRef = useRef<number | null>(null);
  const lastBeatRef = useRef<number>(0);

  // Stable refs — avoid stale closures in timers
  const indexRef    = useRef(0);
  const bpmRef      = useRef(bpm);
  const fixturesRef = useRef(fixtures);

  useEffect(() => { bpmRef.current = bpm; }, [bpm]);
  useEffect(() => { fixturesRef.current = fixtures; }, [fixtures]);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const clearStepTimer = useCallback(() => {
    if (timerRef.current) { clearTimeout(timerRef.current); timerRef.current = null; }
  }, []);

  const clearFadeRaf = useCallback(() => {
    if (rafRef.current) { clearTimeout(rafRef.current); rafRef.current = null; }
  }, []);

  const cleanupAudio = useCallback(() => {
    if (audioRafRef.current) { clearTimeout(audioRafRef.current); audioRafRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch((_e) => { /* noop */ }); audioCtxRef.current = null; }
    analyserRef.current = null;
    useAudioStore.getState().setIsListening(false);
    useAudioStore.getState().setLevel(0);
  }, []);

  const hexToRgb = (hex: string): [number, number, number] => {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };

  const getNextIndex = (current: number, len: number, direction: PlayDirection): number => {
    if (len <= 1) return 0;
    switch (direction) {
      case 'forward':  return (current + 1) % len;
      case 'backward': return (current - 1 + len) % len;
      case 'random': {
        let next = current;
        while (next === current && len > 1) next = Math.floor(Math.random() * len);
        return next;
      }
      default: return (current + 1) % len;
    }
  };

  /**
   * Write one colour per spot.
   * spot i gets colours[(baseIndex + i) % colours.length]
   */
  const writeSpots = useCallback(
    (addresses: LedAddress[], colours: string[], baseIndex: number) => {
      if (typeof window.dmx === 'undefined') return;
      const updates: Array<{ address: number; value: number }> = [];
      for (let i = 0; i < addresses.length; i++) {
        const hex = colours[(baseIndex + i) % colours.length];
        const [r, g, b] = hexToRgb(hex);
        const led = addresses[i];
        updates.push({ address: led.r, value: Math.round(r) });
        updates.push({ address: led.g, value: Math.round(g) });
        updates.push({ address: led.b, value: Math.round(b) });
      }
      void window.dmx.setChannelBatch(updates);
    },
    [],
  );

  /**
   * Crossfade all spots simultaneously from their current colours to their
   * next colours. Each spot independently interpolates its own from→to pair.
   *
   * fromBaseIndex: the baseIndex BEFORE the step (what spots currently show)
   * toBaseIndex:   the baseIndex AFTER  the step (what spots will show)
   */
  const crossfadeSpots = useCallback(
    (
      addresses: LedAddress[],
      colours: string[],
      fromBaseIndex: number,
      toBaseIndex: number,
      fadeMs: number,
    ): Promise<void> =>
      new Promise((resolve) => {
        if (fadeMs <= 0 || colours.length === 0) {
          writeSpots(addresses, colours, toBaseIndex);
          resolve();
          return;
        }

        // Pre-compute per-spot from/to RGB
        const fromRgbs = addresses.map((_, i) => hexToRgb(colours[(fromBaseIndex + i) % colours.length]));
        const toRgbs   = addresses.map((_, i) => hexToRgb(colours[(toBaseIndex   + i) % colours.length]));

        const startTime = performance.now();

        const tick = (now: number) => {
          const t = Math.min((now - startTime) / fadeMs, 1);
          if (typeof window.dmx === 'undefined') { resolve(); return; }

          const updates: Array<{ address: number; value: number }> = [];
          for (let i = 0; i < addresses.length; i++) {
            const [fr, fg, fb] = fromRgbs[i];
            const [tr, tg, tb] = toRgbs[i];
            const led = addresses[i];
            updates.push({ address: led.r, value: Math.round(fr + (tr - fr) * t) });
            updates.push({ address: led.g, value: Math.round(fg + (tg - fg) * t) });
            updates.push({ address: led.b, value: Math.round(fb + (tb - fb) * t) });
          }
          void window.dmx.setChannelBatch(updates);

          if (t < 1) { rafRef.current = setTimeout(() => tick(performance.now()), 16) as unknown as number; }
          else { rafRef.current = null; resolve(); }
        };

        rafRef.current = setTimeout(() => tick(performance.now()), 16) as unknown as number;
      }),
    [writeSpots],
  );

  // ── Auto mode step loop ────────────────────────────────────────────────────

  const runStep = useCallback(
    async (playlist: PalettePlaylist) => {
      const { palettePlaybackState: state } = usePlaylistStore.getState();
      if (state !== 'playing') return;

      const pl = usePlaylistStore.getState().palettePlayists.find((p) => p.id === playlist.id);
      if (!pl) return;

      const palette = useColourStore.getState().palettes.find((p) => p.id === pl.paletteId);
      const colours = palette?.colours ?? [];
      if (colours.length < 2) return;

      const effectiveHoldMs = pl.bpmSync
        ? (60_000 / bpmRef.current) * pl.bpmDivider
        : pl.holdMs;

      const fromIndex = indexRef.current;
      const nextIndex = getNextIndex(fromIndex, colours.length, pl.playDirection);
      indexRef.current = nextIndex;
      setPaletteCurrentIndex(nextIndex);

      const addresses = collectFilteredLedAddresses(fixturesRef.current, pl.target);
      await crossfadeSpots(addresses, colours, fromIndex, nextIndex, pl.fadeMs);

      const { palettePlaybackState: stateAfter } = usePlaylistStore.getState();
      if (stateAfter !== 'playing') return;

      timerRef.current = setTimeout(() => { void runStep(pl); }, effectiveHoldMs);
    },
    [crossfadeSpots, setPaletteCurrentIndex],
  );

  // ── Music beat detection ───────────────────────────────────────────────────

  const startBeatDetection = useCallback(
    async () => {
      cleanupAudio();
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;
        const ctx = new AudioContext();
        audioCtxRef.current = ctx;
        const source = ctx.createMediaStreamSource(stream);
        const analyser = ctx.createAnalyser();
        analyser.fftSize = 256;
        source.connect(analyser);
        analyserRef.current = analyser;
        const dataArray = new Uint8Array(analyser.frequencyBinCount);
        lastBeatRef.current = 0;
        useAudioStore.getState().setIsListening(true);

        const detect = () => {
          analyser.getByteFrequencyData(dataArray);
          const bass = dataArray.slice(0, 8);
          const energy = bass.reduce((sum, v) => sum + v, 0) / (bass.length * 255);

          const pl = usePlaylistStore.getState().palettePlayists.find(
            (p) => p.id === usePlaylistStore.getState().activePalettePlaylistId,
          );
          const gain      = ((pl?.audioGain      ?? 50) / 100);
          const threshold = ((pl?.audioThreshold ?? 50) / 100);
          const cooldown  =   pl?.audioCooldown  ?? 300;
          const scaled = energy * (0.5 + gain * 1.5);
          const now = Date.now();

          useAudioStore.getState().setLevel(scaled);

          if (scaled > threshold && now - lastBeatRef.current > cooldown) {
            lastBeatRef.current = now;
            if (!pl) return;

            const palette = useColourStore.getState().palettes.find((p) => p.id === pl.paletteId);
            const colours = palette?.colours ?? [];
            if (colours.length < 2) return;

            const fromIndex = indexRef.current;
            const nextIndex = getNextIndex(fromIndex, colours.length, pl.playDirection);
            indexRef.current = nextIndex;
            setPaletteCurrentIndex(nextIndex);

            const addresses = collectFilteredLedAddresses(fixturesRef.current, pl.target);
            void crossfadeSpots(addresses, colours, fromIndex, nextIndex, pl.fadeMs);
          }

          audioRafRef.current = setTimeout(() => detect(), 16) as unknown as number;
        };

        audioRafRef.current = setTimeout(() => detect(), 16) as unknown as number;
      } catch (err) {
        console.error('[PalettePlaylistRunner] Mic error:', err);
      }
    },
    [cleanupAudio, crossfadeSpots, setPaletteCurrentIndex],
  );

  // ── Effect: react to playback state ───────────────────────────────────────

  useEffect(() => {
    clearStepTimer();
    clearFadeRaf();
    cleanupAudio();

    if (palettePlaybackState !== 'playing' || !activePalettePlaylistId) return;

    const playlist = palettePlayists.find((p) => p.id === activePalettePlaylistId);
    if (!playlist) return;

    const paletteObj = palettes.find((p) => p.id === playlist.paletteId);
    const colours = paletteObj?.colours ?? [];
    if (colours.length < 2) return;

    // Stop any running Scene Playlist
    const sceneState = usePlaylistStore.getState().playbackState;
    if (sceneState !== 'stopped') usePlaylistStore.getState().setPlaybackState('stopped');

    // Write start state immediately — each spot gets its own colour
    const addresses = collectFilteredLedAddresses(fixturesRef.current, playlist.target);
    writeSpots(addresses, colours, indexRef.current);

    if (playlist.syncMode === 'auto') {
      const effectiveHoldMs = playlist.bpmSync
        ? (60_000 / bpmRef.current) * playlist.bpmDivider
        : playlist.holdMs;
      timerRef.current = setTimeout(() => { void runStep(playlist); }, effectiveHoldMs);
    } else if (playlist.syncMode === 'music') {
      void startBeatDetection();
    }
    // manual: no timer — user navigates via next/prev

    return () => {
      clearStepTimer();
      clearFadeRaf();
      cleanupAudio();
    };
  }, [palettePlaybackState, activePalettePlaylistId]);

  // Cleanup on unmount
  useEffect(() => () => {
    clearStepTimer();
    clearFadeRaf();
    cleanupAudio();
  }, [clearStepTimer, clearFadeRaf, cleanupAudio]);
}

/**
 * usePalettePlaylistControls — transport + manual navigation exposed to the panel.
 */
export function usePalettePlaylistControls() {
  const palettePlaybackState    = usePlaylistStore((s) => s.palettePlaybackState);
  const paletteCurrentIndex     = usePlaylistStore((s) => s.paletteCurrentIndex);
  const activePalettePlaylistId = usePlaylistStore((s) => s.activePalettePlaylistId);
  const palettePlayists         = usePlaylistStore((s) => s.palettePlayists);
  const setPalettePlaybackState = usePlaylistStore((s) => s.setPalettePlaybackState);
  const setPaletteCurrentIndex  = usePlaylistStore((s) => s.setPaletteCurrentIndex);

  const palettes = useColourStore((s) => s.palettes);
  const fixtures = useRoomStore((s) => s.fixtures);

  const playlist = palettePlayists.find((p) => p.id === activePalettePlaylistId) ?? null;

  const getNextIndex = (current: number, len: number): number => {
    if (!playlist || len <= 1) return 0;
    switch (playlist.playDirection) {
      case 'forward':  return (current + 1) % len;
      case 'backward': return (current - 1 + len) % len;
      case 'random': {
        let next = current;
        while (next === current && len > 1) next = Math.floor(Math.random() * len);
        return next;
      }
      default: return (current + 1) % len;
    }
  };

  const getPrevIndex = (current: number, len: number): number => {
    if (!playlist || len <= 1) return 0;
    switch (playlist.playDirection) {
      case 'forward':  return (current - 1 + len) % len;
      case 'backward': return (current + 1) % len;
      case 'random': {
        let next = current;
        while (next === current && len > 1) next = Math.floor(Math.random() * len);
        return next;
      }
      default: return (current - 1 + len) % len;
    }
  };

  const hexToRgb = (hex: string): [number, number, number] => {
    const h = hex.replace('#', '');
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  };

  const goToIndex = useCallback((fromIdx: number, toIdx: number) => {
    if (!playlist) return;
    const paletteObj = palettes.find((p) => p.id === playlist.paletteId);
    const colours = paletteObj?.colours ?? [];
    if (!colours.length) return;

    setPaletteCurrentIndex(toIdx);

    const allAddresses = collectFilteredLedAddresses(fixtures, playlist.target);
    if (typeof window.dmx === 'undefined') return;

    const updates: Array<{ address: number; value: number }> = [];
    for (let i = 0; i < allAddresses.length; i++) {
      // Snap (no crossfade in manual controls for now)
      const hex = colours[(toIdx + i) % colours.length];
      const [r, g, b] = hexToRgb(hex);
      const led = allAddresses[i];
      updates.push({ address: led.r, value: r });
      updates.push({ address: led.g, value: g });
      updates.push({ address: led.b, value: b });
    }
    void window.dmx.setChannelBatch(updates);
  }, [playlist, palettes, fixtures, setPaletteCurrentIndex]);

  const next = useCallback(() => {
    if (!playlist) return;
    const colours = palettes.find((p) => p.id === playlist.paletteId)?.colours ?? [];
    const nextIdx = getNextIndex(paletteCurrentIndex, colours.length);
    goToIndex(paletteCurrentIndex, nextIdx);
  }, [playlist, palettes, paletteCurrentIndex, goToIndex]);

  const previous = useCallback(() => {
    if (!playlist) return;
    const colours = palettes.find((p) => p.id === playlist.paletteId)?.colours ?? [];
    const prevIdx = getPrevIndex(paletteCurrentIndex, colours.length);
    goToIndex(paletteCurrentIndex, prevIdx);
  }, [playlist, palettes, paletteCurrentIndex, goToIndex]);

  return {
    palettePlaybackState,
    paletteCurrentIndex,
    playlist,
    next,
    previous,
    stop: () => setPalettePlaybackState('stopped'),
  };
}
