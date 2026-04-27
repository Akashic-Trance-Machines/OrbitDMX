import { DMX_MAX_VALUE, DMX_MIN_VALUE, DMX_UNIVERSE_SIZE } from '../../shared/constants';

/**
 * DMX Universe — owns the live channel buffer for one 512-channel universe.
 * The engine is the only place that writes to hardware; all other layers
 * compute values and pass them here.
 */
export class DmxUniverse {
  private readonly buffer: Uint8Array;

  constructor() {
    this.buffer = new Uint8Array(DMX_UNIVERSE_SIZE);
  }

  /** Write a single channel value (1-indexed address, 0-based internally). */
  setChannel(address: number, value: number): void {
    if (address < 1 || address > DMX_UNIVERSE_SIZE) {
      console.warn(`[DmxUniverse] setChannel: address ${address} out of range, ignored`);
      return;
    }
    this.buffer[address - 1] = this.clamp(value);
  }

  /** Write a block of values starting at startAddress (1-indexed). */
  setChannels(startAddress: number, values: number[]): void {
    for (let i = 0; i < values.length; i++) {
      this.setChannel(startAddress + i, values[i]);
    }
  }

  /** Apply a full 512-value snapshot. */
  applySnapshot(snapshot: number[]): void {
    for (let i = 0; i < DMX_UNIVERSE_SIZE; i++) {
      this.buffer[i] = this.clamp(snapshot[i] ?? 0);
    }
  }

  /** Linearly interpolate between two snapshots at progress t ∈ [0, 1]. */
  applyFade(from: number[], to: number[], t: number): void {
    const clamped = Math.max(0, Math.min(1, t));
    for (let i = 0; i < DMX_UNIVERSE_SIZE; i++) {
      const a = from[i] ?? 0;
      const b = to[i] ?? 0;
      this.buffer[i] = this.clamp(Math.round(a + (b - a) * clamped));
    }
  }

  /** Zero every channel (safe blackout). */
  blackout(): void {
    this.buffer.fill(0);
  }

  /** Return a copy of the current buffer as a plain array. */
  getSnapshot(): number[] {
    return Array.from(this.buffer);
  }

  /** Return the raw Uint8Array for serial transmission. */
  getRawBuffer(): Uint8Array {
    return this.buffer;
  }

  private clamp(value: number): number {
    return Math.max(DMX_MIN_VALUE, Math.min(DMX_MAX_VALUE, Math.round(value)));
  }
}
