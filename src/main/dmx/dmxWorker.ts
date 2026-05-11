/**
 * DMX Worker Thread
 *
 * Runs in a dedicated Node.js Worker Thread with Atomics.wait() timing.
 *
 * Frame data is received via SharedArrayBuffer (zero-copy, zero-GC).
 * The main thread writes output frames directly into shared memory;
 * this worker reads the latest frame on each tick cycle.
 *
 * Control messages (connect/disconnect) still use postMessage.
 */

import { parentPort, workerData } from 'worker_threads';
import { SerialPort } from 'serialport';

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

// ── Shared memory ────────────────────────────────────────────────────────────
// The main thread writes output frames here via DmxEngine.sharedFrameView.
// We read from it on each tick — zero-copy, zero-allocation, zero-GC.
const sharedFrameBuffer: SharedArrayBuffer = workerData.sharedFrameBuffer;
const sharedFrame = new Uint8Array(sharedFrameBuffer);

// Atomics.wait() buffer for precise kernel-level sleep
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));

function preciseSleep(ms: number): void {
  if (ms > 0) Atomics.wait(waitBuffer, 0, 0, Math.ceil(ms));
}

// ── Message handler (control messages only — no frame data) ──────────────────

parentPort!.on('message', (msg: { type: string; path?: string }) => {
  if (msg.type === 'connect') handleConnect(msg.path!);
  else if (msg.type === 'disconnect') handleDisconnect();
});

// ── Connect / Disconnect ─────────────────────────────────────────────────────

function handleConnect(path: string): void {
  if (port?.isOpen) handleDisconnect();
  emitStatus('connecting');

  port = new SerialPort({
    path,
    baudRate: DMX_BAUD_RATE,
    dataBits: DMX_DATA_BITS,
    stopBits: DMX_STOP_BITS,
    parity: DMX_PARITY,
    autoOpen: false,
  }, undefined);

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
      tickRunning = false;
      emitStatus('disconnected');
    });

    startTick();
  });
}

function handleDisconnect(): void {
  tickRunning = false;
  if (!port?.isOpen) return;
  const blackout = Buffer.alloc(DMX_UNIVERSE_SIZE + 1, 0);
  port.write(blackout);
  port.drain(() => { port?.close(() => { port = null; }); });
}

// ── Tick loop ────────────────────────────────────────────────────────────────

function startTick(): void {
  if (tickRunning) return;
  tickRunning = true;
  console.log('[DmxWorker] Tick loop started (SharedArrayBuffer + Atomics.wait)');
  tickLoop();
}

async function tickLoop(): Promise<void> {
  // Pre-allocate the DMX frame buffer once — reuse every tick (zero allocation)
  const frame = Buffer.alloc(DMX_UNIVERSE_SIZE + 1);
  frame[0] = DMX_START_CODE;

  while (tickRunning) {
    const t0 = process.hrtime.bigint();

    try {
      // Copy latest frame from shared memory into our pre-allocated buffer.
      // This is a single memcpy of 512 bytes — ~0.1μs, no allocation.
      frame.set(sharedFrame, 1);

      await sendFrame(frame);
    } catch (e) {
      console.error('[DmxWorker] sendFrame error:', e);
    }

    const elapsedMs = Number(process.hrtime.bigint() - t0) / 1_000_000;
    preciseSleep(TICK_INTERVAL_MS - elapsedMs);
  }
}

// ── DMX frame transmission ───────────────────────────────────────────────────

function sendFrame(buf: Buffer): Promise<void> {
  if (!port?.isOpen) return Promise.resolve();
  const p = port;

  return new Promise<void>((resolve, reject) => {
    // 1. Assert BREAK
    p.set({ brk: true }, (err) => {
      if (err) { reject(err); return; }

      // 2. Hold BREAK — Atomics.wait (kernel-level, NOT setTimeout)
      preciseSleep(BREAK_DURATION_MS);
      if (!p.isOpen) { resolve(); return; }

      // 3. Release BREAK
      p.set({ brk: false }, (err2) => {
        if (err2) { reject(err2); return; }

        // 4. Write frame + drain
        p.write(buf, (err3) => {
          if (err3) { reject(err3); return; }
          p.drain((err4) => {
            if (err4) reject(err4); else resolve();
          });
        });
      });
    });
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function emitStatus(s: string): void { parentPort!.postMessage({ type: 'status', status: s }); }
function emitError(m: string): void { parentPort!.postMessage({ type: 'error', message: m }); }
