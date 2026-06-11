import type { SceneState } from './constants';

// ─── Colour types (shared so RoomFile can reference them) ─────────────────────

export interface ColourPreset {
  id: string;
  name: string;
  hex: string; // 6-char hex, e.g. "#f5a023"
}

export interface ColourPalette {
  id: string;
  name: string;
  /** Ordered list of hex colours */
  colours: string[];
}

// ─── Fixture Profile types ─────────────────────────────────────────────────────

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

export interface FixturePersonality {
  name: string;           // e.g. "3-channel RGB", "6-channel extended"
  channelCount: number;
  channels: ChannelDefinition[];
}

export interface FixtureProfile {
  id: string;             // slug, e.g. "ayra-compar-jr"
  brand: string;
  model: string;
  defaultPersonality?: string;  // name of the personality to select by default
  personalities: FixturePersonality[];
}

// ─── Room types ──────────────────────────────────────────────────────────────

export interface FixtureInstance {
  id: string;             // uuid
  profileId: string;      // references FixtureProfile.id
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
  kind?: 'scene';            // optional discriminant — absent = 'scene' for backward compat
  cues: Cue[];
  syncMode: PlaylistSyncMode;
  playDirection: PlayDirection;
  fadeDurationMs: number;      // crossfade time (all modes)
  holdDurationMs: number;      // auto mode: how long each scene holds before advancing
  bpmSync?: boolean;           // auto mode: sync hold to global BPM
  bpmDivider?: number;         // auto mode + bpmSync: beat multiplier (4, 2, 1, 0.5…)
  audioGain: number;           // music mode: microphone input gain (0–100)
  audioThreshold: number;      // music mode: beat detection threshold (0–100)
  audioCooldown?: number;      // music mode: minimum ms between triggers (default 300)
}

// ─── Palette Playlist types ────────────────────────────────────────────────────

/**
 * A Palette Generator playlist — cycles through the colours of a named
 * ColourPalette and writes them to targeted fixture LEDs with crossfade.
 * Uses the same syncMode system as Scene Playlists.
 * Session-only (not persisted to room file).
 */
export interface PalettePlaylist {
  id: string;
  roomId: string;
  name: string;
  kind: 'palette';           // discriminant

  paletteId: string;         // references ColourPalette.id

  // Mode — same three as scene playlists for a uniform UI
  syncMode: PlaylistSyncMode; // 'auto' | 'manual' | 'music'

  // Auto mode timing
  holdMs: number;            // manual hold duration ms (after fade completes)
  bpmSync: boolean;          // auto mode: sync hold to global BPM
  bpmDivider: number;        // auto mode + bpmSync: beat multiplier (4, 2, 1, 0.5…)

  // Crossfade
  fadeMs: number;            // 0 = snap, >0 = crossfade duration ms

  // Music mode
  audioGain: number;         // microphone input gain (0–100)
  audioThreshold: number;    // beat detection threshold (0–100)
  audioCooldown?: number;    // minimum ms between triggers (default 300)

  // Playback order
  playDirection: PlayDirection;

  // Fixture targeting
  target: FixtureTarget;
}

// ─── HSB Playlist types ────────────────────────────────────────────────────────

/** A min/max range for a single HSB channel. */
export interface HsbRange {
  min: number;
  max: number;
}

/**
 * An HSB Generator playlist — on every step each spot receives its own
 * independently randomised colour, constrained by min/max Hue (0–360),
 * Saturation (0–100), and Brightness (0–100) ranges.
 * Session-only (not persisted to room file).
 */
export interface HsbPlaylist {
  id: string;
  roomId: string;
  name: string;
  kind: 'hsb';               // discriminant

  // HSB colour constraints
  hueCenter: number;   // 0–360 centre of the hue arc
  hueWidth:  number;   // 0–360 total arc span (0 = one colour, 360 = all hues)
  saturation: HsbRange;      // percentage 0–100
  brightness: HsbRange;      // percentage 0–100

  // Mode — same three as other generators
  syncMode: PlaylistSyncMode;

  // Auto mode timing
  holdMs:     number;        // ms between steps (non-BPM)
  bpmSync:    boolean;       // derive hold from global BPM
  bpmDivider: number;        // beat multiplier (4, 2, 1, 0.5…)

  // Crossfade
  fadeMs: number;            // 0 = snap, >0 = crossfade duration ms

  // Music mode
  audioGain:      number;    // microphone gain (0–100)
  audioThreshold: number;    // beat detection threshold (0–100)
  audioCooldown?: number;    // min ms between triggers (default 300)

  // Fixture targeting
  target: FixtureTarget;
}

// ─── FX types ─────────────────────────────────────────────────────────────────

export type FxType = 'strobe' | 'strobeColor' | 'breath' | 'fire' | 'candle' | 'twinkle' | 'hueRotator';

export interface FxConfig {
  type: FxType;
  active: boolean;
  speed: number;                      // 0–100 (mapped per effect)
  intensity: number;                  // 0–100 (depth/amount)
  color?: [number, number, number];   // RGB for strobeColor
  fadeSpeed?: number;                 // 0–100 twinkle fade-out speed
  randomness?: number;                // 0–100 twinkle timing randomness
  amount?: number;                    // 0–100 twinkle: max LEDs that can trigger per tick

  // ── Tempo sync ──────────────────────────────────────────────────────────
  /** When true, timing is derived from globalBpm + tempoDivider instead of speed 0–100. */
  syncToBpm?: boolean;
  /**
   * Beat multiplier that controls the effect period relative to one beat.
   * 4 = 4 bars, 2 = 2 bars, 1 = 1/1, 0.5 = 1/2, 0.25 = 1/4,
   * 0.125 = 1/8, 0.0625 = 1/16, 0.03125 = 1/32
   */
  tempoDivider?: number;
  /** Current global BPM — included in the config so the engine needs no separate call. */
  globalBpm?: number;

  // ── Strobe quantisation ──────────────────────────────────────────────────
  /**
   * When true, the strobe period is snapped to the nearest multiple of 50ms
   * (2 × DMX frame = 25ms). This guarantees a perfectly symmetric ON/OFF
   * pattern with no frame-level jitter.
   * Only relevant for 'strobe' and 'strobeColor'.
   */
  quantiseStrobe?: boolean;

  // ── Hue Rotator ──────────────────────────────────────────────────────────────
  /**
   * Period for one full 360° hue rotation in milliseconds.
   * Ignored when syncToBpm is true (BPM period used instead).
   */
  rotatePeriodMs?: number;
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

// DMX output protocol
export type DmxOutputMode = 'baudRateBreak' | 'enttecOpen' | 'enttecPro' | 'eurolite';

export type SerialStatus = 'disconnected' | 'connecting' | 'connected' | 'error' | 'reconnecting';


export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  /** Best-guess protocol hint derived from VID/PID + manufacturer string. */
  detectedMode?: DmxOutputMode;
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
    colourPresets?: ColourPreset[];      // v1.3: custom preset swatches
    colourPalettes?: ColourPalette[];    // v1.3: named colour palettes
    paletteGenerators?: PalettePlaylist[]; // v1.3: palette generator playlists
    hsbGenerators?: HsbPlaylist[];        // v1.3: HSB generator playlists
  };
}

// ─── Show file (portable bundle) ──────────────────────────────────────────────

export interface ShowFile {
  orbitshow: string;           // schema version, e.g. "1.0"
  room: RoomFile['room'];
  fixtureProfiles: FixtureProfile[];                 // embedded copies of all referenced fixture profiles
}

// ─── OBD push progress ────────────────────────────────────────────────────────

export interface ObdProgress {
  phase: 'compiled' | 'uploading' | 'done' | 'error';
  progress: number;  // 0.0–1.0
  error?: string;
}
