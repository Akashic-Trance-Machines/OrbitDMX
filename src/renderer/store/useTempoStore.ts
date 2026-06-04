import { create } from 'zustand';

// ─── Constants ────────────────────────────────────────────────────────────────

/** How many tap timestamps to keep for averaging. */
const TAP_BUFFER_SIZE = 8;

/** Max gap between taps (ms) before the buffer resets. */
const TAP_RESET_THRESHOLD_MS = 2500;

/** Min/max BPM the engine will output. */
const BPM_MIN = 20;
const BPM_MAX = 300;

/**
 * How many beat intervals to accumulate for MIDI clock BPM averaging.
 * More = smoother, but slower to lock.
 */
const MIDI_BEAT_AVG_COUNT = 4;

/**
 * If no MIDI clock tick arrives within this window (ms), consider the
 * clock signal lost and set midiClockActive = false.
 */
const MIDI_CLOCK_TIMEOUT_MS = 2000;

// ─── Store interface ──────────────────────────────────────────────────────────

interface TempoStore {
  /**
   * Current global BPM — used by all FX timing.
   * When midiSyncEnabled AND midiClockActive, this is driven by MIDI ticks.
   * Otherwise it equals manualBpm (the last user-set value).
   */
  bpm: number;

  /**
   * Last BPM set by the user (tap or manual edit).
   * Preserved so we can fall back to it when MIDI clock signal is lost.
   */
  manualBpm: number;

  /** When true, incoming MIDI Clock (0xF8) messages drive the BPM. */
  midiSyncEnabled: boolean;

  /**
   * True when MIDI clock ticks are actively arriving (i.e. within the last
   * MIDI_CLOCK_TIMEOUT_MS ms). Distinct from midiSyncEnabled — the user can
   * have sync enabled but no source connected.
   */
  midiClockActive: boolean;

  /**
   * Pulses Per Quarter Note — how many raw 0xF8 ticks equal one beat.
   * Standard MIDI = 24. Set lower to treat each tick as a subdivision.
   * Examples: 24 = 1/4 note, 12 = 1/8 note, 6 = 1/16 note.
   */
  midiPpqn: number;

  setBpm: (bpm: number) => void;
  setMidiSyncEnabled: (on: boolean) => void;
  setMidiPpqn: (ppqn: number) => void;

  /** Record a tap; calculates running average BPM from recent taps. */
  tap: () => void;

  /**
   * Called for each raw MIDI Timing Clock (0xF8) message received.
   * Internally accumulates ticks and calculates BPM once a full beat
   * (midiPpqn ticks) has elapsed. Only updates bpm when midiSyncEnabled.
   */
  handleMidiClock: () => void;
}

// ─── Internal tap/clock state (not reactive, no re-renders needed) ────────────

// Tap tempo state
const tapTimes: number[] = [];

// MIDI Clock state
let midiTickCount    = 0;
let midiLastBeatTime = 0;
const midiBeatIntervals: number[] = [];
let midiClockTimeoutId: ReturnType<typeof setTimeout> | null = null;

// ─── Helper ───────────────────────────────────────────────────────────────────

function clampBpm(bpm: number): number {
  return Math.max(BPM_MIN, Math.min(BPM_MAX, Math.round(bpm * 10) / 10));
}

function averageIntervals(intervals: number[]): number {
  if (intervals.length === 0) return 0;
  return intervals.reduce((a, b) => a + b, 0) / intervals.length;
}

/** Arm (or re-arm) the clock-lost timeout. Fires midiClockActive → false. */
function armClockTimeout(): void {
  if (midiClockTimeoutId !== null) clearTimeout(midiClockTimeoutId);
  midiClockTimeoutId = setTimeout(() => {
    midiClockTimeoutId = null;
    // Reset accumulator so next burst locks in fresh
    midiTickCount    = 0;
    midiLastBeatTime = 0;
    midiBeatIntervals.length = 0;
    // Freeze the global BPM at the last measured MIDI tempo.
    // We update manualBpm to the current (MIDI-driven) bpm so that:
    //  - the beat dot keeps pulsing at the same rate
    //  - tap tempo and manual edits now start from this tempo
    //  - re-enabling MIDI sync and losing signal again will freeze at the right value
    const { bpm } = useTempoStore.getState();
    useTempoStore.setState({ midiClockActive: false, manualBpm: bpm });
    // bpm itself is intentionally left unchanged — it stays at the last MIDI value.
  }, MIDI_CLOCK_TIMEOUT_MS);
}

// ─── Store ────────────────────────────────────────────────────────────────────

export const useTempoStore = create<TempoStore>()((set, get) => ({
  bpm:            120,
  manualBpm:      120,
  midiSyncEnabled: false,
  midiClockActive: false,
  midiPpqn:       24,

  setBpm: (bpm) => {
    const clamped = clampBpm(bpm);
    // Always update manualBpm when the user sets a value directly
    set({ bpm: clamped, manualBpm: clamped });
  },

  setMidiSyncEnabled: (midiSyncEnabled) => {
    // Reset clock accumulator when toggling to avoid stale beats
    midiTickCount    = 0;
    midiLastBeatTime = 0;
    midiBeatIntervals.length = 0;
    if (midiClockTimeoutId !== null) { clearTimeout(midiClockTimeoutId); midiClockTimeoutId = null; }

    if (!midiSyncEnabled) {
      // Freeze the global BPM at the last measured value (may be MIDI-driven).
      // Update manualBpm to the current bpm so tap/edit starts from the right tempo.
      const currentBpm = get().bpm;
      set({ midiSyncEnabled, midiClockActive: false, manualBpm: currentBpm });
      // bpm stays at currentBpm — no jump.
    } else {
      // Enable sync — clock is not yet active until ticks arrive
      set({ midiSyncEnabled, midiClockActive: false });
    }
  },

  setMidiPpqn: (midiPpqn) => {
    // Reset accumulator when PPQN changes
    midiTickCount    = 0;
    midiLastBeatTime = 0;
    midiBeatIntervals.length = 0;
    set({ midiPpqn });
  },

  tap: () => {
    const now = Date.now();

    // Reset if too long since last tap
    if (tapTimes.length > 0 && now - tapTimes[tapTimes.length - 1] > TAP_RESET_THRESHOLD_MS) {
      tapTimes.length = 0;
    }

    tapTimes.push(now);

    // Keep only the last TAP_BUFFER_SIZE taps
    if (tapTimes.length > TAP_BUFFER_SIZE) {
      tapTimes.shift();
    }

    // Need at least 2 taps to calculate an interval
    if (tapTimes.length < 2) return;

    // Calculate intervals between consecutive taps
    const intervals: number[] = [];
    for (let i = 1; i < tapTimes.length; i++) {
      intervals.push(tapTimes[i] - tapTimes[i - 1]);
    }

    const avgInterval = averageIntervals(intervals);
    if (avgInterval <= 0) return;

    const newBpm = clampBpm(60_000 / avgInterval);
    // Tap always updates both bpm and manualBpm
    set({ bpm: newBpm, manualBpm: newBpm });
  },

  handleMidiClock: () => {
    const { midiSyncEnabled, midiPpqn } = get();
    if (!midiSyncEnabled) return;

    // Any tick arriving means the clock is alive — re-arm the timeout
    armClockTimeout();
    if (!get().midiClockActive) {
      set({ midiClockActive: true });
    }

    midiTickCount++;
    if (midiTickCount < midiPpqn) return;

    // A full beat has elapsed
    midiTickCount = 0;
    const now = Date.now();

    if (midiLastBeatTime > 0) {
      const interval = now - midiLastBeatTime;

      // Guard against jitter / impossible tempos
      if (interval > 0) {
        midiBeatIntervals.push(interval);
        if (midiBeatIntervals.length > MIDI_BEAT_AVG_COUNT) {
          midiBeatIntervals.shift();
        }

        const avgInterval = averageIntervals(midiBeatIntervals);
        if (avgInterval > 0) {
          const newBpm = clampBpm(60_000 / avgInterval);
          // MIDI sync only overrides the live bpm, not manualBpm
          set({ bpm: newBpm });
        }
      }
    }

    midiLastBeatTime = now;
  },
}));
