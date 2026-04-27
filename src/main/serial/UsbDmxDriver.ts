import { SerialPort } from 'serialport';
import { DMX_BAUD_RATE, DMX_DATA_BITS, DMX_PARITY, DMX_STOP_BITS, DMX_UNIVERSE_SIZE } from '../../shared/constants';
import type { SerialPortInfo, SerialStatus } from '../../shared/types';

// Enttec Open DMX USB protocol constants
const DMX_START_CODE = 0x00;
const BREAK_DURATION_MS = 1;

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
      }))
      // Sort USB/FTDI ports to the top
      .sort((a, b) => {
        const isUsb = (port: SerialPortInfo) =>
          port.manufacturer != null || port.path.toLowerCase().includes('usb');
        if (isUsb(a) && !isUsb(b)) return -1;
        if (!isUsb(a) && isUsb(b)) return 1;
        return a.path.localeCompare(b.path);
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
   */
  async sendFrame(universe: Uint8Array): Promise<void> {
    if (!this.port?.isOpen) return;

    // Build frame: [start code, channel 1..512]
    const frame = new Uint8Array(DMX_UNIVERSE_SIZE + 1);
    frame[0] = DMX_START_CODE;
    frame.set(universe, 1);

    // 1. Assert BREAK (pulls TX line low)
    await this.setBreak(true);

    // 2. Hold BREAK for ≥ 88 μs (1 ms is safe and common for FTDI adapters)
    await this.delay(BREAK_DURATION_MS);

    // 3. Release BREAK → MAB begins (line goes high)
    await this.setBreak(false);

    // 4. Write the DMX frame (start code + 512 channels)
    await this.writeRaw(frame);
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
