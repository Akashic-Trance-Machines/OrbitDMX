import React, { useCallback } from 'react';
import { useFxStore } from '../store/useFxStore';
import { useRoomStore } from '../store/useRoomStore';
import type { FxType } from '../../shared/types';
import './FxView.css';

/* ── FX definitions ────────────────────────────────────────────────────────── */

interface FxDef {
  type: FxType;
  label: string;
  icon: string;
  description: string;
  hasColor?: boolean;
  momentary?: boolean;    // true = hold-to-activate (strobe types)
  hasTwinkleParams?: boolean;  // show fade speed + randomness sliders
}

const FX_DEFS: FxDef[] = [
  { type: 'strobe',      label: 'Strobe',       icon: '⚡', description: 'Flash on/off at speed rate',           momentary: true },
  { type: 'strobeColor', label: 'Strobe Color',  icon: '🌈', description: 'Flash a chosen colour at speed rate', momentary: true, hasColor: true },
  { type: 'breath',      label: 'Breath',        icon: '🫁', description: 'Ease dimmer up/down sinusoidally' },
  { type: 'fire',        label: 'Fire',          icon: '🔥', description: 'Sudden random per-LED flicker' },
  { type: 'candle',      label: 'Candle',        icon: '🕯️', description: 'Smooth random per-LED flicker' },
  { type: 'twinkle',     label: 'Twinkle',       icon: '✨', description: 'Random white sparkles with fade-out', hasTwinkleParams: true },
];

/* ── Component ─────────────────────────────────────────────────────────────── */

export default function FxView() {
  const selectedType = useFxStore((s) => s.selectedType);
  const isActive = useFxStore((s) => s.isActive);
  const speed = useFxStore((s) => s.speed);
  const intensity = useFxStore((s) => s.intensity);
  const color = useFxStore((s) => s.color);
  const setSelectedType = useFxStore((s) => s.setSelectedType);
  const setIsActive = useFxStore((s) => s.setIsActive);
  const setSpeed = useFxStore((s) => s.setSpeed);
  const setIntensity = useFxStore((s) => s.setIntensity);
  const setColor = useFxStore((s) => s.setColor);
  const fadeSpeed = useFxStore((s) => s.fadeSpeed);
  const randomness = useFxStore((s) => s.randomness);
  const setFadeSpeed = useFxStore((s) => s.setFadeSpeed);
  const setRandomness = useFxStore((s) => s.setRandomness);
  const amount = useFxStore((s) => s.amount);
  const setAmount = useFxStore((s) => s.setAmount);
  const stopFx = useFxStore((s) => s.stopFx);
  const fixtures = useRoomStore((s) => s.fixtures);

  const selectedDef = FX_DEFS.find((d) => d.type === selectedType) ?? null;

  // ── Selecting an FX type ──────────────────────────────────────────────────
  const handleSelectType = useCallback(
    (type: FxType) => {
      if (isActive) {
        stopFx();
      }
      setSelectedType(selectedType === type ? null : type);
    },
    [isActive, selectedType, stopFx, setSelectedType],
  );

  // ── Continuous FX: toggle start/stop ──────────────────────────────────────
  const handleToggle = useCallback(() => {
    if (isActive) {
      stopFx();
    } else {
      setIsActive(true);
    }
  }, [isActive, stopFx, setIsActive]);

  // ── Momentary strobe: hold-to-activate ────────────────────────────────────
  const handleMomentaryDown = useCallback(() => {
    setIsActive(true);
  }, [setIsActive]);

  const handleMomentaryUp = useCallback(() => {
    stopFx();
  }, [stopFx]);

  // ── Color picker helper ───────────────────────────────────────────────────
  const colorHex = `#${color.map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  const handleColorChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const hex = e.target.value;
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    setColor([r, g, b]);
  };

  // ── Speed → seconds conversion ──────────────────────────────────────────
  // Matches the formulas in FxProcessor so the displayed value is accurate.
  const speedPeriodMs = (() => {
    if (!selectedType) return 1000;
    switch (selectedType) {
      case 'strobe':
      case 'strobeColor': {
        const hz = 1 + (speed / 100) * 24; // 1–25 Hz
        return 1000 / hz;
      }
      case 'breath': {
        const hz = 0.2 + (speed / 100) * 2.8; // 0.2–3 Hz
        return 1000 / hz;
      }
      case 'fire':
      case 'candle':
      case 'twinkle':
      default: {
        // Rate-based: approximate period = 2s at speed=0, 0.1s at speed=100
        return 2000 - (speed / 100) * 1900;
      }
    }
  })();

  const speedLabel = speedPeriodMs >= 1000
    ? `${(speedPeriodMs / 1000).toFixed(1)}s`
    : `${Math.round(speedPeriodMs)}ms`;

  // ── Render ──────────────────────────────────────────────────────────────
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
            const isRunning = isSelected && isActive;

            return (
              <button
                key={def.type}
                className={`fx-card ${isSelected ? 'selected' : ''} ${isRunning ? 'running' : ''}`}
                onClick={() => handleSelectType(def.type)}
              >
                <span className="fx-card-icon">{def.icon}</span>
                <span className="fx-card-label">{def.label}</span>
                <span className="fx-card-desc text-dim">{def.description}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Right: control panel */}
      {selectedDef && (
        <div className="fx-control-pane">
          <div className="fx-panel-header">
            <h2 className="fx-panel-title">
              <span className="fx-panel-icon">{selectedDef.icon}</span>
              {selectedDef.label}
            </h2>
            <button
              className="fx-panel-close"
              title="Close"
              onClick={() => {
                stopFx();
                setSelectedType(null);
              }}
            >✕</button>
          </div>

          <div className="fx-panel-body">
            {/* Activation button */}
            {selectedDef.momentary ? (
              <div className="fx-activate-section">
                <button
                  className={`fx-momentary-btn ${isActive ? 'active' : ''}`}
                  onMouseDown={handleMomentaryDown}
                  onMouseUp={handleMomentaryUp}
                  onMouseLeave={handleMomentaryUp}
                  onTouchStart={handleMomentaryDown}
                  onTouchEnd={handleMomentaryUp}
                >
                  ⚡ HOLD TO {selectedDef.label.toUpperCase()}
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

            {/* Speed indicator blink + sliders */}
            <div className="fx-settings-section">
              {/* Speed indicator light — always blinks when an FX type is selected */}
              <div className="fx-speed-indicator-row">
                <span
                  className="fx-speed-blink"
                  style={{ animationDuration: `${speedPeriodMs}ms` }}
                />
                <span className="fx-speed-period mono">{speedLabel}</span>
              </div>

              {/* Speed */}
              <div className="fx-slider-row">
                <label className="fx-slider-label">Speed</label>
                <input
                  type="range"
                  className="fx-slider"
                  min={0}
                  max={100}
                  step={1}
                  value={speed}
                  onChange={(e) => setSpeed(parseInt(e.target.value))}
                  style={{
                    background: `linear-gradient(to right, var(--color-accent) ${speed}%, var(--color-surface-3) ${speed}%)`,
                  }}
                />
                <span className="fx-slider-value mono">{speedLabel}</span>
              </div>

              {/* Intensity */}
              <div className="fx-slider-row">
                <label className="fx-slider-label">Intensity</label>
                <input
                  type="range"
                  className="fx-slider"
                  min={0}
                  max={100}
                  step={1}
                  value={intensity}
                  onChange={(e) => setIntensity(parseInt(e.target.value))}
                  style={{
                    background: `linear-gradient(to right, var(--color-accent) ${intensity}%, var(--color-surface-3) ${intensity}%)`,
                  }}
                />
                <span className="fx-slider-value mono">{intensity}%</span>
              </div>

              {/* Color picker (strobe color only) */}
              {selectedDef.hasColor && (
                <div className="fx-slider-row">
                  <label className="fx-slider-label">Color</label>
                  <div className="fx-color-picker">
                    <input
                      type="color"
                      className="fx-color-input"
                      value={colorHex}
                      onChange={handleColorChange}
                    />
                    <span
                      className="fx-color-swatch"
                      style={{ background: colorHex }}
                    />
                    <span className="fx-slider-value mono">{colorHex.toUpperCase()}</span>
                  </div>
                </div>
              )}

              {/* Twinkle: Fade Speed */}
              {selectedDef.hasTwinkleParams && (
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
                      onChange={(e) => setFadeSpeed(parseInt(e.target.value))}
                      style={{
                        background: `linear-gradient(to right, var(--color-accent) ${fadeSpeed}%, var(--color-surface-3) ${fadeSpeed}%)`,
                      }}
                    />
                    <span className="fx-slider-value mono">
                      {(() => {
                        const ms = 2000 - (fadeSpeed / 100) * 1950;
                        return ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;
                      })()}
                    </span>
                  </div>

                  {/* Twinkle: Randomness */}
                  <div className="fx-slider-row">
                    <label className="fx-slider-label">Random</label>
                    <input
                      type="range"
                      className="fx-slider"
                      min={0}
                      max={100}
                      step={1}
                      value={randomness}
                      onChange={(e) => setRandomness(parseInt(e.target.value))}
                      style={{
                        background: `linear-gradient(to right, var(--color-accent) ${randomness}%, var(--color-surface-3) ${randomness}%)`,
                      }}
                    />
                    <span className="fx-slider-value mono">{randomness}%</span>
                  </div>

                  {/* Twinkle: Amount */}
                  <div className="fx-slider-row">
                    <label className="fx-slider-label">Amount</label>
                    <input
                      type="range"
                      className="fx-slider"
                      min={1}
                      max={100}
                      step={1}
                      value={amount}
                      onChange={(e) => setAmount(parseInt(e.target.value))}
                      style={{
                        background: `linear-gradient(to right, var(--color-accent) ${amount}%, var(--color-surface-3) ${amount}%)`,
                      }}
                    />
                    <span className="fx-slider-value mono">{amount}%</span>
                  </div>
                </>
              )}
            </div>

            {/* Info */}
            <div className="fx-info text-dim">
              {selectedDef.momentary
                ? 'Hold the button to activate this effect. Release to return to normal.'
                : 'Click Start to activate. Parameters update in real-time.'}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
