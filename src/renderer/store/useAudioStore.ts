import { create } from 'zustand';

/**
 * Shared audio state for the VU meter.
 * Updated by the playlist runner's beat detection loop.
 */
interface AudioStore {
  /** Current audio energy level 0–1 (after gain scaling) */
  level: number;
  /** Whether audio is actively being analysed */
  isListening: boolean;

  setLevel: (level: number) => void;
  setIsListening: (isListening: boolean) => void;
}

export const useAudioStore = create<AudioStore>()((set) => ({
  level: 0,
  isListening: false,

  setLevel: (level) => set({ level }),
  setIsListening: (isListening) => set({ isListening }),
}));
