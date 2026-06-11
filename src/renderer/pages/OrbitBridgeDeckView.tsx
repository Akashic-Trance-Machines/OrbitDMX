import React, { useEffect, useCallback, useState, useRef } from 'react';
import { useOrbitBridgeDeckStore } from '../store/useOrbitBridgeDeckStore';
import { useMidiStore } from '../store/useMidiStore';
import { sendOrbitBridgeDeckSysEx } from '../hooks/useMidiListener';
import type { ButtonConfig, SliderConfig } from '../store/useOrbitBridgeDeckStore';
import './OrbitBridgeDeckView.css';

// SysEx command constants (mirror firmware midi_handler.c)
const CMD_SET_BUTTON     = 0x01;
const CMD_SET_SLIDER     = 0x02;
const CMD_SAVE_FLASH     = 0x10;
const CMD_RESET_DEFAULTS = 0x11;
const CMD_GET_ALL        = 0x22;

// MIDI channel options 1-16
const CHANNELS = Array.from({ length: 16 }, (_, i) => i + 1);

interface Activity {
  channel: number;
  cc: number;
  value: number;
}

// ── Section icons ─────────────────────────────────────────────────────────────

function IconPad() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <circle cx="6.5" cy="6.5" r="5.25" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="6.5" cy="6.5" r="2.5"  fill="currentColor" />
    </svg>
  );
}

function IconSlider() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
      <rect x="0.75" y="5.75" width="11.5" height="1.5" rx="0.75" fill="currentColor" />
      <circle cx="6.5" cy="6.5" r="2.75" fill="var(--color-surface-2, #1a1a2e)"
              stroke="currentColor" strokeWidth="1.5" />
    </svg>
  );
}

function IconDevice() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1" y="3" width="14" height="10" rx="2" stroke="currentColor" strokeWidth="1.5" />
      <circle cx="4.5" cy="8" r="1.25" fill="currentColor" />
      <circle cx="8"   cy="8" r="1.25" fill="currentColor" />
      <circle cx="11.5" cy="8" r="1.25" fill="currentColor" />
    </svg>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

export default function OrbitBridgeDeckView() {
  const buttons     = useOrbitBridgeDeckStore((s) => s.buttons);
  const sliders     = useOrbitBridgeDeckStore((s) => s.sliders);
  const isLoading   = useOrbitBridgeDeckStore((s) => s.isLoading);
  const lastSavedAt = useOrbitBridgeDeckStore((s) => s.lastSavedAt);
  const isConnected = useMidiStore((s) => s.isOrbitBridgeDeckConnected);
  const lastMessage = useMidiStore((s) => s.lastMessage);
  const { updateButton, updateSlider, setIsLoading, markSaved, resetToDefaults } =
    useOrbitBridgeDeckStore.getState();

  // Live activity — throttled to 20 fps to prevent React update-depth overflow
  const [activity, setActivity] = useState<Activity | null>(null);
  const activityThrottleRef = useRef<number>(0);
  const activityFadeRef     = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!lastMessage) return;
    const now = Date.now();
    if (now - activityThrottleRef.current < 50) return;
    activityThrottleRef.current = now;
    if (activityFadeRef.current) clearTimeout(activityFadeRef.current);
    setActivity({ channel: lastMessage.channel, cc: lastMessage.cc, value: lastMessage.value });
    activityFadeRef.current = setTimeout(() => setActivity(null), 1500);
  }, [lastMessage]);

  const activeButtonIdx = activity
    ? buttons.findIndex((b) => b.channel === activity.channel && b.cc === activity.cc)
    : -1;
  const activeSliderIdx = activity
    ? sliders.findIndex((s) => s.channel === activity.channel && s.cc === activity.cc)
    : -1;

  // On mount: read current config from device
  useEffect(() => {
    if (!isConnected) return;
    setIsLoading(true);
    sendOrbitBridgeDeckSysEx(CMD_GET_ALL, []);
    const t = setTimeout(() => setIsLoading(false), 3000);
    return () => clearTimeout(t);
  }, [isConnected]);

  const handleButtonChange = useCallback((idx: number, patch: Partial<ButtonConfig>) => {
    updateButton(idx, patch);
    const btn = { ...useOrbitBridgeDeckStore.getState().buttons[idx], ...patch };
    sendOrbitBridgeDeckSysEx(CMD_SET_BUTTON, [idx, btn.channel - 1, btn.cc]);
  }, []);

  const handleSliderChange = useCallback((idx: number, patch: Partial<SliderConfig>) => {
    updateSlider(idx, patch);
    const s = { ...useOrbitBridgeDeckStore.getState().sliders[idx], ...patch };
    sendOrbitBridgeDeckSysEx(CMD_SET_SLIDER, [
      idx, s.channel - 1, s.cc, s.minVal, s.maxVal, s.invert ? 1 : 0,
    ]);
  }, []);

  const handleReadFromDevice = () => {
    setIsLoading(true);
    sendOrbitBridgeDeckSysEx(CMD_GET_ALL, []);
    setTimeout(() => setIsLoading(false), 3000);
  };

  const handleSaveToFlash = () => {
    sendOrbitBridgeDeckSysEx(CMD_SAVE_FLASH, []);
    markSaved();
  };

  const handleResetDefaults = () => {
    if (!window.confirm('Reset OrbitBridgeDeck to factory defaults?')) return;
    sendOrbitBridgeDeckSysEx(CMD_RESET_DEFAULTS, []);
    resetToDefaults();
  };

  const savedLabel = lastSavedAt
    ? `Saved at ${new Date(lastSavedAt).toLocaleTimeString()}`
    : null;

  if (!isConnected) {
    return (
      <div className="obd-view obd-disconnected">
        <div className="obd-disconnected-inner">
          <span className="obd-disconnected-icon">⬡</span>
          <span className="obd-disconnected-title">OrbitBridgeDeck not connected</span>
          <span className="obd-disconnected-hint">
            Connect the OrbitBridgeDeck via USB and select it as MIDI input in Settings.
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="obd-view">

      {/* Header */}
      <div className="obd-header">
        <div className="obd-header-left">
          <span className="obd-header-icon"><IconDevice /></span>
          <div>
            <h1 className="obd-header-title">OrbitBridgeDeck</h1>
            <span className="obd-header-sub">MIDI Configuration</span>
          </div>
          <span className="obd-badge-connected">● Connected</span>
        </div>
        <div className="obd-toolbar">
          <button className="obd-btn obd-btn-secondary" onClick={handleReadFromDevice} disabled={isLoading}>
            {isLoading ? 'Reading…' : 'Read'}
          </button>
          <button className="obd-btn obd-btn-primary" onClick={handleSaveToFlash}>
            Save to Flash
          </button>
          <button className="obd-btn obd-btn-danger" onClick={handleResetDefaults}>
            Reset
          </button>
        </div>
      </div>

      {savedLabel && <div className="obd-save-notice">✓ {savedLabel}</div>}

      <div className="obd-body">

        {/* ── Buttons ───────────────────────────────────────────────────── */}
        <section className="obd-section">
          <div className="obd-section-header">
            <span className="obd-section-icon"><IconPad /></span>
            <h2 className="obd-section-title">Buttons</h2>
            <span className="obd-section-sub">6 capacitive pads · CC toggle 127 / 0</span>
          </div>
          <div className="obd-table">
            <div className="obd-table-head">
              <span>Button</span>
              <span>MIDI Channel</span>
              <span>CC</span>
              <span>Live</span>
            </div>
            {buttons.map((btn, idx) => {
              const isActive = activeButtonIdx === idx;
              return (
                <div key={idx} className={`obd-row${isActive ? ' obd-row-active' : ''}`}>
                  <span className="obd-row-label">
                    {isActive && <span className="obd-activity-dot" />}
                    Button {idx + 1}
                  </span>
                  <span>
                    <select
                      id={`obd-btn-${idx}-ch`}
                      className="obd-select"
                      value={btn.channel}
                      onChange={(e) => handleButtonChange(idx, { channel: parseInt(e.target.value) })}
                    >
                      {CHANNELS.map((ch) => (
                        <option key={ch} value={ch}>Ch {ch}</option>
                      ))}
                    </select>
                  </span>
                  <span>
                    <input
                      id={`obd-btn-${idx}-cc`}
                      className="obd-number"
                      type="number"
                      min={0} max={127}
                      value={btn.cc}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        if (!isNaN(v) && v >= 0 && v <= 127) handleButtonChange(idx, { cc: v });
                      }}
                    />
                  </span>
                  <span className="obd-preview">
                    {isActive && activity ? (
                      <span className={`obd-live-value ${activity.value > 0 ? 'obd-live-on' : 'obd-live-off'}`}>
                        {activity.value > 0 ? '▶ 127' : '■ 0'}
                      </span>
                    ) : (
                      <span className="obd-preview-chip">CH{btn.channel} · CC{btn.cc}</span>
                    )}
                  </span>
                </div>
              );
            })}
          </div>
        </section>

        {/* ── Sliders ───────────────────────────────────────────────────── */}
        <section className="obd-section">
          <div className="obd-section-header">
            <span className="obd-section-icon"><IconSlider /></span>
            <h2 className="obd-section-title">Sliders</h2>
            <span className="obd-section-sub">2 × 5-pad capacitive strips · CC value</span>
          </div>
          <div className="obd-table obd-table-sliders">
            <div className="obd-table-head">
              <span>Slider</span>
              <span>Channel</span>
              <span>CC</span>
              <span>Min</span>
              <span>Max</span>
              <span>Range</span>
              <span title="Invert direction">Inv</span>
            </div>
            {sliders.map((s, idx) => {
              const isActive = activeSliderIdx === idx;
              const rangeLabel = s.invert
                ? `${s.maxVal}→${s.minVal}`
                : `${s.minVal}→${s.maxVal}`;
              return (
                <div key={idx} className={`obd-row obd-row-slider${isActive ? ' obd-row-active' : ''}`}>
                  <span className="obd-row-label">
                    {isActive && <span className="obd-activity-dot" />}
                    Slider {idx + 1}
                    {isActive && activity && (
                      <span className="obd-live-slider" style={{ marginLeft: 8 }}>
                        <span className="obd-live-bar-wrap">
                          <span className="obd-live-bar" style={{ width: `${(activity.value / 127) * 100}%` }} />
                        </span>
                        <span className="obd-live-num">{activity.value}</span>
                      </span>
                    )}
                  </span>
                  <span>
                    <select
                      id={`obd-sl-${idx}-ch`}
                      className="obd-select obd-select-sm"
                      value={s.channel}
                      onChange={(e) => handleSliderChange(idx, { channel: parseInt(e.target.value) })}
                    >
                      {CHANNELS.map((ch) => (
                        <option key={ch} value={ch}>Ch {ch}</option>
                      ))}
                    </select>
                  </span>
                  <span>
                    <input
                      id={`obd-sl-${idx}-cc`}
                      className="obd-number obd-number-sm"
                      type="number" min={0} max={127} value={s.cc}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        if (!isNaN(v) && v >= 0 && v <= 127) handleSliderChange(idx, { cc: v });
                      }}
                    />
                  </span>
                  <span>
                    <input
                      id={`obd-sl-${idx}-min`}
                      className="obd-number obd-number-sm"
                      type="number" min={0} max={127} value={s.minVal}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        if (!isNaN(v) && v >= 0 && v <= 127) handleSliderChange(idx, { minVal: v });
                      }}
                    />
                  </span>
                  <span>
                    <input
                      id={`obd-sl-${idx}-max`}
                      className="obd-number obd-number-sm"
                      type="number" min={0} max={127} value={s.maxVal}
                      onChange={(e) => {
                        const v = parseInt(e.target.value);
                        if (!isNaN(v) && v >= 0 && v <= 127) handleSliderChange(idx, { maxVal: v });
                      }}
                    />
                  </span>
                  <span className="obd-preview">
                    <span className={`obd-preview-chip${isActive ? '' : ' obd-preview-range'}`}>
                      {rangeLabel}
                    </span>
                  </span>
                  <span>
                    <button
                      id={`obd-sl-${idx}-inv`}
                      className={`obd-toggle ${s.invert ? 'active' : ''}`}
                      onClick={() => handleSliderChange(idx, { invert: !s.invert })}
                      title={s.invert ? 'Inverted — click to set normal' : 'Normal — click to invert'}
                    />
                  </span>
                </div>
              );
            })}
          </div>
          <p className="obd-footer-info">
            Changes are sent immediately. Click <strong>Save to Flash</strong> to persist across
            power cycles. SysEx ID: <code className="obd-code">F0 7D 00 00</code>.
            Invert toggle reverses slider direction (Max→Min).
          </p>
        </section>

      </div>
    </div>
  );
}
