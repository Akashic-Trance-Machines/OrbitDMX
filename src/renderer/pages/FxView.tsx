import React, { useCallback } from 'react';
import { useFxStore } from '../store/useFxStore';
import { useRoomStore } from '../store/useRoomStore';
import { useTempoStore } from '../store/useTempoStore';
import { collectFilteredLedAddresses } from '../utils/ledAddresses';
import FixtureTargetSelector from '../components/FixtureTargetSelector';
import { HtsColorPicker } from '../components/HtsColorPicker';
import type { FxType, FixtureTarget } from '../../shared/types';
import './FxView.css';

/* ── Rainbow rotator icon (SVG) ─────────────────────────────────────────────── */

function RainbowRotatorIcon({ size = 32 }: { size?: number }) {
  const id = 'hue-rot-grad';
  const cx = size / 2;
  const cy = size / 2;
  const r  = size * 0.38;
  const sw = size * 0.18;
  const ah = size * 0.13;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden>
      <defs>
        <linearGradient id={id} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%"   stopColor="#ff0000" />
          <stop offset="17%"  stopColor="#ff8800" />
          <stop offset="34%"  stopColor="#ffff00" />
          <stop offset="50%"  stopColor="#00ff00" />
          <stop offset="67%"  stopColor="#0088ff" />
          <stop offset="84%"  stopColor="#8800ff" />
          <stop offset="100%" stopColor="#ff0055" />
        </linearGradient>
      </defs>
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={`url(#${id})`}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeDasharray={`${circ * 0.83} ${circ}`}
        transform={`rotate(100, ${cx}, ${cy})`}
      />
      <polygon
        points={`${cx},${cy - r - sw * 0.5} ${cx + ah},${cy - r + ah * 0.6} ${cx - ah},${cy - r + ah * 0.6}`}
        fill="#ff0055"
        transform={`rotate(20, ${cx}, ${cy})`}
      />
    </svg>
  );
}

/* ── FX definitions ─────────────────────────────────────────────────────────── */

interface FxDef {
  type: FxType;
  label: string;
  icon: string;
  description: string;
  hasColor?: boolean;
  momentary?: boolean;         // hold-to-activate (strobe types)
  hasTwinkleParams?: boolean;  // show fade speed + randomness sliders
  hasRotateParams?: boolean;   // Time/360 replaces Speed
  hideSpeed?: boolean;         // suppress the Speed slider
  hideIntensity?: boolean;     // suppress the Intensity slider
}

const FX_DEFS: FxDef[] = [
  { type: 'strobe',      label: 'Strobe',       icon: String.fromCodePoint(0x26A1), description: 'Flash on/off at speed rate', momentary: true },
  { type: 'strobeColor', label: 'Strobe Color',  icon: String.fromCodePoint(0x1F308), description: 'Flash a chosen colour at speed rate', momentary: true, hasColor: true },
  { type: 'breath',      label: 'Breath',        icon: String.fromCodePoint(0x1FAB4), description: 'Ease dimmer up/down sinusoidally' },
  { type: 'fire',        label: 'Fire',          icon: String.fromCodePoint(0x1F525), description: 'Sudden random per-LED flicker' },
  { type: 'candle',      label: 'Candle',        icon: String.fromCodePoint(0x1F56F, 0xFE0F), description: 'Smooth random per-LED flicker' },
  { type: 'twinkle',     label: 'Twinkle',       icon: String.fromCodePoint(0x2728), description: 'Random white sparkles with fade-out', hasTwinkleParams: true, hasColor: true },
  { type: 'hueRotator',  label: 'Hue Rotator',   icon: null, description: "Continuously rotate hue of each spot's colour", hasRotateParams: true, hideIntensity: true },
];

/** Render card / panel icon for an FX definition. */
function renderIcon(def: FxDef, size = 32): React.ReactNode {
  if (def.type === 'hueRotator') return <RainbowRotatorIcon size={size} />;
  return def.icon;
}

/* ── Panel for one selected FX type ─────────────────────────────────────────── */

interface FxPanelProps {
  def: FxDef;
  onClose: () => void;
}

function FxPanel({ def, onClose }: FxPanelProps) {
  const fxStates  = useFxStore((s) => s.fxStates);
  const setFxParam  = useFxStore((s) => s.setFxParam);
  const setFxActive = useFxStore((s) => s.setFxActive);
  const fixtures  = useRoomStore((s) => s.fixtures);
  const bpm       = useTempoStore((s) => s.bpm);

  const { type } = def;
  const state = fxStates[type];
  const { isActive, speed, intensity, color, fadeSpeed, randomness, amount,
          syncToBpm, tempoDivider, quantiseStrobe, rotatePeriodMs, target } = state;

  // ── Speed/period display helpers ──────────────────────────────────────────
  const DMX_MIN_PERIOD_MS = 50;
  const DMX_QUANTUM_MS    = 50;

  const rawPeriodMs = (() => {
    if (syncToBpm) return (60000 / bpm) * tempoDivider;
    if (def.hasRotateParams) return rotatePeriodMs;  // hueRotator uses its own period
    switch (type) {
      case 'strobe':
      case 'strobeColor': { const hz = 1 + (speed / 100) * 19; return 1000 / hz; }
      case 'breath': { const hz = 0.2 + (speed / 100) * 2.8; return 1000 / hz; }
      default: return 2000 - (speed / 100) * 1900;
    }
  })();

  const isCapped        = rawPeriodMs < DMX_MIN_PERIOD_MS;
  const speedPeriodMs   = Math.max(rawPeriodMs, DMX_MIN_PERIOD_MS);
  const quantisedPeriodMs = Math.max(DMX_QUANTUM_MS, Math.round(speedPeriodMs / DMX_QUANTUM_MS) * DMX_QUANTUM_MS);
  const isStrobeType    = type === 'strobe' || type === 'strobeColor';
  const isQuantised     = quantiseStrobe && isStrobeType;
  const effectivePeriodMs = isQuantised ? quantisedPeriodMs : speedPeriodMs;

  const fmtMs = (ms: number) => ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`;
  const speedLabel     = fmtMs(effectivePeriodMs);
  const quantisedLabel = fmtMs(quantisedPeriodMs);

  // ── Color picker helper ────────────────────────────────────────────────────
  const [colorR, colorG, colorB] = color;
  const handleColorChange = useCallback((r: number, g: number, b: number) => {
    setFxParam(type, 'color', [r, g, b]);
  }, [type, setFxParam]);

  // ── Target change → re-sync LED addresses ─────────────────────────────────
  const handleTargetChange = useCallback((t: FixtureTarget) => {
    setFxParam(type, 'target', t);
    const addresses = collectFilteredLedAddresses(fixtures, t);
    if (typeof window.dmx !== 'undefined') {
      window.dmx.setFxLedAddressesForType(type, addresses);
    }
  }, [type, fixtures, setFxParam]);

  // ── Active toggles ─────────────────────────────────────────────────────────
  const handleToggle = useCallback(() => {
    setFxActive(type, !isActive);
  }, [type, isActive, setFxActive]);

  const handleMomentaryDown = useCallback(() => {
    setFxActive(type, true);
  }, [type, setFxActive]);

  const handleMomentaryUp = useCallback(() => {
    setFxActive(type, false);
  }, [type, setFxActive]);

  // ── Sync helper for BPM toggle ─────────────────────────────────────────────
  const handleSyncToBpmToggle = () => {
    setFxParam(type, 'syncToBpm', !syncToBpm);
  };

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="fx-control-pane">
      <div className="fx-panel-header">
        <h2 className="fx-panel-title">
          <span className="fx-panel-icon">{renderIcon(def, 22)}</span>
          {def.label}
          {isActive && <span className="fx-panel-active-badge">● LIVE</span>}
        </h2>
        <button className="fx-panel-close" title="Close" onClick={onClose}>✕</button>
      </div>

      <div className="fx-panel-body">
        {/* Activation button */}
        {def.momentary ? (
          <div className="fx-activate-section">
            <button
              className={`fx-momentary-btn ${isActive ? 'active' : ''}`}
              onMouseDown={handleMomentaryDown}
              onMouseUp={handleMomentaryUp}
              onMouseLeave={handleMomentaryUp}
              onTouchStart={handleMomentaryDown}
              onTouchEnd={handleMomentaryUp}
            >
              ⚡ HOLD TO {def.label.toUpperCase()}
            </button>
          </div>
        ) : (
          <div className="fx-activate-section">
            <button
              className={`fx-toggle-btn ${isActive ? 'active' : ''}`}
              onClick={handleToggle}
            >
              {isActive ? '⏹ Stop' : '▶ Start'}
            </button>
          </div>
        )}

        {/* Settings: timing + intensity + extras */}
        <div className="fx-settings-section">
          {/* BPM sync toggle */}
          <div className="fx-tempo-section">
            <div className="fx-tempo-toggle-row">
              <span className="fx-slider-label">Sync to Global Tempo</span>
              <button
                className={`fx-tempo-toggle-btn ${syncToBpm ? 'active' : ''}`}
                onClick={handleSyncToBpmToggle}
                role="switch"
                aria-checked={syncToBpm}
                title={`Global BPM: ${bpm.toFixed(1)}`}
              >
                <span className="fx-tempo-toggle-thumb" />
              </button>
            </div>

            {/* Quantise toggle — strobe only */}
            {isStrobeType && (
              <div className="fx-tempo-toggle-row">
                <span className="fx-slider-label">Quantise to frame grid</span>
                <button
                  className={`fx-tempo-toggle-btn ${quantiseStrobe ? 'active' : ''}`}
                  onClick={() => setFxParam(type, 'quantiseStrobe', !quantiseStrobe)}
                  role="switch"
                  aria-checked={quantiseStrobe}
                  title="Snap period to nearest 50ms (2 DMX frames) for jitter-free strobing"
                >
                  <span className="fx-tempo-toggle-thumb" />
                </button>
              </div>
            )}

            {syncToBpm ? (
              <>
                <div className="fx-slider-row">
                  <label className="fx-slider-label">Divider</label>
                  <select
                    className="fx-divider-select"
                    value={tempoDivider}
                    onChange={(e) => setFxParam(type, 'tempoDivider', parseFloat(e.target.value))}
                  >
                    <option value={4}>4 bars</option>
                    <option value={2}>2 bars</option>
                    <option value={1}>1/1</option>
                    <option value={0.5}>1/2</option>
                    <option value={0.25}>1/4</option>
                    <option value={0.125}>1/8</option>
                    <option value={0.0625}>1/16</option>
                    <option value={0.03125}>1/32</option>
                  </select>
                  <span className="fx-tempo-preview mono">
                    = {speedLabel} @ {bpm.toFixed(0)} BPM
                  </span>
                </div>
                <div className="fx-speed-indicator-row">
                  <span className="fx-speed-blink" style={{ animationDuration: `${speedPeriodMs}ms` }} />
                  <span className="fx-speed-period mono">{speedLabel}</span>
                </div>
              </>
            ) : (
              <>
                {/* Time / 360° for hueRotator — replaces Speed */}
                {def.hasRotateParams ? (
                  <div className="fx-slider-row">
                    <label className="fx-slider-label">Time / 360°</label>
                    <input
                      type="range"
                      className="fx-slider"
                      min={500}
                      max={60000}
                      step={500}
                      value={rotatePeriodMs}
                      onChange={(e) => setFxParam(type, 'rotatePeriodMs', parseInt(e.target.value))}
                      style={{
                        background: `linear-gradient(to right, var(--color-accent) ${((rotatePeriodMs - 500) / 59500) * 100}%, var(--color-surface-3) ${((rotatePeriodMs - 500) / 59500) * 100}%)`,
                      }}
                    />
                    <span className="fx-slider-value mono">
                      {rotatePeriodMs >= 1000
                        ? `${(rotatePeriodMs / 1000).toFixed(1)}s`
                        : `${rotatePeriodMs}ms`}
                    </span>
                  </div>
                ) : (
                  /* Standard speed slider for all other types */
                  <>
                    <div className="fx-speed-indicator-row">
                      <span className="fx-speed-blink" style={{ animationDuration: `${speedPeriodMs}ms` }} />
                      <span className="fx-speed-period mono">{speedLabel}</span>
                    </div>
                    <div className="fx-slider-row">
                      <label className="fx-slider-label">Speed</label>
                      <input
                        type="range"
                        className="fx-slider"
                        min={0}
                        max={100}
                        step={1}
                        value={speed}
                        onChange={(e) => setFxParam(type, 'speed', parseInt(e.target.value))}
                        style={{
                          background: `linear-gradient(to right, var(--color-accent) ${speed}%, var(--color-surface-3) ${speed}%)`,
                        }}
                      />
                      <span className="fx-slider-value mono">{speedLabel}</span>
                    </div>
                  </>
                )}
              </>
            )}
          </div>

          {/* DMX speed cap warning */}
          {isCapped && (
            <div className="fx-cap-warning">
              ⚠ Capped to 50ms — DMX runs at 40 Hz (25ms/frame, 2 frames minimum)
            </div>
          )}

          {/* Quantise info */}
          {isStrobeType && quantiseStrobe && (
            <div className="fx-quantise-info mono">
              {speedPeriodMs === quantisedPeriodMs
                ? `${quantisedLabel} — already on grid ✓`
                : `${fmtMs(speedPeriodMs)} → snapped to ${quantisedLabel} (${quantisedPeriodMs / 25} frames)`}
            </div>
          )}

          {/* Intensity — hidden for hueRotator */}
          {!def.hideIntensity && (
            <div className="fx-slider-row">
              <label className="fx-slider-label">Intensity</label>
              <input
                type="range"
                className="fx-slider"
                min={0}
                max={100}
                step={1}
                value={intensity}
                onChange={(e) => setFxParam(type, 'intensity', parseInt(e.target.value))}
                style={{
                  background: `linear-gradient(to right, var(--color-accent) ${intensity}%, var(--color-surface-3) ${intensity}%)`,
                }}
              />
              <span className="fx-slider-value mono">{intensity}%</span>
            </div>
          )}

          {/* Color picker — strobeColor and twinkle */}
          {def.hasColor && (
            <div className="fx-color-picker-wrap">
              <HtsColorPicker
                r={colorR}
                g={colorG}
                b={colorB}
                onChange={handleColorChange}
                label="Color"
                size={160}
              />
            </div>
          )}


          {/* Twinkle extras */}
          {def.hasTwinkleParams && (
            <>
              <div className="fx-slider-row">
                <label className="fx-slider-label">Fade</label>
                <input
                  type="range"
                  className="fx-slider"
                  min={0}
                  max={100}
                  step={1}
                  value={fadeSpeed}
                  onChange={(e) => setFxParam(type, 'fadeSpeed', parseInt(e.target.value))}
                  style={{
                    background: `linear-gradient(to right, var(--color-accent) ${fadeSpeed}%, var(--color-surface-3) ${fadeSpeed}%)`,
                  }}
                />
                <span className="fx-slider-value mono">
                  {(() => { const ms = 2000 - (fadeSpeed / 100) * 1950; return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`; })()}
                </span>
              </div>

              <div className="fx-slider-row">
                <label className="fx-slider-label">Random</label>
                <input
                  type="range"
                  className="fx-slider"
                  min={0}
                  max={100}
                  step={1}
                  value={randomness}
                  onChange={(e) => setFxParam(type, 'randomness', parseInt(e.target.value))}
                  style={{
                    background: `linear-gradient(to right, var(--color-accent) ${randomness}%, var(--color-surface-3) ${randomness}%)`,
                  }}
                />
                <span className="fx-slider-value mono">{randomness}%</span>
              </div>

              <div className="fx-slider-row">
                <label className="fx-slider-label">Amount</label>
                <input
                  type="range"
                  className="fx-slider"
                  min={1}
                  max={100}
                  step={1}
                  value={amount}
                  onChange={(e) => setFxParam(type, 'amount', parseInt(e.target.value))}
                  style={{
                    background: `linear-gradient(to right, var(--color-accent) ${amount}%, var(--color-surface-3) ${amount}%)`,
                  }}
                />
                <span className="fx-slider-value mono">{amount}%</span>
              </div>
            </>
          )}

          {/* Fixture target picker */}
          <FixtureTargetSelector target={target} onChange={handleTargetChange} />
        </div>

        {/* Info */}
        <div className="fx-info text-dim">
          {def.momentary
            ? 'Hold the button to activate this effect. Release to return to normal.'
            : 'Click Start to activate. Parameters update in real-time. Multiple effects can run simultaneously.'}
        </div>
      </div>
    </div>
  );
}

/* ── Main view ───────────────────────────────────────────────────────────────── */

export default function FxView() {
  const selectedType  = useFxStore((s) => s.selectedType);
  const fxStates      = useFxStore((s) => s.fxStates);
  const setSelectedType = useFxStore((s) => s.setSelectedType);

  const selectedDef = FX_DEFS.find((d) => d.type === selectedType) ?? null;

  const handleCardClick = useCallback((type: FxType) => {
    // Clicking just opens/closes the panel — does NOT affect isActive
    setSelectedType(selectedType === type ? null : type);
  }, [selectedType, setSelectedType]);

  return (
    <div className={`fx-view ${selectedDef ? 'has-panel' : ''}`}>
      {/* Left: FX grid */}
      <div className="fx-list-pane">
        <div className="fx-view-header">
          <h1>Effects</h1>
        </div>

        <div className="fx-grid">
          {FX_DEFS.map((def) => {
            const isSelected = selectedType === def.type;
            const isRunning  = fxStates[def.type]?.isActive ?? false;

            return (
              <button
                key={def.type}
                className={`fx-card ${isSelected ? 'selected' : ''} ${isRunning ? 'running' : ''}`}
                onClick={() => handleCardClick(def.type)}
              >
                {isRunning && <span className="fx-card-running-dot" aria-label="Active" />}
                <span className="fx-card-icon">{renderIcon(def)}</span>
                <span className="fx-card-label">{def.label}</span>
                <span className="fx-card-desc text-dim">{def.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: control panel for selected type */}
      {selectedDef && (
        <FxPanel
          def={selectedDef}
          onClose={() => setSelectedType(null)}
        />
      )}
    </div>
  );
}
