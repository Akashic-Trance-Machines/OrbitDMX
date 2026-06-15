/**
 * ObdStandaloneView.tsx — OBD Standalone Configuration Page
 *
 * Visual 2×3 button grid + 2 sliders matching the physical OBD hardware.
 * Click a control to open a slide-out config panel for assigning standalone
 * actions, LED colours, and previewing effects live.
 *
 * Also contains the Push-to-OBD section (moved from Settings).
 */

import React, { useState, useEffect, useCallback } from 'react';
import { useObdStandaloneStore } from '../store/useObdStandaloneStore';
import { useSerialStore } from '../store/useSerialStore';
import { useRoomStore } from '../store/useRoomStore';
import { useSceneStore } from '../store/useSceneStore';
import { usePlaylistStore } from '../store/usePlaylistStore';
import { useTempoStore } from '../store/useTempoStore';
import { useMidiStore } from '../store/useMidiStore';
import { buildCurrentRoomFile } from '../hooks/useAutosave';
import { sendOrbitBridgeDeckSysEx } from '../hooks/useMidiListener';
import type {
  ObdActionType,
  ObdControlBinding,
  ObdProgress,
  FxType,
  FxConfig,
  FixtureTarget,
} from '../../shared/types';
import {
  OBD_BUTTON_ACTIONS,
  OBD_SLIDER_ACTIONS,
  OBD_ACTION_LABELS,
} from '../../shared/types';
import './ObdStandaloneView.css';

// ── FX type options ──────────────────────────────────────────────────────────

const FX_TYPES_MOMENTARY: { value: FxType; label: string }[] = [
  { value: 'strobe',      label: 'Strobe' },
  { value: 'strobeColor', label: 'Strobe Colour' },
];

const FX_TYPES_TOGGLE: { value: FxType; label: string }[] = [
  { value: 'breath',      label: 'Breath' },
  { value: 'fire',        label: 'Fire' },
  { value: 'candle',      label: 'Candle' },
  { value: 'twinkle',     label: 'Twinkle' },
  { value: 'hueRotator',  label: 'Hue Rotator' },
];

const FX_TYPES_ALL: { value: FxType; label: string }[] = [
  ...FX_TYPES_MOMENTARY,
  ...FX_TYPES_TOGGLE,
];

// ── Push Section ─────────────────────────────────────────────────────────────

function PushSection() {
  const isConnected = useSerialStore((s) => s.status === 'connected');
  const fixtures = useRoomStore((s) => s.fixtures);
  const bpm = useTempoStore((s) => s.bpm);
  const bindings = useObdStandaloneStore((s) => s.bindings);
  const selectedPlaylistId = useObdStandaloneStore((s) => s.selectedPlaylistId);
  const baseSceneId = useObdStandaloneStore((s) => s.baseSceneId);

  const [pushing, setPushing] = useState(false);
  const [progress, setProgress] = useState<ObdProgress | null>(null);
  const [storedShow, setStoredShow] = useState<{ name: string; size: number } | null>(null);
  const [lastPushAt, setLastPushAt] = useState<number | null>(null);
  const [dirtyAfterPush, setDirtyAfterPush] = useState(false);

  // Mark dirty when bindings/playlist/baseScene change after a push
  useEffect(() => {
    if (lastPushAt !== null) {
      setDirtyAfterPush(true);
    }
  }, [bindings, selectedPlaylistId, baseSceneId]);

  useEffect(() => {
    if (typeof window.dmx === 'undefined') return;
    return window.dmx.onObdProgress((p: ObdProgress) => {
      setProgress(p);
      if (p.phase === 'done' || p.phase === 'error') {
        setPushing(false);
        if (p.phase === 'done') {
          setLastPushAt(Date.now());
          setDirtyAfterPush(false);
          setTimeout(() => queryStoredShow(), 500);
        }
      }
    });
  }, []);

  useEffect(() => {
    if (isConnected) queryStoredShow();
  }, [isConnected]);

  async function queryStoredShow() {
    if (typeof window.dmx === 'undefined') return;
    try {
      const res = await window.dmx.queryObdShow();
      if (res.success && res.data) {
        setStoredShow(res.data as { name: string; size: number });
      } else {
        setStoredShow(null);
      }
    } catch {
      setStoredShow(null);
    }
  }

  async function handlePush() {
    if (typeof window.dmx === 'undefined' || pushing) return;

    setPushing(true);
    setProgress({ phase: 'compiled', progress: 0 });

    try {
      const data = buildCurrentRoomFile();
      const profileIds = new Set(data.room.fixtures.map((f) => f.profileId));
      const { FIXTURE_PROFILES } = await import('../../fixtures');
      const fixtureProfiles = FIXTURE_PROFILES.filter((r) => profileIds.has(r.id));
      const baseSceneId = useObdStandaloneStore.getState().baseSceneId;

      // Gather ALL configured FX from the FX store (not just active ones).
      // Inactive FX are included so they can be toggled on via standalone
      // control bindings on OBD.
      const { useFxStore } = await import('../store/useFxStore');
      const fxStates = useFxStore.getState().fxStates;
      const fxConfigs: FxConfig[] = [];
      const fxTargets: Record<string, FixtureTarget> = {};
      for (const [type, state] of Object.entries(fxStates)) {
        fxConfigs.push({
          type: type as FxType,
          active: state.isActive,
          speed: state.speed,
          intensity: state.intensity,
          color: state.color,
          fadeSpeed: state.fadeSpeed,
          randomness: state.randomness,
          amount: state.amount,
          syncToBpm: state.syncToBpm,
          tempoDivider: state.tempoDivider,
          globalBpm: bpm,
          quantiseStrobe: state.quantiseStrobe,
          rotatePeriodMs: state.rotatePeriodMs,
        });
        fxTargets[type] = state.target;
      }

      const res = await window.dmx.pushToObd(
        data, fixtureProfiles, bpm, baseSceneId, fxConfigs, fxTargets,
      );
      if (!res.success) {
        setProgress({ phase: 'error', progress: 0, error: res.error });
        setPushing(false);
      }
    } catch (e) {
      setProgress({ phase: 'error', progress: 0, error: String(e) });
      setPushing(false);
    }
  }

  const hasFixtures = fixtures.length > 0;
  const canPush = isConnected && hasFixtures && !pushing;
  const progressPercent = progress?.progress ? Math.round(progress.progress * 100) : 0;

  return (
    <section className="osd-push-section">
      <div className="osd-push-header">
        <div className="osd-push-status">
          <span className={`osd-status-dot ${isConnected ? 'connected' : 'disconnected'}`} />
          <span className="osd-status-label">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        {storedShow && (
          <div className="osd-stored-show">
            <span className="osd-stored-icon">💾</span>
            <span className="osd-stored-name">{storedShow.name}</span>
            <span className="osd-stored-size">({(storedShow.size / 1024).toFixed(1)} KB)</span>
          </div>
        )}
      </div>

      {progress && (progress.phase === 'compiled' || progress.phase === 'uploading') && (
        <div className="osd-progress">
          <div className="osd-progress-bar">
            <div className="osd-progress-fill" style={{ width: `${progressPercent}%` }} />
          </div>
          <span className="osd-progress-label">
            {progress.phase === 'compiled' ? 'Compiled, uploading…' : `Uploading… ${progressPercent}%`}
          </span>
        </div>
      )}

      {progress?.phase === 'done' && !dirtyAfterPush && (
        <div className="osd-flash-msg osd-flash-success">✅ Show uploaded successfully!</div>
      )}
      {progress?.phase === 'done' && dirtyAfterPush && (
        <div className="osd-flash-msg osd-flash-warning">⚠️ Settings changed — push again to apply</div>
      )}
      {progress?.phase === 'error' && (
        <div className="osd-flash-msg osd-flash-error">❌ {progress.error || 'Upload failed'}</div>
      )}

      <button
        className="osd-push-btn"
        disabled={!canPush}
        onClick={handlePush}
        id="btn-push-obd-standalone"
      >
        {pushing ? '⏳ Uploading…' : '🚀 Push to OrbitBridgeDeck'}
      </button>
    </section>
  );
}

// ── Playlist Selector ────────────────────────────────────────────────────────

function PlaylistSelector() {
  const scenePlaylists = usePlaylistStore((s) => s.playlists);
  const palettePlaylists = usePlaylistStore((s) => s.palettePlayists);
  const hsbPlaylists = usePlaylistStore((s) => s.hsbPlaylists);
  const selectedId = useObdStandaloneStore((s) => s.selectedPlaylistId);
  const setSelected = useObdStandaloneStore((s) => s.setSelectedPlaylist);

  const hasAny = scenePlaylists.length > 0 || palettePlaylists.length > 0 || hsbPlaylists.length > 0;

  if (!hasAny) {
    return (
      <div className="osd-playlist-selector">
        <span className="osd-playlist-hint">
          No playlists in this room. Create one on the Playlists page to enable standalone playback.
        </span>
      </div>
    );
  }

  return (
    <div className="osd-playlist-selector">
      <label className="osd-playlist-label" htmlFor="osd-playlist-select">
        Standalone playlist
      </label>
      <select
        id="osd-playlist-select"
        className="osd-select"
        value={selectedId ?? ''}
        onChange={(e) => setSelected(e.target.value || null)}
      >
        <option value="">— Select playlist —</option>
        {scenePlaylists.length > 0 && (
          <optgroup label="Scene Playlists">
            {scenePlaylists.map((pl) => (
              <option key={pl.id} value={pl.id}>
                {pl.name || `Playlist ${pl.id.slice(0, 6)}`} ({pl.cues.length} cues)
              </option>
            ))}
          </optgroup>
        )}
        {palettePlaylists.length > 0 && (
          <optgroup label="Palette Generators">
            {palettePlaylists.map((pl) => (
              <option key={pl.id} value={pl.id}>
                {pl.name || `Palette ${pl.id.slice(0, 6)}`}
              </option>
            ))}
          </optgroup>
        )}
        {hsbPlaylists.length > 0 && (
          <optgroup label="HSB Generators">
            {hsbPlaylists.map((pl) => (
              <option key={pl.id} value={pl.id}>
                {pl.name || `HSB ${pl.id.slice(0, 6)}`}
              </option>
            ))}
          </optgroup>
        )}
      </select>
    </div>
  );
}

// ── Control Button ───────────────────────────────────────────────────────────

function ControlButton({
  index,
  binding,
  isSelected,
  onClick,
}: {
  index: number;
  binding: ObdControlBinding;
  isSelected: boolean;
  onClick: () => void;
}) {
  const ledColor = binding.ledColor ?? [60, 60, 60];
  const actionLabel = OBD_ACTION_LABELS[binding.action];
  const hasAction = binding.action !== 'none';

  return (
    <button
      className={`osd-control-btn ${isSelected ? 'selected' : ''} ${hasAction ? 'assigned' : ''}`}
      onClick={onClick}
      id={`osd-btn-${index}`}
    >
      <span
        className="osd-led-dot"
        style={{
          backgroundColor: hasAction
            ? `rgb(${ledColor[0]}, ${ledColor[1]}, ${ledColor[2]})`
            : 'var(--color-surface-3)',
        }}
      />
      <span className="osd-control-index">{index + 1}</span>
      <span className="osd-control-action">{actionLabel}</span>
      {(binding.action === 'fx-toggle' || binding.action === 'fx-momentary') && binding.fxType && (
        <span className="osd-control-param">{binding.fxType}</span>
      )}
    </button>
  );
}

// ── Control Slider ───────────────────────────────────────────────────────────

function ControlSlider({
  index,
  binding,
  isSelected,
  onClick,
}: {
  index: number;
  binding: ObdControlBinding;
  isSelected: boolean;
  onClick: () => void;
}) {
  const actionLabel = OBD_ACTION_LABELS[binding.action];
  const hasAction = binding.action !== 'none';

  return (
    <button
      className={`osd-control-slider ${isSelected ? 'selected' : ''} ${hasAction ? 'assigned' : ''}`}
      onClick={onClick}
      id={`osd-slider-${index - 6}`}
    >
      <div className="osd-slider-track">
        <div className="osd-slider-thumb" />
      </div>
      <span className="osd-slider-label">Slider {index - 5}</span>
      <span className="osd-control-action">{actionLabel}</span>
      {(binding.action === 'fx-intensity' || binding.action === 'fx-speed') && binding.fxType && (
        <span className="osd-control-param">{binding.fxType}</span>
      )}
    </button>
  );
}

// ── Config Panel (slide-out) ─────────────────────────────────────────────────

function ConfigPanel({
  index,
  binding,
  onClose,
}: {
  index: number;
  binding: ObdControlBinding;
  onClose: () => void;
}) {
  const updateBinding = useObdStandaloneStore((s) => s.updateBinding);
  const allBindings = useObdStandaloneStore((s) => s.bindings);
  const isButton = index < 6;
  const actions = isButton ? OBD_BUTTON_ACTIONS : OBD_SLIDER_ACTIONS;
  const controlLabel = isButton ? `Button ${index + 1}` : `Slider ${index - 5}`;

  const needsFxType = binding.action === 'fx-toggle' || binding.action === 'fx-momentary'
    || binding.action === 'fx-intensity' || binding.action === 'fx-speed';

  return (
    <div className="osd-config-panel">
      <div className="osd-panel-header">
        <h3>{controlLabel}</h3>
        <button className="osd-panel-close" onClick={onClose} aria-label="Close">×</button>
      </div>

      <div className="osd-panel-body">
        {/* Action picker */}
        <label className="osd-field-label">Action</label>
        <select
          className="osd-select"
          value={binding.action}
          onChange={(e) => {
            const action = e.target.value as ObdActionType;
            // Auto-set fxType to first available when selecting an FX action
            const isFx = action === 'fx-toggle' || action === 'fx-momentary'
              || action === 'fx-intensity' || action === 'fx-speed';
            const types = isFx ? getFxTypesForAction(action) : [];
            const defaultFx = types.length > 0 ? types[0].value : undefined;
            updateBinding(index, { action, fxType: isFx ? defaultFx : undefined });
          }}
          id={`osd-action-${index}`}
        >
          {actions.map((a) => (
            <option key={a} value={a}>{OBD_ACTION_LABELS[a]}</option>
          ))}
        </select>

        {/* FX type picker */}
        {needsFxType && (
          <>
            <label className="osd-field-label">FX Type</label>
            <select
              className="osd-select"
              value={binding.fxType ?? 'strobe'}
              onChange={(e) => updateBinding(index, { fxType: e.target.value as FxType })}
              id={`osd-fxtype-${index}`}
            >
              {getFxTypesForAction(binding.action).map((fx) => {
                // Only prevent duplicate toggle/momentary for the same FX type.
                // Intensity/speed sliders can target any FX, even toggled ones.
                const isToggleOrMomentary = binding.action === 'fx-toggle'
                  || binding.action === 'fx-momentary';
                const isUsed = isToggleOrMomentary && allBindings.some((b, i) =>
                  i !== index
                  && (b.action === 'fx-toggle' || b.action === 'fx-momentary')
                  && b.fxType === fx.value
                );
                return (
                  <option key={fx.value} value={fx.value} disabled={isUsed}>
                    {fx.label}{isUsed ? ' (already assigned)' : ''}
                  </option>
                );
              })}
            </select>
          </>
        )}

        {/* LED colour picker (buttons only) */}
        {isButton && binding.action !== 'none' && (
          <>
            <label className="osd-field-label">LED Colour</label>
            <div className="osd-color-picker">
              <input
                type="color"
                value={rgbToHex(binding.ledColor ?? [60, 60, 60])}
                onChange={(e) => {
                  const rgb = hexToRgb(e.target.value);
                  updateBinding(index, { ledColor: rgb });
                }}
                id={`osd-led-color-${index}`}
                className="osd-color-input"
              />
              <span className="osd-color-hex">
                {rgbToHex(binding.ledColor ?? [60, 60, 60])}
              </span>
            </div>
          </>
        )}

        {/* Test control (only when OBD is connected) */}
        <TestControlSection index={index} isButton={isButton} />
      </div>
    </div>
  );
}

// ── Test Control (in sidebar) ────────────────────────────────────────────────

function TestControlSection({ index, isButton }: { index: number; isButton: boolean }) {
  const isObdConnected = useMidiStore((s) => s.isOrbitBridgeDeckConnected);

  if (!isObdConnected) return null;

  if (isButton) {
    return (
      <>
        <label className="osd-field-label">Test</label>
        <button
          className="osd-sim-btn"
          style={{ width: '100%' }}
          onMouseDown={() => sendOrbitBridgeDeckSysEx(0x30, [index, 1, 0])}
          onMouseUp={() => sendOrbitBridgeDeckSysEx(0x30, [index, 0, 0])}
          onMouseLeave={() => sendOrbitBridgeDeckSysEx(0x30, [index, 0, 0])}
          id={`osd-test-btn-${index}`}
        >
          <span className="osd-sim-label">Press & hold</span>
        </button>
      </>
    );
  }

  // Slider test
  return (
    <>
      <label className="osd-field-label">Test</label>
      <input
        type="range"
        className="osd-sim-slider"
        min={0}
        max={255}
        defaultValue={0}
        onChange={(e) => {
          const val = parseInt(e.target.value, 10);
          const val7 = Math.round((val / 255) * 127);
          sendOrbitBridgeDeckSysEx(0x30, [index, 0, val7]);
        }}
        id={`osd-test-slider-${index}`}
      />
    </>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

/** Return the filtered FX type options based on the selected action. */
function getFxTypesForAction(action: ObdActionType) {
  if (action === 'fx-momentary') return FX_TYPES_MOMENTARY;
  if (action === 'fx-toggle') return FX_TYPES_TOGGLE;
  return FX_TYPES_ALL;  // sliders (fx-intensity, fx-speed) can target any FX
}

function rgbToHex(rgb: [number, number, number]): string {
  return '#' + rgb.map((c) => c.toString(16).padStart(2, '0')).join('');
}

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace('#', '');
  return [
    parseInt(h.substring(0, 2), 16) || 0,
    parseInt(h.substring(2, 4), 16) || 0,
    parseInt(h.substring(4, 6), 16) || 0,
  ];
}

// ── Base Scene Selector ──────────────────────────────────────────────────────

function BaseSceneSelector() {
  const scenes = useSceneStore((s) => s.scenes);
  const baseSceneId = useObdStandaloneStore((s) => s.baseSceneId);
  const setBaseSceneId = useObdStandaloneStore((s) => s.setBaseSceneId);

  return (
    <div className="osd-playlist-selector">
      <label className="osd-playlist-label" htmlFor="osd-base-scene-select">
        Base scene (background)
      </label>
      <select
        id="osd-base-scene-select"
        className="osd-select"
        value={baseSceneId ?? ''}
        onChange={(e) => setBaseSceneId(e.target.value || null)}
      >
        <option value="">— None —</option>
        {scenes.map((s) => (
          <option key={s.id} value={s.id}>
            {s.name || `Scene ${s.id.slice(0, 6)}`}
          </option>
        ))}
      </select>
      <span className="osd-playlist-hint">
        Always rendered as background. Generators and playlists layer on top.
      </span>
    </div>
  );
}


// ── Main View ────────────────────────────────────────────────────────────────

export default function ObdStandaloneView() {
  const bindings = useObdStandaloneStore((s) => s.bindings);
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  const handleControlClick = useCallback((index: number) => {
    setSelectedIndex((prev) => (prev === index ? null : index));
  }, []);

  const selectedBinding = selectedIndex !== null ? bindings[selectedIndex] : null;

  return (
    <div className={`osd-view ${selectedIndex !== null ? 'panel-open' : ''}`}>
      <div className="osd-main">
        {/* Header */}
        <div className="osd-header">
          <h1 className="osd-title">OBD Standalone</h1>
          <p className="osd-subtitle">
            Configure what each physical control does in standalone mode
          </p>
        </div>

        {/* Push section */}
        <PushSection />

        {/* Playlist selector */}
        <PlaylistSelector />

        {/* Base scene selector */}
        <BaseSceneSelector />

        {/* Control grid */}
        <section className="osd-controls-section">
          <h2 className="osd-section-title">Buttons</h2>
          <div className="osd-button-grid">
            {bindings.slice(0, 6).map((b, i) => (
              <ControlButton
                key={i}
                index={i}
                binding={b}
                isSelected={selectedIndex === i}
                onClick={() => handleControlClick(i)}
              />
            ))}
          </div>

          <h2 className="osd-section-title" style={{ marginTop: 24 }}>Sliders</h2>
          <div className="osd-slider-grid">
            {bindings.slice(6, 8).map((b, i) => (
              <ControlSlider
                key={i + 6}
                index={i + 6}
                binding={b}
                isSelected={selectedIndex === i + 6}
                onClick={() => handleControlClick(i + 6)}
              />
            ))}
          </div>
        </section>
      </div>

      {/* Slide-out config panel */}
      {selectedIndex !== null && selectedBinding && (
        <ConfigPanel
          index={selectedIndex}
          binding={selectedBinding}
          onClose={() => setSelectedIndex(null)}
        />
      )}
    </div>
  );
}
