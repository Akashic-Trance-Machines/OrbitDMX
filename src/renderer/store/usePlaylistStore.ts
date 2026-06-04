import { create } from 'zustand';
import type { Playlist, Cue, PalettePlaylist, HsbPlaylist } from '../../shared/types';

export type PlaybackState = 'stopped' | 'playing' | 'paused';

interface PlaylistStore {
  // ── Scene playlists ──────────────────────────────────────────────────────────
  playlists: Playlist[];
  activePlaylistId: string | null;
  playbackState: PlaybackState;
  currentCueIndex: number;

  addPlaylist: (playlist: Playlist) => void;
  updatePlaylist: (id: string, updates: Partial<Playlist>) => void;
  deletePlaylist: (id: string) => void;
  selectPlaylist: (id: string | null) => void;

  addCue: (playlistId: string, cue: Cue) => void;
  removeCue: (playlistId: string, cueId: string) => void;
  reorderCues: (playlistId: string, cues: Cue[]) => void;

  setPlaybackState: (state: PlaybackState) => void;
  setCurrentCueIndex: (index: number) => void;
  /** Timestamp (Date.now()) when the current hold period began. Null when stopped/paused. */
  holdStartedAt: number | null;
  setHoldStartedAt: (ts: number | null) => void;
  /** Bulk-replace all playlists (used by undo/redo and file load). */
  setPlaylists: (playlists: Playlist[]) => void;

  // ── Palette playlists ─────────────────────────────────────────────────────
  palettePlayists: PalettePlaylist[];
  activePalettePlaylistId: string | null;
  palettePlaybackState: PlaybackState;
  paletteCurrentIndex: number;

  addPalettePlaylist: (playlist: PalettePlaylist) => void;
  updatePalettePlaylist: (id: string, updates: Partial<Omit<PalettePlaylist, 'id' | 'kind'>>) => void;
  deletePalettePlaylist: (id: string) => void;
  selectPalettePlaylist: (id: string | null) => void;
  setPalettePlaybackState: (state: PlaybackState) => void;
  setPaletteCurrentIndex: (index: number) => void;
  /** Bulk-replace all palette generators (used by file load / undo). */
  setPaletteGenerators: (playlists: PalettePlaylist[]) => void;

  // ── HSB playlists ─────────────────────────────────────────────────────────
  hsbPlaylists: HsbPlaylist[];
  activeHsbPlaylistId: string | null;
  hsbPlaybackState: PlaybackState;

  addHsbPlaylist: (playlist: HsbPlaylist) => void;
  updateHsbPlaylist: (id: string, updates: Partial<Omit<HsbPlaylist, 'id' | 'kind'>>) => void;
  deleteHsbPlaylist: (id: string) => void;
  selectHsbPlaylist: (id: string | null) => void;
  setHsbPlaybackState: (state: PlaybackState) => void;
  /** Bulk-replace all HSB generators (used by file load / undo). */
  setHsbGenerators: (playlists: HsbPlaylist[]) => void;
}

export const usePlaylistStore = create<PlaylistStore>()((set) => ({
  playlists: [],
  activePlaylistId: null,
  playbackState: 'stopped',
  currentCueIndex: 0,
  holdStartedAt: null,

  // Palette playlist initial state
  palettePlayists: [],
  activePalettePlaylistId: null,
  palettePlaybackState: 'stopped',
  paletteCurrentIndex: 0,

  // HSB playlist initial state
  hsbPlaylists: [],
  activeHsbPlaylistId: null,
  hsbPlaybackState: 'stopped',

  // ── Scene playlist actions ────────────────────────────────────────────────────

  addPlaylist: (playlist) =>
    set((state) => ({
      playlists: [...state.playlists, playlist],
      activePlaylistId: playlist.id,
    })),

  updatePlaylist: (id, updates) =>
    set((state) => ({
      playlists: state.playlists.map((p) =>
        p.id === id ? { ...p, ...updates } : p,
      ),
    })),

  deletePlaylist: (id) =>
    set((state) => ({
      playlists: state.playlists.filter((p) => p.id !== id),
      activePlaylistId: state.activePlaylistId === id ? null : state.activePlaylistId,
      playbackState: state.activePlaylistId === id ? 'stopped' : state.playbackState,
    })),

  selectPlaylist: (id) =>
    set((state) => {
      if (id === state.activePlaylistId) return {};
      return { activePlaylistId: id, playbackState: 'stopped', currentCueIndex: 0 };
    }),

  addCue: (playlistId, cue) =>
    set((state) => ({
      playlists: state.playlists.map((p) =>
        p.id === playlistId ? { ...p, cues: [...p.cues, cue] } : p,
      ),
    })),

  removeCue: (playlistId, cueId) =>
    set((state) => ({
      playlists: state.playlists.map((p) =>
        p.id === playlistId
          ? { ...p, cues: p.cues.filter((c) => c.id !== cueId) }
          : p,
      ),
    })),

  reorderCues: (playlistId, cues) =>
    set((state) => ({
      playlists: state.playlists.map((p) =>
        p.id === playlistId ? { ...p, cues } : p,
      ),
    })),

  setPlaybackState: (playbackState) => set({ playbackState }),
  setCurrentCueIndex: (currentCueIndex) => set({ currentCueIndex }),
  setHoldStartedAt: (holdStartedAt) => set({ holdStartedAt }),
  setPlaylists: (playlists) => set({ playlists }),

  // ── Palette playlist actions ──────────────────────────────────────────────────

  addPalettePlaylist: (playlist) =>
    set((state) => ({
      palettePlayists: [...state.palettePlayists, playlist],
      activePalettePlaylistId: playlist.id,
    })),

  updatePalettePlaylist: (id, updates) =>
    set((state) => ({
      palettePlayists: state.palettePlayists.map((p) =>
        p.id === id ? { ...p, ...updates } : p,
      ),
    })),

  deletePalettePlaylist: (id) =>
    set((state) => ({
      palettePlayists: state.palettePlayists.filter((p) => p.id !== id),
      activePalettePlaylistId:
        state.activePalettePlaylistId === id ? null : state.activePalettePlaylistId,
      palettePlaybackState:
        state.activePalettePlaylistId === id ? 'stopped' : state.palettePlaybackState,
    })),

  selectPalettePlaylist: (id) =>
    set((state) => {
      if (id === state.activePalettePlaylistId) return {};
      return {
        activePalettePlaylistId: id,
        palettePlaybackState: 'stopped',
        paletteCurrentIndex: 0,
      };
    }),

  setPalettePlaybackState: (palettePlaybackState) => set({ palettePlaybackState }),
  setPaletteCurrentIndex: (paletteCurrentIndex) => set({ paletteCurrentIndex }),
  setPaletteGenerators: (palettePlayists) => set({ palettePlayists }),

  // ── HSB playlist actions ──────────────────────────────────────────────────────

  addHsbPlaylist: (playlist) =>
    set((state) => ({
      hsbPlaylists: [...state.hsbPlaylists, playlist],
      activeHsbPlaylistId: playlist.id,
    })),

  updateHsbPlaylist: (id, updates) =>
    set((state) => ({
      hsbPlaylists: state.hsbPlaylists.map((p) =>
        p.id === id ? { ...p, ...updates } : p,
      ),
    })),

  deleteHsbPlaylist: (id) =>
    set((state) => ({
      hsbPlaylists: state.hsbPlaylists.filter((p) => p.id !== id),
      activeHsbPlaylistId:
        state.activeHsbPlaylistId === id ? null : state.activeHsbPlaylistId,
      hsbPlaybackState:
        state.activeHsbPlaylistId === id ? 'stopped' : state.hsbPlaybackState,
    })),

  selectHsbPlaylist: (id) =>
    set((state) => {
      if (id === state.activeHsbPlaylistId) return {};
      return { activeHsbPlaylistId: id, hsbPlaybackState: 'stopped' };
    }),

  setHsbPlaybackState: (hsbPlaybackState) => set({ hsbPlaybackState }),
  setHsbGenerators: (hsbPlaylists) => set({ hsbPlaylists }),
}));
