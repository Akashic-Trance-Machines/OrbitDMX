import { powerSaveBlocker } from 'electron';
import { Worker } from 'worker_threads';
import path from 'node:path';
import { DmxUniverse } from './DmxUniverse';
import { FxProcessor } from './FxProcessor';
import { UsbBulkDmxDriver, isUsbBulkPath } from '../serial/UsbBulkDmxDriver';
import { DMX_TICK_INTERVAL_MS, SCENE_STATE, DMX_OUTPUT_MODE_DEFAULT } from '../../shared/constants';
import type { RunnerStatus, Scene, SerialStatus, FxConfig, LedAddress, DmxOutputMode, SerialPortInfo } from '../../shared/types';
import type { SceneState } from '../../shared/constants';

type UniverseUpdateCallback = (snapshot: number[]) => void;
type RunnerStateCallback = (status: RunnerStatus) => void;
type SerialStatusCallback = (status: SerialStatus) => void;

/**
 * DmxEngine — the heart of the application (main process only).
 *
 * Responsibilities:
 * - Owns the DmxUniverse (live buffer)
 * - Computes the output frame (fade, FX, color shift, room dimmer)
 * - Delegates hardware output to a dedicated Worker Thread that runs at 40 Hz
 * - Manages fade transitions between scenes
 * - Emits push events to the renderer via registered callbacks
 *
 * Architecture:
 *   Main thread: computes frames, sends them to the worker via postMessage
 *   Worker thread: owns the serial port, runs a tight tick loop, re-sends
 *                  the latest frame at ~40 Hz. Even if the main thread stalls,
 *                  the worker keeps sending — no blackouts.
 */
export class DmxEngine {
  private readonly universe: DmxUniverse;

  /** UsbBulkDmxDriver is used for listPorts() of USB bulk devices only.
   * NOTE: UsbDmxDriver (serialport) is intentionally NOT imported here.
   * All SerialPort.list() calls happen inside the Worker thread to keep
   * the native Poller UV handles off the main process event loop.
   * Importing serialport in the main process registers UV io_poll handles
   * on Thread 0; when USB is unplugged, those fire can_call_into_js() on
   * the main isolate during teardown → SIGSEGV. */
  private readonly bulkDriver: UsbBulkDmxDriver;

  /** The dedicated DMX output worker thread. */
  private worker: Worker | null = null;

  /**
   * SharedArrayBuffer for zero-copy frame transfer to the worker.
   * Main thread writes output frames here; worker reads on each tick.
   * No postMessage, no structured clone, no GC pressure.
   */
  private readonly sharedFrameBuffer = new SharedArrayBuffer(512);
  private readonly sharedFrameView = new Uint8Array(this.sharedFrameBuffer);

  /** Remember the last-connected port for auto-reconnect after sleep/wake. */
  private lastConnectedPath: string | null = null;

  private tickRunning = false;
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private powerSaveBlockerId: number | null = null;

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

  // Track whether we're connected (worker handles the actual connection)
  private _isConnected = false;

  /**
   * Set to true when the user explicitly calls disconnect().
   * Prevents the auto-reconnect loop from firing after a manual disconnect.
   * Cleared on the next successful connect().
   */
  private intentionalDisconnect = false;

  /** Auto-reconnect retry timer (USB unplug recovery). */
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  // Pending listPorts requests: requestId → { resolve, reject }
  private pendingListPorts = new Map<string, { resolve: (ports: SerialPortInfo[]) => void; reject: (e: Error) => void }>();

  // Output protocol mode
  private outputMode: DmxOutputMode = DMX_OUTPUT_MODE_DEFAULT;
  private outputModeAutoDetected = false;

  constructor() {
    this.universe = new DmxUniverse();
    this.bulkDriver = new UsbBulkDmxDriver();
  }

  // ── Serial control ─────────────────────────────────────────────────────────

  async listPorts() {
    // Serial ports are enumerated inside the Worker (where serialport's native
    // Poller handles are safely isolated from the main thread). USB bulk devices
    // are enumerated in the main process via the usb module.
    const [serialPorts, bulkPorts] = await Promise.all([
      this.workerListPorts(),
      this.bulkDriver.listPorts(),
    ]);
    return [...bulkPorts, ...serialPorts]; // USB bulk first (more likely for this user)
  }

  async connect(path: string): Promise<void> {
    // USB bulk devices are unsupported — delegate to the bulk driver which throws
    if (isUsbBulkPath(path)) {
      throw new Error(
        'LightingSoft SUSHI1A is not yet supported — it uses a proprietary protocol. ' +
        'Please use an FTDI-based USB-DMX adapter (e.g. Enttec Open DMX USB).'
      );
    }

    this.intentionalDisconnect = false; // new explicit connect clears the flag
    this.lastConnectedPath = path;

    // Spawn the worker thread and connect
    await this.spawnWorker();
    await this.workerConnect(path);
    this.startFrameLoop();
  }

  async disconnect(): Promise<void> {
    this.intentionalDisconnect = true;
    this._cancelReconnectTimer();
    this.stopFrameLoop();
    // terminateWorker() sends the disconnect message and waits for the
    // worker to close the serial port and exit naturally — do NOT call
    // workerDisconnect() separately here. That would send a redundant
    // disconnect and only wait 200ms total before terminateWorker() sends
    // a second disconnect and starts its own (previously 300ms) grace period.
    await this.terminateWorker();
    // Intentionally do NOT clear lastConnectedPath — we need it for reconnect.
  }

  /**
   * Attempt to reconnect to the last-used serial port.
   * Called after system resume (wake from sleep) OR after an unexpected USB
   * unplug. The USB-serial adapter may need a moment to re-enumerate, so we
   * retry a few times with a delay.
   */
  async reconnect(): Promise<boolean> {
    if (!this.lastConnectedPath) {
      console.log('[DmxEngine] reconnect: no previous port to reconnect to');
      return false;
    }

    const portPath = this.lastConnectedPath;
    const MAX_RETRIES = 5;
    const RETRY_DELAY_MS = 1000;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        console.log(`[DmxEngine] reconnect attempt ${attempt}/${MAX_RETRIES} → ${portPath}`);
        // Make sure old connection is torn down
        this.stopFrameLoop();
        await this.terminateWorker();

        await this.connect(portPath);
        console.log(`[DmxEngine] reconnect successful on attempt ${attempt}`);
        return true;
      } catch (e) {
        console.warn(`[DmxEngine] reconnect attempt ${attempt} failed:`, e);
        if (attempt < MAX_RETRIES) {
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        }
      }
    }

    console.error(`[DmxEngine] reconnect failed after ${MAX_RETRIES} attempts`);
    return false;
  }

  /**
   * Start the auto-reconnect loop after an unexpected USB disconnect.
   * Polls every POLL_MS for up to MAX_WAIT_MS, notifying the renderer of
   * 'reconnecting' status while retrying. On success: 'connected'.
   * On timeout: 'disconnected' (user must reconnect manually).
   */
  private startAutoReconnect(): void {
    if (this.intentionalDisconnect || !this.lastConnectedPath) return;

    const POLL_MS     = 2000;
    const MAX_WAIT_MS = 30_000;
    const started     = Date.now();
    const portPath    = this.lastConnectedPath;

    console.log(`[DmxEngine] Auto-reconnect started for ${portPath}`);
    this.onSerialStatus?.('reconnecting' as SerialStatus);

    const attempt = async () => {
      if (this.intentionalDisconnect || this._isConnected) return;
      if (Date.now() - started > MAX_WAIT_MS) {
        console.warn('[DmxEngine] Auto-reconnect timed out — user must reconnect manually');
        this.currentSerialStatus = 'disconnected';
        this.onSerialStatus?.('disconnected');
        return;
      }

      try {
        console.log(`[DmxEngine] Auto-reconnect attempt → ${portPath}`);
        await this.connect(portPath);
        console.log('[DmxEngine] Auto-reconnect successful');
        // onSerialStatus('connected') is emitted by the worker via spawnWorker's message handler
      } catch {
        // Port not yet available — schedule next attempt
        this.reconnectTimer = setTimeout(attempt, POLL_MS);
      }
    };

    this.reconnectTimer = setTimeout(attempt, POLL_MS);
  }

  private _cancelReconnectTimer(): void {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  get isConnected(): boolean {
    return this._isConnected;
  }

  getSerialStatus(): SerialStatus {
    return this.currentSerialStatus;
  }

  getConnectedPort(): string | null {
    return this._isConnected ? this.lastConnectedPath : null;
  }

  /** Set the DMX output protocol. Only takes effect on the next connect(). */
  setOutputMode(mode: DmxOutputMode, autoDetected = false): void {
    this.outputMode = mode;
    this.outputModeAutoDetected = autoDetected;
    console.log(`[DmxEngine] Output mode set to '${mode}' (autoDetected=${autoDetected})`);
  }

  getOutputMode(): { mode: DmxOutputMode; autoDetected: boolean } {
    return { mode: this.outputMode, autoDetected: this.outputModeAutoDetected };
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
    this.fxProcessor.setFxConfig(config);
  }

  setFxLedAddresses(addresses: LedAddress[]): void {
    this.fxProcessor.setLedAddresses(addresses);
  }

  setFxLedAddressesForType(type: string, addresses: LedAddress[]): void {
    this.fxProcessor.setLedAddressesForType(type as any, addresses);
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

  // ── Worker management ──────────────────────────────────────────────────────

  /**
   * Spawn the DMX worker thread.
   * The worker handles all serial I/O and runs the 40 Hz tick loop
   * independently of the main process event loop.
   */
  private spawnWorker(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (this.worker) {
        resolve();
        return;
      }

      // Resolve the worker script path relative to the compiled main.js.
      // In the Vite build output (.vite/build/), the worker is compiled
      // alongside main.js in the same directory.
      const workerPath = path.join(__dirname, 'dmxWorker.js');
      console.log(`[DmxEngine] Spawning worker thread: ${workerPath}`);

      this.worker = new Worker(workerPath, {
        workerData: { sharedFrameBuffer: this.sharedFrameBuffer },
      });

      this.worker.on('message', (msg: { type: string; status?: string; message?: string; fallback?: DmxOutputMode; requestId?: string; ports?: SerialPortInfo[]; error?: string }) => {
        if (msg.type === 'status') {
          const status = msg.status as SerialStatus;
          this.currentSerialStatus = status;
          this._isConnected = status === 'connected';
          this.onSerialStatus?.(status);
          // If the worker reports disconnected on its own (hardware unplug),
          // stop the frame loop immediately. The worker will self-exit shortly,
          // then the 'exit' handler will trigger auto-reconnect.
          if (status === 'disconnected' || status === 'error') {
            this.stopFrameLoop();
          }
        } else if (msg.type === 'error') {
          console.error('[DmxEngine] Worker error:', msg.message);
        } else if (msg.type === 'probeFailed') {
          // Pro probe timed out — worker already switched to baudRateBreak
          this.outputMode = msg.fallback ?? 'baudRateBreak';
          this.outputModeAutoDetected = false;
          console.warn(`[DmxEngine] probeFailed — mode corrected to '${this.outputMode}'`);
          // Notify renderer so the UI badge updates
          this.onSerialStatus?.(this.currentSerialStatus);
        } else if (msg.type === 'listPortsResult' && msg.requestId) {
          const pending = this.pendingListPorts.get(msg.requestId);
          if (pending) {
            this.pendingListPorts.delete(msg.requestId);
            if (msg.error) pending.reject(new Error(msg.error));
            else pending.resolve(msg.ports ?? []);
          }
        }
      });

      this.worker.on('error', (err) => {
        // This fires for spawn errors (e.g. file not found). Log it — the exit
        // handler below will clean up state regardless.
        console.error('[DmxEngine] Worker thread error:', err);
      });

      this.worker.on('exit', (code) => {
        console.log(`[DmxEngine] Worker thread exited (code=${code})`);
        const wasConnected = this._isConnected;
        this.worker = null;
        this._isConnected = false;
        this.stopFrameLoop();
        // Notify renderer even on unexpected exit (e.g. USB unplug causing crash)
        if (wasConnected || code !== 0) {
          this.currentSerialStatus = 'disconnected';
          this.onSerialStatus?.('disconnected');
        }
        // If the disconnect was unexpected (hardware removal), begin the
        // auto-reconnect polling loop.
        if (!this.intentionalDisconnect && this.lastConnectedPath) {
          this.startAutoReconnect();
        }
      });

      // Worker is ready once spawned (no async init needed)
      resolve();
    });
  }

  /**
   * Route SerialPort.list() through the Worker thread.
   *
   * CRITICAL: serialport MUST NOT be imported in the main process. Its native
   * binding (bindings.node) registers UV io_poll handles on the main thread's
   * event loop. When USB is unplugged, the kernel sends POLLHUP on the fd,
   * the native Poller fires Poller::onData → napi_call_function →
   * can_call_into_js() on the main isolate — causing SIGSEGV.
   *
   * By routing list() into the Worker, all Poller handles stay on Thread 51's
   * event loop. The main thread's UV loop never sees a serialport fd.
   */
  private workerListPorts(): Promise<SerialPortInfo[]> {
    return new Promise(async (resolve, reject) => {
      const requestId = Math.random().toString(36).slice(2);

      // If a worker is already running (connected), use it.
      if (this.worker) {
        this.pendingListPorts.set(requestId, { resolve, reject });
        this.worker.postMessage({ type: 'listPorts', requestId });
        return;
      }

      // No active worker — spawn a temporary one just for port listing.
      const workerPath = path.join(__dirname, 'dmxWorker.js');
      const tempWorker = new Worker(workerPath, {
        workerData: { sharedFrameBuffer: this.sharedFrameBuffer },
      });

      const onMessage = (msg: { type: string; requestId?: string; ports?: SerialPortInfo[]; error?: string }) => {
        if (msg.type === 'listPortsResult' && msg.requestId === requestId) {
          tempWorker.removeListener('message', onMessage);
          // Do NOT call tempWorker.terminate() here.
          //
          // The worker calls workerExitClean() (parentPort.unref) after sending
          // listPortsResult, so it will exit naturally once the serialport
          // Poller's uv_poll_t handle is released. If we terminate() immediately,
          // we race with those in-flight native handles: terminate() tears down
          // the worker's isolate from the main thread while the Poller callback
          // is still pending → can_call_into_js() fires on Thread 0 → SIGSEGV.
          //
          // Instead, let the worker exit on its own. Add a 2 s timeout as a
          // safety net in case something keeps the event loop alive unexpectedly.
          const exitTimeout = setTimeout(() => {
            tempWorker.terminate().catch(() => {});
          }, 2000);
          tempWorker.once('exit', () => clearTimeout(exitTimeout));

          if (msg.error) reject(new Error(msg.error));
          else resolve(msg.ports ?? []);
        }
      };
      tempWorker.on('message', onMessage);
      tempWorker.on('error', (e) => { reject(e); tempWorker.terminate().catch(() => {}); });

      tempWorker.postMessage({ type: 'listPorts', requestId });
    });
  }

  private async terminateWorker(): Promise<void> {
    if (!this.worker) return;
    const w = this.worker;
    this.worker = null;
    this._isConnected = false;

    // With the @serialport/bindings-cpp Poller patch (napi_get_uv_event_loop),
    // the Poller runs on the Worker's own event loop — all cleanup happens on
    // the correct thread. We just need to send 'disconnect' and let the Worker
    // close the port, unref parentPort, and exit naturally.
    //
    // The 3 s grace period is a last-resort safety net only. On macOS, USB CDC
    // teardown can be slow in edge cases. If the worker exits before the
    // timeout, clearTimeout ensures we don't wait unnecessarily.
    try {
      w.postMessage({ type: 'disconnect' });
      await new Promise<void>((resolve) => {
        const t = setTimeout(() => {
          console.warn('[DmxEngine] terminateWorker: grace period expired, force-terminating');
          resolve();
        }, 3000);
        w.once('exit', () => { clearTimeout(t); resolve(); });
      });
    } catch { /* worker already gone — safe to proceed */ }

    // Force-terminate ONLY if the worker is still alive after the full grace
    // period. If it exited naturally, terminate() is a safe no-op.
    try { await w.terminate(); } catch { /* already exited */ }
  }


  /** Tell the worker to open the serial port with the configured output mode. */
  private workerConnect(portPath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.worker) {
        reject(new Error('Worker not spawned'));
        return;
      }

      // Listen for the status change that confirms connection
      const onMessage = (msg: { type: string; status?: string; message?: string }) => {
        if (msg.type === 'status' && msg.status === 'connected') {
          this.worker?.removeListener('message', onMessage);
          clearTimeout(timer);
          resolve();
        } else if (msg.type === 'status' && msg.status === 'error') {
          this.worker?.removeListener('message', onMessage);
          clearTimeout(timer);
          reject(new Error('Worker connect failed'));
        }
      };
      this.worker.on('message', onMessage);

      // skipProbe is always true: the user's (or auto-detector's) protocol choice
      // is honoured as-is. The GET_WIDGET_PARAMS probe caused false negatives for
      // Enttec-compatible clones (e.g. Eurolite USB-DMX512 Pro) that use the same
      // framing but do not implement the Pro widget-params handshake.
      this.worker.postMessage({ type: 'connect', path: portPath, mode: this.outputMode, skipProbe: true });

      // 8s timeout: probe is 300ms + port open overhead, but give plenty of margin.
      // IMPORTANT: on timeout, send a disconnect to let the port close cleanly
      // before we reject — do NOT call terminateWorker() here, that is the caller's
      // responsibility. Abruptly terminating while the Poller is active causes SIGSEGV.
      const timer = setTimeout(() => {
        this.worker?.removeListener('message', onMessage);
        reject(new Error('Worker connect timeout'));
      }, 8000);
    });
  }

  /** Tell the worker to close the serial port. */
  private workerDisconnect(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.worker) {
        resolve();
        return;
      }
      this.worker.postMessage({ type: 'disconnect' });
      // Give the worker a moment to send the blackout and close
      setTimeout(resolve, 200);
    });
  }

  // ── Frame loop (main thread) ───────────────────────────────────────────────
  //
  // The main thread runs a frame computation loop at ~40 Hz using setInterval.
  // Each tick computes the output frame (fade, FX, etc.) and posts it to the
  // worker. This is decoupled from the worker's own tick loop:
  //   - If the main thread is slow, the worker re-sends the last frame (no blackout)
  //   - If the main thread is fast, the worker picks up the latest frame
  //

  private startFrameLoop(): void {
    if (this.tickRunning) return;
    this.tickRunning = true;

    // Prevent macOS from sleeping while DMX is active.
    // 'prevent-display-sleep' prevents both App Nap and idle sleep.
    if (this.powerSaveBlockerId === null) {
      this.powerSaveBlockerId = powerSaveBlocker.start('prevent-display-sleep');
      console.log(`[DmxEngine] powerSaveBlocker started (id=${this.powerSaveBlockerId})`);
    }

    console.log('[DmxEngine] Frame computation loop started');

    // Use setInterval — even if a tick is late, the next one still fires.
    // The worker handles the actual 40 Hz serial output independently.
    this.tickTimer = setInterval(() => this.computeAndSendFrame(), DMX_TICK_INTERVAL_MS);
  }

  private stopFrameLoop(): void {
    this.tickRunning = false;

    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    if (this.powerSaveBlockerId !== null) {
      powerSaveBlocker.stop(this.powerSaveBlockerId);
      console.log(`[DmxEngine] powerSaveBlocker released (id=${this.powerSaveBlockerId})`);
      this.powerSaveBlockerId = null;
    }

    console.log('[DmxEngine] Frame computation loop stopped');
  }

  /**
   * Compute the output frame and post it to the worker thread.
   * This runs on the main thread's setInterval, but the worker independently
   * sends frames to hardware — so a late main-thread tick doesn't cause blackouts.
   */
  private computeAndSendFrame(): void {
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

    // Write the computed frame directly into shared memory (zero-copy).
    // The worker reads this on each tick — no postMessage, no GC pressure.
    this.sharedFrameView.set(outputBuf);

    // Push update to renderer
    this.onUniverseUpdate?.(this.universe.getSnapshot());
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
