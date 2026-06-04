import { create } from 'zustand';
import type { FxType, FxConfig, FixtureTarget, FixtureInstance } from '../../shared/types';
import { useTempoStore } from './useTempoStore';
import { collectFilteredLedAddresses } from '../utils/ledAddresses';

// ── Per-FX type state ─────────────────────────────────────────────────────────

export interface FxTypeState {
  isActive: boolean;
  speed: number;           // 0–100 (timing for strobe/breath/fire/candle/twinkle)
  intensity: number;       // 0–100
  color: [number, number, number];   // strobeColor only
  fadeSpeed: number;       // 0–100 twinkle fade-out speed
  randomness: number;      // 0–100 twinkle timing randomness
  amount: number;          // 0–100 twinkle: max LEDs per tick
  rotatePeriodMs: number;  // hueRotator: ms per full 360° rotation
  target: FixtureTarget;
  syncToBpm: boolean;
  tempoDivider: number;
  quantiseStrobe: boolean;
}

const DEFAULT_FX_STATE: FxTypeState = {
  isActive: false,
  speed: 50,
  intensity: 50,
  color: [255, 255, 255],
  fadeSpeed: 50,
  randomness: 50,
  amount: 50,
  rotatePeriodMs: 5000,
  target: { mode: 'all', fixtureIds: [] },
  syncToBpm: false,
  tempoDivider: 1,
  quantiseStrobe: false,
};

const ALL_FX_TYPES: FxType[] = ['strobe', 'strobeColor', 'breath', 'fire', 'candle', 'twinkle', 'hueRotator'];

function makeDefaultStates(): Record<FxType, FxTypeState> {
  return Object.fromEntries(
    ALL_FX_TYPES.map((t) => [t, { ...DEFAULT_FX_STATE, color: [...DEFAULT_FX_STATE.color] as [number, number, number] }]),
  ) as Record<FxType, FxTypeState>;
}

// ── Store interface ───────────────────────────────────────────────────────────

interface FxStore {
  /** Which FX panel is currently open in the UI (does NOT affect running state). */
  selectedType: FxType | null;

  /** Per-type independent state. */
  fxStates: Record<FxType, FxTypeState>;

  // ── Panel selection ─────────────────────────────────────────────────────────
  setSelectedType: (type: FxType | null) => void;

  // ── Per-type param setters ──────────────────────────────────────────────────
  setFxParam: <K extends keyof FxTypeState>(type: FxType, key: K, value: FxTypeState[K]) => void;

  // ── Active state ─────────────────────────────────────────────────────────────
  /** Toggle a specific FX on/off. Momentary effects (strobe, strobeColor) set active directly. */
  setFxActive: (type: FxType, active: boolean) => void;
  stopAllFx: () => void;

  // ── Engine sync ─────────────────────────────────────────────────────────────
  syncToEngine: (type: FxType) => void;
  syncLedAddresses: (type: FxType, fixtures: FixtureInstance[]) => void;
  syncAllLedAddresses: (fixtures: FixtureInstance[]) => void;
}

// ── Build FxConfig for a single type ─────────────────────────────────────────

function buildConfig(type: FxType, state: FxTypeState): FxConfig {
  const globalBpm = useTempoStore.getState().bpm;
  const isStrobe = type === 'strobe' || type === 'strobeColor';
  return {
    type,
    active: state.isActive,
    speed: state.speed,
    intensity: state.intensity,
    color: type === 'strobeColor' ? state.color : undefined,
    fadeSpeed: type === 'twinkle' ? state.fadeSpeed : undefined,
    randomness: type === 'twinkle' ? state.randomness : undefined,
    amount: type === 'twinkle' ? state.amount : undefined,
    syncToBpm: state.syncToBpm,
    tempoDivider: state.tempoDivider,
    globalBpm,
    quantiseStrobe: isStrobe ? state.quantiseStrobe : undefined,
    rotatePeriodMs: type === 'hueRotator' ? state.rotatePeriodMs : undefined,
  };
}

// ── Store ─────────────────────────────────────────────────────────────────────

export const useFxStore = create<FxStore>()((set, get) => ({
  selectedType: null,
  fxStates: makeDefaultStates(),

  setSelectedType: (selectedType) => set({ selectedType }),

  setFxParam: (type, key, value) => {
    set((s) => ({
      fxStates: {
        ...s.fxStates,
        [type]: { ...s.fxStates[type], [key]: value },
      },
    }));
    // If this type is currently active, push the updated config to the engine
    if (get().fxStates[type].isActive) {
      get().syncToEngine(type);
    }
  },

  setFxActive: (type, active) => {
    set((s) => ({
      fxStates: {
        ...s.fxStates,
        [type]: { ...s.fxStates[type], isActive: active },
      },
    }));
    get().syncToEngine(type);
  },

  stopAllFx: () => {
    if (typeof window.dmx === 'undefined') return;
    // Send inactive config for every type
    const { fxStates } = get();
    for (const type of ALL_FX_TYPES) {
      if (fxStates[type].isActive) {
        window.dmx.setFx({ ...buildConfig(type, fxStates[type]), active: false });
      }
    }
    set((s) => {
      const updated = { ...s.fxStates };
      for (const type of ALL_FX_TYPES) {
        updated[type] = { ...updated[type], isActive: false };
      }
      return { fxStates: updated };
    });
  },

  syncToEngine: (type) => {
    if (typeof window.dmx === 'undefined') return;
    const state = get().fxStates[type];
    const config = buildConfig(type, state);
    window.dmx.setFx(config);
  },

  syncLedAddresses: (type, fixtures) => {
    if (typeof window.dmx === 'undefined') return;
    const target = get().fxStates[type].target;
    const addresses = collectFilteredLedAddresses(fixtures, target);
    window.dmx.setFxLedAddressesForType(type, addresses);
  },

  syncAllLedAddresses: (fixtures) => {
    if (typeof window.dmx === 'undefined') return;
    const { fxStates } = get();
    for (const type of ALL_FX_TYPES) {
      const addresses = collectFilteredLedAddresses(fixtures, fxStates[type].target);
      window.dmx.setFxLedAddressesForType(type, addresses);
    }
  },
}));
