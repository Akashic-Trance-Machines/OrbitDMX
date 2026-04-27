import { create } from 'zustand';
import type { FxType, FxConfig } from '../../shared/types';

/**
 * Global FX state store.
 * Lives across page navigation — FX keeps playing when leaving the FX page.
 */
interface FxStore {
  selectedType: FxType | null;
  isActive: boolean;
  speed: number;
  intensity: number;
  color: [number, number, number];
  fadeSpeed: number;       // 0–100 twinkle fade-out speed
  randomness: number;      // 0–100 twinkle timing randomness
  amount: number;          // 0–100 twinkle: max LEDs per tick

  setSelectedType: (type: FxType | null) => void;
  setIsActive: (active: boolean) => void;
  setSpeed: (speed: number) => void;
  setIntensity: (intensity: number) => void;
  setColor: (color: [number, number, number]) => void;
  setFadeSpeed: (fadeSpeed: number) => void;
  setRandomness: (randomness: number) => void;
  setAmount: (amount: number) => void;

  /** Build the FxConfig from current state */
  getConfig: () => FxConfig | null;

  /** Send current config to the engine */
  syncToEngine: () => void;

  /** Stop FX and clear */
  stopFx: () => void;
}

export const useFxStore = create<FxStore>()((set, get) => ({
  selectedType: null,
  isActive: false,
  speed: 50,
  intensity: 50,
  color: [255, 255, 255] as [number, number, number],
  fadeSpeed: 50,
  randomness: 50,
  amount: 50,

  setSelectedType: (selectedType) => set({ selectedType }),
  setIsActive: (isActive) => {
    set({ isActive });
    get().syncToEngine();
  },
  setSpeed: (speed) => {
    set({ speed });
    if (get().isActive) get().syncToEngine();
  },
  setIntensity: (intensity) => {
    set({ intensity });
    if (get().isActive) get().syncToEngine();
  },
  setColor: (color) => {
    set({ color });
    if (get().isActive) get().syncToEngine();
  },
  setFadeSpeed: (fadeSpeed) => {
    set({ fadeSpeed });
    if (get().isActive) get().syncToEngine();
  },
  setRandomness: (randomness) => {
    set({ randomness });
    if (get().isActive) get().syncToEngine();
  },
  setAmount: (amount) => {
    set({ amount });
    if (get().isActive) get().syncToEngine();
  },

  getConfig: () => {
    const { selectedType, isActive, speed, intensity, color, fadeSpeed, randomness, amount } = get();
    if (!selectedType) return null;
    return {
      type: selectedType,
      active: isActive,
      speed,
      intensity,
      color: selectedType === 'strobeColor' ? color : undefined,
      fadeSpeed: selectedType === 'twinkle' ? fadeSpeed : undefined,
      randomness: selectedType === 'twinkle' ? randomness : undefined,
      amount: selectedType === 'twinkle' ? amount : undefined,
    };
  },

  syncToEngine: () => {
    if (typeof window.dmx === 'undefined') return;
    const config = get().getConfig();
    window.dmx.setFx(config);
  },

  stopFx: () => {
    set({ isActive: false });
    if (typeof window.dmx !== 'undefined') {
      window.dmx.setFx(null);
    }
  },
}));
