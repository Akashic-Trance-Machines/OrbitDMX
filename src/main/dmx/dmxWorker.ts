/**
 * DMX Worker Thread
 *
 * Runs in a dedicated Node.js Worker Thread with Atomics.wait() timing.
 * Frame data via SharedArrayBuffer (zero-copy, zero-GC).
 *
 * BREAK generation uses baud-rate switching instead of ioctl:
 *   1. Switch to 76800 baud → write 0x00 → produces ~117μs LOW = valid BREAK
 *   2. Switch to 250000 baud → write DMX frame
 * This avoids TIOCSBRK/TIOCCBRK ioctls which are unreliable on some
 * macOS USB-C controllers (especially MacBook Air).
 */

import { parentPort, workerData } from 'worker_threads';
import { SerialPort } from 'serialport';

const DMX_UNIVERSE_SIZE = 512;
const DMX_BAUD_RATE = 250000;
const DMX_DATA_BITS = 8;
const DMX_STOP_BITS = 2;
const DMX_PARITY = 'none' as const;
const DMX_START_CODE = 0x00;
const TICK_INTERVAL_MS = 25; // 40 Hz

// BREAK baud rate: at 76800 baud with 8N2, a 0x00 byte produces:
//   9 LOW bits × 13.02μs = 117.19μs BREAK  (min 88μs ✓)
//   2 HIGH bits × 13.02μs = 26.04μs MAB    (min 8μs ✓)
// This goes through the normal data path — no ioctl required.
const BREAK_BAUD_RATE = 76800;

let port: SerialPort | null = null;
let tickRunning = false;

// Shared memory for zero-copy frame transfer from main thread
const sharedFrame = new Uint8Array(workerData.sharedFrameBuffer as SharedArrayBuffer);

// Atomics.wait() for precise kernel-level sleep
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
function preciseSleep(ms: number): void {
  if (ms > 0) Atomics.wait(waitBuffer, 0, 0, Math.ceil(ms));
}

// Pre-allocated buffers (zero allocation per frame)
const breakByte = Buffer.from([0x00]);  // BREAK byte sent at low baud
const frame = Buffer.alloc(DMX_UNIVERSE_SIZE + 1);
frame[0] = DMX_START_CODE;

// ── Message handler ──────────────────────────────────────────────────────────

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
    console.log(`[DmxWorker] Connected to ${path} (baud-rate BREAK mode)`);

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
  console.log('[DmxWorker] Tick loop started (baud-rate BREAK + Atomics.wait)');
  tickLoop();
}

async function tickLoop(): Promise<void> {
  while (tickRunning) {
    const t0 = process.hrtime.bigint();

    try {
      // Copy latest frame from shared memory (single memcpy, no allocation)
      frame.set(sharedFrame, 1);
      await sendFrame();
    } catch (e) {
      console.error('[DmxWorker] sendFrame error:', e);
    }

    const elapsedMs = Number(process.hrtime.bigint() - t0) / 1_000_000;
    preciseSleep(TICK_INTERVAL_MS - elapsedMs);
  }
}

// ── DMX frame transmission ───────────────────────────────────────────────────
//
// Uses baud-rate switching for BREAK generation:
//   1. Switch to 76800 baud
//   2. Write 0x00 → FTDI produces ~117μs LOW (= BREAK) + ~26μs HIGH (= MAB)
//   3. Switch to 250000 baud
//   4. Write DMX frame (start code + 512 channels)
//
// This avoids ioctl(TIOCSBRK/TIOCCBRK) entirely, using the normal data path
// for BREAK. Much more reliable on macOS USB-C controllers.

function sendFrame(): Promise<void> {
  if (!port?.isOpen) return Promise.resolve();
  const p = port;

  return new Promise<void>((resolve, reject) => {
    // 1. Switch to BREAK baud rate
    p.update({ baudRate: BREAK_BAUD_RATE }, (err) => {
      if (err) { reject(err); return; }

      // 2. Write BREAK byte (0x00 at 76800 = ~117μs LOW + ~26μs HIGH)
      p.write(breakByte, (err2) => {
        if (err2) { reject(err2); return; }

        // 3. Drain — ensure BREAK is fully on the wire before switching baud
        p.drain((err3) => {
          if (err3) { reject(err3); return; }
          if (!p.isOpen) { resolve(); return; }

          // 4. Switch back to DMX baud rate
          p.update({ baudRate: DMX_BAUD_RATE }, (err4) => {
            if (err4) { reject(err4); return; }

            // 5. Write DMX frame (start code + 512 channels) + drain
            p.write(frame, (err5) => {
              if (err5) { reject(err5); return; }
              p.drain((err6) => {
                if (err6) reject(err6); else resolve();
              });
            });
          });
        });
      });
    });
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function emitStatus(s: string): void { parentPort!.postMessage({ type: 'status', status: s }); }
function emitError(m: string): void { parentPort!.postMessage({ type: 'error', message: m }); }
