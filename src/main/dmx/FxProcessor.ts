import type { FxConfig, LedAddress } from '../../shared/types';

/**
 * FxProcessor — real-time effect processing for the DMX tick loop.
 *
 * Each tick, `processTick()` modifies the output buffer in-place,
 * layering the active effect on top of the scene values + room dimmer.
 *
 * Only one effect is active at a time.
 */
export class FxProcessor {
  private config: FxConfig | null = null;
  private ledAddresses: LedAddress[] = [];
  private dimmerAddresses: Set<number> = new Set();

  // Per-LED state for fire/candle/twinkle effects
  private ledTargets: Map<number, number> = new Map();   // target brightness 0–1
  private ledCurrent: Map<number, number> = new Map();   // current brightness 0–1
  private twinkleActive: Map<number, { startTime: number; fadeMs: number }> = new Map();
  private nextTwinkleTime = 0;

  private startTime = 0;

  setConfig(config: FxConfig | null): void {
    if (config && (!this.config || this.config.type !== config.type)) {
      // New effect — reset state
      this.startTime = Date.now();
      this.nextTwinkleTime = 0;
      this.ledTargets.clear();
      this.ledCurrent.clear();
      this.twinkleActive.clear();
      this.startTime = Date.now();
    }
    this.config = config;
  }

  setLedAddresses(addresses: LedAddress[]): void {
    this.ledAddresses = addresses;
  }

  setDimmerAddresses(addresses: Set<number>): void {
    this.dimmerAddresses = addresses;
  }

  /**
   * Modify the output buffer in-place. Called every tick (~25ms).
   *
   * @param output  - The buffer to write to (already has scene + room dimmer)
   * @param clean   - The original scene values (unmodified reference)
   */
  processTick(output: number[], clean: number[]): void {
    if (!this.config || !this.config.active) return;

    const now = Date.now();
    const elapsed = now - this.startTime;

    switch (this.config.type) {
      case 'strobe':
        this.processStrobe(output, clean, elapsed);
        break;
      case 'strobeColor':
        this.processStrobeColor(output, clean, elapsed);
        break;
      case 'breath':
        this.processBreath(output, clean, elapsed);
        break;
      case 'fire':
        this.processFire(output, clean, 0.15);  // fast easing
        break;
      case 'candle':
        this.processFire(output, clean, 0.04);  // slow easing
        break;
      case 'twinkle':
        this.processTwinkle(output, clean, now);
        break;
    }
  }

  // ── Strobe ──────────────────────────────────────────────────────────────

  private processStrobe(output: number[], clean: number[], elapsed: number): void {
    // Speed 0–100 → 1–25 Hz
    const hz = 1 + (this.config!.speed / 100) * 24;
    const period = 1000 / hz;
    const phase = (elapsed % period) / period;
    const isOn = phase < 0.5;

    // Intensity controls dim depth: 100% = full black, 0% = no visible change
    const dimFactor = 1 - (this.config!.intensity / 100); // 0 at 100% intensity, 1 at 0%

    if (!isOn) {
      // Dim LED channels by intensity amount
      for (const led of this.ledAddresses) {
        output[led.r - 1] = Math.round(output[led.r - 1] * dimFactor);
        output[led.g - 1] = Math.round(output[led.g - 1] * dimFactor);
        output[led.b - 1] = Math.round(output[led.b - 1] * dimFactor);
      }
      for (const addr of this.dimmerAddresses) {
        output[addr - 1] = Math.round(output[addr - 1] * dimFactor);
      }
    }
    // When isOn, output stays as-is (scene colours)
  }

  // ── Strobe Color ────────────────────────────────────────────────────────

  private processStrobeColor(output: number[], clean: number[], elapsed: number): void {
    const hz = 1 + (this.config!.speed / 100) * 24;
    const period = 1000 / hz;
    const phase = (elapsed % period) / period;
    const isOn = phase < 0.5;

    const [cr, cg, cb] = this.config!.color ?? [255, 255, 255];
    // Intensity controls flash brightness: 100% = full chosen color, 0% = barely visible
    const flashFactor = this.config!.intensity / 100;

    if (isOn) {
      // Flash the chosen colour scaled by intensity
      for (const led of this.ledAddresses) {
        const origR = output[led.r - 1];
        const origG = output[led.g - 1];
        const origB = output[led.b - 1];
        output[led.r - 1] = Math.round(origR + (cr - origR) * flashFactor);
        output[led.g - 1] = Math.round(origG + (cg - origG) * flashFactor);
        output[led.b - 1] = Math.round(origB + (cb - origB) * flashFactor);
      }
      // Scale dimmers toward full by intensity
      for (const addr of this.dimmerAddresses) {
        const orig = output[addr - 1];
        output[addr - 1] = Math.round(orig + (255 - orig) * flashFactor);
      }
    }
    // When off, output stays as-is (scene colours show through)
  }

  // ── Breath ──────────────────────────────────────────────────────────────

  private processBreath(output: number[], _clean: number[], elapsed: number): void {
    // Speed 0–100 → 0.2–3 Hz (breaths per second)
    const hz = 0.2 + (this.config!.speed / 100) * 2.8;
    // Intensity 0–100 → min dimmer 0%–80% (how dim it gets at the bottom)
    const minFactor = 1 - (this.config!.intensity / 100);

    const phase = (elapsed / 1000) * hz * Math.PI * 2;
    const sine = (Math.sin(phase) + 1) / 2; // 0–1 (ease in/out)
    const factor = minFactor + sine * (1 - minFactor);

    // Apply to dimmer channels
    for (const addr of this.dimmerAddresses) {
      output[addr - 1] = Math.round(output[addr - 1] * factor);
    }
  }

  // ── Fire / Candle ───────────────────────────────────────────────────────

  private processFire(output: number[], clean: number[], easeFactor: number): void {
    // Speed controls how often we pick new targets
    const changeChance = 0.05 + (this.config!.speed / 100) * 0.3;
    // Intensity controls the flicker depth
    const maxDim = this.config!.intensity / 100;

    for (let i = 0; i < this.ledAddresses.length; i++) {
      const led = this.ledAddresses[i];

      // Get or init current/target for this LED
      if (!this.ledCurrent.has(i)) this.ledCurrent.set(i, 1);
      if (!this.ledTargets.has(i)) this.ledTargets.set(i, 1);

      let target = this.ledTargets.get(i)!;
      let current = this.ledCurrent.get(i)!;

      // Randomly pick new target
      if (Math.random() < changeChance) {
        target = 1 - Math.random() * maxDim;
        this.ledTargets.set(i, target);
      }

      // Ease toward target
      current += (target - current) * easeFactor;
      this.ledCurrent.set(i, current);

      // Apply: scale the LED's RGB channels by the current factor
      // Keep the original colour, just vary brightness
      const r = clean[led.r - 1] ?? 0;
      const g = clean[led.g - 1] ?? 0;
      const b = clean[led.b - 1] ?? 0;

      output[led.r - 1] = Math.round(r * current);
      output[led.g - 1] = Math.round(g * current);
      output[led.b - 1] = Math.round(b * current);
    }
  }

  // ── Twinkle ─────────────────────────────────────────────────────────────

  private processTwinkle(output: number[], clean: number[], now: number): void {
    // Speed maps to base interval: 2000ms at 0% down to 100ms at 100%
    const baseIntervalMs = 2000 - (this.config!.speed / 100) * 1900;

    // Randomness 0–100: controls interval variation and fade variation
    const randomness = (this.config!.randomness ?? 50) / 100;

    // Fade speed 0–100 → fade-out duration: 2000ms (slow) to 50ms (fast)
    const fadeMs = 2000 - ((this.config!.fadeSpeed ?? 50) / 100) * 1950;

    // Intensity controls the brightness of the white flash (0% = subtle, 100% = full white)
    const flashIntensity = this.config!.intensity / 100;

    // Amount 0–100: exactly how many new LEDs start twinkling per interval
    const totalLeds = this.ledAddresses.length;
    const targetAmount = Math.max(1, Math.round(((this.config!.amount ?? 50) / 100) * totalLeds));

    // Time to trigger the next cluster?
    if (now >= this.nextTwinkleTime) {
      // Find available LEDs
      const availableLeds: number[] = [];
      for (let i = 0; i < totalLeds; i++) {
        if (!this.twinkleActive.has(i)) availableLeds.push(i);
      }

      // Shuffle using Fisher-Yates and pick exactly `targetAmount`
      for (let i = availableLeds.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [availableLeds[i], availableLeds[j]] = [availableLeds[j], availableLeds[i]];
      }
      const toTrigger = availableLeds.slice(0, targetAmount);

      // Trigger them
      for (const idx of toTrigger) {
        const fadeMsJitter = fadeMs * (1 + (Math.random() * 0.6 - 0.3) * randomness);
        this.twinkleActive.set(idx, { startTime: now, fadeMs: fadeMsJitter });
      }

      // Schedule next trigger time
      const jitter = 1 + (Math.random() * 2 - 1) * randomness; // range: [1-randomness, 1+randomness]
      this.nextTwinkleTime = now + (baseIntervalMs * jitter);
    }

    // Process active twinkles
    for (const [ledIdx, twinkle] of this.twinkleActive) {
      const led = this.ledAddresses[ledIdx];
      if (!led) { this.twinkleActive.delete(ledIdx); continue; }

      const age = now - twinkle.startTime;

      if (age > twinkle.fadeMs) {
        // Twinkle done — restore original
        this.twinkleActive.delete(ledIdx);
        output[led.r - 1] = clean[led.r - 1] ?? 0;
        output[led.g - 1] = clean[led.g - 1] ?? 0;
        output[led.b - 1] = clean[led.b - 1] ?? 0;
        continue;
      }

      // Ease-out: use quadratic falloff for a smoother fade
      const progress = age / twinkle.fadeMs; // 0→1
      const brightness = (1 - progress) * (1 - progress) * flashIntensity; // quadratic ease-out

      const origR = clean[led.r - 1] ?? 0;
      const origG = clean[led.g - 1] ?? 0;
      const origB = clean[led.b - 1] ?? 0;

      // Blend from white toward original colour
      output[led.r - 1] = Math.round(origR + (255 - origR) * brightness);
      output[led.g - 1] = Math.round(origG + (255 - origG) * brightness);
      output[led.b - 1] = Math.round(origB + (255 - origB) * brightness);
    }
  }
}
