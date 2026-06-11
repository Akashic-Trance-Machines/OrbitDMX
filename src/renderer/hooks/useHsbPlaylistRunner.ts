import { useEffect, useRef, useCallback } from 'react';
import { usePlaylistStore } from '../store/usePlaylistStore';
import { useRoomStore } from '../store/useRoomStore';
import { useTempoStore } from '../store/useTempoStore';
import { useAudioStore } from '../store/useAudioStore';
import { collectFilteredLedAddresses } from '../utils/ledAddresses';
import type { HsbPlaylist, LedAddress } from '../../shared/types';

// ── HSV → RGB conversion ─────────────────────────────────────────────────────

/**
 * Standard HSV → RGB.
 * h: 0–360, s: 0–1, v: 0–1
 * Returns [r, g, b] each 0–255.
 */
function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const hh = ((h % 360) + 360) % 360; // normalise to [0, 360)
  const c = v * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if      (hh < 60)  { r = c; g = x; b = 0; }
  else if (hh < 120) { r = x; g = c; b = 0; }
  else if (hh < 180) { r = 0; g = c; b = x; }
  else if (hh < 240) { r = 0; g = x; b = c; }
  else if (hh < 300) { r = x; g = 0; b = c; }
  else               { r = c; g = 0; b = x; }
  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255)];
}

function randRange(min: number, max: number): number {
  if (min >= max) return min;
  return min + Math.random() * (max - min);
}

/** Generate a random RGB colour within the playlist's HSB ranges. */
function randomColour(pl: HsbPlaylist): [number, number, number] {
  // hueCenter ± hueWidth/2 with natural modular wrap-around
  const h = ((pl.hueCenter - pl.hueWidth / 2) + Math.random() * pl.hueWidth + 3600) % 360;
  const s = randRange(pl.saturation.min, pl.saturation.max) / 100;
  const v = randRange(pl.brightness.min, pl.brightness.max) / 100;
  return hsvToRgb(h, s, v);
}

// ── Types ─────────────────────────────────────────────────────────────────────

/** Per-spot colour state — tracks current and target RGB for crossfading. */
type SpotState = {
  r: number; g: number; b: number;    // current (start of fade)
  tr: number; tg: number; tb: number; // target (end of fade)
};

// ── Runner ───────────────────────────────────────────────────────────────────

/**
 * useHsbPlaylistRunner — drives HSB Generator playback.
 *
 * On every step, each spot receives its own independently randomised colour
 * constrained by min/max Hue (0–360°), Saturation (0–100%) and Brightness
 * (0–100%) ranges set by the user.
 *
 * Crossfade: each spot fades independently from its previous colour to its
 * new random colour in a single shared rAF loop.
 *
 * Supports three sync modes: auto / manual (re-roll on next/prev) / music.
 * Mutual exclusion: starting this stops any running Scene or Palette playlist.
 *
 * MUST be mounted exactly once at App level.
 */
export function useHsbPlaylistRunner() {
  const hsbPlaybackState    = usePlaylistStore((s) => s.hsbPlaybackState);
  const activeHsbPlaylistId = usePlaylistStore((s) => s.activeHsbPlaylistId);
  const hsbPlaylists        = usePlaylistStore((s) => s.hsbPlaylists);

  const fixtures = useRoomStore((s) => s.fixtures);
  const bpm      = useTempoStore((s) => s.bpm);

  const timerRef    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rafRef      = useRef<number | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef   = useRef<MediaStream | null>(null);
  const audioRafRef = useRef<number | null>(null);
  const lastBeatRef = useRef<number>(0);

  // Stable refs — avoid stale closures in timers
  const bpmRef      = useRef(bpm);
  const fixturesRef = useRef(fixtures);

  /** Current displayed RGB values per spot — used as "from" on next crossfade. */
  const spotStatesRef = useRef<SpotState[]>([]);

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
    if (audioRafRef.current) { cancelAnimationFrame(audioRafRef.current); audioRafRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach((t) => t.stop()); streamRef.current = null; }
    if (audioCtxRef.current) { audioCtxRef.current.close().catch((_e) => { /* noop */ }); audioCtxRef.current = null; }
    analyserRef.current = null;
    useAudioStore.getState().setIsListening(false);
    useAudioStore.getState().setLevel(0);
  }, []);

  // ── Write helpers ──────────────────────────────────────────────────────────

  const writeSpots = useCallback((addresses: LedAddress[], states: SpotState[]) => {
    if (typeof window.dmx === 'undefined') return;
    const updates: Array<{ address: number; value: number }> = [];
    for (let i = 0; i < addresses.length; i++) {
      const st = states[i];
      if (!st) continue;
      updates.push({ address: addresses[i].r, value: st.r });
      updates.push({ address: addresses[i].g, value: st.g });
      updates.push({ address: addresses[i].b, value: st.b });
    }
    void window.dmx.setChannelBatch(updates);
  }, []);

  /**
   * Crossfade each spot from its current colour to a new random colour.
   * Resolves when the fade completes (or immediately if fadeMs = 0).
   */
  const doStep = useCallback(
    (pl: HsbPlaylist, addresses: LedAddress[]): Promise<void> =>
      new Promise((resolve) => {
        clearFadeRaf();

        // Generate a new target for every spot
        const targets = addresses.map(() => randomColour(pl));

        if (pl.fadeMs <= 0) {
          // Snap: write immediately and update spot state
          for (let i = 0; i < addresses.length; i++) {
            const [r, g, b] = targets[i];
            spotStatesRef.current[i] = { r, g, b, tr: r, tg: g, tb: b };
          }
          writeSpots(addresses, spotStatesRef.current);
          resolve();
          return;
        }

        // Ensure spotStates has an entry for each spot (initialise to black if missing)
        for (let i = 0; i < addresses.length; i++) {
          if (!spotStatesRef.current[i]) {
            spotStatesRef.current[i] = { r: 0, g: 0, b: 0, tr: 0, tg: 0, tb: 0 };
          }
          const [tr, tg, tb] = targets[i];
          spotStatesRef.current[i].tr = tr;
          spotStatesRef.current[i].tg = tg;
          spotStatesRef.current[i].tb = tb;
        }

        // Snapshot from values at fade start
        const fromRgbs = spotStatesRef.current.slice(0, addresses.length).map(
          (s) => [s.r, s.g, s.b] as [number, number, number],
        );

        const startTime = performance.now();

        const tick = (now: number) => {
          const t = Math.min((now - startTime) / pl.fadeMs, 1);
          if (typeof window.dmx === 'undefined') { resolve(); return; }

          const updates: Array<{ address: number; value: number }> = [];
          for (let i = 0; i < addresses.length; i++) {
            const [fr, fg, fb] = fromRgbs[i];
            const st = spotStatesRef.current[i];
            const r = Math.round(fr + (st.tr - fr) * t);
            const g = Math.round(fg + (st.tg - fg) * t);
            const b = Math.round(fb + (st.tb - fb) * t);
            // Update current values
            st.r = r; st.g = g; st.b = b;
            updates.push({ address: addresses[i].r, value: r });
            updates.push({ address: addresses[i].g, value: g });
            updates.push({ address: addresses[i].b, value: b });
          }
          void window.dmx.setChannelBatch(updates);

          if (t < 1) { rafRef.current = setTimeout(() => tick(performance.now()), 16) as unknown as number; }
          else { rafRef.current = null; resolve(); }
        };

        rafRef.current = setTimeout(() => tick(performance.now()), 16) as unknown as number;
      }),
    [clearFadeRaf, writeSpots],
  );

  // ── Auto mode step loop ────────────────────────────────────────────────────

  const runStep = useCallback(
    async (playlist: HsbPlaylist) => {
      const { hsbPlaybackState: state } = usePlaylistStore.getState();
      if (state !== 'playing') return;

      const pl = usePlaylistStore.getState().hsbPlaylists.find((p) => p.id === playlist.id);
      if (!pl) return;

      const effectiveHoldMs = pl.bpmSync
        ? (60_000 / bpmRef.current) * pl.bpmDivider
        : pl.holdMs;

      const addresses = collectFilteredLedAddresses(fixturesRef.current, pl.target);
      await doStep(pl, addresses);

      const { hsbPlaybackState: stateAfter } = usePlaylistStore.getState();
      if (stateAfter !== 'playing') return;

      timerRef.current = setTimeout(() => { void runStep(pl); }, effectiveHoldMs);
    },
    [doStep],
  );

  // ── Music beat detection ───────────────────────────────────────────────────

  const startBeatDetection = useCallback(async () => {
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

        const pl = usePlaylistStore.getState().hsbPlaylists.find(
          (p) => p.id === usePlaylistStore.getState().activeHsbPlaylistId,
        );
        const gain      = (pl?.audioGain      ?? 50) / 100;
        const threshold = (pl?.audioThreshold ?? 50) / 100;
        const cooldown  =  pl?.audioCooldown  ?? 300;
        const scaled = energy * (0.5 + gain * 1.5);
        const now = Date.now();

        useAudioStore.getState().setLevel(scaled);

        if (scaled > threshold && now - lastBeatRef.current > cooldown) {
          lastBeatRef.current = now;
          if (!pl) return;
          const addresses = collectFilteredLedAddresses(fixturesRef.current, pl.target);
          void doStep(pl, addresses);
        }

        audioRafRef.current = setTimeout(() => detect(), 16) as unknown as number;
      };

      audioRafRef.current = setTimeout(() => detect(), 16) as unknown as number;
    } catch (err) {
      console.error('[HsbPlaylistRunner] Mic error:', err);
    }
  }, [cleanupAudio, doStep]);

  // ── Effect: react to playback state ───────────────────────────────────────

  useEffect(() => {
    clearStepTimer();
    clearFadeRaf();
    cleanupAudio();

    if (hsbPlaybackState !== 'playing' || !activeHsbPlaylistId) return;

    const playlist = hsbPlaylists.find((p) => p.id === activeHsbPlaylistId);
    if (!playlist) return;

    // Mutual exclusion — stop any running Scene or Palette playlist
    const { playbackState, palettePlaybackState } = usePlaylistStore.getState();
    if (playbackState !== 'stopped')        usePlaylistStore.getState().setPlaybackState('stopped');
    if (palettePlaybackState !== 'stopped') usePlaylistStore.getState().setPalettePlaybackState('stopped');

    // Reset spot state so the first step always starts from black
    spotStatesRef.current = [];

    const addresses = collectFilteredLedAddresses(fixturesRef.current, playlist.target);

    if (playlist.syncMode === 'auto') {
      const effectiveHoldMs = playlist.bpmSync
        ? (60_000 / bpmRef.current) * playlist.bpmDivider
        : playlist.holdMs;
      // Run the first step immediately, then schedule the rest
      void doStep(playlist, addresses).then(() => {
        const { hsbPlaybackState: after } = usePlaylistStore.getState();
        if (after === 'playing') {
          timerRef.current = setTimeout(() => { void runStep(playlist); }, effectiveHoldMs);
        }
      });
    } else if (playlist.syncMode === 'music') {
      // Fire first step immediately, then drive by beat
      void doStep(playlist, addresses);
      void startBeatDetection();
    }
    // manual: user drives via next / re-roll button

    return () => {
      clearStepTimer();
      clearFadeRaf();
      cleanupAudio();
    };
  }, [hsbPlaybackState, activeHsbPlaylistId]);

  // Cleanup on unmount
  useEffect(() => () => {
    clearStepTimer();
    clearFadeRaf();
    cleanupAudio();
  }, [clearStepTimer, clearFadeRaf, cleanupAudio]);
}

// ── Controls hook (transport + manual re-roll) ───────────────────────────────

/**
 * useHsbPlaylistControls — transport + manual "re-roll" for the panel.
 */
export function useHsbPlaylistControls() {
  const hsbPlaybackState    = usePlaylistStore((s) => s.hsbPlaybackState);
  const activeHsbPlaylistId = usePlaylistStore((s) => s.activeHsbPlaylistId);
  const hsbPlaylists        = usePlaylistStore((s) => s.hsbPlaylists);
  const setHsbPlaybackState = usePlaylistStore((s) => s.setHsbPlaybackState);
  const selectHsbPlaylist   = usePlaylistStore((s) => s.selectHsbPlaylist);

  const fixtures = useRoomStore((s) => s.fixtures);

  const playlist = hsbPlaylists.find((p) => p.id === activeHsbPlaylistId) ?? null;

  const reroll = useCallback(() => {
    if (!playlist) return;
    const addresses = collectFilteredLedAddresses(fixtures, playlist.target);
    if (typeof window.dmx === 'undefined') return;
    const updates: Array<{ address: number; value: number }> = [];
    for (const addr of addresses) {
      const [r, g, b] = randomColour(playlist);
      updates.push({ address: addr.r, value: r });
      updates.push({ address: addr.g, value: g });
      updates.push({ address: addr.b, value: b });
    }
    void window.dmx.setChannelBatch(updates);
  }, [playlist, fixtures]);

  const start = useCallback((id: string) => {
    // Stop other generators
    const { playbackState, palettePlaybackState } = usePlaylistStore.getState();
    if (playbackState !== 'stopped')        usePlaylistStore.getState().setPlaybackState('stopped');
    if (palettePlaybackState !== 'stopped') usePlaylistStore.getState().setPalettePlaybackState('stopped');
    selectHsbPlaylist(id);
    setHsbPlaybackState('playing');
  }, [selectHsbPlaylist, setHsbPlaybackState]);

  const stop = useCallback(() => {
    setHsbPlaybackState('stopped');
  }, [setHsbPlaybackState]);

  return { hsbPlaybackState, playlist, reroll, start, stop };
}
