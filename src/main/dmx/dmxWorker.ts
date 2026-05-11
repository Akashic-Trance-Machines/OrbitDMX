/**
 * DMX Worker Thread
 *
 * Runs in a dedicated Node.js Worker Thread, completely isolated from the
 * Electron main process event loop. This guarantees a steady 40 Hz DMX
 * output even when the main thread is busy with IPC, rendering, or GC.
 *
 * The main thread sends output frames; this worker re-transmits the latest
 * frame at a constant rate. If no new frame arrives, the last frame is
 * re-sent — so the DMX signal never drops.
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

// ── Message handler ──────────────────────────────────────────────────────────

parentPort!.on('message', async (msg: { type: string; path?: string; data?: number[] }) => {
  switch (msg.type) {
    case 'connect':
      await handleConnect(msg.path!);
      break;
    case 'disconnect':
      await handleDisconnect();
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

async function handleConnect(path: string): Promise<void> {
  if (port?.isOpen) {
    await handleDisconnect();
  }

  emitStatus('connecting');

  return new Promise<void>((resolve, reject) => {
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
        reject(err);
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
        emitStatus('disconnected');
      });

      startTick();
      resolve();
    });
  });
}

// ── Disconnect ───────────────────────────────────────────────────────────────

async function handleDisconnect(): Promise<void> {
  stopTick();

  if (!port?.isOpen) return;

  // Send a blackout frame before closing
  const blackout = new Uint8Array(DMX_UNIVERSE_SIZE + 1);
  blackout[0] = DMX_START_CODE;
  await writeRaw(blackout);

  return new Promise<void>((resolve) => {
    port!.close(() => {
      port = null;
      resolve();
    });
  });
}

// ── Tick loop ────────────────────────────────────────────────────────────────

function startTick(): void {
  if (tickRunning) return;
  tickRunning = true;
  console.log('[DmxWorker] Tick loop started');
  tickLoop();
}

function stopTick(): void {
  tickRunning = false;
  console.log('[DmxWorker] Tick loop stopped');
}

/**
 * Self-scheduling tick loop running in the worker thread.
 * Re-sends the latest frame at ~40 Hz. Because this thread has no IPC
 * handlers, no renderer updates, and no Electron overhead, the event loop
 * stays uncontested and timers fire reliably.
 */
async function tickLoop(): Promise<void> {
  while (tickRunning) {
    const frameStart = process.hrtime.bigint();

    try {
      await sendFrame(currentFrame);
    } catch (e) {
      console.error('[DmxWorker] sendFrame error:', e);
    }

    // Wait for remainder of tick interval
    const elapsedMs = Number(process.hrtime.bigint() - frameStart) / 1_000_000;
    const remaining = TICK_INTERVAL_MS - elapsedMs;
    if (remaining > 1) {
      await new Promise((r) => setTimeout(r, Math.floor(remaining)));
    }
  }
}

// ── DMX frame transmission ───────────────────────────────────────────────────

/**
 * Send a full DMX512 frame: BREAK → data → drain.
 * All steps in a single Promise to minimize event-loop round-trips.
 */
function sendFrame(universe: Uint8Array): Promise<void> {
  if (!port?.isOpen) return Promise.resolve();

  const frame = new Uint8Array(DMX_UNIVERSE_SIZE + 1);
  frame[0] = DMX_START_CODE;
  frame.set(universe, 1);

  const p = port;
  const buf = Buffer.from(frame);

  return new Promise<void>((resolve, reject) => {
    // 1. Assert BREAK
    p.set({ brk: true }, (err) => {
      if (err) { reject(err); return; }

      // 2. Hold BREAK for ~1ms
      setTimeout(() => {
        if (!p.isOpen) { resolve(); return; }

        // 3. Release BREAK
        p.set({ brk: false }, (err2) => {
          if (err2) { reject(err2); return; }

          // 4. Write frame + drain
          p.write(buf, (err3) => {
            if (err3) { reject(err3); return; }
            p.drain((err4) => {
              if (err4) reject(err4);
              else resolve();
            });
          });
        });
      }, BREAK_DURATION_MS);
    });
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function writeRaw(data: Uint8Array): Promise<void> {
  return new Promise((resolve, reject) => {
    if (!port?.isOpen) { resolve(); return; }
    port.write(Buffer.from(data), (err) => {
      if (err) { reject(err); return; }
      port!.drain((drainErr) => {
        if (drainErr) reject(drainErr);
        else resolve();
      });
    });
  });
}

function emitStatus(status: string): void {
  parentPort!.postMessage({ type: 'status', status });
}

function emitError(message: string): void {
  parentPort!.postMessage({ type: 'error', message });
}
