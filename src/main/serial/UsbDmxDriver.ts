import { SerialPort } from 'serialport';
import { DMX_BAUD_RATE, DMX_DATA_BITS, DMX_PARITY, DMX_STOP_BITS, DMX_UNIVERSE_SIZE } from '../../shared/constants';
import type { SerialPortInfo, SerialStatus, DmxOutputMode } from '../../shared/types';

// Enttec Open DMX USB protocol constants
const DMX_START_CODE = 0x00;
const BREAK_DURATION_MS = 1;

/**
 * Infer the most likely DMX output protocol from port metadata.
 * Uses manufacturer string and PnP ID — no port needs to be opened.
 *
 * Accuracy:
 *  - OrbitBridgeDeck (Akashic Trance Machines): confirmed Enttec Pro framing.
 *  - Enttec Pro: reliably identified by "pro" in manufacturer/PnP.
 *  - Enttec Open: identified by "enttec" without "pro".
 *  - Everything else: defaults to baud-rate BREAK (safe for any FTDI/CH340/CP210x).
 */
function detectMode(p: { manufacturer?: string; pnpId?: string }): DmxOutputMode {
  const mfg = (p.manufacturer ?? '').toLowerCase();
  const pnp = (p.pnpId      ?? '').toLowerCase();
  const combined = `${mfg} ${pnp}`;

  // OrbitBridgeDeck (RP2350 CDC) implements Enttec Pro framing
  if (combined.includes('akashic')) return 'enttecPro';

  if (combined.includes('enttec')) {
    if (combined.includes('pro')) return 'enttecPro';
    return 'enttecOpen';
  }
  return 'baudRateBreak';
}

/**
 * USB-DMX serial driver.
 * Wraps SerialPort to send DMX512 frames over the Enttec Open DMX USB
 * (or compatible) adapter.
 */
export class UsbDmxDriver {
  private port: SerialPort | null = null;
  private portPath: string | null = null;
  private statusCallback: ((status: SerialStatus) => void) | null = null;

  /** List available serial ports, filtered for DMX adapter use. */
  async listPorts(): Promise<SerialPortInfo[]> {
    const all = await SerialPort.list();

    // Diagnostic: always log the raw list so we can debug port detection issues
    console.log('[UsbDmxDriver] Raw port list from SerialPort.list():');
    all.forEach((p) =>
      console.log(`  path=${p.path}  manufacturer=${p.manufacturer ?? '(none)'}  serial=${p.serialNumber ?? '(none)'}  pnp=${p.pnpId ?? '(none)'}`)
    );

    // On macOS, SerialPort.list() enumerates via IOKit and returns only
    // /dev/tty.* paths. We convert them to their /dev/cu.* counterparts
    // because cu.* (Call-Up) doesn't block on DCD and is the correct
    // choice for outgoing connections to USB-serial adapters.
    // We also filter out system pseudo-TTYs (debug-console, Bluetooth).
    const MACOS_PSEUDO_TTYS = ['debug-console', 'Bluetooth-Incoming-Port'];

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

    console.log(`[UsbDmxDriver] After macOS cu.* filter: ${filtered.length} port(s)`);

    return filtered
      .map((p) => ({
        path: p.path,
        manufacturer: p.manufacturer,
        serialNumber: p.serialNumber,
        detectedMode: detectMode(p),
      }))
      // Sort USB/FTDI ports to the top; Enttec Pro/Open before generic
      .sort((a, b) => {
        const rank = (port: SerialPortInfo) => {
          if (port.detectedMode === 'enttecPro')  return 0;
          if (port.detectedMode === 'enttecOpen') return 1;
          if (port.manufacturer != null || port.path.toLowerCase().includes('usb')) return 2;
          return 3;
        };
        return rank(a) - rank(b) || a.path.localeCompare(b.path);
      });
  }

  /** Open a connection to the specified serial port. */
  async connect(path: string): Promise<void> {
    if (this.port?.isOpen) {
      await this.disconnect();
    }

    this.emitStatus('connecting');

    return new Promise((resolve, reject) => {
      this.port = new SerialPort(
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

      this.port.open((err) => {
        if (err) {
          this.emitStatus('error');
          reject(err);
          return;
        }
        this.portPath = path;
        this.emitStatus('connected');

        this.port!.on('error', (e) => {
          console.error('[UsbDmxDriver] Serial error:', e.message);
          this.emitStatus('error');
        });

        this.port!.on('close', () => {
          console.log('[UsbDmxDriver] Port closed');
          this.emitStatus('disconnected');
        });

        resolve();
      });
    });
  }

  /** Close the serial port and ensure a DMX blackout is sent first. */
  async disconnect(): Promise<void> {
    if (!this.port?.isOpen) return;

    // Send a blackout frame before closing
    const blackout = new Uint8Array(DMX_UNIVERSE_SIZE + 1);
    blackout[0] = DMX_START_CODE;
    await this.writeRaw(blackout);

    return new Promise((resolve) => {
      this.port!.close(() => {
        this.port = null;
        this.portPath = null;
        resolve();
      });
    });
  }

  /**
   * Send a full DMX512 frame with proper BREAK timing.
   *
   * The DMX512 protocol requires this sequence for each frame:
   *   1. BREAK  — hold the line low for ≥ 88 μs  (we use ~1 ms)
   *   2. MAB    — mark-after-break, line high for ≥ 8 μs
   *   3. DATA   — start code (0x00) followed by up to 512 channel bytes
   *
   * Without the BREAK, receivers cannot synchronize to the data stream
   * and will ignore it entirely (falling back to auto/standalone mode).
   *
   * The entire sequence is executed inside a single Promise with nested
   * callbacks, avoiding 4 separate event-loop round-trips that previously
   * added 2–10 ms of overhead per frame on slower machines.
   */
  async sendFrame(universe: Uint8Array): Promise<void> {
    if (!this.port?.isOpen) return;

    // Build frame: [start code, channel 1..512]
    const frame = new Uint8Array(DMX_UNIVERSE_SIZE + 1);
    frame[0] = DMX_START_CODE;
    frame.set(universe, 1);

    const port = this.port;
    const buf = Buffer.from(frame);

    return new Promise<void>((resolve, reject) => {
      // 1. Assert BREAK (pulls TX line low)
      port.set({ brk: true }, (err) => {
        if (err) { reject(err); return; }

        // 2. Hold BREAK for ≥ 88 μs (1 ms is safe and common for FTDI adapters)
        setTimeout(() => {
          if (!port.isOpen) { resolve(); return; }

          // 3. Release BREAK → MAB begins (line goes high)
          port.set({ brk: false }, (err2) => {
            if (err2) { reject(err2); return; }

            // 4. Write the DMX frame (start code + 512 channels) and drain
            port.write(buf, (err3) => {
              if (err3) { reject(err3); return; }
              port.drain((err4) => {
                if (err4) reject(err4);
                else resolve();
              });
            });
          });
        }, BREAK_DURATION_MS);
      });
    });
  }

  /** Register a callback to receive serial status changes. */
  onStatusChange(cb: (status: SerialStatus) => void): void {
    this.statusCallback = cb;
  }

  get isConnected(): boolean {
    return this.port?.isOpen ?? false;
  }

  get currentPath(): string | null {
    return this.portPath;
  }

  /** Assert or release the serial BREAK condition. */
  private setBreak(flag: boolean): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.port?.isOpen) { resolve(); return; }
      this.port.set({ brk: flag }, (err) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  /** Simple ms delay using setTimeout. */
  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  private writeRaw(data: Uint8Array): Promise<void> {
    return new Promise((resolve, reject) => {
      if (!this.port?.isOpen) {
        resolve();
        return;
      }
      this.port.write(Buffer.from(data), (err) => {
        if (err) {
          reject(err);
          return;
        }
        this.port!.drain((drainErr) => {
          if (drainErr) reject(drainErr);
          else resolve();
        });
      });
    });
  }

  private emitStatus(status: SerialStatus): void {
    this.statusCallback?.(status);
  }
}
