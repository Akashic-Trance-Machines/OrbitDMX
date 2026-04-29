import { create } from 'zustand';
import type { Scene } from '../../shared/types';

interface SceneStore {
  scenes: Scene[];
  activeSceneId: string | null;
  fadeDurationMs: number;

  addScene: (scene: Scene) => void;
  updateScene: (id: string, values: number[]) => void;
  deleteScene: (id: string) => void;
  setActiveScene: (id: string | null) => void;
  setFadeDuration: (ms: number) => void;
  /** Bulk-replace all scenes (used by undo/redo and file load). */
  setScenes: (scenes: Scene[]) => void;
}

export const useSceneStore = create<SceneStore>()((set) => ({
  scenes: [],
  activeSceneId: null,
  fadeDurationMs: 0,

  addScene: (scene) =>
    set((state) => ({
      scenes: [...state.scenes, scene],
      activeSceneId: scene.id,
    })),

  updateScene: (id, values) =>
    set((state) => ({
      scenes: state.scenes.map((s) =>
        s.id === id ? { ...s, values } : s,
      ),
    })),

  deleteScene: (id) =>
    set((state) => ({
      scenes: state.scenes.filter((s) => s.id !== id),
      activeSceneId: state.activeSceneId === id ? null : state.activeSceneId,
    })),

  setActiveScene: (id) => set({ activeSceneId: id }),

  setFadeDuration: (fadeDurationMs) => set({ fadeDurationMs }),

  setScenes: (scenes) => set({ scenes }),
}));
