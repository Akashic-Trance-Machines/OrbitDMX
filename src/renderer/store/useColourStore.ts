import { create } from 'zustand';
import type { ColourPreset, ColourPalette } from '../../shared/types';

// Re-export so existing imports from this file continue to work
export type { ColourPreset, ColourPalette };

// ─── Defaults ─────────────────────────────────────────────────────────────────

export const DEFAULT_PRESETS: ColourPreset[] = [
  { id: 'p00', name: 'Warm White',    hex: '#ffe8b0' },
  { id: 'p01', name: 'Cool Blue',     hex: '#4fa8f7' },
  { id: 'p02', name: 'Deep Red',      hex: '#cc1a1a' },
  { id: 'p03', name: 'Amber',         hex: '#f7a04f' },
  { id: 'p04', name: 'Lime',          hex: '#7fff00' },
  { id: 'p05', name: 'Magenta',       hex: '#e040fb' },
  { id: 'p06', name: 'Purple',        hex: '#7c3aed' },
  { id: 'p07', name: 'Teal',          hex: '#00bcd4' },
  { id: 'p08', name: 'Hot Pink',      hex: '#f74f6a' },
  { id: 'p09', name: 'Forest Green',  hex: '#2d6a4f' },
  { id: 'p10', name: 'Lavender',      hex: '#b39ddb' },
  { id: 'p11', name: 'Gold',          hex: '#ffd700' },
];

// ─── Persistence helpers ───────────────────────────────────────────────────────

const STORAGE_KEY = 'orbitdmx-colours';

function load(): { presets: ColourPreset[]; palettes: ColourPalette[] } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { presets: DEFAULT_PRESETS, palettes: [] };
    const parsed = JSON.parse(raw);
    // Merge saved presets with defaults to handle new slots added in future updates
    const presets: ColourPreset[] = DEFAULT_PRESETS.map((d, i) =>
      parsed.presets?.[i] ?? d,
    );
    const palettes: ColourPalette[] = parsed.palettes ?? [];
    return { presets, palettes };
  } catch {
    return { presets: DEFAULT_PRESETS, palettes: [] };
  }
}

function save(presets: ColourPreset[], palettes: ColourPalette[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ presets, palettes }));
  } catch {
    // ignore storage quota errors
  }
}

// ─── Store ────────────────────────────────────────────────────────────────────

interface ColourStore {
  presets: ColourPreset[];
  palettes: ColourPalette[];

  /** Update a single preset slot (0-based index 0–14) */
  setPreset: (index: number, preset: ColourPreset) => void;

  /** Bulk-replace all presets */
  setPresets: (presets: ColourPreset[]) => void;

  /** Reset presets to the built-in defaults */
  resetPresets: () => void;

  /** Bulk-replace presets + palettes (used by room file load) */
  setColours: (presets: ColourPreset[], palettes: ColourPalette[]) => void;

  /** Palette CRUD */
  addPalette: (palette: ColourPalette) => void;
  updatePalette: (id: string, changes: Partial<Omit<ColourPalette, 'id'>>) => void;
  deletePalette: (id: string) => void;
  addColourToPalette: (paletteId: string, hex: string) => void;
  removeColourFromPalette: (paletteId: string, index: number) => void;
  reorderPaletteColours: (paletteId: string, colours: string[]) => void;
}

const initial = load();

export const useColourStore = create<ColourStore>()((set) => ({
  presets: initial.presets,
  palettes: initial.palettes,

  setPreset: (index, preset) =>
    set((s) => {
      const presets = [...s.presets];
      presets[index] = preset;
      save(presets, s.palettes);
      return { presets };
    }),

  setPresets: (presets) =>
    set((s) => {
      save(presets, s.palettes);
      return { presets };
    }),

  resetPresets: () =>
    set((s) => {
      save(DEFAULT_PRESETS, s.palettes);
      return { presets: DEFAULT_PRESETS };
    }),

  setColours: (presets, palettes) =>
    set(() => {
      save(presets, palettes);
      return { presets, palettes };
    }),

  addPalette: (palette) =>
    set((s) => {
      const palettes = [...s.palettes, palette];
      save(s.presets, palettes);
      return { palettes };
    }),

  updatePalette: (id, changes) =>
    set((s) => {
      const palettes = s.palettes.map((p) =>
        p.id === id ? { ...p, ...changes } : p,
      );
      save(s.presets, palettes);
      return { palettes };
    }),

  deletePalette: (id) =>
    set((s) => {
      const palettes = s.palettes.filter((p) => p.id !== id);
      save(s.presets, palettes);
      return { palettes };
    }),

  addColourToPalette: (paletteId, hex) =>
    set((s) => {
      const palettes = s.palettes.map((p) =>
        p.id === paletteId ? { ...p, colours: [...p.colours, hex] } : p,
      );
      save(s.presets, palettes);
      return { palettes };
    }),

  removeColourFromPalette: (paletteId, index) =>
    set((s) => {
      const palettes = s.palettes.map((p) =>
        p.id === paletteId
          ? { ...p, colours: p.colours.filter((_, i) => i !== index) }
          : p,
      );
      save(s.presets, palettes);
      return { palettes };
    }),

  reorderPaletteColours: (paletteId, colours) =>
    set((s) => {
      const palettes = s.palettes.map((p) =>
        p.id === paletteId ? { ...p, colours } : p,
      );
      save(s.presets, palettes);
      return { palettes };
    }),
}));
