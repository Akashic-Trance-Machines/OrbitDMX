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
}

export interface Room {
  id: string;
  name: string;
  fixtures: FixtureInstance[];
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
