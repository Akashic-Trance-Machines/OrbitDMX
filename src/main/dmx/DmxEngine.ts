import { DmxUniverse } from './DmxUniverse';
import { FxProcessor } from './FxProcessor';
import { UsbDmxDriver } from '../serial/UsbDmxDriver';
import { UsbBulkDmxDriver, isUsbBulkPath } from '../serial/UsbBulkDmxDriver';
import { DMX_TICK_INTERVAL_MS, SCENE_STATE } from '../../shared/constants';
import type { RunnerStatus, Scene, SerialStatus, FxConfig, LedAddress } from '../../shared/types';
import type { SceneState } from '../../shared/constants';

type UniverseUpdateCallback = (snapshot: number[]) => void;
type RunnerStateCallback = (status: RunnerStatus) => void;
type SerialStatusCallback = (status: SerialStatus) => void;

/**
 * DmxEngine — the heart of the application (main process only).
 *
 * Responsibilities:
 * - Owns the DmxUniverse (live buffer)
 * - Drives the hardware tick loop at 40 Hz
 * - Manages fade transitions between scenes
 * - Emits push events to the renderer via registered callbacks
 */
export class DmxEngine {
  private readonly universe: DmxUniverse;
  private readonly serialDriver: UsbDmxDriver;
  private readonly bulkDriver: UsbBulkDmxDriver;

  /** Which driver is currently active (changes on connect). */
  private activeDriver: UsbDmxDriver | UsbBulkDmxDriver | null = null;

  private tickRunning = false;

  // Fade state
  private fadeFromSnapshot: number[] | null = null;
  private fadeToSnapshot: number[] | null = null;
  private fadeStartTime: number = 0;
  private fadeDurationMs: number = 0;

  // Room dimmer (0–255, default 255 = full brightness)
  // Applied as a global multiplier to ALL channels before hardware output.
  private roomDimmer: number = 255;
  private dimmerAddresses: Set<number> = new Set();

  // Color shift modifiers (per control id)
  // Each entry rotates the hue of targeted RGB triplets by N degrees.
  private colorShiftModifiers: Map<string, { addresses: Array<{ r: number; g: number; b: number }>; degrees: number }> = new Map();

  // LED dimmer modifiers (per control id)
  // Each entry scales targeted color channels by a factor (0–1).
  private ledDimmerModifiers: Map<string, { addresses: number[]; factor: number }> = new Map();

  // FX processor
  private readonly fxProcessor = new FxProcessor();

  // Runner state
  private runnerState: SceneState = SCENE_STATE.IDLE;
  private currentSceneId: string | undefined;

  // Callbacks (main → renderer push)
  private onUniverseUpdate: UniverseUpdateCallback | null = null;
  private onRunnerState: RunnerStateCallback | null = null;
  private onSerialStatus: SerialStatusCallback | null = null;

  // Current serial status (tracked locally so we can answer getSerialStatus queries)
  private currentSerialStatus: SerialStatus = 'disconnected';

  constructor() {
    this.universe = new DmxUniverse();
    this.serialDriver = new UsbDmxDriver();
    this.bulkDriver = new UsbBulkDmxDriver();

    // Forward status events from both drivers
    const onStatus = (status: SerialStatus) => {
      this.currentSerialStatus = status;
      this.onSerialStatus?.(status);
    };
    this.serialDriver.onStatusChange(onStatus);
    this.bulkDriver.onStatusChange(onStatus);
  }

  // ── Serial control ─────────────────────────────────────────────────────────

  async listPorts() {
    // Merge serial ports + USB bulk devices
    const [serialPorts, bulkPorts] = await Promise.all([
      this.serialDriver.listPorts(),
      this.bulkDriver.listPorts(),
    ]);
    return [...bulkPorts, ...serialPorts]; // USB bulk first (more likely for this user)
  }

  async connect(path: string): Promise<void> {
    const driver = isUsbBulkPath(path) ? this.bulkDriver : this.serialDriver;
    this.activeDriver = driver;
    await driver.connect(path);
    this.startTick();
  }

  async disconnect(): Promise<void> {
    this.stopTick();
    await this.activeDriver?.disconnect();
    this.activeDriver = null;
  }

  get isConnected(): boolean {
    return this.activeDriver?.isConnected ?? false;
  }

  getSerialStatus(): SerialStatus {
    return this.currentSerialStatus;
  }

  getConnectedPort(): string | null {
    return this.activeDriver?.currentPath ?? null;
  }

  // ── DMX control ────────────────────────────────────────────────────────────

  /** Instantly apply a scene (no fade). */
  playScene(scene: Scene): void {
    this.cancelFade();
    this.universe.applySnapshot(scene.values);
    this.currentSceneId = scene.id;
    this.setRunnerState(SCENE_STATE.PLAYING);
  }

  /** Start a linear fade from the current state to the target scene. */
  fadeToScene(scene: Scene, durationMs: number): void {
    this.fadeFromSnapshot = this.universe.getSnapshot();
    this.fadeToSnapshot = scene.values;
    this.fadeDurationMs = durationMs;
    this.fadeStartTime = Date.now();
    this.currentSceneId = scene.id;
    this.setRunnerState(SCENE_STATE.FADING);
  }

  /** Immediately zero all channels. */
  blackout(): void {
    this.cancelFade();
    this.universe.blackout();
    this.setRunnerState(SCENE_STATE.IDLE);
  }

  /** Set a single channel (1-indexed). */
  setChannel(address: number, value: number): void {
    this.universe.setChannel(address, value);
  }

  /** Set multiple channels atomically (1-indexed addresses). */
  setChannelBatch(updates: Array<{ address: number; value: number }>): void {
    for (const { address, value } of updates) {
      this.universe.setChannel(address, value);
    }
  }

  /**
   * Cancel any active crossfade, keeping the current (mid-fade) universe
   * values intact. Called when the user manually adjusts a channel during
   * a fade — the fade freezes at its current position and the manual
   * change is applied on top.
   */
  stopFade(): void {
    if (this.runnerState === SCENE_STATE.FADING) {
      this.cancelFade();
      this.setRunnerState(SCENE_STATE.PLAYING);
    }
  }

  getUniverseSnapshot(): number[] {
    return this.universe.getSnapshot();
  }

  // ── Room dimmer ─────────────────────────────────────────────────────────────

  /**
   * Set the room-wide master dimmer (0–255).
   * This is applied as a multiplier to every dimmer-type channel right before
   * hardware output. The universe buffer is NOT modified — the renderer always
   * sees the intended (pre-room-dimmer) values.
   */
  setRoomDimmer(value: number): void {
    this.roomDimmer = Math.max(0, Math.min(255, Math.round(value)));
  }

  getRoomDimmer(): number {
    return this.roomDimmer;
  }

  /**
   * Tell the engine which DMX addresses (1-indexed) are dimmer channels.
   * Called whenever the fixture list changes.
   */
  setDimmerAddresses(addresses: number[]): void {
    this.dimmerAddresses = new Set(addresses);
    this.fxProcessor.setDimmerAddresses(this.dimmerAddresses);
  }

  // ── FX ──────────────────────────────────────────────────────────────────────

  setFx(config: FxConfig | null): void {
    this.fxProcessor.setConfig(config);
  }

  setFxLedAddresses(addresses: LedAddress[]): void {
    this.fxProcessor.setLedAddresses(addresses);
  }

  // ── Color shift modifiers ──────────────────────────────────────────────────

  /**
   * Set a color shift modifier.
   * Rotates the hue of the given RGB address triplets by `degrees`.
   * @param id - Control widget id (unique key for this modifier)
   * @param addresses - RGB address triplets to rotate
   * @param degrees - Hue rotation in degrees (0–360)
   */
  setColorShift(id: string, addresses: LedAddress[], degrees: number): void {
    if (degrees === 0) {
      this.colorShiftModifiers.delete(id);
    } else {
      this.colorShiftModifiers.set(id, { addresses, degrees });
    }
  }

  clearColorShift(id: string): void {
    this.colorShiftModifiers.delete(id);
  }

  // ── LED dimmer modifiers ───────────────────────────────────────────────────

  /**
   * Set an LED dimmer modifier.
   * Scales all given DMX addresses by `factor` (0–1).
   * @param id - Control widget id
   * @param addresses - 1-indexed DMX addresses to scale (RGBW channels)
   * @param factor - 0 = off, 1 = full
   */
  setLedDimmer(id: string, addresses: number[], factor: number): void {
    if (factor >= 1) {
      this.ledDimmerModifiers.delete(id);
    } else {
      this.ledDimmerModifiers.set(id, { addresses, factor: Math.max(0, Math.min(1, factor)) });
    }
  }

  clearLedDimmer(id: string): void {
    this.ledDimmerModifiers.delete(id);
  }

  // ── Callbacks ──────────────────────────────────────────────────────────────

  onUniverseUpdateCallback(cb: UniverseUpdateCallback): void {
    this.onUniverseUpdate = cb;
  }

  onRunnerStateCallback(cb: RunnerStateCallback): void {
    this.onRunnerState = cb;
  }

  onSerialStatusCallback(cb: SerialStatusCallback): void {
    this.onSerialStatus = cb;
  }

  // ── Tick loop ──────────────────────────────────────────────────────────────

  private startTick(): void {
    if (this.tickRunning) return;
    this.tickRunning = true;
    console.log('[DmxEngine] Tick loop started (self-scheduling)');
    this.tickLoop();
  }

  private stopTick(): void {
    this.tickRunning = false;
    console.log('[DmxEngine] Tick loop stopped');
  }

  /**
   * Self-scheduling async tick loop.
   * Each iteration awaits the full sendFrame() (BREAK + data + drain) before
   * scheduling the next, so frames never overlap and BREAK signals cannot
   * corrupt in-flight data.
   */
  private async tickLoop(): Promise<void> {
    while (this.tickRunning) {
      const frameStart = Date.now();

      // Advance fade if active
      if (this.runnerState === SCENE_STATE.FADING && this.fadeFromSnapshot && this.fadeToSnapshot) {
        const elapsed = Date.now() - this.fadeStartTime;
        const t = Math.min(elapsed / this.fadeDurationMs, 1);

        this.universe.applyFade(this.fadeFromSnapshot, this.fadeToSnapshot, t);

        if (t >= 1) {
          this.cancelFade();
          this.setRunnerState(SCENE_STATE.PLAYING);
        }
      }

      // Build output frame — apply signal chain in order:
      // 1. Color shift  2. LED dimmer  3. FX  4. Room dimmer (global)
      const rawBuf = this.universe.getRawBuffer();
      const cleanSnapshot = this.universe.getSnapshot(); // unmodified scene values
      // Always work on a copy so effects don't corrupt the universe buffer
      const outputBuf = new Uint8Array(rawBuf);

      // 1. Apply color shift modifiers (rotate hue of targeted RGB groups)
      for (const [, mod] of this.colorShiftModifiers) {
        for (const addr of mod.addresses) {
          const ri = addr.r - 1;
          const gi = addr.g - 1;
          const bi = addr.b - 1;
          const [h, s, l] = rgbToHsl(outputBuf[ri], outputBuf[gi], outputBuf[bi]);
          const [nr, ng, nb] = hslToRgb((h + mod.degrees / 360) % 1, s, l);
          outputBuf[ri] = nr;
          outputBuf[gi] = ng;
          outputBuf[bi] = nb;
        }
      }

      // 2. Apply LED dimmer modifiers (scale targeted color channels)
      for (const [, mod] of this.ledDimmerModifiers) {
        for (const addr of mod.addresses) {
          const idx = addr - 1;
          outputBuf[idx] = Math.round(outputBuf[idx] * mod.factor);
        }
      }

      // 3. Apply FX on a plain number array (modifies in-place)
      {
        const arr = new Array(outputBuf.length);
        for (let i = 0; i < outputBuf.length; i++) arr[i] = outputBuf[i];
        this.fxProcessor.processTick(arr, cleanSnapshot);
        for (let i = 0; i < outputBuf.length; i++) outputBuf[i] = arr[i];
      }

      // 4. Apply room dimmer — global master fader on ALL channels
      if (this.roomDimmer < 255) {
        for (let i = 0; i < outputBuf.length; i++) {
          outputBuf[i] = Math.round((outputBuf[i] * this.roomDimmer) / 255);
        }
      }

      // Write to hardware (await ensures frame completes before next iteration)
      try {
        await this.activeDriver?.sendFrame(outputBuf);
      } catch (e) {
        console.error('[DmxEngine] sendFrame error:', e);
      }

      // Push update to renderer
      this.onUniverseUpdate?.(this.universe.getSnapshot());

      // Wait for remainder of tick interval to maintain target frame rate.
      // If the frame took longer than the interval, proceed immediately.
      const elapsed = Date.now() - frameStart;
      const remaining = DMX_TICK_INTERVAL_MS - elapsed;
      if (remaining > 0) {
        await new Promise((r) => setTimeout(r, remaining));
      }
    }
  }

  private cancelFade(): void {
    this.fadeFromSnapshot = null;
    this.fadeToSnapshot = null;
    this.fadeDurationMs = 0;
  }

  private setRunnerState(state: SceneState): void {
    this.runnerState = state;
    this.onRunnerState?.({
      state,
      sceneId: this.currentSceneId,
    });
  }
}

// ── HSL helpers for color shift ──────────────────────────────────────────────

/** Convert RGB (0–255) to HSL (0–1 each). */
function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const l = (max + min) / 2;

  if (max === min) return [0, 0, l];

  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);

  let h = 0;
  if (max === rn) h = ((gn - bn) / d + (gn < bn ? 6 : 0)) / 6;
  else if (max === gn) h = ((bn - rn) / d + 2) / 6;
  else h = ((rn - gn) / d + 4) / 6;

  return [h, s, l];
}

/** Convert HSL (0–1 each) to RGB (0–255). */
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  if (s === 0) {
    const v = Math.round(l * 255);
    return [v, v, v];
  }

  const hue2rgb = (p: number, q: number, t: number) => {
    if (t < 0) t += 1;
    if (t > 1) t -= 1;
    if (t < 1 / 6) return p + (q - p) * 6 * t;
    if (t < 1 / 2) return q;
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
    return p;
  };

  const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
  const p = 2 * l - q;

  return [
    Math.round(hue2rgb(p, q, h + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, h) * 255),
    Math.round(hue2rgb(p, q, h - 1 / 3) * 255),
  ];
}
