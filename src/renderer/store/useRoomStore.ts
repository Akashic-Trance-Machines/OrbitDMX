import { create } from 'zustand';
import type { FixtureInstance, FloorPlanDimensions } from '../../shared/types';

interface RoomStore {
  fixtures: FixtureInstance[];
  floorPlan: FloorPlanDimensions;
  roomDimmer: number; // 0–255, persists across page navigation

  addFixture: (fixture: FixtureInstance) => void;
  removeFixture: (id: string) => void;
  updateFixture: (id: string, updates: Partial<FixtureInstance>) => void;
  /** Bulk-replace all fixtures (used by undo/redo and file load). */
  setFixtures: (fixtures: FixtureInstance[]) => void;
  setFloorPlan: (dims: FloorPlanDimensions) => void;
  setRoomDimmer: (value: number) => void;

  /** Returns true if the given address range overlaps an existing fixture (optionally excluding one by id). */
  hasAddressConflict: (startAddress: number, channelCount: number, excludeId?: string) => boolean;
  /** Returns the conflicting fixture label(s) for a given range. */
  getConflicts: (startAddress: number, channelCount: number, excludeId?: string) => FixtureInstance[];
}

export const useRoomStore = create<RoomStore>()((set, get) => ({
  fixtures: [],
  floorPlan: { widthM: 10, depthM: 8 },
  roomDimmer: 255,

  addFixture: (fixture) =>
    set((state) => ({ fixtures: [...state.fixtures, fixture] })),

  removeFixture: (id) =>
    set((state) => ({ fixtures: state.fixtures.filter((f) => f.id !== id) })),

  updateFixture: (id, updates) =>
    set((state) => ({
      fixtures: state.fixtures.map((f) =>
        f.id === id ? { ...f, ...updates } : f,
      ),
    })),

  setFixtures: (fixtures) => set({ 
    fixtures: fixtures.map(f => {
      // Migrate old save files where rigId was used instead of profileId
      if ((f as any).rigId && !f.profileId) {
        return { ...f, profileId: (f as any).rigId };
      }
      return f;
    }) 
  }),

  setFloorPlan: (floorPlan) => set({ floorPlan }),

  setRoomDimmer: (value) => {
    set({ roomDimmer: Math.max(0, Math.min(255, Math.round(value))) });
    if (typeof window.dmx !== 'undefined') {
      window.dmx.setRoomDimmer(value);
    }
  },

  hasAddressConflict: (startAddress, channelCount, excludeId) =>
    get().getConflicts(startAddress, channelCount, excludeId).length > 0,

  getConflicts: (startAddress, channelCount, excludeId) => {
    const newEnd = startAddress + channelCount - 1;
    return get().fixtures.filter((f) => {
      if (f.id === excludeId) return false;
      const fEnd = f.startAddress + f.channelCount - 1;
      // Ranges overlap if neither is entirely before the other
      return !(newEnd < f.startAddress || startAddress > fEnd);
    });
  },
}));
