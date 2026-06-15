/**
 * osbExporter.ts — OrbitShow Binary (.osb) Compiler
 *
 * Transforms OD's ShowFile (one room + embedded fixture profiles) into the
 * compact binary format consumed by OrbitBridgeDeck's standalone firmware.
 *
 * See docs/OrbitShow_Binary_Format.md for the full specification.
 *
 * Format version: 1.0
 */

import type {
  ShowFile,
  FixtureInstance,
  FixtureProfile,
  ChannelType,
  Scene,
  Playlist,
  PalettePlaylist,
  HsbPlaylist,
  FxConfig,
  FxType,
  FixtureTarget,
  ColourPalette,
  ObdControlBinding,
  ObdActionType,
} from './types';

// ============================================================================
// Constants matching show_format.h
// ============================================================================

const OSB_MAGIC = 0x5344424F; // "OBDS" as LE u32
const OSB_VERSION_MAJOR = 1;
const OSB_VERSION_MINOR = 0;
const HEADER_SIZE = 72;

const SECTION_PATCH              = 0x0010;
const SECTION_SCENES             = 0x0020;
const SECTION_SCENE_PLAYLISTS    = 0x0030;
const SECTION_PALETTES           = 0x0040;
const SECTION_PALETTE_GENERATORS = 0x0050;
const SECTION_HSB_GENERATORS     = 0x0060;
const SECTION_FX                 = 0x0070;
const SECTION_CONTROL_BINDINGS   = 0x0080;

// ============================================================================
// Enum mappings (string → u8)
// ============================================================================

const CHANNEL_TYPE_MAP: Record<ChannelType, number> = {
  'generic': 0, 'dimmer': 1, 'red': 2, 'green': 3, 'blue': 4,
  'white': 5, 'amber': 6, 'uv': 7, 'strobe': 8, 'pan': 9,
  'tilt': 10, 'pan-fine': 11, 'tilt-fine': 12, 'color-wheel': 13,
  'gobo': 14, 'speed': 15, 'program': 16, 'macro': 17, 'other': 18,
};

const FX_TYPE_MAP: Record<FxType, number> = {
  'strobe': 0, 'strobeColor': 1, 'breath': 2, 'fire': 3,
  'candle': 4, 'twinkle': 5, 'hueRotator': 6,
};

const SYNC_MODE_MAP: Record<string, number> = {
  'auto': 0, 'manual': 1, 'music': 2,
};

const DIRECTION_MAP: Record<string, number> = {
  'forward': 0, 'backward': 1, 'random': 2,
};

const TARGET_MODE_MAP: Record<string, number> = {
  'all': 0, 'include': 1, 'exclude': 2,
};

const ACTION_MAP: Record<ObdActionType, number> = {
  'none':                0,
  'master-dimmer':       1,
  'hue-shift':           2,
  'blackout-momentary':  3,
  'playlist-startstop':  5,
  'cue-next':            6,
  'cue-prev':            7,
  'tap-tempo':           8,
  'fx-toggle':           9,
  'playlist-speed':      14,
  'playlist-fade':       15,
  'fx-intensity':        16,
  'fx-momentary':        17,
  'fx-speed':            18,
};

// ============================================================================
// Utility helpers
// ============================================================================

/** Convert a float bpmDivider (4, 2, 1, 0.5, 0.25, …) to log2 int. */
function bpmDividerToLog2(divider: number | undefined): number {
  if (!divider || divider <= 0) return 0;
  return Math.round(Math.log2(divider));
}

/** Compute CRC32 (IEEE 802.3, same as zlib). */
function crc32(data: Uint8Array): number {
  let crc = 0xFFFFFFFF;
  for (let i = 0; i < data.length; i++) {
    crc ^= data[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (0xEDB88320 & (-(crc & 1)));
    }
  }
  return (~crc) >>> 0; // unsigned
}

/** Parse "#RRGGBB" hex to [r, g, b]. */
function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16) || 0,
    parseInt(h.substring(2, 4), 16) || 0,
    parseInt(h.substring(4, 6), 16) || 0,
  ];
}

// ============================================================================
// Binary writer — auto-growing buffer
// ============================================================================

class BinaryWriter {
  private buf: ArrayBuffer;
  private view: DataView;
  private _offset = 0;

  constructor(initialSize = 4096) {
    this.buf = new ArrayBuffer(initialSize);
    this.view = new DataView(this.buf);
  }

  get offset(): number { return this._offset; }

  private _ensure(bytes: number) {
    while (this._offset + bytes > this.buf.byteLength) {
      const newBuf = new ArrayBuffer(this.buf.byteLength * 2);
      new Uint8Array(newBuf).set(new Uint8Array(this.buf));
      this.buf = newBuf;
      this.view = new DataView(this.buf);
    }
  }

  u8(v: number) { this._ensure(1); this.view.setUint8(this._offset, v & 0xFF); this._offset += 1; }
  i8(v: number) { this._ensure(1); this.view.setInt8(this._offset, v); this._offset += 1; }
  u16(v: number) { this._ensure(2); this.view.setUint16(this._offset, v & 0xFFFF, true); this._offset += 2; }
  u32(v: number) { this._ensure(4); this.view.setUint32(this._offset, v >>> 0, true); this._offset += 4; }
  bytes(data: Uint8Array) { this._ensure(data.length); new Uint8Array(this.buf, this._offset).set(data); this._offset += data.length; }
  pad(n: number) { this._ensure(n); for (let i = 0; i < n; i++) this.view.setUint8(this._offset + i, 0); this._offset += n; }

  /** Write a fixed-length null-padded string. */
  fixedString(s: string, len: number) {
    const enc = new TextEncoder().encode(s.substring(0, len - 1));
    this._ensure(len);
    new Uint8Array(this.buf, this._offset, len).fill(0);
    new Uint8Array(this.buf, this._offset).set(enc);
    this._offset += len;
  }

  /** Overwrite a u32 at a specific offset (for backpatching). */
  patchU32(offset: number, v: number) {
    this.view.setUint32(offset, v >>> 0, true);
  }

  /** Overwrite a u16 at a specific offset. */
  patchU16(offset: number, v: number) {
    this.view.setUint16(offset, v & 0xFFFF, true);
  }

  toUint8Array(): Uint8Array {
    return new Uint8Array(this.buf, 0, this._offset);
  }
}

// ============================================================================
// Resolved fixture — flattened from profile + instance
// ============================================================================

interface ResolvedFixture {
  startAddress: number;
  channelTypes: number[];  // ChannelType enum ids
  leds: { rOff: number; gOff: number; bOff: number }[];
  strobeValue: number;
  hasStrobe: boolean;
}

function resolveFixture(
  inst: FixtureInstance,
  profiles: FixtureProfile[],
): ResolvedFixture | null {
  const profile = profiles.find(p => p.id === inst.profileId);
  if (!profile) return null;

  const personality = profile.personalities.find(p => p.name === inst.personalityName);
  if (!personality) return null;

  const channelTypes = personality.channels.map(ch =>
    CHANNEL_TYPE_MAP[ch.type] ?? 0,
  );

  // Derive LEDs from equal-count R/G/B channel groups
  const reds   = personality.channels.filter(c => c.type === 'red');
  const greens = personality.channels.filter(c => c.type === 'green');
  const blues  = personality.channels.filter(c => c.type === 'blue');

  const leds: ResolvedFixture['leds'] = [];
  if (reds.length > 0 && reds.length === greens.length && reds.length === blues.length) {
    for (let i = 0; i < reds.length; i++) {
      leds.push({
        rOff: reds[i].offset,
        gOff: greens[i].offset,
        bOff: blues[i].offset,
      });
    }
  }

  // Find strobe channel
  const strobeCh = personality.channels.find(c => c.type === 'strobe');
  const hasStrobe = !!strobeCh;
  const strobeValue = strobeCh ? strobeCh.maxValue : 0;

  return { startAddress: inst.startAddress, channelTypes, leds, strobeValue, hasStrobe };
}

// ============================================================================
// Section serializers
// ============================================================================

function serializePatch(w: BinaryWriter, fixtures: ResolvedFixture[]) {
  w.u16(fixtures.length);
  for (const f of fixtures) {
    w.u16(f.startAddress);
    w.u8(0);  // universe
    w.u8(f.channelTypes.length);
    w.u8(f.hasStrobe ? 0x01 : 0x00);
    w.u8(f.strobeValue);
    for (const ct of f.channelTypes) w.u8(ct);
    w.u8(f.leds.length);
    for (const led of f.leds) {
      w.u8(led.rOff);
      w.u8(led.gOff);
      w.u8(led.bOff);
    }
  }
}

function serializeScenes(
  w: BinaryWriter,
  scenes: Scene[],
  fixtures: FixtureInstance[],
) {
  w.u16(scenes.length);
  for (const scene of scenes) {
    // Build sparse channel/value pairs — only channels owned by room fixtures
    const pairs: { channel: number; value: number }[] = [];
    for (const f of fixtures) {
      for (let offset = 0; offset < f.channelCount; offset++) {
        const ch = f.startAddress + offset; // 1-based
        const val = scene.values[ch - 1];   // values is 0-indexed
        if (val !== undefined && val !== 0) {
          pairs.push({ channel: ch, value: val });
        }
      }
    }

    w.u16(pairs.length);
    for (const p of pairs) {
      w.u16(p.channel);
      w.u8(p.value);
    }
  }
}

function serializeScenePlaylists(
  w: BinaryWriter,
  playlists: Playlist[],
  sceneIdToIndex: Map<string, number>,
) {
  w.u16(playlists.length);
  for (const pl of playlists) {
    w.u8(SYNC_MODE_MAP[pl.syncMode] ?? 0);
    w.u8(DIRECTION_MAP[pl.playDirection] ?? 0);
    const flags = (pl.bpmSync ? 0x01 : 0x00);
    w.u8(flags);
    w.i8(bpmDividerToLog2(pl.bpmDivider));
    w.u16(pl.fadeDurationMs);
    w.u16(pl.holdDurationMs);
    w.u16(pl.cues.length);
    for (const cue of pl.cues) {
      const idx = sceneIdToIndex.get(cue.sceneId) ?? 0;
      w.u16(idx);
    }
  }
}

function serializePalettes(w: BinaryWriter, palettes: ColourPalette[]) {
  w.u16(palettes.length);
  for (const pal of palettes) {
    w.u8(pal.colours.length);
    for (const hex of pal.colours) {
      const [r, g, b] = hexToRgb(hex);
      w.u8(r); w.u8(g); w.u8(b);
    }
  }
}

function serializeFixtureTarget(
  w: BinaryWriter,
  target: FixtureTarget,
  fixtureIdToIndex: Map<string, number>,
) {
  w.u8(TARGET_MODE_MAP[target.mode] ?? 0);

  // Fixture indices
  const fixtureIndices = target.fixtureIds
    .map(id => fixtureIdToIndex.get(id))
    .filter((idx): idx is number => idx !== undefined);
  w.u16(fixtureIndices.length);
  for (const idx of fixtureIndices) w.u16(idx);

  // LED sub-filters
  const ledFilters: { fixtureIndex: number; ledIndices: number[] }[] = [];
  if (target.ledIndices) {
    for (const [fId, indices] of Object.entries(target.ledIndices)) {
      const fIdx = fixtureIdToIndex.get(fId);
      if (fIdx !== undefined && indices.length > 0) {
        ledFilters.push({ fixtureIndex: fIdx, ledIndices: indices });
      }
    }
  }
  w.u16(ledFilters.length);
  for (const lf of ledFilters) {
    w.u16(lf.fixtureIndex);
    w.u8(lf.ledIndices.length);
    for (const li of lf.ledIndices) w.u8(li);
  }
}

function serializePaletteGenerators(
  w: BinaryWriter,
  generators: PalettePlaylist[],
  paletteIdToIndex: Map<string, number>,
  fixtureIdToIndex: Map<string, number>,
) {
  w.u16(generators.length);
  for (const gen of generators) {
    w.u16(paletteIdToIndex.get(gen.paletteId) ?? 0);
    w.u8(SYNC_MODE_MAP[gen.syncMode] ?? 0);
    w.u8(DIRECTION_MAP[gen.playDirection] ?? 0);
    const flags = (gen.bpmSync ? 0x01 : 0x00);
    w.u8(flags);
    w.i8(bpmDividerToLog2(gen.bpmDivider));
    w.u16(gen.holdMs);
    w.u16(gen.fadeMs);
    serializeFixtureTarget(w, gen.target, fixtureIdToIndex);
  }
}

function serializeHsbGenerators(
  w: BinaryWriter,
  generators: HsbPlaylist[],
  fixtureIdToIndex: Map<string, number>,
) {
  w.u16(generators.length);
  for (const gen of generators) {
    w.u16(gen.hueCenter);
    w.u16(gen.hueWidth);
    w.u8(gen.saturation.min);
    w.u8(gen.saturation.max);
    w.u8(gen.brightness.min);
    w.u8(gen.brightness.max);
    w.u8(SYNC_MODE_MAP[gen.syncMode] ?? 0);
    w.u8(DIRECTION_MAP[gen.playDirection ?? 'forward'] ?? 0);
    const flags = (gen.bpmSync ? 0x01 : 0x00);
    w.u8(flags);
    w.i8(bpmDividerToLog2(gen.bpmDivider));
    w.u16(gen.holdMs);
    w.u16(gen.fadeMs);
    serializeFixtureTarget(w, gen.target, fixtureIdToIndex);
  }
}

function serializeFx(
  w: BinaryWriter,
  fxConfigs: FxConfig[],
  fixtureIdToIndex: Map<string, number>,
  fxTargets: Map<FxType, FixtureTarget>,
) {
  w.u8(fxConfigs.length);
  for (const fx of fxConfigs) {
    w.u8(FX_TYPE_MAP[fx.type] ?? 0);
    let flags = 0;
    if (fx.active)          flags |= 0x01;
    if (fx.syncToBpm)       flags |= 0x02;
    if (fx.quantiseStrobe)  flags |= 0x04;
    w.u8(flags);
    w.u8(fx.speed);
    w.u8(fx.intensity);
    w.u8(fx.color?.[0] ?? 255);
    w.u8(fx.color?.[1] ?? 255);
    w.u8(fx.color?.[2] ?? 255);
    w.u8(fx.fadeSpeed ?? 50);
    w.u8(fx.randomness ?? 50);
    w.u8(fx.amount ?? 50);
    w.u16(fx.rotatePeriodMs ?? 4000);
    w.i8(bpmDividerToLog2(fx.tempoDivider));

    // Target for this FX type
    const target = fxTargets.get(fx.type) ?? { mode: 'all' as const, fixtureIds: [] };
    serializeFixtureTarget(w, target, fixtureIdToIndex);
  }
}
// ============================================================================
// Control Bindings (section 0x0080)
// ============================================================================

/**
 * Serialize OBD control bindings to binary.
 * Per binding (8 bytes):
 *   physical_control: u8   (0–5 = button, 6–7 = slider)
 *   action:           u8   (osb_action_t enum value)
 *   param_a:          u16  (FX type index for fx-toggle/fx-intensity, 0 otherwise)
 *   flags:            u8   (reserved)
 *   led_r:            u8
 *   led_g:            u8
 *   led_b:            u8
 */
function serializeControlBindings(
  w: BinaryWriter,
  bindings: ObdControlBinding[],
): void {
  w.u8(bindings.length);  // binding_count
  for (const b of bindings) {
    w.u8(b.physicalControl);
    w.u8(ACTION_MAP[b.action] ?? 0);
    // param_a: FX type index for FX-related actions
    const isFxAction = b.action === 'fx-toggle' || b.action === 'fx-momentary'
      || b.action === 'fx-intensity' || b.action === 'fx-speed';
    const paramA = isFxAction
      ? (FX_TYPE_MAP[b.fxType ?? 'strobe'] ?? 0)
      : 0;
    w.u16(paramA);
    w.u8(0);  // flags (reserved)
    // LED colour
    const led = b.ledColor ?? [0, 0, 0];
    w.u8(led[0]);
    w.u8(led[1]);
    w.u8(led[2]);
  }
}

// ============================================================================
// Main export function
// ============================================================================

export interface CompileOptions {
  /** Show name (≤31 chars). */
  name: string;
  /** Default BPM. */
  bpm: number;
  /** Active FX configurations. */
  fxConfigs?: FxConfig[];
  /** Per-FX fixture targets. */
  fxTargets?: Map<FxType, FixtureTarget>;
  /** Base scene ID (background scene for non-targeted spots). null/undefined = none. */
  baseSceneId?: string | null;
}

/**
 * Compile an OD ShowFile (one room) into a binary .osb.
 *
 * @param show       The ShowFile to compile
 * @param options    Additional metadata (name, BPM, FX state)
 * @returns          The compiled .osb as a Uint8Array
 */
export function compileShow(show: ShowFile, options: CompileOptions): Uint8Array {
  const room = show.room;
  const profiles = show.fixtureProfiles;
  const fixtures = room.fixtures;

  // --- Build index maps (UUID → compact 0-based index) ---
  const fixtureIdToIndex = new Map<string, number>();
  fixtures.forEach((f, i) => fixtureIdToIndex.set(f.id, i));

  const sceneIdToIndex = new Map<string, number>();
  room.scenes.forEach((s, i) => sceneIdToIndex.set(s.id, i));

  const paletteIdToIndex = new Map<string, number>();
  (room.colourPalettes ?? []).forEach((p, i) => paletteIdToIndex.set(p.id, i));

  // --- Resolve fixtures ---
  const resolvedFixtures: ResolvedFixture[] = [];
  for (const inst of fixtures) {
    const rf = resolveFixture(inst, profiles);
    if (rf) resolvedFixtures.push(rf);
  }

  // --- Serialize each section into separate buffers ---
  const sections: { type: number; data: Uint8Array }[] = [];

  // PATCH
  const patchWriter = new BinaryWriter();
  serializePatch(patchWriter, resolvedFixtures);
  sections.push({ type: SECTION_PATCH, data: patchWriter.toUint8Array() });

  // SCENES
  if (room.scenes.length > 0) {
    const scenesWriter = new BinaryWriter();
    serializeScenes(scenesWriter, room.scenes, fixtures);
    sections.push({ type: SECTION_SCENES, data: scenesWriter.toUint8Array() });
  }

  // SCENE_PLAYLISTS
  // Reorder so the selected standalone playlist (if any) is at index 0
  let playlists = [...room.playlists];
  const selectedPlId = room.obdStandalone?.selectedPlaylistId;
  let isSelectedAGenPlaylist = false;
  if (selectedPlId) {
    const selIdx = playlists.findIndex(p => p.id === selectedPlId);
    if (selIdx > 0) {
      const [selected] = playlists.splice(selIdx, 1);
      playlists.unshift(selected);
    } else if (selIdx < 0) {
      // Selected playlist not found in scene playlists — it's a generator playlist
      isSelectedAGenPlaylist = true;
    }
  }
  // When a gen is the selected playlist, omit scene playlists from the binary
  // so the firmware has playlist_count=0 and only the base scene plays.
  if (playlists.length > 0 && !isSelectedAGenPlaylist) {
    const plWriter = new BinaryWriter();
    serializeScenePlaylists(plWriter, playlists, sceneIdToIndex);
    sections.push({ type: SECTION_SCENE_PLAYLISTS, data: plWriter.toUint8Array() });
  }

  // PALETTES — always include (needed by palette generators)
  if (room.colourPalettes && room.colourPalettes.length > 0) {
    const palWriter = new BinaryWriter();
    serializePalettes(palWriter, room.colourPalettes);
    sections.push({ type: SECTION_PALETTES, data: palWriter.toUint8Array() });
  }

  // When a generator is the selected playlist, only include THAT generator.
  // Otherwise both run and the last one overwrites the other.
  const selectedPalGen = isSelectedAGenPlaylist
    ? (room.paletteGenerators ?? []).find(g => g.id === selectedPlId)
    : undefined;
  const selectedHsbGen = isSelectedAGenPlaylist
    ? (room.hsbGenerators ?? []).find(g => g.id === selectedPlId)
    : undefined;

  // PALETTE_GENERATORS
  const palGensToExport = selectedPalGen ? [selectedPalGen]
    : (!isSelectedAGenPlaylist && room.paletteGenerators?.length) ? room.paletteGenerators
    : [];
  if (palGensToExport.length > 0) {
    const pgWriter = new BinaryWriter();
    serializePaletteGenerators(pgWriter, palGensToExport, paletteIdToIndex, fixtureIdToIndex);
    sections.push({ type: SECTION_PALETTE_GENERATORS, data: pgWriter.toUint8Array() });
  }

  // HSB_GENERATORS
  const hsbGensToExport = selectedHsbGen ? [selectedHsbGen]
    : (!isSelectedAGenPlaylist && room.hsbGenerators?.length) ? room.hsbGenerators
    : [];
  if (hsbGensToExport.length > 0) {
    const hgWriter = new BinaryWriter();
    serializeHsbGenerators(hgWriter, hsbGensToExport, fixtureIdToIndex);
    sections.push({ type: SECTION_HSB_GENERATORS, data: hgWriter.toUint8Array() });
  }

  // FX
  if (options.fxConfigs && options.fxConfigs.length > 0) {
    const fxWriter = new BinaryWriter();
    serializeFx(fxWriter, options.fxConfigs, fixtureIdToIndex, options.fxTargets ?? new Map());
    sections.push({ type: SECTION_FX, data: fxWriter.toUint8Array() });
  }

  // CONTROL_BINDINGS
  const obdConfig = show.room.obdStandalone;
  if (obdConfig && obdConfig.bindings.some(b => b.action !== 'none')) {
    const cbWriter = new BinaryWriter();
    serializeControlBindings(cbWriter, obdConfig.bindings);
    sections.push({ type: SECTION_CONTROL_BINDINGS, data: cbWriter.toUint8Array() });
  }

  // --- Compute section directory ---
  const dirSize = sections.length * 10;
  let dataOffset = HEADER_SIZE + dirSize;

  const sectionEntries: { type: number; offset: number; length: number }[] = [];
  for (const s of sections) {
    sectionEntries.push({ type: s.type, offset: dataOffset, length: s.data.length });
    dataOffset += s.data.length;
  }

  // --- Assemble the final binary ---
  const totalSize = dataOffset + 4; // +4 for CRC32 trailer
  const out = new BinaryWriter(totalSize);

  // Header (72 bytes)
  out.u32(OSB_MAGIC);
  out.u8(OSB_VERSION_MAJOR);
  out.u8(OSB_VERSION_MINOR);
  // Flags
  let headerFlags = 0;
  if (isSelectedAGenPlaylist) {
    headerFlags |= 0x0002;  // NO_AUTO_PLAYLIST — don't auto-start scene playlist 0
    headerFlags |= 0x0004;  // GENS_ACTIVE — run palette/HSB generators
  }
  out.u16(headerFlags);
  out.u16(Math.round(options.bpm * 100));  // bpm_centi
  // base_scene_index: resolve scene ID to index, 0xFFFF = none
  const baseSceneIndex = options.baseSceneId
    ? sceneIdToIndex.get(options.baseSceneId) ?? 0xFFFF
    : 0xFFFF;
  out.u16(baseSceneIndex);  // base_scene_index
  out.fixedString(options.name, 32);
  out.u16(sections.length);  // section_count
  out.u16(0);  // reserved1
  out.pad(24); // reserved2

  // Section directory
  for (const entry of sectionEntries) {
    out.u16(entry.type);
    out.u32(entry.offset);
    out.u32(entry.length);
  }

  // Section payloads
  for (const s of sections) {
    out.bytes(s.data);
  }

  // CRC32 trailer
  const payload = out.toUint8Array();
  const crcValue = crc32(payload);
  out.u32(crcValue);

  return out.toUint8Array();
}
