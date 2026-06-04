import { create } from 'zustand';
import type { ControlWidget, ControlsLayout, FixtureTarget, ChannelType, ControlType, WidgetKind } from '../../shared/types';
import { useRoomStore } from './useRoomStore';
import { getFixtureProfileById } from '../../fixtures';
import { useFxStore } from './useFxStore';

// ── Type-driven helpers ──────────────────────────────────────────────────────

/** Determines what UI widget to render for a control type. */
export function getWidgetKind(controlType: ControlType): WidgetKind {
  switch (controlType) {
    case 'rgb-color':
      return 'color-wheel';
    case 'fx-strobe':
    case 'fx-strobe-color':
    case 'fx-breath':
    case 'fx-fire':
    case 'fx-candle':
    case 'fx-twinkle':
    case 'playlist':
      return 'button';
    default:
      return 'slider';
  }
}

/** Whether this control type needs a fixture/LED target selector. */
export function needsTarget(controlType: ControlType): boolean {
  switch (controlType) {
    case 'room-dimmer':
    case 'playlist':
      return false;
    default:
      return true;
  }
}

/** Whether this control type supports MIDI CC mapping. */
export function needsMidi(controlType: ControlType): boolean {
  return controlType !== 'rgb-color';
}

/** Whether to show per-LED sub-filtering in the target selector. */
export function showLedFilter(controlType: ControlType): boolean {
  switch (controlType) {
    case 'channel-red':
    case 'channel-green':
    case 'channel-blue':
    case 'channel-white':
    case 'rgb-color':
    case 'led-dimmer':
    case 'color-shift':
    case 'fx-strobe':
    case 'fx-strobe-color':
    case 'fx-breath':
    case 'fx-fire':
    case 'fx-candle':
    case 'fx-twinkle':
      return true;
    default:
      return false;
  }
}

/** Whether FX buttons are momentary (hold) vs toggle. */
export function isMomentary(controlType: ControlType): boolean {
  return controlType === 'fx-strobe' || controlType === 'fx-strobe-color';
}

/** Map control type → underlying DMX channel type (for channel-* types). */
export function getChannelTypeForControl(controlType: ControlType, subType?: ChannelType): ChannelType | null {
  switch (controlType) {
    case 'channel-dimmer': return 'dimmer';
    case 'channel-red': return 'red';
    case 'channel-green': return 'green';
    case 'channel-blue': return 'blue';
    case 'channel-white': return 'white';
    case 'channel-strobe': return 'strobe';
    case 'channel-other': return subType ?? 'generic';
    default: return null;
  }
}

/** Map control type → FxType for FX button controls. */
export function getFxTypeForControl(controlType: ControlType): string | null {
  switch (controlType) {
    case 'fx-strobe': return 'strobe';
    case 'fx-strobe-color': return 'strobeColor';
    case 'fx-breath': return 'breath';
    case 'fx-fire': return 'fire';
    case 'fx-candle': return 'candle';
    case 'fx-twinkle': return 'twinkle';
    default: return null;
  }
}

/** Default label for a newly created control of a given type. */
export function getDefaultLabel(controlType: ControlType): string {
  switch (controlType) {
    case 'channel-dimmer': return 'Dimmer';
    case 'channel-red': return 'Red';
    case 'channel-green': return 'Green';
    case 'channel-blue': return 'Blue';
    case 'channel-white': return 'White';
    case 'channel-strobe': return 'Strobe';
    case 'channel-other': return 'Channel';
    case 'room-dimmer': return 'Room Dimmer';
    case 'led-dimmer': return 'LED Dimmer';
    case 'color-shift': return 'Color Shift';
    case 'rgb-color': return 'RGB Color';
    case 'fx-strobe': return 'FX Strobe';
    case 'fx-strobe-color': return 'FX Strobe Color';
    case 'fx-breath': return 'FX Breath';
    case 'fx-fire': return 'FX Fire';
    case 'fx-candle': return 'FX Candle';
    case 'fx-twinkle': return 'FX Twinkle';
    case 'playlist': return 'Playlist';
  }
}

// ── Control type groups for the UI dropdown ──────────────────────────────────

export interface ControlTypeOption {
  value: ControlType;
  label: string;
  icon: string;
}

export interface ControlTypeGroup {
  label: string;
  options: ControlTypeOption[];
}

export const CONTROL_TYPE_GROUPS: ControlTypeGroup[] = [
  {
    label: 'Channels',
    options: [
      { value: 'channel-dimmer', label: 'Dimmer', icon: '💡' },
      { value: 'channel-red', label: 'Red', icon: '🔴' },
      { value: 'channel-green', label: 'Green', icon: '🟢' },
      { value: 'channel-blue', label: 'Blue', icon: '🔵' },
      { value: 'channel-white', label: 'White', icon: '⚪' },
      { value: 'channel-strobe', label: 'Strobe', icon: '⚡' },
      { value: 'channel-other', label: 'Other Channel…', icon: '🎛' },
    ],
  },
  {
    label: 'Global / Effects',
    options: [
      { value: 'room-dimmer', label: 'Room Dimmer', icon: '🌙' },
      { value: 'led-dimmer', label: 'LED Dimmer', icon: '🔅' },
      { value: 'color-shift', label: 'Color Shift', icon: '🌈' },
      { value: 'rgb-color', label: 'RGB Color', icon: '🎨' },
    ],
  },
  {
    label: 'FX Triggers',
    options: [
      { value: 'fx-strobe', label: 'Strobe', icon: '⚡' },
      { value: 'fx-strobe-color', label: 'Strobe Color', icon: '🌈' },
      { value: 'fx-breath', label: 'Breath', icon: '🫁' },
      { value: 'fx-fire', label: 'Fire', icon: '🔥' },
      { value: 'fx-candle', label: 'Candle', icon: '🕯️' },
      { value: 'fx-twinkle', label: 'Twinkle', icon: '✨' },
    ],
  },
  {
    label: 'Actions',
    options: [
      { value: 'playlist', label: 'Start Playlist', icon: '▶' },
    ],
  },
];

// ── Store ─────────────────────────────────────────────────────────────────────

interface ControlsStore {
  widgets: ControlWidget[];

  addControl: (widget: ControlWidget) => void;
  removeControl: (id: string) => void;
  updateControl: (id: string, updates: Partial<ControlWidget>) => void;
  /** Bulk-replace all controls (used by file load / undo). */
  setControls: (widgets: ControlWidget[]) => void;

  /**
   * Resolve a widget's FixtureTarget + channel type into actual DMX addresses.
   * Only meaningful for channel-* and rgb-color types.
   */
  getTargetAddresses: (widget: ControlWidget) => number[];

  /**
   * For rgb-color type, resolve to { r, g, b } address groups.
   */
  getTargetRGBAddresses: (widget: ControlWidget) => Array<{ r: number; g: number; b: number }>;
}

/** Get the list of fixture IDs that match a FixtureTarget. */
function resolveTargetFixtureIds(target: FixtureTarget): string[] {
  const allFixtures = useRoomStore.getState().fixtures;

  switch (target.mode) {
    case 'all':
      return allFixtures.map((f) => f.id);
    case 'include':
      return target.fixtureIds;
    case 'exclude':
      return allFixtures
        .filter((f) => !target.fixtureIds.includes(f.id))
        .map((f) => f.id);
    default:
      return [];
  }
}

/** Get DMX addresses for a specific channel type across targeted fixtures, respecting ledIndices. */
function getAddressesForChannelType(fixtureIds: string[], channelType: ChannelType, target: FixtureTarget): number[] {
  const allFixtures = useRoomStore.getState().fixtures;
  const addresses: number[] = [];

  for (const fId of fixtureIds) {
    const fixture = allFixtures.find((f) => f.id === fId);
    if (!fixture) continue;

    const profile = getFixtureProfileById(fixture.profileId);
    const personality = profile?.personalities.find((p) => p.name === fixture.personalityName);
    if (!personality) continue;

    const matchingChannels = personality.channels
      .map((ch, idx) => ({ ch, idx }))
      .filter(({ ch }) => ch.type === channelType);

    const ledFilter = target.ledIndices?.[fId];
    if (ledFilter && (channelType === 'red' || channelType === 'green' || channelType === 'blue')) {
      for (let i = 0; i < matchingChannels.length; i++) {
        if (ledFilter.includes(i)) {
          addresses.push(fixture.startAddress + matchingChannels[i].ch.offset);
        }
      }
    } else {
      for (const { ch } of matchingChannels) {
        addresses.push(fixture.startAddress + ch.offset);
      }
    }
  }

  return addresses;
}

/**
 * Clean up engine-side effects when a control is removed or its type changes.
 * This prevents stale modifiers from persisting in the DMX pipeline.
 */
function cleanupControlEffect(widget: ControlWidget): void {
  if (typeof window.dmx === 'undefined') return;

  switch (widget.controlType) {
    case 'room-dimmer':
      // Reset room dimmer to full brightness
      useRoomStore.getState().setRoomDimmer(255);
      break;

    case 'led-dimmer':
      // Remove LED dimmer modifier from engine
      window.dmx.clearLedDimmer(widget.id);
      break;

    case 'color-shift':
      // Remove color shift modifier from engine
      window.dmx.clearColorShift(widget.id);
      break;

    case 'fx-strobe':
    case 'fx-strobe-color':
    case 'fx-breath':
    case 'fx-fire':
    case 'fx-candle':
    case 'fx-twinkle': {
      // Stop that specific FX type
      const fxType = getFxTypeForControl(type);
      if (fxType) {
        const fxStore = useFxStore.getState();
        fxStore.setFxActive(fxType as any, false);
      }
      break;
    }

    default:
      break;
  }
}

export const useControlsStore = create<ControlsStore>()((set, get) => ({
  widgets: [],

  addControl: (widget) =>
    set((state) => ({ widgets: [...state.widgets, widget] })),

  removeControl: (id) => {
    const widget = get().widgets.find((w) => w.id === id);
    if (widget) cleanupControlEffect(widget);
    set((state) => ({ widgets: state.widgets.filter((w) => w.id !== id) }));
  },

  updateControl: (id, updates) => {
    // If the controlType is changing, clean up the old type's engine-side effects
    if (updates.controlType) {
      const oldWidget = get().widgets.find((w) => w.id === id);
      if (oldWidget && oldWidget.controlType !== updates.controlType) {
        cleanupControlEffect(oldWidget);
      }
    }
    set((state) => ({
      widgets: state.widgets.map((w) =>
        w.id === id ? { ...w, ...updates } : w,
      ),
    }));
  },

  setControls: (widgets) => set({ widgets }),

  getTargetAddresses: (widget) => {
    const channelType = getChannelTypeForControl(widget.controlType, widget.channelSubType);
    if (!channelType) return [];

    const fixtureIds = resolveTargetFixtureIds(widget.target);
    if (channelType === 'red' || channelType === 'green' || channelType === 'blue') {
      // For individual R/G/B, use the standard address resolution
      return getAddressesForChannelType(fixtureIds, channelType, widget.target);
    }
    return getAddressesForChannelType(fixtureIds, channelType, widget.target);
  },

  getTargetRGBAddresses: (widget) => {
    const fixtureIds = resolveTargetFixtureIds(widget.target);
    const allFixtures = useRoomStore.getState().fixtures;
    const results: Array<{ r: number; g: number; b: number }> = [];

    for (const fId of fixtureIds) {
      const fixture = allFixtures.find((f) => f.id === fId);
      if (!fixture) continue;

      const profile = getFixtureProfileById(fixture.profileId);
      const personality = profile?.personalities.find((p) => p.name === fixture.personalityName);
      if (!personality) continue;

      const channels = personality.channels;
      const reds = channels.filter((c) => c.type === 'red');
      const greens = channels.filter((c) => c.type === 'green');
      const blues = channels.filter((c) => c.type === 'blue');

      if (reds.length > 0 && reds.length === greens.length && reds.length === blues.length) {
        const ledFilter = widget.target.ledIndices?.[fId];
        for (let i = 0; i < reds.length; i++) {
          if (ledFilter && !ledFilter.includes(i)) continue;

          results.push({
            r: fixture.startAddress + reds[i].offset,
            g: fixture.startAddress + greens[i].offset,
            b: fixture.startAddress + blues[i].offset,
          });
        }
      }
    }

    return results;
  },
}));
