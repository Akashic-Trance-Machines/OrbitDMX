import type { FxConfig, FxType, LedAddress } from '../../shared/types';

/**
 * FxProcessor — real-time effect processing for the DMX tick loop.
 *
 * Multiple effects can be active simultaneously. Each tick, `processTick()`
 * modifies the output buffer in-place in a fixed processing order:
 *   breath → fire → candle → twinkle → strobe → strobeColor → hueRotator
 *
 * Each FX type maintains its own state (LED addresses, timing, per-LED values).
 */
export class FxProcessor {
  // ── Per-type config ──────────────────────────────────────────────────────────
  private configs: Map<FxType, FxConfig> = new Map();

  // ── Per-type LED addresses ───────────────────────────────────────────────────
  private ledAddressesMap: Map<FxType, LedAddress[]> = new Map();

  // ── Shared dimmer addresses (for breath) ─────────────────────────────────────
  private dimmerAddresses: Set<number> = new Set();

  // ── Per-type timing ──────────────────────────────────────────────────────────
  private startTimes: Map<FxType, number> = new Map();

  // ── Per-type fire/candle state ───────────────────────────────────────────────
  private ledTargets: Map<FxType, Map<number, number>> = new Map();
  private ledCurrent: Map<FxType, Map<number, number>> = new Map();

  // ── Per-type twinkle state ───────────────────────────────────────────────────
  private twinkleActive: Map<FxType, Map<number, { startTime: number; fadeMs: number }>> = new Map();
  private nextTwinkleTimes: Map<FxType, number> = new Map();

  // ── Processing order ─────────────────────────────────────────────────────────
  private static readonly PROCESS_ORDER: FxType[] = [
    'breath',
    'fire',
    'candle',
    'twinkle',
    'strobe',
    'strobeColor',
    'hueRotator',
  ];

  // ── Config management ────────────────────────────────────────────────────────

  /**
   * Set or clear a single FX type's config.
   * Pass null (or config.active = false) to stop that specific type.
   */
  setFxConfig(config: FxConfig | null): void {
    if (!config || !config.active) {
      if (config) this.configs.delete(config.type);
      return;
    }

    const wasActive = this.configs.has(config.type);
    if (!wasActive) {
      // New effect starting — initialise per-type state
      this.startTimes.set(config.type, Date.now());
      this.ledTargets.set(config.type, new Map());
      this.ledCurrent.set(config.type, new Map());
      this.twinkleActive.set(config.type, new Map());
      this.nextTwinkleTimes.set(config.type, 0);
    }

    this.configs.set(config.type, config);
  }

  /** Clear all active effects (e.g. on room load / stop-all). */
  clearAllConfigs(): void {
    this.configs.clear();
  }

  /** @deprecated Use setFxConfig() instead. Kept for backward compat. */
  setConfig(config: FxConfig | null): void {
    this.setFxConfig(config);
  }

  // ── LED address management ───────────────────────────────────────────────────

  setLedAddressesForType(type: FxType, addresses: LedAddress[]): void {
    this.ledAddressesMap.set(type, addresses);
  }

  /** @deprecated Sets all types to the same addresses (old single-FX path). */
  setLedAddresses(addresses: LedAddress[]): void {
    for (const type of FxProcessor.PROCESS_ORDER) {
      this.ledAddressesMap.set(type, addresses);
    }
  }

  setDimmerAddresses(addresses: Set<number>): void {
    this.dimmerAddresses = addresses;
  }

  // ── Tick helpers ─────────────────────────────────────────────────────────────

  private getBpmPeriodMs(config: FxConfig, legacyPeriodMs: number): number {
    if (config.syncToBpm && config.globalBpm) {
      const divider = config.tempoDivider ?? 1;
      return (60_000 / config.globalBpm) * divider;
    }
    return legacyPeriodMs;
  }

  private quantisePeriod(periodMs: number): number {
    const QUANTUM = 50;
    return Math.max(QUANTUM, Math.round(periodMs / QUANTUM) * QUANTUM);
  }

  // ── Main tick ────────────────────────────────────────────────────────────────

  /**
   * Modify the output buffer in-place. Called every tick (~25ms).
   * Processes all active effects in the fixed processing order.
   */
  processTick(output: number[], clean: number[]): void {
    if (this.configs.size === 0) return;

    const now = Date.now();

    for (const type of FxProcessor.PROCESS_ORDER) {
      const config = this.configs.get(type);
      if (!config || !config.active) continue;

      const elapsed = now - (this.startTimes.get(type) ?? now);
      const leds = this.ledAddressesMap.get(type) ?? [];

      switch (type) {
        case 'strobe':
          this.processStrobe(config, leds, output, clean, elapsed);
          break;
        case 'strobeColor':
          this.processStrobeColor(config, leds, output, clean, elapsed);
          break;
        case 'breath':
          this.processBreath(config, leds, output, elapsed);
          break;
        case 'fire':
          this.processFire(config, type, leds, output, clean, 0.15);
          break;
        case 'candle':
          this.processFire(config, type, leds, output, clean, 0.04);
          break;
        case 'twinkle':
          this.processTwinkle(config, type, leds, output, clean, now);
          break;
        case 'hueRotator':
          this.processHueRotator(config, leds, output, elapsed);
          break;
      }
    }
  }

  // ── Strobe ────────────────────────────────────────────────────────────────────────────────

  private processStrobe(
    config: FxConfig, leds: LedAddress[],
    output: number[], clean: number[], elapsed: number,
  ): void {
    const hz = 1 + (config.speed / 100) * 19;
    const legacyPeriodMs = 1000 / hz;
    let period = this.getBpmPeriodMs(config, legacyPeriodMs);
    if (config.quantiseStrobe) period = this.quantisePeriod(period);
    const phase = (elapsed % period) / period;
    const isOn = phase < 0.5;
    const f = config.intensity / 100;    // 0 = no effect, 1 = full override
    const dimFactor = 1 - f;             // factor for scene on OFF phase

    // ON  phase: lerp scene → white  (at f=1: pure white; at f=0: unchanged)
    // OFF phase: lerp scene → black  (at f=1: pure black; at f=0: unchanged)
    for (const led of leds) {
      const sr = clean[led.r - 1];
      const sg = clean[led.g - 1];
      const sb = clean[led.b - 1];
      if (isOn) {
        output[led.r - 1] = Math.round(sr + (255 - sr) * f);
        output[led.g - 1] = Math.round(sg + (255 - sg) * f);
        output[led.b - 1] = Math.round(sb + (255 - sb) * f);
      } else {
        output[led.r - 1] = Math.round(sr * dimFactor);
        output[led.g - 1] = Math.round(sg * dimFactor);
        output[led.b - 1] = Math.round(sb * dimFactor);
      }
    }
  }

  // ── Strobe Color ──────────────────────────────────────────────────────────────────────────

  private processStrobeColor(
    config: FxConfig, leds: LedAddress[],
    output: number[], clean: number[], elapsed: number,
  ): void {
    const hz = 1 + (config.speed / 100) * 19;
    const legacyPeriodMs = 1000 / hz;
    let period = this.getBpmPeriodMs(config, legacyPeriodMs);
    if (config.quantiseStrobe) period = this.quantisePeriod(period);
    const phase = (elapsed % period) / period;
    const isOn = phase < 0.5;
    const [cr, cg, cb] = config.color ?? [255, 255, 255];
    const f = config.intensity / 100;    // 0 = no effect, 1 = full override
    const dimFactor = 1 - f;             // factor for scene on OFF phase

    // ON  phase: lerp scene → color   (at f=1: pure color; at f=0: unchanged)
    // OFF phase: lerp scene → black   (at f=1: pure black; at f=0: unchanged)
    for (const led of leds) {
      const sr = clean[led.r - 1];
      const sg = clean[led.g - 1];
      const sb = clean[led.b - 1];
      if (isOn) {
        output[led.r - 1] = Math.round(sr + (cr - sr) * f);
        output[led.g - 1] = Math.round(sg + (cg - sg) * f);
        output[led.b - 1] = Math.round(sb + (cb - sb) * f);
      } else {
        output[led.r - 1] = Math.round(sr * dimFactor);
        output[led.g - 1] = Math.round(sg * dimFactor);
        output[led.b - 1] = Math.round(sb * dimFactor);
      }
    }
  }

  // ── Breath ───────────────────────────────────────────────────────────────────

  private processBreath(config: FxConfig, leds: LedAddress[], output: number[], elapsed: number): void {
    const legacyHz = 0.2 + (config.speed / 100) * 2.8;
    const legacyPeriodMs = 1000 / legacyHz;
    const periodMs = this.getBpmPeriodMs(config, legacyPeriodMs);
    const hz = 1000 / periodMs;
    const minFactor = 1 - (config.intensity / 100);
    const phase = (elapsed / 1000) * hz * Math.PI * 2;
    const sine = (Math.sin(phase) + 1) / 2;
    const factor = minFactor + sine * (1 - minFactor);

    for (const led of leds) {
      output[led.r - 1] = Math.round(output[led.r - 1] * factor);
      output[led.g - 1] = Math.round(output[led.g - 1] * factor);
      output[led.b - 1] = Math.round(output[led.b - 1] * factor);
    }
  }

  // ── Fire / Candle ────────────────────────────────────────────────────────────

  private processFire(
    config: FxConfig, type: FxType, leds: LedAddress[],
    output: number[], clean: number[], easeFactor: number,
  ): void {
    let changeChance: number;
    if (config.syncToBpm && config.globalBpm) {
      const periodMs = (60_000 / config.globalBpm) * (config.tempoDivider ?? 1);
      changeChance = Math.min(0.95, 40 / periodMs);
    } else {
      changeChance = 0.05 + (config.speed / 100) * 0.3;
    }
    const maxDim = config.intensity / 100;
    const targets = this.ledTargets.get(type)!;
    const currents = this.ledCurrent.get(type)!;

    for (let i = 0; i < leds.length; i++) {
      const led = leds[i];
      if (!currents.has(i)) currents.set(i, 1);
      if (!targets.has(i)) targets.set(i, 1);

      let target = targets.get(i)!;
      let current = currents.get(i)!;

      if (Math.random() < changeChance) {
        target = 1 - Math.random() * maxDim;
        targets.set(i, target);
      }

      current += (target - current) * easeFactor;
      currents.set(i, current);

      const r = clean[led.r - 1] ?? 0;
      const g = clean[led.g - 1] ?? 0;
      const b = clean[led.b - 1] ?? 0;
      output[led.r - 1] = Math.round(r * current);
      output[led.g - 1] = Math.round(g * current);
      output[led.b - 1] = Math.round(b * current);
    }
  }

  // ── Twinkle ──────────────────────────────────────────────────────────────────

  private processTwinkle(
    config: FxConfig, type: FxType, leds: LedAddress[],
    output: number[], clean: number[], now: number,
  ): void {
    const legacyIntervalMs = 2000 - (config.speed / 100) * 1900;
    const baseIntervalMs = this.getBpmPeriodMs(config, legacyIntervalMs);
    const randomness = (config.randomness ?? 50) / 100;
    const fadeMs = 2000 - ((config.fadeSpeed ?? 50) / 100) * 1950;
    const flashIntensity = config.intensity / 100;
    const [cr, cg, cb] = config.color ?? [255, 255, 255];  // sparkle target colour
    const totalLeds = leds.length;
    const targetAmount = Math.max(1, Math.round(((config.amount ?? 50) / 100) * totalLeds));
    const twinkle = this.twinkleActive.get(type)!;
    const nextTime = this.nextTwinkleTimes.get(type) ?? 0;

    if (now >= nextTime) {
      const available: number[] = [];
      for (let i = 0; i < totalLeds; i++) {
        if (!twinkle.has(i)) available.push(i);
      }
      for (let i = available.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [available[i], available[j]] = [available[j], available[i]];
      }
      for (const idx of available.slice(0, targetAmount)) {
        const fadeMsJitter = fadeMs * (1 + (Math.random() * 0.6 - 0.3) * randomness);
        twinkle.set(idx, { startTime: now, fadeMs: fadeMsJitter });
      }
      const jitter = 1 + (Math.random() * 2 - 1) * randomness;
      this.nextTwinkleTimes.set(type, now + baseIntervalMs * jitter);
    }

    for (const [ledIdx, tw] of twinkle) {
      const led = leds[ledIdx];
      if (!led) { twinkle.delete(ledIdx); continue; }
      const age = now - tw.startTime;
      if (age > tw.fadeMs) {
        twinkle.delete(ledIdx);
        output[led.r - 1] = clean[led.r - 1] ?? 0;
        output[led.g - 1] = clean[led.g - 1] ?? 0;
        output[led.b - 1] = clean[led.b - 1] ?? 0;
        continue;
      }
      const progress = age / tw.fadeMs;
      const brightness = (1 - progress) * (1 - progress) * flashIntensity;
      const origR = clean[led.r - 1] ?? 0;
      const origG = clean[led.g - 1] ?? 0;
      const origB = clean[led.b - 1] ?? 0;
      output[led.r - 1] = Math.round(origR + (cr - origR) * brightness);
      output[led.g - 1] = Math.round(origG + (cg - origG) * brightness);
      output[led.b - 1] = Math.round(origB + (cb - origB) * brightness);
    }
  }

  // ── Hue Rotator ──────────────────────────────────────────────────────────────

  /**
   * Rotates the hue of every targeted LED by a linearly advancing phase.
   * Reads the current output RGB (post-scene, post-dimmer, post-other-FX),
   * converts to HSL, shifts hue, converts back to RGB.
   * Saturation and lightness are preserved.
   */
  private processHueRotator(
    config: FxConfig, leds: LedAddress[],
    output: number[], elapsed: number,
  ): void {
    const legacyPeriodMs = config.rotatePeriodMs ?? 5000;
    const periodMs = this.getBpmPeriodMs(config, legacyPeriodMs);
    const hueShiftDeg = ((elapsed % periodMs) / periodMs) * 360;

    for (const led of leds) {
      const r = output[led.r - 1] / 255;
      const g = output[led.g - 1] / 255;
      const b = output[led.b - 1] / 255;

      // RGB → HSL
      const max = Math.max(r, g, b);
      const min = Math.min(r, g, b);
      const l = (max + min) / 2;
      let h = 0;
      let s = 0;

      if (max !== min) {
        const d = max - min;
        s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
        switch (max) {
          case r: h = ((g - b) / d + (g < b ? 6 : 0)) / 6; break;
          case g: h = ((b - r) / d + 2) / 6; break;
          case b: h = ((r - g) / d + 4) / 6; break;
        }
      }

      h = ((h * 360 + hueShiftDeg) % 360) / 360;

      let outR: number, outG: number, outB: number;
      if (s === 0) {
        outR = outG = outB = l;
      } else {
        const hue2rgb = (p: number, q: number, t: number): number => {
          if (t < 0) t += 1;
          if (t > 1) t -= 1;
          if (t < 1 / 6) return p + (q - p) * 6 * t;
          if (t < 1 / 2) return q;
          if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
          return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        outR = hue2rgb(p, q, h + 1 / 3);
        outG = hue2rgb(p, q, h);
        outB = hue2rgb(p, q, h - 1 / 3);
      }

      output[led.r - 1] = Math.round(outR * 255);
      output[led.g - 1] = Math.round(outG * 255);
      output[led.b - 1] = Math.round(outB * 255);
    }
  }
}
