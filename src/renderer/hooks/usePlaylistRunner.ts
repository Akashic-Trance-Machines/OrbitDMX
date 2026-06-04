import { useEffect, useRef, useCallback } from 'react';
import { usePlaylistStore } from '../store/usePlaylistStore';
import { useSceneStore } from '../store/useSceneStore';
import { useTempoStore } from '../store/useTempoStore';
import { useAudioStore } from '../store/useAudioStore';
import type { Playlist, Scene } from '../../shared/types';

/**
 * usePlaylistRunner — drives playlist playback in the renderer.
 *
 * Handles:
 * - Auto mode: timed advance via setTimeout
 * - Manual mode: next/previous via exposed callbacks
 * - Music mode: Web Audio beat detection via microphone
 *
 * All modes loop back to the start when reaching the end.
 * Play direction: forward, backward, or random.
 *
 * MUST be called exactly once at App-level so timers survive page navigation.
 */
export function usePlaylistRunner() {
  const playbackState = usePlaylistStore((s) => s.playbackState);
  const currentCueIndex = usePlaylistStore((s) => s.currentCueIndex);
  const activePlaylistId = usePlaylistStore((s) => s.activePlaylistId);
  const playlists = usePlaylistStore((s) => s.playlists);
  const setPlaybackState = usePlaylistStore((s) => s.setPlaybackState);
  const setCurrentCueIndex = usePlaylistStore((s) => s.setCurrentCueIndex);

  const scenes = useSceneStore((s) => s.scenes);

  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const rafRef = useRef<number | null>(null);
  const lastBeatRef = useRef<number>(0);

  const playlist = playlists.find((p) => p.id === activePlaylistId) ?? null;

  // ── Helpers ──────────────────────────────────────────────────────────────

  const getScene = useCallback(
    (sceneId: string): Scene | undefined => scenes.find((s) => s.id === sceneId),
    [scenes],
  );

  const getNextIndex = useCallback(
    (current: number, pl: Playlist): number => {
      const len = pl.cues.length;
      if (len <= 1) return 0;

      switch (pl.playDirection) {
        case 'forward':
          return (current + 1) % len;
        case 'backward':
          return (current - 1 + len) % len;
        case 'random': {
          let next = current;
          while (next === current && len > 1) {
            next = Math.floor(Math.random() * len);
          }
          return next;
        }
        default:
          return (current + 1) % len;
      }
    },
    [],
  );

  const getPrevIndex = useCallback(
    (current: number, pl: Playlist): number => {
      const len = pl.cues.length;
      if (len <= 1) return 0;

      switch (pl.playDirection) {
        case 'forward':
          return (current - 1 + len) % len;
        case 'backward':
          return (current + 1) % len;
        case 'random': {
          let next = current;
          while (next === current && len > 1) {
            next = Math.floor(Math.random() * len);
          }
          return next;
        }
        default:
          return (current - 1 + len) % len;
      }
    },
    [],
  );

  // ── Play a cue ──────────────────────────────────────────────────────────

  const playCue = useCallback(
    async (index: number, pl: Playlist) => {
      const cue = pl.cues[index];
      if (!cue) return;

      const scene = getScene(cue.sceneId);
      if (!scene) return;

      setCurrentCueIndex(index);

      if (typeof window.dmx !== 'undefined') {
        await window.dmx.playScene(scene, pl.fadeDurationMs);
      }

      // Set active scene in scene store for visual feedback
      useSceneStore.getState().setActiveScene(scene.id);
    },
    [getScene, setCurrentCueIndex],
  );

  // ── Auto timer ──────────────────────────────────────────────────────────

  const clearAutoTimer = useCallback(() => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
  }, []);

  const scheduleAutoAdvance = useCallback(
    (fromIndex: number, pl: Playlist) => {
      clearAutoTimer();

      // BPM sync: derive hold from global BPM if enabled
      const bpmMs = pl.bpmSync
        ? (60_000 / useTempoStore.getState().bpm) * (pl.bpmDivider ?? 1)
        : null;
      const holdMs = bpmMs ?? pl.holdDurationMs;
      const nextIdx = getNextIndex(fromIndex, pl);

      // Record when this hold period started so the progress bar can animate correctly.
      usePlaylistStore.getState().setHoldStartedAt(Date.now());

      timerRef.current = setTimeout(() => {
        playCue(nextIdx, pl);
        scheduleAutoAdvance(nextIdx, pl);
      }, holdMs + pl.fadeDurationMs);
    },
    [clearAutoTimer, getNextIndex, playCue],
  );

  // ── Music beat detection ────────────────────────────────────────────────

  const cleanupAudio = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (audioCtxRef.current) {
      audioCtxRef.current.close().catch(() => {});
      audioCtxRef.current = null;
    }
    analyserRef.current = null;
    useAudioStore.getState().setIsListening(false);
    useAudioStore.getState().setLevel(0);
  }, []);

  const startBeatDetection = useCallback(
    async (fromIndex: number, pl: Playlist) => {
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
        let idx = fromIndex;
        lastBeatRef.current = 0;

        useAudioStore.getState().setIsListening(true);

        const detect = () => {
          analyser.getByteFrequencyData(dataArray);
          const bass = dataArray.slice(0, 8);
          const energy = bass.reduce((sum, v) => sum + v, 0) / (bass.length * 255);

          // Read gain/threshold from the CURRENT playlist state (live, not stale)
          const currentPl = usePlaylistStore.getState().playlists.find(
            (p) => p.id === usePlaylistStore.getState().activePlaylistId,
          );
          const gain = ((currentPl?.audioGain ?? 50) / 100);
          const threshold = ((currentPl?.audioThreshold ?? 50) / 100);
          const cooldown = currentPl?.audioCooldown ?? 300;

          const scaled = energy * (0.5 + gain * 1.5);
          const now = Date.now();

          // Push level to store for VU meter
          useAudioStore.getState().setLevel(scaled);

          if (scaled > threshold && now - lastBeatRef.current > cooldown) {
            lastBeatRef.current = now;
            const nextIdx = getNextIndex(idx, currentPl ?? pl);
            idx = nextIdx;
            playCue(nextIdx, currentPl ?? pl);
          }

          rafRef.current = requestAnimationFrame(detect);
        };

        rafRef.current = requestAnimationFrame(detect);
      } catch (err) {
        console.error('[PlaylistRunner] Microphone access error:', err);
      }
    },
    [cleanupAudio, getNextIndex, playCue],
  );

  // ── Effect: react to playback state / mode changes ──────────────────────

  const syncMode = playlist?.syncMode;

  useEffect(() => {
    if (!playlist || playlist.cues.length === 0) return;

    if (playbackState === 'playing') {
      // Play the current cue immediately
      playCue(currentCueIndex, playlist);

      if (playlist.syncMode === 'auto') {
        scheduleAutoAdvance(currentCueIndex, playlist);
      } else if (playlist.syncMode === 'music') {
        startBeatDetection(currentCueIndex, playlist);
      }
      // manual: no timer needed, user presses next/prev
    }

    return () => {
      clearAutoTimer();
      cleanupAudio();
      usePlaylistStore.getState().setHoldStartedAt(null);
    };
  }, [playbackState, activePlaylistId, syncMode]);

  // Cleanup on unmount (app shutdown)
  useEffect(() => {
    return () => {
      clearAutoTimer();
      cleanupAudio();
    };
  }, []);
}

/**
 * usePlaylistControls — access playlist transport controls from any page.
 *
 * Reads state from the store and provides play/pause/stop/next/prev functions.
 * Does NOT create timers — those live in usePlaylistRunner at App level.
 */
export function usePlaylistControls() {
  const playbackState = usePlaylistStore((s) => s.playbackState);
  const currentCueIndex = usePlaylistStore((s) => s.currentCueIndex);
  const activePlaylistId = usePlaylistStore((s) => s.activePlaylistId);
  const playlists = usePlaylistStore((s) => s.playlists);
  const setPlaybackState = usePlaylistStore((s) => s.setPlaybackState);
  const setCurrentCueIndex = usePlaylistStore((s) => s.setCurrentCueIndex);

  const scenes = useSceneStore((s) => s.scenes);
  const playlist = playlists.find((p) => p.id === activePlaylistId) ?? null;

  const getScene = useCallback(
    (sceneId: string): Scene | undefined => scenes.find((s) => s.id === sceneId),
    [scenes],
  );

  const getNextIndex = useCallback(
    (current: number, pl: Playlist): number => {
      const len = pl.cues.length;
      if (len <= 1) return 0;
      switch (pl.playDirection) {
        case 'forward':  return (current + 1) % len;
        case 'backward': return (current - 1 + len) % len;
        case 'random': {
          let next = current;
          while (next === current && len > 1) next = Math.floor(Math.random() * len);
          return next;
        }
        default: return (current + 1) % len;
      }
    },
    [],
  );

  const getPrevIndex = useCallback(
    (current: number, pl: Playlist): number => {
      const len = pl.cues.length;
      if (len <= 1) return 0;
      switch (pl.playDirection) {
        case 'forward':  return (current - 1 + len) % len;
        case 'backward': return (current + 1) % len;
        case 'random': {
          let next = current;
          while (next === current && len > 1) next = Math.floor(Math.random() * len);
          return next;
        }
        default: return (current - 1 + len) % len;
      }
    },
    [],
  );

  const playCue = useCallback(
    async (index: number, pl: Playlist) => {
      const cue = pl.cues[index];
      if (!cue) return;
      const scene = getScene(cue.sceneId);
      if (!scene) return;
      setCurrentCueIndex(index);
      if (typeof window.dmx !== 'undefined') {
        await window.dmx.playScene(scene, pl.fadeDurationMs);
      }
      useSceneStore.getState().setActiveScene(scene.id);
    },
    [getScene, setCurrentCueIndex],
  );

  const play = useCallback(() => {
    if (!playlist || playlist.cues.length === 0) return;
    setPlaybackState('playing');
  }, [playlist, setPlaybackState]);

  const pause = useCallback(() => {
    setPlaybackState('paused');
  }, [setPlaybackState]);

  const stop = useCallback(() => {
    setPlaybackState('stopped');
    setCurrentCueIndex(0);
  }, [setPlaybackState, setCurrentCueIndex]);

  const next = useCallback(() => {
    if (!playlist || playlist.cues.length === 0) return;
    const nextIdx = getNextIndex(currentCueIndex, playlist);
    playCue(nextIdx, playlist);
  }, [playlist, currentCueIndex, getNextIndex, playCue]);

  const previous = useCallback(() => {
    if (!playlist || playlist.cues.length === 0) return;
    const prevIdx = getPrevIndex(currentCueIndex, playlist);
    playCue(prevIdx, playlist);
  }, [playlist, currentCueIndex, getPrevIndex, playCue]);

  return { play, pause, stop, next, previous, playbackState, currentCueIndex, playlist };
}
