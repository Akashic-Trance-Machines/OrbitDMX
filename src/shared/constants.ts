// DMX protocol constants
export const DMX_UNIVERSE_SIZE = 512;
export const DMX_MIN_VALUE = 0;
export const DMX_MAX_VALUE = 255;
export const DMX_TICK_RATE_HZ = 40;
export const DMX_TICK_INTERVAL_MS = 1000 / DMX_TICK_RATE_HZ; // 25ms

// USB-DMX adapter — standard DMX baud (baud-rate BREAK + Enttec Open)
export const DMX_BAUD_RATE  = 250000;
export const DMX_DATA_BITS  = 8;
export const DMX_STOP_BITS  = 2;
export const DMX_PARITY     = 'none' as const;

// Enttec DMX USB Pro — host ↔ adapter baud rate (adapter handles DMX bus timing)
export const ENTTEC_PRO_BAUD      = 57600;
export const ENTTEC_PRO_DATA_BITS = 8;
export const ENTTEC_PRO_STOP_BITS = 1;
export const ENTTEC_PRO_PARITY    = 'none' as const;
export const ENTTEC_PRO_PROBE_TIMEOUT_MS = 300;

// Default output mode (used when no auto-detection result is available)
export const DMX_OUTPUT_MODE_DEFAULT = 'baudRateBreak' as const;

// Scene runner state machine states
export const SCENE_STATE = {
  IDLE: 'IDLE',
  PLAYING: 'PLAYING',
  FADING: 'FADING',
  HOLDING: 'HOLDING',
  NEXT: 'NEXT',
} as const;
export type SceneState = (typeof SCENE_STATE)[keyof typeof SCENE_STATE];

// Default fade duration (ms)
export const DEFAULT_FADE_MS = 1000;
