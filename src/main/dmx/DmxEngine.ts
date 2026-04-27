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
  // Applied as a multiplier to dimmer channels right before hardware output.
  private roomDimmer: number = 255;
  private dimmerAddresses: Set<number> = new Set();

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

      // Build output frame with room dimmer applied to dimmer channels
      const rawBuf = this.universe.getRawBuffer();
      const cleanSnapshot = this.universe.getSnapshot(); // unmodified scene values
      // Always work on a copy so FX + dimmer don't corrupt the universe buffer
      const outputBuf = new Uint8Array(rawBuf);

      // Apply room dimmer
      if (this.roomDimmer < 255 && this.dimmerAddresses.size > 0) {
        for (const addr of this.dimmerAddresses) {
          const idx = addr - 1;
          outputBuf[idx] = Math.round((outputBuf[idx] * this.roomDimmer) / 255);
        }
      }

      // Apply FX on a plain number array (modifies in-place)
      {
        const arr = new Array(outputBuf.length);
        for (let i = 0; i < outputBuf.length; i++) arr[i] = outputBuf[i];
        this.fxProcessor.processTick(arr, cleanSnapshot);
        for (let i = 0; i < outputBuf.length; i++) outputBuf[i] = arr[i];
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
