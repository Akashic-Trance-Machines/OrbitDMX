import { create } from 'zustand';

interface MidiDevice {
  id: string;
  name: string;
}

interface MidiStore {
  devices: MidiDevice[];
  isListening: boolean;
  /** Control ID currently in "learn" mode — next incoming CC maps to this control. */
  learnTargetId: string | null;
  /** Last received MIDI message (for visual feedback). */
  lastMessage: { channel: number; cc: number; value: number } | null;

  setDevices: (devices: MidiDevice[]) => void;
  setIsListening: (listening: boolean) => void;
  setLearnTarget: (controlId: string | null) => void;
  setLastMessage: (msg: { channel: number; cc: number; value: number } | null) => void;
}

export const useMidiStore = create<MidiStore>()((set) => ({
  devices: [],
  isListening: false,
  learnTargetId: null,
  lastMessage: null,

  setDevices: (devices) => set({ devices }),
  setIsListening: (isListening) => set({ isListening }),
  setLearnTarget: (learnTargetId) => set({ learnTargetId }),
  setLastMessage: (lastMessage) => set({ lastMessage }),
}));
