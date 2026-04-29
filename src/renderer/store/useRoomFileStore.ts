import { create } from 'zustand';

interface RoomFileStore {
  /** Absolute path to the current .orbitdmx file, or null if not yet saved. */
  filePath: string | null;
  /** Display name shown in the header. */
  fileName: string;
  /** Whether the in-memory state differs from the on-disk file. */
  isDirty: boolean;

  setFilePath: (path: string | null) => void;
  setFileName: (name: string) => void;
  setIsDirty: (dirty: boolean) => void;
}

export const useRoomFileStore = create<RoomFileStore>()((set) => ({
  filePath: null,
  fileName: 'Untitled Room',
  isDirty: false,

  setFilePath: (filePath) => set({ filePath }),
  setFileName: (fileName) => set({ fileName }),
  setIsDirty: (isDirty) => set({ isDirty }),
}));
