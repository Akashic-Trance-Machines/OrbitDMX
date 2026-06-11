import { create } from 'zustand';

// ── Per-control config types (mirrors firmware button_cfg_t / slider_cfg_t) ──

export interface ButtonConfig {
  channel: number;   // 1–16 (1-indexed for display)
  cc: number;        // 0–127
}

export interface SliderConfig {
  channel: number;   // 1–16
  cc: number;        // 0–127
  minVal: number;    // 0–127
  maxVal: number;    // 0–127
  invert: boolean;
}

const DEFAULT_BUTTONS: ButtonConfig[] = Array.from({ length: 6 }, (_, i) => ({
  channel: 1,
  cc: 20 + i,
}));

const DEFAULT_SLIDERS: SliderConfig[] = [
  { channel: 1, cc: 7,  minVal: 0, maxVal: 127, invert: false },
  { channel: 1, cc: 11, minVal: 0, maxVal: 127, invert: false },
];

// ── Store interface ───────────────────────────────────────────────────────────

interface OrbitBridgeDeckStore {
  buttons: ButtonConfig[];
  sliders: SliderConfig[];
  /** True while waiting for GET_ALL response from device. */
  isLoading: boolean;
  /** Timestamp of last successful save-to-flash. */
  lastSavedAt: number | null;

  updateButton: (idx: number, patch: Partial<ButtonConfig>) => void;
  updateSlider: (idx: number, patch: Partial<SliderConfig>) => void;
  /** Bulk-apply all button configs at once (used when parsing GET_ALL reply). */
  setButtons: (buttons: ButtonConfig[]) => void;
  /** Bulk-apply all slider configs at once. */
  setSliders: (sliders: SliderConfig[]) => void;
  setIsLoading: (loading: boolean) => void;
  markSaved: () => void;
  resetToDefaults: () => void;
}

export const useOrbitBridgeDeckStore = create<OrbitBridgeDeckStore>()((set) => ({
  buttons: DEFAULT_BUTTONS.map((b) => ({ ...b })),
  sliders: DEFAULT_SLIDERS.map((s) => ({ ...s })),
  isLoading: false,
  lastSavedAt: null,

  updateButton: (idx, patch) =>
    set((state) => {
      const buttons = state.buttons.map((b, i) =>
        i === idx ? { ...b, ...patch } : b
      );
      return { buttons };
    }),

  updateSlider: (idx, patch) =>
    set((state) => {
      const sliders = state.sliders.map((s, i) =>
        i === idx ? { ...s, ...patch } : s
      );
      return { sliders };
    }),

  setButtons: (buttons) => set({ buttons }),
  setSliders: (sliders) => set({ sliders }),
  setIsLoading: (isLoading) => set({ isLoading }),
  markSaved: () => set({ lastSavedAt: Date.now() }),
  resetToDefaults: () =>
    set({
      buttons: DEFAULT_BUTTONS.map((b) => ({ ...b })),
      sliders: DEFAULT_SLIDERS.map((s) => ({ ...s })),
      lastSavedAt: null,
    }),
}));
