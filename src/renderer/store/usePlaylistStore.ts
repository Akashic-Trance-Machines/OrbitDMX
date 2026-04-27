import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { Playlist, Cue } from '../../shared/types';

export type PlaybackState = 'stopped' | 'playing' | 'paused';

interface PlaylistStore {
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
}

export const usePlaylistStore = create<PlaylistStore>()(
  persist(
    (set) => ({
      playlists: [],
      activePlaylistId: null,
      playbackState: 'stopped',
      currentCueIndex: 0,

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
        set({ activePlaylistId: id, playbackState: 'stopped', currentCueIndex: 0 }),

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
    }),
    {
      name: 'ayra-playlist-store',
      // Don't persist playback state — always start stopped
      partialize: (state) => ({
        playlists: state.playlists,
        activePlaylistId: state.activePlaylistId,
      }),
    },
  ),
);
