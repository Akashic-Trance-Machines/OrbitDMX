import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { FixtureInstance } from '../../shared/types';

interface RoomStore {
  fixtures: FixtureInstance[];
  addFixture: (fixture: FixtureInstance) => void;
  removeFixture: (id: string) => void;
  /** Returns true if the given address range overlaps an existing fixture (optionally excluding one by id). */
  hasAddressConflict: (startAddress: number, channelCount: number, excludeId?: string) => boolean;
  /** Returns the conflicting fixture label(s) for a given range. */
  getConflicts: (startAddress: number, channelCount: number, excludeId?: string) => FixtureInstance[];
}

export const useRoomStore = create<RoomStore>()(
  persist(
    (set, get) => ({
      fixtures: [],

      addFixture: (fixture) =>
        set((state) => ({ fixtures: [...state.fixtures, fixture] })),

      removeFixture: (id) =>
        set((state) => ({ fixtures: state.fixtures.filter((f) => f.id !== id) })),

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
    }),
    { name: 'ayra-room-store' },
  ),
);
