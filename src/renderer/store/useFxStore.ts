import { create } from 'zustand';
import type { FxType, FxConfig, FixtureTarget, LedAddress, FixtureInstance } from '../../shared/types';
import { getRigById } from '../../rigs';

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
  target: FixtureTarget;   // which fixtures/LEDs to apply FX to

  setSelectedType: (type: FxType | null) => void;
  setIsActive: (active: boolean) => void;
  setSpeed: (speed: number) => void;
  setIntensity: (intensity: number) => void;
  setColor: (color: [number, number, number]) => void;
  setFadeSpeed: (fadeSpeed: number) => void;
  setRandomness: (randomness: number) => void;
  setAmount: (amount: number) => void;
  setTarget: (target: FixtureTarget) => void;

  /** Build the FxConfig from current state */
  getConfig: () => FxConfig | null;

  /** Send current config to the engine */
  syncToEngine: () => void;

  /** Sync FX LED addresses based on target filter */
  syncLedAddresses: (fixtures: FixtureInstance[]) => void;

  /** Stop FX and clear */
  stopFx: () => void;
}

/**
 * Collect LED addresses from fixtures, filtered by the given FixtureTarget.
 */
function collectFilteredLedAddresses(fixtures: FixtureInstance[], target: FixtureTarget): LedAddress[] {
  const addresses: LedAddress[] = [];

  // Determine which fixture IDs are included
  let includedFixtures: FixtureInstance[];
  switch (target.mode) {
    case 'all':
      includedFixtures = fixtures;
      break;
    case 'include':
      includedFixtures = fixtures.filter((f) => target.fixtureIds.includes(f.id));
      break;
    case 'exclude':
      includedFixtures = fixtures.filter((f) => !target.fixtureIds.includes(f.id));
      break;
    default:
      includedFixtures = fixtures;
  }

  for (const f of includedFixtures) {
    const rig = getRigById(f.rigId);
    const personality = rig?.personalities.find((p) => p.name === f.personalityName);
    if (!personality) continue;

    const channels = personality.channels;
    const reds   = channels.filter((c) => c.type === 'red');
    const greens = channels.filter((c) => c.type === 'green');
    const blues  = channels.filter((c) => c.type === 'blue');

    if (reds.length > 0 && reds.length === greens.length && reds.length === blues.length) {
      // Check for per-LED filtering
      const ledFilter = target.ledIndices?.[f.id];

      for (let i = 0; i < reds.length; i++) {
        // If ledFilter exists, only include specified indices
        if (ledFilter && !ledFilter.includes(i)) continue;

        addresses.push({
          r: f.startAddress + reds[i].offset,
          g: f.startAddress + greens[i].offset,
          b: f.startAddress + blues[i].offset,
        });
      }
    }
  }
  return addresses;
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
  target: { mode: 'all', fixtureIds: [] },

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
  setTarget: (target) => {
    set({ target });
    // Re-sync LED addresses with the new target filter
    // (this requires the fixture list, which App.tsx provides via syncLedAddresses)
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

  syncLedAddresses: (fixtures) => {
    if (typeof window.dmx === 'undefined') return;
    const { target } = get();
    const addresses = collectFilteredLedAddresses(fixtures, target);
    window.dmx.setFxLedAddresses(addresses);
  },

  stopFx: () => {
    set({ isActive: false });
    if (typeof window.dmx !== 'undefined') {
      window.dmx.setFx(null);
    }
  },
}));

