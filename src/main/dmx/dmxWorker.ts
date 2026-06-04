/**
 * DMX Worker Thread
 *
 * Runs in a dedicated Node.js Worker Thread with Atomics.wait() timing.
 * Frame data via SharedArrayBuffer (zero-copy, zero-GC).
 *
 * Supports four output protocols:
 *
 *  'baudRateBreak' (default — any FTDI/CH340/CP210x cable)
 *    Generates BREAK in software by switching baud rates:
 *    1. 76800 baud → write 0x00 → ~117μs LOW (BREAK) + ~26μs HIGH (MAB)
 *    2. 250000 baud 8N2 → write [0x00][ch1…ch512]
 *
 *  'enttecOpen' (Enttec Open DMX USB / DMXKing OpenDMX)
 *    Adapter firmware handles BREAK. Host writes 513 bytes at 250000 8N2:
 *    [0x00][ch1…ch512]
 *
 *  'enttecPro' (Enttec DMX USB Pro / Pro Mk2 / DMXKing ultraDMX Pro)
 *    Message-framed protocol at 57600 8N1. Host writes 518 bytes:
 *    [0x7E][0x06][0x01][0x02][0x00][ch1…ch512][0xE7]
 *    Adapter handles all DMX bus timing internally.
 *
 *  'eurolite' (Eurolite USB-DMX512 Pro / Cable / MK2)
 *    Same Enttec Pro packet framing as above, but at 250,000 baud 8N2:
 *    [0x7E][0x06][0x01][0x02][0x00][ch1…ch512][0xE7]
 *    The Eurolite has an embedded FTDI FT232R that handles DMX timing natively.
 *    Despite the Pro framing, it MUST be opened at 250k baud — NOT 57600.
 */

import { parentPort, workerData } from 'worker_threads';
import { SerialPort } from 'serialport';
import type { DmxOutputMode } from '../../shared/types';
import { ENTTEC_PRO_BAUD, ENTTEC_PRO_PROBE_TIMEOUT_MS, DMX_UNIVERSE_SIZE as SHARED_DMX_UNIVERSE_SIZE } from '../../shared/constants';
import type { SerialPortInfo } from '../../shared/types';

const DMX_UNIVERSE_SIZE = 512;
const DMX_BAUD_RATE     = 250000;
const DMX_DATA_BITS     = 8;
const DMX_STOP_BITS     = 2;
const BREAK_BAUD_RATE   = 76800;
const DMX_START_CODE    = 0x00;
const TICK_INTERVAL_MS  = 25; // 40 Hz

// Enttec Pro framing constants
const ENTTEC_START     = 0x7E;
const ENTTEC_END       = 0xE7;
const ENTTEC_LABEL_DMX = 0x06;
const ENTTEC_LABEL_PARAMS = 0x03;
const ENTTEC_DATA_LEN  = DMX_UNIVERSE_SIZE + 1; // start code + 512 channels

let port: SerialPort | null = null;
let mode: DmxOutputMode = 'baudRateBreak';
let tickRunning = false;

// Shared memory for zero-copy frame transfer from main thread
const sharedFrame = new Uint8Array(workerData.sharedFrameBuffer as SharedArrayBuffer);

// Atomics.wait() for precise kernel-level sleep
const waitBuffer = new Int32Array(new SharedArrayBuffer(4));
function preciseSleep(ms: number): void {
  if (ms > 0) Atomics.wait(waitBuffer, 0, 0, Math.ceil(ms));
}

// Pre-allocated buffers (zero allocation per frame in hot path)
const breakByte  = Buffer.from([0x00]);
const dmxFrame   = Buffer.alloc(DMX_UNIVERSE_SIZE + 1);
dmxFrame[0]      = DMX_START_CODE;

// Enttec Pro frame: [0x7E][0x06][LSB][MSB][start code][ch1…ch512][0xE7]
const proFrame   = Buffer.alloc(DMX_UNIVERSE_SIZE + 6);
proFrame[0] = ENTTEC_START;
proFrame[1] = ENTTEC_LABEL_DMX;
proFrame[2] = ENTTEC_DATA_LEN & 0xFF;        // LSB = 513 & 0xFF = 0x01
proFrame[3] = (ENTTEC_DATA_LEN >> 8) & 0xFF; // MSB = 513 >> 8 = 0x02
proFrame[4] = DMX_START_CODE;
// proFrame[5..516] = channel data  (filled per tick)
proFrame[DMX_UNIVERSE_SIZE + 5] = ENTTEC_END;

// ── Message handler ──────────────────────────────────────────────────────────

parentPort!.on('message', (msg: { type: string; path?: string; mode?: DmxOutputMode; skipProbe?: boolean; requestId?: string }) => {
  if      (msg.type === 'connect')    handleConnect(msg.path!, msg.mode ?? 'baudRateBreak', msg.skipProbe ?? false);
  else if (msg.type === 'disconnect') handleDisconnect();
  else if (msg.type === 'listPorts')  handleListPorts(msg.requestId!);
});

// ── Safety net: prevent unhandled errors from crashing Electron ──────────────
// Worker runs in its own Node thread. An uncaught error causes Electron to
// treat it as a main-process crash and exit the whole app.

// ── Worker exit helper ───────────────────────────────────────────────────────
//
// Patch summary: @serialport/bindings-cpp has two fixes applied via patch-package:
//
//   1. Poller constructor: uses napi_get_uv_event_loop(env) instead of
//      uv_default_loop(), so the Poller is registered on the Worker's own event
//      loop (not the main thread's). This prevents the SIGSEGV from cross-thread
//      NAPI callbacks into a freed isolate.
//
//   2. Poller::destroy(): calls uv_close() on the poll handle so it is fully
//      removed from the event loop. Without this, poller.destroy() only called
//      Reset() (releasing the JS wrapper) but left the uv_poll_t handle in the
//      loop's handle queue. When the Worker exited, Node's CheckedUvLoopClose()
//      asserted "uv_loop_close() while having open handles".
//
// With both fixes, the normal exit path is:
//   binding.close() → poller.stop() [uv_poll_stop] → poller.destroy() [uv_close]
//   → async fd close → 'close' event → workerExitClean() → parentPort.unref()
//   → event loop drains (Poller close callback fires) → Worker exits cleanly.
//
// As belt-and-suspenders, a 500 ms timeout calls process.exit(0). In a Worker
// thread, process.exit() terminates only the Worker — not the Electron process.

function workerExitClean(): void {
  // Give the event loop one turn to fire the Poller's uv_close callback and
  // drain any remaining work, then unref the parentPort so the loop can exit.
  setImmediate(() => {
    parentPort!.unref();
    // Belt-and-suspenders: if the event loop still has open handles after 500 ms
    // (e.g. the binary wasn't rebuilt and the Poller fix isn't in effect),
    // force-exit the Worker thread. process.exit() in a Worker terminates only
    // this thread, not the whole Electron process.
    setTimeout(() => { process.exit(0); }, 500).unref();
  });
}


function safeWorkerShutdown(reason: unknown): void {
  console.error('[DmxWorker] Fatal error — shutting down safely:', reason);
  tickRunning = false;
  const p = port;
  port = null;
  emitStatus('disconnected');
  try {
    if (p?.isOpen) {
      // Close the port; workerExitClean() runs in the close callback so the
      // Poller is fully unregistered before the event loop starts draining.
      p.close(() => { workerExitClean(); });
    } else {
      workerExitClean();
    }
  } catch { workerExitClean(); /* port already gone */ }
}

process.on('uncaughtException',  (err)    => safeWorkerShutdown(err));
process.on('unhandledRejection', (reason) => safeWorkerShutdown(reason));

// ── Connect / Disconnect ─────────────────────────────────────────────────────

function handleConnect(path: string, requestedMode: DmxOutputMode, skipProbe: boolean): void {
  if (port?.isOpen) handleDisconnect();
  mode = requestedMode;
  emitStatus('connecting');

  const isPro      = requestedMode === 'enttecPro';
  // 'eurolite' uses 250k 8N2 with Enttec Pro framing — NOT 57600 8N1.
  // All other modes (baudRateBreak, enttecOpen) also use 250k 8N2.

  port = new SerialPort({
    path,
    baudRate: isPro ? ENTTEC_PRO_BAUD : DMX_BAUD_RATE,
    dataBits: DMX_DATA_BITS,
    stopBits: isPro ? 1 : (DMX_STOP_BITS as 1 | 2),
    parity:   'none',
    autoOpen: false,
  });

  port.open(async (err) => {
    if (err) {
      emitStatus('error');
      emitError(`Failed to open ${path}: ${err.message}`);
      return;
    }

    port!.on('error', (e) => {
      console.error('[DmxWorker] Serial error:', e.message);
      // Stop the tick loop immediately — port is in a bad state (e.g. USB unplug)
      tickRunning = false;
      emitStatus('error');
      // 'close' will fire immediately after; we handle exit there.
    });
    port!.on('close', () => {
      tickRunning = false;
      port = null;
      emitStatus('disconnected');
      // Poller is on the Worker's event loop (napi_get_uv_event_loop patch),
      // so this fires on the correct thread. Defer via setImmediate so the
      // current uv poll iteration finishes and the Poller handle is fully
      // unregistered before we allow the event loop to start draining.
      workerExitClean();
    });

    // For Enttec Pro: optionally probe to confirm identity
    if (requestedMode === 'enttecPro') {
      if (skipProbe) {
        console.log('[DmxWorker] Pro probe skipped (auto-detected / confirmed device)');
      } else {
        const probeResult = await probeEnttecPro();
        if (!probeResult) {
          console.warn('[DmxWorker] Pro probe failed — falling back to baudRateBreak');
          mode = 'baudRateBreak';
          emitProbeFailed('baudRateBreak');
        } else {
          console.log('[DmxWorker] Pro probe successful');
        }
      }
    }

    emitStatus('connected');
    console.log(`[DmxWorker] Connected to ${path} (mode=${mode})`);
    startTick();
  });
}

function handleDisconnect(): void {
  tickRunning = false;
  if (!port?.isOpen) return;
  // Best-effort blackout — null the port reference immediately so the tick
  // loop won't try to write concurrently. Then write zeros and close.
  const p = port;
  port = null;

  const blackout = Buffer.alloc(DMX_UNIVERSE_SIZE + 1, 0);
  p.write(blackout, () => {
    // Ignore write result — just close the port
    p.close(() => {});
  });
}

// ── Port listing ─────────────────────────────────────────────────────────────
//
// SerialPort.list() is called here, inside the Worker, so the native Poller
// UV handles stay on the Worker's event loop (Thread 51). They NEVER touch
// Thread 0 (CrBrowserMain). When USB is unplugged, any Poller callbacks that
// fire are limited to the Worker's isolate — not the main process isolate.
//
// The main process MUST NOT import serialport directly. All port enumeration
// must be routed through this handler.

function detectMode(p: { manufacturer?: string; pnpId?: string; serialNumber?: string }): string {
  const mfg    = (p.manufacturer ?? '').toLowerCase();
  const pnp    = (p.pnpId        ?? '').toLowerCase();
  const serial = (p.serialNumber ?? '').toLowerCase();
  const combined = `${mfg} ${pnp} ${serial}`;

  // Akashic Trance Machines OrbitBridgeDeck (RP2350 CDC)
  if (combined.includes('akashic')) return 'enttecPro';

  // Eurolite USB-DMX512 Pro (Cable / MK2): Pro framing at 250k 8N2.
  // Manufacturer string is 'Eurolite' on some systems; generic FTDI on others.
  if (combined.includes('eurolite')) return 'eurolite';

  if (combined.includes('enttec')) {
    if (combined.includes('pro')) return 'enttecPro';
    return 'enttecOpen';
  }

  // Generic FTDI chip (FT232R) — could be Eurolite, Enttec clone, or any
  // other USB-serial adapter. Log a hint; the user can override in Settings.
  if (mfg.includes('ftdi') || mfg.includes('ft232')) {
    console.log(
      '[DmxWorker] Generic FTDI detected — defaulting to baudRateBreak. ' +
      'If this is a Eurolite USB-DMX512 Pro or Enttec Pro clone, select ' +
      '"Enttec DMX USB Pro" in Output Protocol Settings.'
    );
  }

  return 'baudRateBreak';
}

async function handleListPorts(requestId: string): Promise<void> {
  const MACOS_PSEUDO_TTYS = ['debug-console', 'Bluetooth-Incoming-Port'];

  try {
    const all = await SerialPort.list();

    console.log('[DmxWorker] Raw port list from SerialPort.list():');
    all.forEach((p) =>
      console.log(`  path=${p.path}  manufacturer=${p.manufacturer ?? '(none)'}  serial=${p.serialNumber ?? '(none)'}  pnp=${p.pnpId ?? '(none)'}`)
    );

    const filtered = all
      .filter((p) => {
        if (process.platform === 'darwin') {
          return !MACOS_PSEUDO_TTYS.some((name) => p.path.includes(name));
        }
        return true;
      })
      .map((p) => {
        if (process.platform === 'darwin' && p.path.startsWith('/dev/tty.')) {
          return { ...p, path: p.path.replace('/dev/tty.', '/dev/cu.') };
        }
        return p;
      });

    console.log(`[DmxWorker] After macOS cu.* filter: ${filtered.length} port(s)`);

    const ports: SerialPortInfo[] = filtered
      .map((p) => ({
        path: p.path,
        manufacturer: p.manufacturer,
        serialNumber: p.serialNumber,
        detectedMode: detectMode(p) as import('../../shared/types').DmxOutputMode,
      }))
      .sort((a, b) => {
        const rank = (port: SerialPortInfo) => {
          if (port.detectedMode === 'enttecPro')  return 0;
          if (port.detectedMode === 'enttecOpen') return 1;
          if (port.manufacturer != null || port.path.toLowerCase().includes('usb')) return 2;
          return 3;
        };
        return rank(a) - rank(b) || a.path.localeCompare(b.path);
      });

    parentPort!.postMessage({ type: 'listPortsResult', requestId, ports });
  } catch (e) {
    console.error('[DmxWorker] listPorts error:', e);
    parentPort!.postMessage({ type: 'listPortsResult', requestId, ports: [], error: String(e) });
  }

  // If this worker was spawned solely for port listing (no open port),
  // unref parentPort so the event loop drains and the worker exits naturally.
  // SerialPort.list() never opens a port, so no Poller exists to clean up.
  if (!port?.isOpen) {
    workerExitClean();
  }
}

// ── Enttec Pro probe ─────────────────────────────────────────────────────────

/**
 * Send a GET_WIDGET_PARAMS request (label 0x03) and wait for a valid
 * Enttec Pro response (start byte 0x7E) within ENTTEC_PRO_PROBE_TIMEOUT_MS.
 * Returns true if the adapter acknowledged, false on timeout.
 */
function probeEnttecPro(): Promise<boolean> {
  return new Promise((resolve) => {
    if (!port?.isOpen) { resolve(false); return; }

    const probe = Buffer.from([
      ENTTEC_START, ENTTEC_LABEL_PARAMS, 0x02, 0x00, 0x00, 0x00, ENTTEC_END,
    ]);

    let resolved = false;
    const timer = setTimeout(() => {
      if (!resolved) { resolved = true; port?.removeListener('data', onData); resolve(false); }
    }, ENTTEC_PRO_PROBE_TIMEOUT_MS);

    const onData = (data: Buffer) => {
      if (!resolved && data.length > 0 && data[0] === ENTTEC_START) {
        resolved = true;
        clearTimeout(timer);
        port?.removeListener('data', onData);
        resolve(true);
      }
    };

    port.on('data', onData);
    port.write(probe, (err) => {
      if (err && !resolved) { resolved = true; clearTimeout(timer); resolve(false); }
    });
  });
}

// ── Tick loop ────────────────────────────────────────────────────────────────

function startTick(): void {
  if (tickRunning) return;
  tickRunning = true;
  console.log(`[DmxWorker] Tick loop started (mode=${mode}, Atomics.wait)`);
  tickLoop();
}

async function tickLoop(): Promise<void> {
  while (tickRunning) {
    const t0 = process.hrtime.bigint();

    try {
      // Copy latest frame from shared memory (single memcpy, no allocation)
      dmxFrame.set(sharedFrame, 1);

      switch (mode) {
        case 'eurolite':      await sendFrameEurolite();      break;
        case 'enttecOpen':    await sendFrameEnttecOpen();    break;
        case 'enttecPro':     await sendFrameEnttecPro();     break;
        case 'baudRateBreak':
        default:              await sendFrameBaudRateBreak(); break;
      }
    } catch (e) {
      const msg = String(e);
      // Fatal device-gone conditions: stop immediately instead of spamming at 40 Hz
      const isFatal =
        msg.includes('Device not configured') ||
        msg.includes('ENXIO') ||
        msg.includes('no such device') ||
        msg.includes('EIO') ||
        msg.includes('Input/output error');

      if (isFatal) {
        console.error('[DmxWorker] Device removed — stopping tick loop:', msg.split('\n')[0]);
        safeWorkerShutdown(e);
        return;
      }

      console.error('[DmxWorker] sendFrame error:', e);
    }

    const elapsedMs = Number(process.hrtime.bigint() - t0) / 1_000_000;
    preciseSleep(TICK_INTERVAL_MS - elapsedMs);
  }
}

// ── Protocol implementations ─────────────────────────────────────────────────

/**
 * Baud-rate BREAK (default — any FTDI/CH340/CP210x cable).
 * 1. Switch to 76800 baud → write 0x00 → ~117μs BREAK + ~26μs MAB
 * 2. Switch to 250000 8N2 → write DMX frame (513 bytes)
 */
function sendFrameBaudRateBreak(): Promise<void> {
  if (!port?.isOpen) return Promise.resolve();
  const p = port;

  return new Promise<void>((resolve, reject) => {
    p.update({ baudRate: BREAK_BAUD_RATE }, (err) => {
      if (err || !p.isOpen) { err ? reject(err) : resolve(); return; }

      p.write(breakByte, (err2) => {
        if (err2 || !p.isOpen) { err2 ? reject(err2) : resolve(); return; }

        // Drain the BREAK byte before switching baud — timing critical
        p.drain((err3) => {
          if (err3 || !p.isOpen) { err3 ? reject(err3) : resolve(); return; }

          p.update({ baudRate: DMX_BAUD_RATE }, (err4) => {
            if (err4 || !p.isOpen) { err4 ? reject(err4) : resolve(); return; }

            // Write DMX data — no final drain needed (25ms gap before next frame)
            p.write(dmxFrame, (err5) => {
              if (err5) reject(err5); else resolve();
            });
          });
        });
      });
    });
  });
}



/**
 * Enttec Open DMX USB / DMXKing OpenDMX.
 * Adapter firmware generates BREAK. Host writes raw 513-byte frame at 250000 8N2.
 */
function sendFrameEnttecOpen(): Promise<void> {
  if (!port?.isOpen) return Promise.resolve();
  const p = port;

  // USB CDC write callback fires when data is queued to the OS buffer.
  // drain() is unreliable on CDC devices — skip it.
  return new Promise<void>((resolve, reject) => {
    p.write(dmxFrame, (err) => { if (err) reject(err); else resolve(); });
  });
}

/**
 * Enttec DMX USB Pro / Pro Mk2 / DMXKing ultraDMX Pro.
 * Message-framed protocol at 57600 8N1. Frame = 518 bytes:
 *   [0x7E][0x06][0x01][0x02][0x00][ch1…ch512][0xE7]
 */
function sendFrameEnttecPro(): Promise<void> {
  if (!port?.isOpen) return Promise.resolve();
  const p = port;

  proFrame.set(dmxFrame.subarray(1), 5); // dmxFrame[1..512] → proFrame[5..516]

  // USB CDC: write callback fires when data is in the OS buffer.
  // drain() causes 'First argument must be an int' on port close — skip it.
  return new Promise<void>((resolve, reject) => {
    p.write(proFrame, (err) => { if (err) reject(err); else resolve(); });
  });
}

/**
 * Eurolite USB-DMX512 Pro / Cable / MK2.
 *
 * Uses the same Enttec Pro packet framing as sendFrameEnttecPro(), but the
 * port is opened at 250,000 baud 8N2 (not 57600 8N1). The Eurolite's embedded
 * FTDI FT232R handles DMX bus timing; the host just sends the framed packet.
 *
 * Spec (from Eurolite docs):
 *   Byte 1:   0x7E  — Start
 *   Byte 2:   0x06  — Label (TX DMX Packet)
 *   Byte 3:   0x01  — Data length LSB (513 & 0xFF)
 *   Byte 4:   0x02  — Data length MSB (513 >> 8)
 *   Byte 5:   0x00  — DMX start code
 *   Bytes 6–n: 0x##  — channel data (up to 512 bytes)
 *   Byte n+1: 0xE7  — End
 *
 * Connection: 250,000 baud, 8N2, no parity.
 */
function sendFrameEurolite(): Promise<void> {
  if (!port?.isOpen) return Promise.resolve();
  const p = port;

  proFrame.set(dmxFrame.subarray(1), 5); // dmxFrame[1..512] → proFrame[5..516]

  return new Promise<void>((resolve, reject) => {
    p.write(proFrame, (err) => { if (err) reject(err); else resolve(); });
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function emitStatus(s: string): void {
  parentPort!.postMessage({ type: 'status', status: s });
}
function emitError(m: string): void {
  parentPort!.postMessage({ type: 'error', message: m });
}
function emitProbeFailed(fallback: DmxOutputMode): void {
  parentPort!.postMessage({ type: 'probeFailed', fallback });
}
