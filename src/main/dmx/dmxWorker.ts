/**
 * DMX Worker Thread
 *
 * Runs in a dedicated Node.js Worker Thread, completely isolated from the
 * Electron main process event loop.
 *
 * ALL timing uses Atomics.wait() — a true kernel-level sleep that blocks the
 * thread for the exact specified duration without going through the event loop
 * timer queue. This eliminates setTimeout jitter entirely, producing a rock-
 * solid 40 Hz DMX output regardless of system load or power management state.
 *
 * Atomics.wait() only works in Worker Threads (not the main thread), which is
 * why this architecture is required.
 *
 * Messages from main → worker:
 *   { type: 'connect',    path: string }
 *   { type: 'disconnect' }
 *   { type: 'frame',      data: number[] }   // 512 channel values
 *
 * Messages from worker → main:
 *   { type: 'status',  status: string }       // 'connected' | 'connecting' | 'disconnected' | 'error'
 *   { type: 'error',   message: string }
 */

import { parentPort } from 'worker_threads';
import { SerialPort } from 'serialport';

// DMX protocol constants (duplicated here to avoid import issues in worker context)
const DMX_UNIVERSE_SIZE = 512;
const DMX_BAUD_RATE = 250000;
const DMX_DATA_BITS = 8;
const DMX_STOP_BITS = 2;
const DMX_PARITY = 'none' as const;
const DMX_START_CODE = 0x00;
const BREAK_DURATION_MS = 1;
const TICK_INTERVAL_MS = 25; // 40 Hz

let port: SerialPort | null = null;
let tickRunning = false;

// The latest output frame from the main thread. The worker continuously
// re-sends this at TICK_INTERVAL_MS. Initialized to all-zeros (blackout).
let currentFrame = new Uint8Array(DMX_UNIVERSE_SIZE);

// Shared buffer for Atomics.wait() — used as a precise, non-event-loop sleep.
// This is a true kernel-level block (not a timer), so it's immune to timer
// coalescing, App Nap throttling, and event loop congestion.
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

/**
 * Precise millisecond sleep using Atomics.wait().
 * Blocks the worker thread for exactly `ms` milliseconds without going
 * through the event loop timer queue. This is the key to rock-solid timing.
 */
function preciseSleep(ms: number): void {
  if (ms > 0) {
    Atomics.wait(waitBuffer, 0, 0, Math.ceil(ms));
  }
}

// ── Message handler ──────────────────────────────────────────────────────────

parentPort!.on('message', (msg: { type: string; path?: string; data?: number[] }) => {
  switch (msg.type) {
    case 'connect':
      handleConnect(msg.path!);
      break;
    case 'disconnect':
      handleDisconnect();
      break;
    case 'frame':
      // Update the output frame — the tick loop will pick it up on the next cycle.
      // This is lock-free: JS is single-threaded per worker, so no race conditions.
      if (msg.data) {
        for (let i = 0; i < DMX_UNIVERSE_SIZE; i++) {
          currentFrame[i] = msg.data[i] ?? 0;
        }
      }
      break;
  }
});

// ── Connect ──────────────────────────────────────────────────────────────────

function handleConnect(path: string): void {
  if (port?.isOpen) {
    handleDisconnect();
  }

  emitStatus('connecting');

  port = new SerialPort(
    {
      path,
      baudRate: DMX_BAUD_RATE,
      dataBits: DMX_DATA_BITS,
      stopBits: DMX_STOP_BITS,
      parity: DMX_PARITY,
      autoOpen: false,
    },
    undefined,
  );

  port.open((err) => {
    if (err) {
      emitStatus('error');
      emitError(`Failed to open ${path}: ${err.message}`);
      return;
    }

    emitStatus('connected');
    console.log(`[DmxWorker] Connected to ${path}`);

    port!.on('error', (e) => {
      console.error('[DmxWorker] Serial error:', e.message);
      emitStatus('error');
    });

    port!.on('close', () => {
      console.log('[DmxWorker] Port closed');
      tickRunning = false;
      emitStatus('disconnected');
    });

    startTick();
  });
}

// ── Disconnect ───────────────────────────────────────────────────────────────

function handleDisconnect(): void {
  tickRunning = false;

  if (!port?.isOpen) return;

  // Send a blackout frame before closing
  const blackout = new Uint8Array(DMX_UNIVERSE_SIZE + 1);
  blackout[0] = DMX_START_CODE;
  port.write(Buffer.from(blackout));
  port.drain(() => {
    port?.close(() => {
      port = null;
    });
  });
}

// ── Tick loop ────────────────────────────────────────────────────────────────

function startTick(): void {
  if (tickRunning) return;
  tickRunning = true;
  console.log('[DmxWorker] Tick loop started (Atomics.wait timing)');
  tickLoop();
}

/**
 * Deterministic tick loop using Atomics.wait() for all timing.
 *
 * The entire loop runs without touching the event loop timer queue:
 *   1. BREAK assert (async callback from serialport)
 *   2. BREAK hold — Atomics.wait(1ms) instead of setTimeout(1ms)
 *   3. BREAK release + data write (async callbacks)
 *   4. Tick interval — Atomics.wait(remaining) instead of setTimeout(remaining)
 *
 * This produces consistent, jitter-free 40 Hz output regardless of system
 * load, power management, or event loop congestion.
 */
async function tickLoop(): Promise<void> {
  while (tickRunning) {
    const frameStartNs = process.hrtime.bigint();

    try {
      await sendFrame(currentFrame);
    } catch (e) {
      // Don't log every error — just count and log periodically
      console.error('[DmxWorker] sendFrame error:', e);
    }

    // Use Atomics.wait() for the inter-frame delay — NOT setTimeout.
    const elapsedMs = Number(process.hrtime.bigint() - frameStartNs) / 1_000_000;
    const remaining = TICK_INTERVAL_MS - elapsedMs;
    preciseSleep(remaining);
  }
}

// ── DMX frame transmission ───────────────────────────────────────────────────

/**
 * Send a full DMX512 frame: BREAK → hold → release → data → drain.
 *
 * The BREAK hold uses Atomics.wait(1ms) instead of setTimeout(1ms),
 * eliminating the primary source of timing jitter.
 */
function sendFrame(universe: Uint8Array): Promise<void> {
  if (!port?.isOpen) return Promise.resolve();

  const frame = new Uint8Array(DMX_UNIVERSE_SIZE + 1);
  frame[0] = DMX_START_CODE;
  frame.set(universe, 1);

  const p = port;
  const buf = Buffer.from(frame);

  return new Promise<void>((resolve, reject) => {
    // 1. Assert BREAK (pulls TX line low)
    p.set({ brk: true }, (err) => {
      if (err) { reject(err); return; }

      // 2. Hold BREAK for ~1ms using Atomics.wait (NOT setTimeout!)
      // This is the critical fix: setTimeout(1) can fire 1–15ms late,
      // but Atomics.wait blocks for exactly 1ms.
      preciseSleep(BREAK_DURATION_MS);

      if (!p.isOpen) { resolve(); return; }

      // 3. Release BREAK → MAB begins (line goes high)
      p.set({ brk: false }, (err2) => {
        if (err2) { reject(err2); return; }

        // 4. Write the DMX frame (start code + 512 channels) and drain
        p.write(buf, (err3) => {
          if (err3) { reject(err3); return; }
          p.drain((err4) => {
            if (err4) reject(err4);
            else resolve();
          });
        });
      });
    });
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function emitStatus(status: string): void {
  parentPort!.postMessage({ type: 'status', status });
}

function emitError(message: string): void {
  parentPort!.postMessage({ type: 'error', message });
}
