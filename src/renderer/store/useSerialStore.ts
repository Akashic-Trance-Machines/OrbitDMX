import { create } from 'zustand';
import type { SerialStatus } from '../../shared/types';

/**
 * Global serial connection store.
 * Shared by StatusBar, SettingsView, and any other component that needs
 * to know or react to the current DMX adapter connection state.
 *
 * A single subscription to onSerialStatus (in App.tsx) keeps this store
 * up-to-date; individual components just read from it.
 */
interface SerialStore {
  status: SerialStatus;
  connectedPort: string | null;
  setStatus: (status: SerialStatus) => void;
  setConnectedPort: (port: string | null) => void;
}

export const useSerialStore = create<SerialStore>()((set) => ({
  status: 'disconnected',
  connectedPort: null,
  setStatus: (status) => set({ status }),
  setConnectedPort: (connectedPort) => set({ connectedPort }),
}));
