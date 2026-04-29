import React, { useState, useCallback } from 'react';
import { useControlsStore, getWidgetKind, needsTarget, needsMidi, showLedFilter as showLedFilterFn, getDefaultLabel, CONTROL_TYPE_GROUPS, isMomentary } from '../store/useControlsStore';
import { useMidiStore } from '../store/useMidiStore';
import { usePlaylistStore } from '../store/usePlaylistStore';
import { applyControlValue, applyControlRGB, applyButtonPress, applyButtonRelease } from '../hooks/useMidiListener';
import FixtureTargetSelector from '../components/FixtureTargetSelector';
import type { ControlWidget, ControlType, ChannelType } from '../../shared/types';
import './ControlsView.css';

/* ── Helpers ──────────────────────────────────────────────────────────────── */

function generateId(): string {
  return crypto.randomUUID?.() ?? `ctrl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** Sub-type options for 'channel-other' */
const CHANNEL_SUB_TYPES: Array<{ value: ChannelType; label: string }> = [
  { value: 'pan', label: 'Pan' },
  { value: 'tilt', label: 'Tilt' },
  { value: 'speed', label: 'Speed' },
  { value: 'program', label: 'Program' },
  { value: 'color-wheel', label: 'Color Wheel' },
  { value: 'gobo', label: 'Gobo' },
  { value: 'amber', label: 'Amber' },
  { value: 'uv', label: 'UV' },
  { value: 'macro', label: 'Macro' },
  { value: 'generic', label: 'Generic' },
];

/** Icon for each control type. */
function getControlIcon(controlType: ControlType): string {
  const group = CONTROL_TYPE_GROUPS.find((g) => g.options.some((o) => o.value === controlType));
  const option = group?.options.find((o) => o.value === controlType);
  return option?.icon ?? '🎛';
}

/** Display label for a control type (short). */
function getControlTypeLabel(controlType: ControlType): string {
  const group = CONTROL_TYPE_GROUPS.find((g) => g.options.some((o) => o.value === controlType));
  const option = group?.options.find((o) => o.value === controlType);
  return option?.label ?? controlType;
}

/* ── Component ────────────────────────────────────────────────────────────── */

export default function ControlsView() {
  const widgets = useControlsStore((s) => s.widgets);
  const addControl = useControlsStore((s) => s.addControl);
  const removeControl = useControlsStore((s) => s.removeControl);
  const updateControl = useControlsStore((s) => s.updateControl);
  const learnTargetId = useMidiStore((s) => s.learnTargetId);
  const setLearnTarget = useMidiStore((s) => s.setLearnTarget);
  const playlists = usePlaylistStore((s) => s.playlists);

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedWidget = widgets.find((w) => w.id === selectedId) ?? null;

  // ── Add a new control ──────────────────────────────────────────────────
  const handleAdd = useCallback(() => {
    const newWidget: ControlWidget = {
      id: generateId(),
      controlType: 'channel-dimmer',
      label: getDefaultLabel('channel-dimmer'),
      target: { mode: 'all', fixtureIds: [] },
      value: 0,
    };
    addControl(newWidget);
    setSelectedId(newWidget.id);
  }, [addControl]);

  // ── Delete selected control ────────────────────────────────────────────
  const handleDelete = useCallback(() => {
    if (!selectedId) return;
    removeControl(selectedId);
    setSelectedId(null);
  }, [selectedId, removeControl]);

  // ── Apply slider value change ──────────────────────────────────────────
  const handleSliderChange = useCallback((widget: ControlWidget, value: number) => {
    applyControlValue(widget.id, value);
  }, []);

  // ── Apply color change ─────────────────────────────────────────────────
  const handleColorChange = useCallback((widget: ControlWidget, hex: string) => {
    const r = parseInt(hex.slice(1, 3), 16);
    const g = parseInt(hex.slice(3, 5), 16);
    const b = parseInt(hex.slice(5, 7), 16);
    applyControlRGB(widget.id, [r, g, b]);
  }, []);

  // ── Button interactions ────────────────────────────────────────────────
  const handleButtonDown = useCallback((widget: ControlWidget) => {
    applyButtonPress(widget);
  }, []);

  const handleButtonUp = useCallback((widget: ControlWidget) => {
    applyButtonRelease(widget);
  }, []);

  const handleButtonClick = useCallback((widget: ControlWidget) => {
    // Toggle buttons handle press on click; momentary handled by down/up
    if (!isMomentary(widget.controlType)) {
      if (widget.value > 0) {
        applyButtonRelease(widget);
      } else {
        applyButtonPress(widget);
      }
    }
  }, []);

  // ── Type change handler ────────────────────────────────────────────────
  const handleTypeChange = useCallback((newType: ControlType) => {
    if (!selectedId) return;
    const defaultLabel = getDefaultLabel(newType);
    const updates: Partial<ControlWidget> = {
      controlType: newType,
      label: defaultLabel,
      value: newType === 'room-dimmer' ? 255 : 0,
    };
    // Clear fields not relevant to the new type
    if (!needsTarget(newType)) {
      updates.target = { mode: 'all', fixtureIds: [] };
    }
    if (!needsMidi(newType)) {
      updates.midi = undefined;
    }
    if (newType !== 'channel-other') {
      updates.channelSubType = undefined;
    }
    if (newType !== 'playlist') {
      updates.playlistId = undefined;
    }
    if (newType !== 'rgb-color') {
      updates.colorValue = undefined;
    }
    updateControl(selectedId, updates);
  }, [selectedId, updateControl]);

  // ── Editor field updates ───────────────────────────────────────────────
  const handleEditorUpdate = useCallback((updates: Partial<ControlWidget>) => {
    if (!selectedId) return;
    updateControl(selectedId, updates);
  }, [selectedId, updateControl]);

  // ── Render ─────────────────────────────────────────────────────────────
  return (
    <div className={`controls-view ${selectedWidget ? 'has-editor' : ''}`}>
      {/* Left: Control Grid */}
      <div className="controls-list-pane">
        <div className="controls-header">
          <h1>Controls</h1>
          <button className="controls-add-btn" onClick={handleAdd}>
            ➕ Add Control
          </button>
        </div>

        {widgets.length === 0 ? (
          <div className="controls-empty">
            <span className="controls-empty-icon">🎛</span>
            <span className="controls-empty-text">
              No controls yet. Add sliders, buttons, or color wheels to control your fixtures, effects, and playlists.
            </span>
          </div>
        ) : (
          <div className="controls-grid">
            {widgets.map((widget) => (
              <ControlCard
                key={widget.id}
                widget={widget}
                isSelected={selectedId === widget.id}
                onSelect={() => setSelectedId(selectedId === widget.id ? null : widget.id)}
                onSliderChange={handleSliderChange}
                onColorChange={handleColorChange}
                onButtonDown={handleButtonDown}
                onButtonUp={handleButtonUp}
                onButtonClick={handleButtonClick}
              />
            ))}
          </div>
        )}
      </div>

      {/* Right: Editor Panel */}
      {selectedWidget && (
        <div className="controls-editor-pane">
          <div className="editor-header">
            <h2>Edit Control</h2>
            <button className="editor-close-btn" onClick={() => setSelectedId(null)}>✕</button>
          </div>

          <div className="editor-body">
            {/* Name */}
            <div className="editor-section">
              <label className="editor-section-label">Name</label>
              <input
                className="editor-input"
                type="text"
                value={selectedWidget.label}
                onChange={(e) => handleEditorUpdate({ label: e.target.value })}
              />
            </div>

            {/* Type (grouped dropdown) */}
            <div className="editor-section">
              <label className="editor-section-label">Type</label>
              <select
                className="editor-select"
                value={selectedWidget.controlType}
                onChange={(e) => handleTypeChange(e.target.value as ControlType)}
              >
                {CONTROL_TYPE_GROUPS.map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((opt) => (
                      <option key={opt.value} value={opt.value}>
                        {opt.icon} {opt.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </div>

            {/* Sub-type picker for channel-other */}
            {selectedWidget.controlType === 'channel-other' && (
              <div className="editor-section">
                <label className="editor-section-label">Channel</label>
                <select
                  className="editor-select"
                  value={selectedWidget.channelSubType ?? 'generic'}
                  onChange={(e) => handleEditorUpdate({ channelSubType: e.target.value as ChannelType })}
                >
                  {CHANNEL_SUB_TYPES.map((opt) => (
                    <option key={opt.value} value={opt.value}>{opt.label}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Playlist selector */}
            {selectedWidget.controlType === 'playlist' && (
              <div className="editor-section">
                <label className="editor-section-label">Playlist</label>
                <select
                  className="editor-select"
                  value={selectedWidget.playlistId ?? ''}
                  onChange={(e) => handleEditorUpdate({ playlistId: e.target.value || undefined })}
                >
                  <option value="">— Select playlist —</option>
                  {playlists.map((pl) => (
                    <option key={pl.id} value={pl.id}>{pl.name}</option>
                  ))}
                </select>
              </div>
            )}

            {/* Fixture Target */}
            {needsTarget(selectedWidget.controlType) && (
              <div className="editor-section">
                <label className="editor-section-label">Target Fixtures</label>
                <FixtureTargetSelector
                  target={selectedWidget.target}
                  onChange={(target) => handleEditorUpdate({ target })}
                  showLedFilter={showLedFilterFn(selectedWidget.controlType)}
                />
              </div>
            )}

            {/* MIDI Mapping */}
            {needsMidi(selectedWidget.controlType) && (
              <div className="editor-section">
                <label className="editor-section-label">MIDI Mapping</label>
                <div className="midi-row">
                  <label style={{ fontSize: 12, color: 'var(--color-text-dim)' }}>CH</label>
                  <input
                    className="midi-input"
                    type="number"
                    min={1}
                    max={16}
                    value={selectedWidget.midi?.channel ?? ''}
                    placeholder="—"
                    onChange={(e) => {
                      const ch = parseInt(e.target.value);
                      if (!isNaN(ch)) {
                        handleEditorUpdate({
                          midi: { ...selectedWidget.midi, channel: ch, cc: selectedWidget.midi?.cc ?? 0 },
                        });
                      }
                    }}
                  />
                  <label style={{ fontSize: 12, color: 'var(--color-text-dim)' }}>CC</label>
                  <input
                    className="midi-input"
                    type="number"
                    min={0}
                    max={127}
                    value={selectedWidget.midi?.cc ?? ''}
                    placeholder="—"
                    onChange={(e) => {
                      const cc = parseInt(e.target.value);
                      if (!isNaN(cc)) {
                        handleEditorUpdate({
                          midi: { ...selectedWidget.midi, channel: selectedWidget.midi?.channel ?? 1, cc },
                        });
                      }
                    }}
                  />
                </div>
                <div className="midi-row" style={{ marginTop: 6 }}>
                  <button
                    className={`midi-learn-btn ${learnTargetId === selectedWidget.id ? 'learning' : ''}`}
                    onClick={() => {
                      if (learnTargetId === selectedWidget.id) {
                        setLearnTarget(null);
                      } else {
                        setLearnTarget(selectedWidget.id);
                      }
                    }}
                  >
                    {learnTargetId === selectedWidget.id ? '⏳ Waiting…' : '🎹 Auto Link'}
                  </button>
                  {selectedWidget.midi && (
                    <button
                      className="midi-clear-btn"
                      onClick={() => handleEditorUpdate({ midi: undefined })}
                    >
                      Clear
                    </button>
                  )}
                </div>
                {selectedWidget.midi && (
                  <span className="midi-status">
                    Mapped: CH {selectedWidget.midi.channel} / CC {selectedWidget.midi.cc}
                    {selectedWidget.midi.deviceName && ` (${selectedWidget.midi.deviceName})`}
                  </span>
                )}
              </div>
            )}

            {/* Delete */}
            <button className="editor-delete-btn" onClick={handleDelete}>
              🗑 Delete Control
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ── Control Card sub-component ───────────────────────────────────────────── */

interface ControlCardProps {
  widget: ControlWidget;
  isSelected: boolean;
  onSelect: () => void;
  onSliderChange: (widget: ControlWidget, value: number) => void;
  onColorChange: (widget: ControlWidget, hex: string) => void;
  onButtonDown: (widget: ControlWidget) => void;
  onButtonUp: (widget: ControlWidget) => void;
  onButtonClick: (widget: ControlWidget) => void;
}

function ControlCard({ widget, isSelected, onSelect, onSliderChange, onColorChange, onButtonDown, onButtonUp, onButtonClick }: ControlCardProps) {
  const widgetKind = getWidgetKind(widget.controlType);
  const icon = getControlIcon(widget.controlType);
  const typeLabel = getControlTypeLabel(widget.controlType);

  const colorHex = widget.colorValue
    ? `#${widget.colorValue.map((c) => c.toString(16).padStart(2, '0')).join('')}`
    : '#ffffff';

  // For sliders, display value as appropriate
  const displayValue = widget.controlType === 'room-dimmer' || widget.controlType === 'led-dimmer'
    ? `${Math.round((widget.value / 255) * 100)}%`
    : widget.controlType === 'color-shift'
    ? `${Math.round((widget.value / 255) * 360)}°`
    : `${widget.value}`;

  const sliderMax = 255;

  return (
    <div
      className={`control-card ${isSelected ? 'selected' : ''}`}
      onClick={onSelect}
    >
      <span className="control-card-icon">{icon}</span>
      <span className="control-card-label">{widget.label}</span>
      <span className="control-card-type">{typeLabel}</span>

      {widgetKind === 'slider' && (
        <div className="control-slider-container" onClick={(e) => e.stopPropagation()}>
          <input
            type="range"
            className="control-slider-track"
            min={0}
            max={sliderMax}
            step={1}
            value={widget.value}
            onChange={(e) => onSliderChange(widget, parseInt(e.target.value))}
            style={{
              background: `linear-gradient(to right, var(--color-accent) ${(widget.value / sliderMax) * 100}%, var(--color-surface-3) ${(widget.value / sliderMax) * 100}%)`,
            }}
          />
          <span className="control-card-value">{displayValue}</span>
        </div>
      )}

      {widgetKind === 'color-wheel' && (
        <div onClick={(e) => e.stopPropagation()}>
          <input
            type="color"
            className="control-color-swatch"
            value={colorHex}
            onChange={(e) => onColorChange(widget, e.target.value)}
            style={{ background: colorHex }}
          />
        </div>
      )}

      {widgetKind === 'button' && (
        <button
          className={`control-toggle-btn ${widget.value > 0 ? 'active' : ''}`}
          onClick={(e) => { e.stopPropagation(); onButtonClick(widget); }}
          onMouseDown={(e) => { if (isMomentary(widget.controlType)) { e.stopPropagation(); onButtonDown(widget); } }}
          onMouseUp={(e) => { if (isMomentary(widget.controlType)) { e.stopPropagation(); onButtonUp(widget); } }}
          onMouseLeave={(e) => { if (isMomentary(widget.controlType) && widget.value > 0) { e.stopPropagation(); onButtonUp(widget); } }}
        >
          {widget.value > 0 ? 'ON' : 'OFF'}
        </button>
      )}
    </div>
  );
}
