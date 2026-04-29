import type { SceneState } from './constants';

// ─── Rig / Fixture types ─────────────────────────────────────────────────────

export interface ChannelDefinition {
  offset: number;        // 0-based offset from fixture start address
  name: string;          // e.g. "Red", "Master Dimmer"
  type: ChannelType;
  minValue: number;      // usually 0
  maxValue: number;      // usually 255
  defaultValue: number;
  notes?: string;        // optional: documents value ranges for special channels
}

export type ChannelType =
  | 'dimmer'
  | 'red'
  | 'green'
  | 'blue'
  | 'white'
  | 'amber'
  | 'uv'
  | 'strobe'
  | 'pan'
  | 'tilt'
  | 'pan-fine'
  | 'tilt-fine'
  | 'color-wheel'
  | 'gobo'
  | 'speed'
  | 'program'
  | 'macro'
  | 'other'
  | 'generic';

export interface RigPersonality {
  name: string;           // e.g. "3-channel RGB", "6-channel extended"
  channelCount: number;
  channels: ChannelDefinition[];
}

export interface Rig {
  id: string;             // slug, e.g. "ayra-compar-jr"
  brand: string;
  model: string;
  defaultPersonality?: string;  // name of the personality to select by default
  personalities: RigPersonality[];
}

// ─── Room types ──────────────────────────────────────────────────────────────

export interface FixtureInstance {
  id: string;             // uuid
  rigId: string;          // references Rig.id
  personalityName: string;
  channelCount: number;   // cached from personality — used for conflict detection
  label: string;          // user-given name, e.g. "Stage Left Par"
  startAddress: number;   // 1–512
  universe: number;       // 0-indexed (future: multi-universe)
  // Floor plan position (meters from top-left corner of room)
  x?: number;
  y?: number;
  rotation?: number; // degrees, increments of 45
}

export interface FloorPlanDimensions {
  widthM: number;   // room width in meters
  depthM: number;   // room depth in meters
}

export interface Room {
  id: string;
  name: string;
  fixtures: FixtureInstance[];
  floorPlan?: FloorPlanDimensions;
}

// ─── Scene types ─────────────────────────────────────────────────────────────

/** Full 512-channel snapshot. Index = channel - 1 (0-based). */
export type UniverseSnapshot = number[];   // length 512, values 0–255

export interface Scene {
  id: string;
  roomId: string;
  name: string;
  values: UniverseSnapshot;  // only channels owned by this room's fixtures matter
}

// ─── Cue / Playlist types ────────────────────────────────────────────────────

export interface Cue {
  id: string;
  sceneId: string;
}

export type PlaylistSyncMode = 'auto' | 'manual' | 'music';
export type PlayDirection = 'forward' | 'backward' | 'random';

export interface Playlist {
  id: string;
  roomId: string;
  name: string;
  cues: Cue[];
  syncMode: PlaylistSyncMode;
  playDirection: PlayDirection;
  fadeDurationMs: number;      // crossfade time (all modes)
  holdDurationMs: number;      // auto mode: how long each scene holds before advancing
  audioGain: number;           // music mode: microphone input gain (0–100)
  audioThreshold: number;      // music mode: beat detection threshold (0–100)
  audioCooldown?: number;      // music mode: minimum ms between triggers (default 300)
}

// ─── FX types ─────────────────────────────────────────────────────────────────

export type FxType = 'strobe' | 'strobeColor' | 'breath' | 'fire' | 'candle' | 'twinkle';

export interface FxConfig {
  type: FxType;
  active: boolean;
  speed: number;                      // 0–100 (mapped per effect)
  intensity: number;                  // 0–100 (depth/amount)
  color?: [number, number, number];   // RGB for strobeColor
  fadeSpeed?: number;                 // 0–100 twinkle fade-out speed
  randomness?: number;                // 0–100 twinkle timing randomness
  amount?: number;                    // 0–100 twinkle: max LEDs that can trigger per tick
}

/** Describes one LED's RGB channel addresses (1-indexed DMX). */
export interface LedAddress {
  r: number;
  g: number;
  b: number;
}

// ─── Fixture targeting (shared by Controls & FX) ──────────────────────────────

/** Defines which fixtures/LEDs a control or effect targets. */
export interface FixtureTarget {
  mode: 'all' | 'include' | 'exclude';
  fixtureIds: string[];  // referenced FixtureInstance.id values
  /**
   * Optional per-fixture LED index filtering.
   * Keys are fixture IDs, values are arrays of 0-based LED indices to include.
   * If a fixture ID is absent from this map, ALL its LEDs are included.
   * Example: { "fixture-abc": [0, 2] } → only LED 1 and LED 3 of that fixture.
   */
  ledIndices?: Record<string, number[]>;
}

// ─── Controls types ───────────────────────────────────────────────────────────

/**
 * Control type determines what action the control performs AND which widget
 * is rendered (slider, button, or color-wheel). The user picks the type and
 * the widget follows automatically.
 */
export type ControlType =
  // Channel controls (slider 0–255)
  | 'channel-dimmer'
  | 'channel-red'
  | 'channel-green'
  | 'channel-blue'
  | 'channel-white'
  | 'channel-strobe'
  | 'channel-other'     // sub-type picker for pan, tilt, speed, gobo, etc.
  // Global / after-effect controls (slider)
  | 'room-dimmer'       // master fader, scales all output
  | 'led-dimmer'        // proportional RGBW dimmer for targeted LEDs
  | 'color-shift'       // hue rotation on targeted RGB values (0–360°)
  // Color control (color wheel)
  | 'rgb-color'         // sets R/G/B on targets
  // FX triggers (button)
  | 'fx-strobe'         // momentary: hold to strobe
  | 'fx-strobe-color'   // momentary: hold to strobe color
  | 'fx-breath'         // toggle: start/stop
  | 'fx-fire'           // toggle: start/stop
  | 'fx-candle'         // toggle: start/stop
  | 'fx-twinkle'        // toggle: start/stop
  // Action triggers (button)
  | 'playlist';         // toggle: start/stop a specific playlist

/** Determines what UI widget to render for a control type. */
export type WidgetKind = 'slider' | 'button' | 'color-wheel';

export interface ControlWidget {
  id: string;                    // uuid
  controlType: ControlType;
  label: string;                 // user-given name, e.g. "Front Wash Color"

  // Which fixtures this control targets (not used by room-dimmer / playlist)
  target: FixtureTarget;

  // For 'channel-other': which specific channel type to control
  channelSubType?: ChannelType;

  // For 'playlist': which playlist to trigger
  playlistId?: string;

  // Current value state
  value: number;                 // 0–255 for sliders, 0 or 255 for buttons
  colorValue?: [number, number, number];  // RGB for color-wheel type

  // MIDI mapping (optional — not available for rgb-color)
  midi?: {
    channel: number;   // 1–16
    cc: number;        // 0–127 (Control Change number)
    deviceName?: string; // optional: restrict to a specific MIDI device
  };
}

export interface ControlsLayout {
  widgets: ControlWidget[];
}

// ─── IPC response wrapper ─────────────────────────────────────────────────────

export interface IpcResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ─── Hardware status ─────────────────────────────────────────────────────────

export type SerialStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
}

// ─── Runner state ─────────────────────────────────────────────────────────────

export interface RunnerStatus {
  state: SceneState;
  playlistId?: string;
  currentCueIndex?: number;
  sceneId?: string;
}

// ─── Room file persistence ────────────────────────────────────────────────────

export interface RoomFile {
  orbitdmx: string;           // schema version, e.g. "1.0"
  room: {
    id: string;
    name: string;
    fixtures: FixtureInstance[];
    floorPlan?: FloorPlanDimensions;
    scenes: Scene[];
    playlists: Playlist[];
    controls?: ControlsLayout;  // v1.2: configurable control surface
  };
}

// ─── Show file (portable bundle) ──────────────────────────────────────────────

export interface ShowFile {
  orbitshow: string;           // schema version, e.g. "1.0"
  room: RoomFile['room'];
  rigs: Rig[];                 // embedded copies of all referenced rig definitions
}
