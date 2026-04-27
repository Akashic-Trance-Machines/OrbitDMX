import { usb } from 'usb';
import type { SerialPortInfo, SerialStatus } from '../../shared/types';

/**
 * USB Bulk DMX Driver for LightingSoft AG / Sunlite / Nicolaudie USB-DMX
 * interfaces (SUSHI1A, SIUDI, USB-1, etc.).
 *
 * STATUS: EXPERIMENTAL / DISABLED
 * The SUSHI1A (VID 0x6244, PID 0x0541) uses a proprietary protocol that
 * has not been reverse-engineered. Sending bulk transfers or certain control
 * transfers causes the device to crash (loses DMX output). Until the protocol
 * is captured via USB sniffing with the official software, this driver only
 * lists the device for display purposes — it does NOT attempt to connect.
 *
 * When an FTDI-based USB-DMX adapter is used instead, it appears as a standard
 * serial port and is handled by UsbDmxDriver (SerialPort).
 */

const LIGHTSOFTAG_VID = 0x6244;

const KNOWN_DEVICES: Array<{ vid: number; pid: number; name: string }> = [
  { vid: 0x6244, pid: 0x0541, name: 'SUSHI1A / USB-1 (unsupported)' },
];

type StatusCallback = (status: SerialStatus) => void;

export class UsbBulkDmxDriver {
  private statusCallback: StatusCallback | null = null;
  private _isConnected = false;
  private _connectedPath: string | null = null;

  /**
   * List LightingSoft USB-DMX devices. They appear in the port list with a
   * note that they are unsupported, so the user knows the device is detected
   * but cannot be used until an FTDI adapter is available.
   */
  async listPorts(): Promise<SerialPortInfo[]> {
    try {
      const devices = usb.getDeviceList();
      const result: SerialPortInfo[] = [];

      for (const dev of devices) {
        const { idVendor, idProduct } = dev.deviceDescriptor;
        const match = KNOWN_DEVICES.find((d) => d.vid === idVendor && d.pid === idProduct);
        if (match) {
          const path = `usb://lightingsoft/${idVendor.toString(16)}:${idProduct.toString(16)}`;
          result.push({
            path,
            manufacturer: `LightingSoft AG — ${match.name}`,
          });
        }
      }
      return result;
    } catch (e) {
      console.warn('[UsbBulkDmx] listPorts error (non-fatal):', e);
      return [];
    }
  }

  async connect(_path: string): Promise<void> {
    this.emitStatus('error');
    throw new Error(
      'LightingSoft SUSHI1A is not yet supported — it uses a proprietary protocol. ' +
      'Please use an FTDI-based USB-DMX adapter (e.g. Enttec Open DMX USB).'
    );
  }

  async disconnect(): Promise<void> {
    this._isConnected = false;
    this._connectedPath = null;
    this.emitStatus('disconnected');
  }

  async sendFrame(_universe: Uint8Array): Promise<void> {
    // No-op — device is not connected
  }

  onStatusChange(cb: StatusCallback): void {
    this.statusCallback = cb;
  }

  get isConnected(): boolean { return this._isConnected; }
  get currentPath(): string | null { return this._connectedPath; }

  private emitStatus(status: SerialStatus): void {
    this.statusCallback?.(status);
  }
}

/** Returns true if a USB path belongs to this driver. */
export function isUsbBulkPath(path: string): boolean {
  return path.startsWith('usb://lightingsoft/');
}
