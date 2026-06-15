/**
 * useObdStandaloneStore.ts — Per-room OBD standalone control bindings
 *
 * Manages the 8 control bindings (6 buttons + 2 sliders) and the selected
 * playlist for standalone mode. Data is persisted as part of the room file.
 */

import { create } from 'zustand';
import type { ObdControlBinding, ObdStandaloneConfig, ObdActionType, FxType } from '../../shared/types';

// Default: 8 bindings, all unassigned
function createDefaultBindings(): ObdControlBinding[] {
  return Array.from({ length: 8 }, (_, i) => ({
    physicalControl: i,
    action: 'none' as ObdActionType,
    ledColor: i < 6 ? [60, 60, 60] as [number, number, number] : undefined,
  }));
}

interface ObdStandaloneState {
  selectedPlaylistId: string | null;
  baseSceneId: string | null;
  bindings: ObdControlBinding[];

  // Actions
  setSelectedPlaylist: (id: string | null) => void;
  setBaseSceneId: (id: string | null) => void;
  updateBinding: (index: number, patch: Partial<ObdControlBinding>) => void;
  resetAll: () => void;
  loadFromRoom: (config: ObdStandaloneConfig | undefined) => void;
  toRoomData: () => ObdStandaloneConfig;
}

export const useObdStandaloneStore = create<ObdStandaloneState>((set, get) => ({
  selectedPlaylistId: null,
  baseSceneId: null,
  bindings: createDefaultBindings(),

  setSelectedPlaylist: (id) => set({ selectedPlaylistId: id }),
  setBaseSceneId: (id) => set({ baseSceneId: id }),

  updateBinding: (index, patch) => set((state) => {
    if (index < 0 || index >= 8) return state;
    const bindings = [...state.bindings];
    bindings[index] = { ...bindings[index], ...patch };
    return { bindings };
  }),

  resetAll: () => set({
    selectedPlaylistId: null,
    baseSceneId: null,
    bindings: createDefaultBindings(),
  }),

  loadFromRoom: (config) => {
    if (!config) {
      set({ selectedPlaylistId: null, bindings: createDefaultBindings() });
      return;
    }
    // Ensure we always have exactly 8 bindings
    const loaded = config.bindings ?? [];
    const bindings = createDefaultBindings();
    for (let i = 0; i < Math.min(loaded.length, 8); i++) {
      bindings[i] = { ...bindings[i], ...loaded[i] };
    }
    set({
      selectedPlaylistId: config.selectedPlaylistId ?? null,
      baseSceneId: config.baseSceneId ?? null,
      bindings,
    });
  },

  toRoomData: (): ObdStandaloneConfig => {
    const { selectedPlaylistId, baseSceneId, bindings } = get();
    return {
      selectedPlaylistId: selectedPlaylistId ?? undefined,
      baseSceneId: baseSceneId ?? undefined,
      bindings,
    };
  },
}));
