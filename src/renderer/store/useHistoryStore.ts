import { create } from 'zustand';
import type { FixtureInstance, Scene, Playlist, FloorPlanDimensions, ControlWidget } from '../../shared/types';

/** A serializable snapshot of the room state for undo/redo. */
export interface RoomSnapshot {
  fixtures: FixtureInstance[];
  scenes: Scene[];
  playlists: Playlist[];
  floorPlan: FloorPlanDimensions;
  controls?: ControlWidget[];
}

const MAX_HISTORY = 50;

interface HistoryStore {
  undoStack: RoomSnapshot[];
  redoStack: RoomSnapshot[];

  /** Push a new snapshot (call this BEFORE mutating state). */
  push: (snapshot: RoomSnapshot) => void;

  /** Pop and return the most recent undo snapshot. Returns null if nothing to undo. */
  undo: (current: RoomSnapshot) => RoomSnapshot | null;

  /** Pop and return the most recent redo snapshot. Returns null if nothing to redo. */
  redo: (current: RoomSnapshot) => RoomSnapshot | null;

  /** Clear all history (e.g. after loading a new file). */
  clear: () => void;

  canUndo: () => boolean;
  canRedo: () => boolean;
}

export const useHistoryStore = create<HistoryStore>()((set, get) => ({
  undoStack: [],
  redoStack: [],

  push: (snapshot) =>
    set((state) => ({
      undoStack: [...state.undoStack.slice(-(MAX_HISTORY - 1)), snapshot],
      redoStack: [], // new action clears the redo stack
    })),

  undo: (current) => {
    const { undoStack } = get();
    if (undoStack.length === 0) return null;

    const previous = undoStack[undoStack.length - 1];
    set((state) => ({
      undoStack: state.undoStack.slice(0, -1),
      redoStack: [...state.redoStack, current],
    }));
    return previous;
  },

  redo: (current) => {
    const { redoStack } = get();
    if (redoStack.length === 0) return null;

    const next = redoStack[redoStack.length - 1];
    set((state) => ({
      redoStack: state.redoStack.slice(0, -1),
      undoStack: [...state.undoStack, current],
    }));
    return next;
  },

  clear: () => set({ undoStack: [], redoStack: [] }),

  canUndo: () => get().undoStack.length > 0,
  canRedo: () => get().redoStack.length > 0,
}));
