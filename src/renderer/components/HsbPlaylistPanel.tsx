import React, { useRef, useCallback } from 'react';
import { usePlaylistStore } from '../store/usePlaylistStore';
import { useTempoStore } from '../store/useTempoStore';
import { useHsbPlaylistControls } from '../hooks/useHsbPlaylistRunner';
import VuMeter from './VuMeter';
import FixtureTargetSelector from './FixtureTargetSelector';
import type { HsbPlaylist, HsbRange, PlaylistSyncMode } from '../../shared/types';
import './HsbPlaylistPanel.css';

/* ── Constants ─────────────────────────────────────────────────────────────── */

const MODE_LABELS: Record<PlaylistSyncMode, string> = {
  auto:   'Auto',
  manual: 'Manual',
  music:  'Music',
};

const BPM_DIVIDERS: Array<{ value: number; label: string }> = [
  { value: 4,      label: '4 bars' },
  { value: 2,      label: '2 bars' },
  { value: 1,      label: '1/1'   },
  { value: 0.5,    label: '1/2'   },
  { value: 0.25,   label: '1/4'   },
  { value: 0.125,  label: '1/8'   },
  { value: 0.0625, label: '1/16'  },
];

const fmtMs = (ms: number) =>
  ms >= 1000 ? `${(ms / 1000).toFixed(1)}s` : `${Math.round(ms)}ms`;

/* ── Hue Circle Picker ─────────────────────────────────────────────────────── */

const SVG_SIZE  = 160;
const CX        = 80;
const CY        = 80;
const OUTER_R   = 76;
const INNER_R   = 55;
const MID_R     = 65;   // handle placement radius

/** Convert a hue (0–360) to SVG radians. Hue 0 = top, clockwise. */
function hueToRad(hue: number): number {
  return (hue / 360) * Math.PI * 2 - Math.PI / 2;
}

/** Point on the ring at a given hue and radius. */
function huePoint(hue: number, r: number): [number, number] {
  const rad = hueToRad(hue);
  return [CX + r * Math.cos(rad), CY + r * Math.sin(rad)];
}

/**
 * Build an SVG donut arc path.
 * startHue  = beginning of the arc (in hue degrees, NOT normalised)
 * spanDeg   = how many degrees clockwise to span
 */
function svgArc(startHue: number, spanDeg: number): string {
  if (spanDeg <= 0) return '';
  const span = Math.min(spanDeg, 359.99);
  const startRad = hueToRad(startHue);
  const endRad   = hueToRad(startHue + span);
  const la       = span > 180 ? 1 : 0;

  const [sx, sy]   = [CX + OUTER_R * Math.cos(startRad), CY + OUTER_R * Math.sin(startRad)];
  const [ex, ey]   = [CX + OUTER_R * Math.cos(endRad),   CY + OUTER_R * Math.sin(endRad)];
  const [ix, iy]   = [CX + INNER_R * Math.cos(endRad),   CY + INNER_R * Math.sin(endRad)];
  const [isx, isy] = [CX + INNER_R * Math.cos(startRad), CY + INNER_R * Math.sin(startRad)];

  return `M ${sx} ${sy} A ${OUTER_R} ${OUTER_R} 0 ${la} 1 ${ex} ${ey} L ${ix} ${iy} A ${INNER_R} ${INNER_R} 0 ${la} 0 ${isx} ${isy} Z`;
}

/** Full donut ring (evenodd fill rule). Used when the entire ring is dimmed. */
function fullDonutPath(): string {
  const eps = 0.001;
  return [
    `M ${CX} ${CY - OUTER_R}`,
    `A ${OUTER_R} ${OUTER_R} 0 1 1 ${CX + eps} ${CY - OUTER_R} Z`,
    `M ${CX} ${CY - INNER_R}`,
    `A ${INNER_R} ${INNER_R} 0 1 1 ${CX + eps} ${CY - INNER_R} Z`,
  ].join(' ');
}

interface HueCirclePickerProps {
  center: number;
  width:  number;
  onChange: (center: number, width: number) => void;
}

function HueCirclePicker({ center, width, onChange }: HueCirclePickerProps) {
  const svgRef   = useRef<SVGSVGElement>(null);
  const dragRef  = useRef<'center' | 'edge' | null>(null);

  const clampedWidth = Math.max(0, Math.min(360, width));

  // The "edge" handle sits at center + half-width (right edge of the arc)
  const edgeHue = ((center + clampedWidth / 2) % 360 + 360) % 360;

  // Dim arc spans everything outside the selected region
  const dimStart = edgeHue;
  const dimSpan  = 360 - clampedWidth;

  /** Convert pointer event → hue (0–360). */
  const getHue = (e: React.PointerEvent): number => {
    const svg = svgRef.current;
    if (!svg) return 0;
    const rect = svg.getBoundingClientRect();
    const px = ((e.clientX - rect.left) / rect.width)  * SVG_SIZE - CX;
    const py = ((e.clientY - rect.top)  / rect.height) * SVG_SIZE - CY;
    const rad = Math.atan2(py, px) + Math.PI / 2;
    return ((rad / (2 * Math.PI)) * 360 + 360) % 360;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragRef.current) return;
    const h = getHue(e);

    if (dragRef.current === 'center') {
      onChange(h, clampedWidth);
    } else {
      // Width = 2 × shortest angular distance from center to pointer
      let diff = ((h - center) + 360) % 360;
      if (diff > 180) diff = 360 - diff;
      onChange(center, Math.min(360, diff * 2));
    }
  };

  const startDrag = (target: 'center' | 'edge') =>
    (e: React.PointerEvent) => {
      e.preventDefault();
      dragRef.current = target;
      (e.currentTarget as Element).setPointerCapture(e.pointerId);
    };

  const stopDrag = () => { dragRef.current = null; };

  const [cx_c, cy_c] = huePoint(center, MID_R);
  const [cx_e, cy_e] = huePoint(edgeHue, MID_R);
  const centerColor  = `hsl(${center}, 90%, 60%)`;

  return (
    <div className="hue-circle-wrap">
      {/* CSS rainbow donut ring */}
      <div className="hue-circle-rainbow" />

      {/* SVG overlay — dim mask + interactive handles */}
      <svg
        ref={svgRef}
        className="hue-circle-svg"
        viewBox={`0 0 ${SVG_SIZE} ${SVG_SIZE}`}
        onPointerMove={onPointerMove}
        onPointerUp={stopDrag}
        onPointerLeave={stopDrag}
      >
        {/* Dim the non-selected portion of the ring */}
        {dimSpan >= 360 ? (
          <path
            d={fullDonutPath()}
            fill="rgba(0,0,0,0.75)"
            fillRule="evenodd"
            style={{ pointerEvents: 'none' }}
          />
        ) : dimSpan > 0 ? (
          <path
            d={svgArc(dimStart, dimSpan)}
            fill="rgba(0,0,0,0.75)"
            style={{ pointerEvents: 'none' }}
          />
        ) : null}

        {/* Centre handle — colored with the selected hue */}
        <circle
          cx={cx_c} cy={cy_c} r={9}
          fill={centerColor}
          stroke="#fff" strokeWidth={2.5}
          style={{ cursor: 'grab', filter: 'drop-shadow(0 0 4px rgba(0,0,0,0.7))' }}
          onPointerDown={startDrag('center')}
        />

        {/* Edge handle — white with hue-colored border, shows arc width */}
        <circle
          cx={cx_e} cy={cy_e} r={6}
          fill="#fff"
          stroke={centerColor} strokeWidth={2.5}
          style={{ cursor: 'ew-resize', filter: 'drop-shadow(0 0 3px rgba(0,0,0,0.6))' }}
          onPointerDown={startDrag('edge')}
        />
      </svg>

      {/* Label row */}
      <div className="hue-circle-info">
        <span className="mono" style={{ color: centerColor, fontWeight: 700, fontSize: '0.82rem' }}>
          {Math.round(center)}°
        </span>
        <span className="text-dim" style={{ fontSize: '0.72rem' }}>
          ±{Math.round(clampedWidth / 2)}°
        </span>
      </div>
    </div>
  );
}

/* ── Sat / Bri Range Row (with gradient reference bar) ─────────────────────── */

interface RangeRowProps {
  label: string;
  range: HsbRange;
  min: number;
  max: number;
  unit?: string;
  /** CSS gradient string shown as a reference bar below the sliders */
  gradientCss?: string;
  onChange: (range: HsbRange) => void;
}

function RangeRow({ label, range, min, max, unit = '', gradientCss, onChange }: RangeRowProps) {
  const span   = max - min;
  const minPct = ((range.min - min) / span) * 100;
  const maxPct = ((range.max - min) / span) * 100;
  // When min is dragged into the right half of the track its thumb can slip
  // under the max slider element (later in DOM = higher stacking order).
  // Raise min's z-index in that region so it is always grabbable.
  const minOnTop = range.min > (min + max) / 2;

  return (
    <div className="hsb-range-row">
      <span className="hsb-range-label">{label}</span>
      <div className="hsb-range-controls">
        <div className="hsb-slider-pair">
          <div className="hsb-slider-labels">
            <span className="mono">{Math.round(range.min)}{unit}</span>
            <span className="hsb-range-dash">–</span>
            <span className="mono">{Math.round(range.max)}{unit}</span>
          </div>
          <div className="hsb-slider-track-wrap">
            {/* Shared track background */}
            <div
              className="hsb-track-bg"
              style={{
                background: `linear-gradient(to right,
                  var(--color-surface-3) ${minPct}%,
                  var(--color-accent) ${minPct}%,
                  var(--color-accent) ${maxPct}%,
                  var(--color-surface-3) ${maxPct}%)`,
              }}
            />
            {/* Min thumb — z-index raised when thumb is in the right half */}
            <input
              type="range"
              className="hsb-slider"
              style={{ zIndex: minOnTop ? 2 : 1 }}
              min={min} max={max} step={1}
              value={range.min}
              onChange={(e) => {
                const v = Math.min(parseFloat(e.target.value), range.max - 1);
                onChange({ min: v, max: range.max });
              }}
            />
            {/* Max thumb */}
            <input
              type="range"
              className="hsb-slider"
              style={{ zIndex: minOnTop ? 1 : 2 }}
              min={min} max={max} step={1}
              value={range.max}
              onChange={(e) => {
                const v = Math.max(parseFloat(e.target.value), range.min + 1);
                onChange({ min: range.min, max: v });
              }}
            />
          </div>
          {/* Gradient reference bar */}
          {gradientCss && (
            <div className="hsb-gradient-bar" style={{ background: gradientCss }} />
          )}
        </div>
      </div>
    </div>
  );
}

/* ── Shared slider setting ─────────────────────────────────────────────────── */

interface SliderSettingProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  displayValue: string;
  onChange: (value: number) => void;
}

function SliderSetting({ label, value, min, max, step, displayValue, onChange }: SliderSettingProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="playlist-settings-row">
      <label className="playlist-setting-label">{label}</label>
      <input
        type="range" className="playlist-slider"
        min={min} max={max} step={step} value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          background: `linear-gradient(to right, var(--color-accent) ${pct}%, var(--color-surface-3) ${pct}%)`,
        }}
      />
      <span className="playlist-slider-value mono">{displayValue}</span>
    </div>
  );
}

/* ── Main Panel ────────────────────────────────────────────────────────────── */

interface HsbPlaylistPanelProps {
  playlist: HsbPlaylist;
}

export default function HsbPlaylistPanel({ playlist }: HsbPlaylistPanelProps) {
  const updateHsbPlaylist = usePlaylistStore((s) => s.updateHsbPlaylist);
  const bpm = useTempoStore((s) => s.bpm);

  const controls  = useHsbPlaylistControls();
  const isPlaying = controls.hsbPlaybackState === 'playing';

  const effectiveHoldMs = playlist.bpmSync
    ? (60_000 / bpm) * playlist.bpmDivider
    : playlist.holdMs;

  const update = useCallback(
    (changes: Partial<Omit<HsbPlaylist, 'id' | 'kind'>>) => {
      updateHsbPlaylist(playlist.id, changes);
    },
    [playlist.id, updateHsbPlaylist],
  );

  // Derive gradient colours from the hue center (middle of the selected arc)
  const midHue  = playlist.hueCenter;
  const midSat  = (playlist.saturation.min + playlist.saturation.max) / 2;
  const satGrad = `linear-gradient(to right, hsl(${midHue},0%,55%), hsl(${midHue},100%,55%))`;
  const briGrad = `linear-gradient(to right, #000, hsl(${midHue},${Math.round(midSat)}%,50%))`;

  return (
    <div className="pp-panel">

      {/* Transport */}
      <div className="playlist-transport" style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border-dim)' }}>
        {isPlaying ? (
          <button className="playlist-transport-btn" onClick={controls.stop} title="Stop">⏹</button>
        ) : (
          <button
            className="playlist-transport-btn playlist-transport-play"
            onClick={() => controls.start(playlist.id)}
            title="Start"
          >▶</button>
        )}
        {isPlaying && (
          <span className="playlist-transport-indicator mono">Running</span>
        )}
      </div>

      {/* ── Mode tabs ── */}
      <div className="playlist-settings-section" style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border-dim)' }}>
        <label className="playlist-setting-label">Mode</label>
        <div className="playlist-mode-tabs">
          {(['auto', 'manual', 'music'] as PlaylistSyncMode[]).map((mode) => (
            <button
              key={mode}
              className={`playlist-mode-tab ${playlist.syncMode === mode ? 'active' : ''}`}
              onClick={() => update({ syncMode: mode })}
            >
              {MODE_LABELS[mode]}
            </button>
          ))}
        </div>
      </div>

      {/* ── Hue circle picker ── */}
      <div className="playlist-settings-section" style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border-dim)' }}>
        <label className="playlist-setting-label">Hue</label>
        <HueCirclePicker
          center={playlist.hueCenter}
          width={playlist.hueWidth}
          onChange={(c, w) => update({ hueCenter: c, hueWidth: w })}
        />
        <p className="hsb-hint" style={{ marginTop: 4, textAlign: 'center' }}>
          Drag the colour handle to change centre · drag the white handle to set width
        </p>
      </div>

      {/* ── Sat / Bri range rows ── */}
      <div className="playlist-settings-section" style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border-dim)' }}>
        <label className="playlist-setting-label">Saturation &amp; Brightness</label>
        <RangeRow
          label="Sat"
          range={playlist.saturation}
          min={0} max={100} unit="%"
          gradientCss={satGrad}
          onChange={(r) => update({ saturation: r })}
        />
        <RangeRow
          label="Bri"
          range={playlist.brightness}
          min={0} max={100} unit="%"
          gradientCss={briGrad}
          onChange={(r) => update({ brightness: r })}
        />
      </div>

      {/* ── Crossfade ── */}
      <div className="playlist-settings-section" style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border-dim)' }}>
        <SliderSetting
          label="Crossfade"
          value={playlist.fadeMs}
          min={0} max={4000} step={50}
          displayValue={playlist.fadeMs === 0 ? 'Snap' : fmtMs(playlist.fadeMs)}
          onChange={(v) => update({ fadeMs: v })}
        />
      </div>

      {/* ── Auto mode ── */}
      {playlist.syncMode === 'auto' && (
        <div className="playlist-settings-section" style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border-dim)' }}>
          <div className="pp-sync-row" style={{ marginBottom: 10 }}>
            <label className="playlist-setting-label">Sync to Global Tempo</label>
            <button
              className={`pp-sync-btn ${playlist.bpmSync ? 'active' : ''}`}
              onClick={() => update({ bpmSync: !playlist.bpmSync })}
              role="switch"
              aria-checked={playlist.bpmSync}
              title={`Global BPM: ${bpm.toFixed(1)}`}
            >
              <span className="pp-sync-thumb" />
            </button>
          </div>

          {playlist.bpmSync ? (
            <div className="playlist-settings-row">
              <label className="playlist-setting-label">Divider</label>
              <select
                className="pp-divider-select"
                value={playlist.bpmDivider}
                onChange={(e) => update({ bpmDivider: parseFloat(e.target.value) })}
              >
                {BPM_DIVIDERS.map((d) => (
                  <option key={d.value} value={d.value}>{d.label}</option>
                ))}
              </select>
              <span className="playlist-slider-value mono">
                = {fmtMs(effectiveHoldMs)} @ {bpm.toFixed(0)}
              </span>
            </div>
          ) : (
            <SliderSetting
              label="Hold"
              value={playlist.holdMs}
              min={100} max={30000} step={100}
              displayValue={fmtMs(playlist.holdMs)}
              onChange={(v) => update({ holdMs: v })}
            />
          )}

          <div className="pp-period-row" style={{ marginTop: 8 }}>
            <span className="pp-blink" style={{ animationDuration: `${effectiveHoldMs}ms` }} />
            <span className="playlist-slider-value mono">{fmtMs(effectiveHoldMs)} per step</span>
          </div>
        </div>
      )}

      {/* ── Manual mode: re-roll ── */}
      {playlist.syncMode === 'manual' && (
        <div className="playlist-settings-section" style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border-dim)' }}>
          <label className="playlist-setting-label">Re-roll</label>
          <button
            className="hsb-reroll-btn"
            onClick={controls.reroll}
            disabled={!isPlaying}
            title="Generate new random colours for all spots"
          >
            ⟳ Re-roll all spots
          </button>
          {!isPlaying && (
            <span className="hsb-hint">Start playback first to re-roll.</span>
          )}
        </div>
      )}

      {/* ── Music mode ── */}
      {playlist.syncMode === 'music' && (
        <div className="playlist-settings-section" style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border-dim)' }}>
          <VuMeter threshold={(playlist.audioThreshold ?? 50) / 100} />
          <SliderSetting
            label="Audio Gain"
            value={playlist.audioGain ?? 50}
            min={0} max={100} step={1}
            displayValue={`${playlist.audioGain ?? 50}%`}
            onChange={(v) => update({ audioGain: v })}
          />
          <SliderSetting
            label="Threshold"
            value={playlist.audioThreshold ?? 50}
            min={5} max={100} step={1}
            displayValue={`${playlist.audioThreshold ?? 50}%`}
            onChange={(v) => update({ audioThreshold: v })}
          />
          <SliderSetting
            label="Cooldown"
            value={playlist.audioCooldown ?? 300}
            min={100} max={3000} step={50}
            displayValue={fmtMs(playlist.audioCooldown ?? 300)}
            onChange={(v) => update({ audioCooldown: v })}
          />
        </div>
      )}

      {/* ── Target Fixtures ── */}
      <div className="playlist-settings-section" style={{ padding: '16px 20px' }}>
        <label className="playlist-setting-label">Target Fixtures</label>
        <FixtureTargetSelector
          target={playlist.target}
          onChange={(t) => update({ target: t })}
        />
      </div>

    </div>
  );
}
