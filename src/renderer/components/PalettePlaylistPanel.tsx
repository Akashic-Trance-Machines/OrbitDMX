import React, { useCallback } from 'react';
import { usePlaylistStore } from '../store/usePlaylistStore';
import { useColourStore } from '../store/useColourStore';
import { useTempoStore } from '../store/useTempoStore';
import { usePalettePlaylistControls } from '../hooks/usePalettePlaylistRunner';
import VuMeter from './VuMeter';
import FixtureTargetSelector from './FixtureTargetSelector';
import type { PalettePlaylist, PlayDirection, PlaylistSyncMode } from '../../shared/types';
import './PalettePlaylistPanel.css';

/* ── Constants ─────────────────────────────────────────────────────────────── */

const MODE_LABELS: Record<PlaylistSyncMode, string> = {
  auto:   'Auto',
  manual: 'Manual',
  music:  'Music',
};

const DIRECTION_LABELS: Record<PlayDirection, { label: string; icon: string }> = {
  forward:  { label: 'Forward',  icon: '→' },
  backward: { label: 'Backward', icon: '←' },
  random:   { label: 'Random',   icon: '⇄' },
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

/* ── Component ─────────────────────────────────────────────────────────────── */

interface PalettePlaylistPanelProps {
  playlist: PalettePlaylist;
}

export default function PalettePlaylistPanel({ playlist }: PalettePlaylistPanelProps) {
  const updatePalettePlaylist   = usePlaylistStore((s) => s.updatePalettePlaylist);
  const setPalettePlaybackState = usePlaylistStore((s) => s.setPalettePlaybackState);
  const selectPalettePlaylist   = usePlaylistStore((s) => s.selectPalettePlaylist);

  const palettes = useColourStore((s) => s.palettes);
  const bpm      = useTempoStore((s) => s.bpm);

  const controls = usePalettePlaylistControls();
  const isPlaying = controls.palettePlaybackState === 'playing';

  const palette = palettes.find((p) => p.id === playlist.paletteId);
  const colours = palette?.colours ?? [];

  const effectiveHoldMs = playlist.bpmSync
    ? (60_000 / bpm) * playlist.bpmDivider
    : playlist.holdMs;

  const update = useCallback(
    (changes: Partial<Omit<PalettePlaylist, 'id' | 'kind'>>) => {
      updatePalettePlaylist(playlist.id, changes);
    },
    [playlist.id, updatePalettePlaylist],
  );

  const handleStart = useCallback(() => {
    if (colours.length < 2) return;
    const sceneState = usePlaylistStore.getState().playbackState;
    if (sceneState !== 'stopped') usePlaylistStore.getState().setPlaybackState('stopped');
    selectPalettePlaylist(playlist.id);
    setPalettePlaybackState('playing');
  }, [colours.length, playlist.id, selectPalettePlaylist, setPalettePlaybackState]);

  // ── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="pp-panel">

      {/* Transport */}
      <div className="playlist-transport" style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border-dim)' }}>
        {isPlaying ? (
          <button className="playlist-transport-btn" onClick={controls.stop} title="Stop">⏹</button>
        ) : (
          <button
            className="playlist-transport-btn playlist-transport-play"
            onClick={handleStart}
            title="Start"
            disabled={colours.length < 2}
          >▶</button>
        )}
        {isPlaying && colours.length > 0 && (
          <span
            className="pp-current-colour-indicator"
            style={{ background: colours[controls.paletteCurrentIndex % colours.length] }}
            title={colours[controls.paletteCurrentIndex % colours.length]}
          />
        )}
        {isPlaying && playlist.syncMode !== 'stopped' && (
          <span className="playlist-transport-indicator mono">
            Step {(controls.paletteCurrentIndex % Math.max(colours.length, 1)) + 1} / {colours.length}
          </span>
        )}
      </div>

      {colours.length < 2 && (
        <div className="pp-warning">
          ⚠ Select a palette with at least 2 colours to start.
        </div>
      )}

      {/* Colour strip */}
      {colours.length > 0 && (
        <div className="pp-colour-strip">
          {colours.map((hex, i) => (
            <span
              key={i}
              className={`pp-colour-dot ${isPlaying && i === controls.paletteCurrentIndex % colours.length ? 'active' : ''}`}
              style={{ background: hex }}
              title={hex}
            />
          ))}
        </div>
      )}

      {/* ── Mode tabs — same as scene playlist ── */}
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

      {/* ── Direction — same as scene playlist ── */}
      <div className="playlist-settings-section" style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border-dim)' }}>
        <label className="playlist-setting-label">Direction</label>
        <div className="playlist-mode-tabs">
          {(['forward', 'backward', 'random'] as PlayDirection[]).map((dir) => (
            <button
              key={dir}
              className={`playlist-mode-tab ${playlist.playDirection === dir ? 'active' : ''}`}
              onClick={() => update({ playDirection: dir })}
            >
              {DIRECTION_LABELS[dir].icon} {DIRECTION_LABELS[dir].label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Crossfade ── */}
      <div className="playlist-settings-section" style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border-dim)' }}>
        <SliderSetting
          label="Crossfade"
          value={playlist.fadeMs}
          min={0}
          max={4000}
          step={50}
          displayValue={playlist.fadeMs === 0 ? 'Snap' : fmtMs(playlist.fadeMs)}
          onChange={(v) => update({ fadeMs: v })}
        />
      </div>

      {/* ── Auto mode settings ── */}
      {playlist.syncMode === 'auto' && (
        <div className="playlist-settings-section" style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border-dim)' }}>

          {/* BPM sync toggle — same as scene playlist pattern */}
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
              min={100}
              max={30000}
              step={100}
              displayValue={fmtMs(playlist.holdMs)}
              onChange={(v) => update({ holdMs: v })}
            />
          )}

          {/* Period indicator */}
          <div className="pp-period-row" style={{ marginTop: 8 }}>
            <span className="pp-blink" style={{ animationDuration: `${effectiveHoldMs}ms` }} />
            <span className="playlist-slider-value mono">{fmtMs(effectiveHoldMs)} per step</span>
          </div>
        </div>
      )}

      {/* ── Manual mode: next / prev ── */}
      {playlist.syncMode === 'manual' && isPlaying && (
        <div className="playlist-settings-section" style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border-dim)' }}>
          <label className="playlist-setting-label">Navigate</label>
          <div className="playlist-manual-controls">
            <button className="playlist-nav-btn" onClick={controls.previous}>◄ Prev</button>
            <span className="playlist-cue-indicator mono">
              {(controls.paletteCurrentIndex % Math.max(colours.length, 1)) + 1} / {colours.length}
            </span>
            <button className="playlist-nav-btn" onClick={controls.next}>Next ►</button>
          </div>
        </div>
      )}

      {/* ── Music mode: VU + gain + threshold ── */}
      {playlist.syncMode === 'music' && (
        <div className="playlist-settings-section" style={{ padding: '16px 20px', borderBottom: '1px solid var(--color-border-dim)' }}>
          <VuMeter threshold={(playlist.audioThreshold ?? 50) / 100} />
          <SliderSetting
            label="Audio Gain"
            value={playlist.audioGain ?? 50}
            min={0}
            max={100}
            step={1}
            displayValue={`${playlist.audioGain ?? 50}%`}
            onChange={(v) => update({ audioGain: v })}
          />
          <SliderSetting
            label="Threshold"
            value={playlist.audioThreshold ?? 50}
            min={5}
            max={100}
            step={1}
            displayValue={`${playlist.audioThreshold ?? 50}%`}
            onChange={(v) => update({ audioThreshold: v })}
          />
          <SliderSetting
            label="Cooldown"
            value={playlist.audioCooldown ?? 300}
            min={100}
            max={3000}
            step={50}
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

/* ── Reusable slider (mirrors PlaylistView's SliderSetting) ─────────────────── */

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
        type="range"
        className="playlist-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        style={{
          background: `linear-gradient(to right, var(--color-accent) ${pct}%, var(--color-surface-3) ${pct}%)`,
        }}
      />
      <span className="playlist-slider-value mono">{displayValue}</span>
    </div>
  );
}
