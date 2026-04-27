import React from 'react';
import { useAudioStore } from '../store/useAudioStore';
import './VuMeter.css';

interface VuMeterProps {
  /** Threshold value 0–1 */
  threshold: number;
}

/**
 * VuMeter — displays the current audio level with a threshold marker.
 * Reads live audio level from the shared useAudioStore.
 */
export default function VuMeter({ threshold }: VuMeterProps) {
  const level = useAudioStore((s) => s.level);
  const isListening = useAudioStore((s) => s.isListening);

  // Clamp level to 0–1
  const clampedLevel = Math.min(1, Math.max(0, level));
  const levelPct = clampedLevel * 100;
  const thresholdPct = threshold * 100;
  const isTriggering = clampedLevel > threshold;

  // Color: green → yellow → red as level increases
  const levelColor =
    clampedLevel < 0.4
      ? 'var(--color-success)'
      : clampedLevel < 0.7
      ? 'var(--color-warning)'
      : 'var(--color-danger)';

  return (
    <div className="vu-meter">
      <div className="vu-meter-label">
        <span className={`vu-meter-dot ${isListening ? 'listening' : ''}`} />
        <span className="vu-meter-title">Audio Input</span>
        {isListening && (
          <span className={`vu-meter-db mono ${isTriggering ? 'triggered' : ''}`}>
            {Math.round(levelPct)}%
          </span>
        )}
      </div>

      <div className="vu-meter-track">
        {/* Level bar */}
        <div
          className={`vu-meter-fill ${isTriggering ? 'triggering' : ''}`}
          style={{
            width: `${levelPct}%`,
            background: levelColor,
          }}
        />

        {/* Threshold marker */}
        <div
          className="vu-meter-threshold"
          style={{ left: `${thresholdPct}%` }}
          title={`Threshold: ${Math.round(thresholdPct)}%`}
        >
          <div className="vu-meter-threshold-line" />
          <div className="vu-meter-threshold-label mono">T</div>
        </div>
      </div>

      {!isListening && (
        <div className="vu-meter-hint text-dim">
          Press play to start audio input
        </div>
      )}
    </div>
  );
}
