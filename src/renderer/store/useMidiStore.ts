import { create } from 'zustand';

const LS_KEY = 'orbitdmx:midiDeviceId';

export interface MidiDevice {
  id: string;
  name: string;
}

interface MidiStore {
  devices: MidiDevice[];
  isListening: boolean;
  /** ID of the explicitly connected MIDI input device (null = none selected). */
  connectedDeviceId: string | null;
  /** Control ID currently in "learn" mode — next incoming CC maps to this control. */
  learnTargetId: string | null;
  /** Last received MIDI message (for visual feedback). */
  lastMessage: { channel: number; cc: number; value: number } | null;

  setDevices: (devices: MidiDevice[]) => void;
  setIsListening: (listening: boolean) => void;
  /** Explicitly connect a device by ID. Persists to localStorage. */
  connectDevice: (id: string) => void;
  /** Explicitly disconnect the active device. Clears localStorage entry. */
  disconnectDevice: () => void;
  setLearnTarget: (controlId: string | null) => void;
  setLastMessage: (msg: { channel: number; cc: number; value: number } | null) => void;
}

export const useMidiStore = create<MidiStore>()((set) => ({
  devices: [],
  isListening: false,
  // Restore last-used device ID from localStorage so the listener hook can
  // auto-reconnect when the app starts and the device is already plugged in.
  connectedDeviceId: localStorage.getItem(LS_KEY) ?? null,
  learnTargetId: null,
  lastMessage: null,

  setDevices: (devices) => set({ devices }),
  setIsListening: (isListening) => set({ isListening }),

  connectDevice: (id) => {
    localStorage.setItem(LS_KEY, id);
    set({ connectedDeviceId: id });
  },

  disconnectDevice: () => {
    localStorage.removeItem(LS_KEY);
    set({ connectedDeviceId: null });
  },

  setLearnTarget: (learnTargetId) => set({ learnTargetId }),
  setLastMessage: (lastMessage) => set({ lastMessage }),
}));
