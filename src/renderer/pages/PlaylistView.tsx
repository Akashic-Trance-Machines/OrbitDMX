import React, { useState, useCallback, useRef } from 'react';
import { usePlaylistStore } from '../store/usePlaylistStore';
import { useSceneStore } from '../store/useSceneStore';
import { useRoomStore } from '../store/useRoomStore';
import { usePlaylistControls } from '../hooks/usePlaylistRunner';
import { getFixtureLedColors } from '../utils/ledColors';
import AddSceneToPlaylistModal from '../components/AddSceneToPlaylistModal';
import VuMeter from '../components/VuMeter';
import ConfirmDialog from '../components/ConfirmDialog';
import type { Playlist, Cue, PlaylistSyncMode, PlayDirection, Scene, FixtureInstance } from '../../shared/types';
import './PlaylistView.css';

/* ── Mode labels ───────────────────────────────────────────────────────────── */

const MODE_LABELS: Record<PlaylistSyncMode, string> = {
  auto: 'Auto',
  manual: 'Manual',
  music: 'Music',
};

const DIRECTION_LABELS: Record<PlayDirection, { label: string; icon: string }> = {
  forward: { label: 'Forward', icon: '→' },
  backward: { label: 'Backward', icon: '←' },
  random: { label: 'Random', icon: '⇄' },
};

/* ── Component ─────────────────────────────────────────────────────────────── */

export default function PlaylistView() {
  const playlists = usePlaylistStore((s) => s.playlists);
  const activePlaylistId = usePlaylistStore((s) => s.activePlaylistId);
  const addPlaylist = usePlaylistStore((s) => s.addPlaylist);
  const updatePlaylist = usePlaylistStore((s) => s.updatePlaylist);
  const deletePlaylist = usePlaylistStore((s) => s.deletePlaylist);
  const selectPlaylist = usePlaylistStore((s) => s.selectPlaylist);
  const addCue = usePlaylistStore((s) => s.addCue);
  const removeCue = usePlaylistStore((s) => s.removeCue);
  const reorderCues = usePlaylistStore((s) => s.reorderCues);

  const scenes = useSceneStore((s) => s.scenes);
  const fixtures = useRoomStore((s) => s.fixtures);

  const runner = usePlaylistControls();

  // Local UI state: which card is expanded (separate from playback)
  const [expandedId, setExpandedId] = useState<string | null>(activePlaylistId);
  const expandedPlaylist = playlists.find((p) => p.id === expandedId) ?? null;

  // ── New playlist modal ──────────────────────────────────────────────────
  const [showNewModal, setShowNewModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newMode, setNewMode] = useState<PlaylistSyncMode>('auto');

  const handleCreatePlaylist = useCallback(() => {
    const name = newName.trim();
    if (!name) return;

    const playlist: Playlist = {
      id: crypto.randomUUID(),
      roomId: 'default',
      name,
      cues: [],
      syncMode: newMode,
      playDirection: 'forward',
      fadeDurationMs: 1000,
      holdDurationMs: 5000,
      audioGain: 50,
      audioThreshold: 50,
    };

    addPlaylist(playlist);
    setShowNewModal(false);
  }, [newName, newMode, addPlaylist]);

  // ── Add scene modal ─────────────────────────────────────────────────────
  const [showAddScene, setShowAddScene] = useState(false);

  const handleAddScene = useCallback(
    (scene: Scene) => {
      if (!expandedId) return;
      const cue: Cue = { id: crypto.randomUUID(), sceneId: scene.id };
      addCue(expandedId, cue);
      setShowAddScene(false);
    },
    [expandedId, addCue],
  );

  // ── Delete confirmation ─────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<string | null>(null);

  const handleConfirmDelete = useCallback(() => {
    if (deleteTarget) {
      if (runner.playbackState !== 'stopped' && activePlaylistId === deleteTarget) {
        runner.stop();
      }
      deletePlaylist(deleteTarget);
      setDeleteTarget(null);
    }
  }, [deleteTarget, deletePlaylist, runner, activePlaylistId]);

  // ── Drag-and-drop cue reorder ───────────────────────────────────────────
  const dragIdxRef = useRef<number | null>(null);
  const [dragOverIdx, setDragOverIdx] = useState<number | null>(null);

  const handleDragStart = (e: React.DragEvent, idx: number) => {
    dragIdxRef.current = idx;
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleDragOver = (e: React.DragEvent, idx: number) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    setDragOverIdx(idx);
  };

  const handleDrop = (e: React.DragEvent, dropIdx: number) => {
    e.preventDefault();
    setDragOverIdx(null);
    const fromIdx = dragIdxRef.current;
    if (fromIdx === null || !expandedPlaylist) return;

    const cues = [...expandedPlaylist.cues];
    const [moved] = cues.splice(fromIdx, 1);
    cues.splice(dropIdx, 0, moved);
    reorderCues(expandedPlaylist.id, cues);
    dragIdxRef.current = null;
  };

  const handleDragEnd = () => {
    setDragOverIdx(null);
    dragIdxRef.current = null;
  };

  // ── Settings change handlers ────────────────────────────────────────────
  const handleSettingChange = useCallback(
    (field: keyof Playlist, value: number | string) => {
      if (!expandedId) return;
      updatePlaylist(expandedId, { [field]: value } as Partial<Playlist>);
    },
    [expandedId, updatePlaylist],
  );

  // ── Render ──────────────────────────────────────────────────────────────

  return (
    <div className={`playlist-view ${expandedPlaylist ? 'has-panel' : ''}`}>
      {/* Left pane: playlist list + cue list */}
      <div className="playlist-list-pane">
        {/* Header */}
        <div className="playlist-view-header">
          <h1>Playlists</h1>
          <button
            className="btn-primary"
            id="btn-new-playlist"
            onClick={() => { setNewName(''); setNewMode('auto'); setShowNewModal(true); }}
          >
            + New Playlist
          </button>
        </div>

        {/* Playlist cards */}
        {playlists.length === 0 ? (
          <div className="playlist-view-empty">
            <div className="playlist-view-empty-icon">▶</div>
            <h2>No playlists yet</h2>
            <p className="text-dim">Create a playlist to chain your scenes together.</p>
          </div>
        ) : (
          <div className="playlist-scroll-area">
            <div className="playlist-card-list">
              {playlists.map((pl) => {
                const isExpanded = pl.id === expandedId;
                const isActivePlayback = pl.id === activePlaylistId;
                const isPlaying = isActivePlayback && runner.playbackState === 'playing';
                const isPaused = isActivePlayback && runner.playbackState === 'paused';

                return (
                  <div
                    key={pl.id}
                    className={`playlist-card ${isExpanded ? 'active' : ''} ${isPlaying ? 'playing' : ''}`}
                  >
                    {/* Card header (clickable to select) */}
                    <div
                      className="playlist-card-header"
                      onClick={() => {
                        if (!isExpanded) {
                          setExpandedId(pl.id);
                        } else {
                          // Clicking the expanded card collapses it (playback continues)
                          setExpandedId(null);
                        }
                      }}
                    >
                      <div className="playlist-card-info">
                        <span className="playlist-card-name">{pl.name}</span>
                        <span className="playlist-card-meta text-dim">
                          {MODE_LABELS[pl.syncMode]} · {pl.cues.length} {pl.cues.length === 1 ? 'scene' : 'scenes'} · {DIRECTION_LABELS[pl.playDirection].icon}
                        </span>
                      </div>
                      <div className="playlist-card-controls">
                        {isPlaying ? (
                          <button className="playlist-btn" title="Pause" onClick={(e) => { e.stopPropagation(); runner.pause(); }}>⏸</button>
                        ) : (
                          <button className="playlist-btn playlist-btn-play" title="Play" onClick={(e) => {
                            e.stopPropagation();
                            if (!isActivePlayback) {
                              // Stop any current playback first
                              if (runner.playbackState !== 'stopped') runner.stop();
                              // Select this playlist for playback
                              selectPlaylist(pl.id);
                            }
                            // Directly set playback state — the runner hook picks this up
                            usePlaylistStore.getState().setPlaybackState('playing');
                          }} disabled={pl.cues.length === 0}>▶</button>
                        )}
                        {(isPlaying || isPaused) && (
                          <button className="playlist-btn" title="Stop" onClick={(e) => { e.stopPropagation(); runner.stop(); }}>⏹</button>
                        )}
                        <button
                          className="playlist-btn playlist-btn-delete"
                          title="Delete"
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget(pl.id); }}
                        >✕</button>
                      </div>
                    </div>

                    {/* Collapsible cue list (inside the card) */}
                    {isExpanded && (
                      <div className="playlist-cue-section">
                        <div className="playlist-cue-header">
                          <h3 className="playlist-cue-title">
                            Cues
                            <span className="playlist-cue-count text-dim">{expandedPlaylist!.cues.length}</span>
                          </h3>
                          <button
                            className="btn-primary btn-sm"
                            id="btn-add-scene-to-playlist"
                            onClick={() => setShowAddScene(true)}
                          >
                            + Add Scene
                          </button>
                        </div>

                        {expandedPlaylist!.cues.length === 0 ? (
                          <div className="playlist-cue-empty text-dim">
                            No scenes in this playlist yet. Add scenes to start chaining.
                          </div>
                        ) : (
                          <div className="playlist-cue-list">
                            {expandedPlaylist!.cues.map((cue, idx) => {
                              const scene = scenes.find((s) => s.id === cue.sceneId);
                              const isCurrent = runner.playbackState !== 'stopped' && runner.currentCueIndex === idx;

                              return (
                                <div
                                  key={cue.id}
                                  className={`playlist-cue-row ${isCurrent ? 'current' : ''} ${dragOverIdx === idx ? 'drag-over' : ''}`}
                                  draggable
                                  onDragStart={(e) => handleDragStart(e, idx)}
                                  onDragOver={(e) => handleDragOver(e, idx)}
                                  onDrop={(e) => handleDrop(e, idx)}
                                  onDragEnd={handleDragEnd}
                                >
                                  <span className="playlist-cue-handle" title="Drag to reorder">≡</span>
                                  <span className="playlist-cue-number mono">{idx + 1}.</span>
                                  <span className="playlist-cue-name">{scene?.name ?? '(deleted scene)'}</span>
                                  <div className="playlist-cue-dots">
                                    {scene && fixtures.map((f) => {
                                      const leds = getFixtureLedColors(f, scene.values);
                                      return (
                                        <div key={f.id} className="playlist-cue-fixture-group">
                                          {leds.map((led) => (
                                            <span
                                              key={`${led.fixtureId}-${led.ledIndex}`}
                                              className="playlist-cue-dot"
                                              style={{ background: led.color }}
                                            />
                                          ))}
                                        </div>
                                      );
                                    })}
                                  </div>
                                  <button
                                    className="playlist-cue-remove"
                                    title="Remove"
                                    onClick={() => removeCue(expandedPlaylist!.id, cue.id)}
                                  >✕</button>
                                </div>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>

      {/* Right pane: playlist controls (settings panel) */}
      {expandedPlaylist && (
        <div className="playlist-control-pane">
          <div className="playlist-panel-header">
            <h2 className="playlist-panel-title">{expandedPlaylist.name}</h2>
            <button
              className="playlist-panel-close"
              title="Close"
              onClick={() => setExpandedId(null)}
            >✕</button>
          </div>

          <div className="playlist-panel-body">
            {/* Transport controls */}
            <div className="playlist-transport">
              {runner.playbackState === 'playing' ? (
                <button className="playlist-transport-btn" onClick={runner.pause} title="Pause">⏸</button>
              ) : (
                <button
                  className="playlist-transport-btn playlist-transport-play"
                  onClick={runner.play}
                  title="Play"
                  disabled={expandedPlaylist.cues.length === 0}
                >▶</button>
              )}
              <button
                className="playlist-transport-btn"
                onClick={runner.stop}
                title="Stop"
                disabled={runner.playbackState === 'stopped'}
              >⏹</button>
              {runner.playbackState !== 'stopped' && (
                <span className="playlist-transport-indicator mono">
                  Cue {runner.currentCueIndex + 1} / {expandedPlaylist.cues.length}
                </span>
              )}
            </div>

            {/* Mode tabs */}
            <div className="playlist-settings-section">
              <label className="playlist-setting-label">Mode</label>
              <div className="playlist-mode-tabs">
                {(['auto', 'manual', 'music'] as PlaylistSyncMode[]).map((mode) => (
                  <button
                    key={mode}
                    className={`playlist-mode-tab ${expandedPlaylist.syncMode === mode ? 'active' : ''}`}
                    onClick={() => handleSettingChange('syncMode', mode)}
                  >
                    {MODE_LABELS[mode]}
                  </button>
                ))}
              </div>
            </div>

            {/* Direction tabs */}
            <div className="playlist-settings-section">
              <label className="playlist-setting-label">Direction</label>
              <div className="playlist-mode-tabs">
                {(['forward', 'backward', 'random'] as PlayDirection[]).map((dir) => (
                  <button
                    key={dir}
                    className={`playlist-mode-tab ${expandedPlaylist.playDirection === dir ? 'active' : ''}`}
                    onClick={() => handleSettingChange('playDirection', dir)}
                  >
                    {DIRECTION_LABELS[dir].icon} {DIRECTION_LABELS[dir].label}
                  </button>
                ))}
              </div>
            </div>

            {/* Crossfade (all modes) */}
            <div className="playlist-settings-section">
              <SliderSetting
                label="Crossfade"
                value={expandedPlaylist.fadeDurationMs}
                min={0}
                max={10000}
                step={100}
                displayValue={`${(expandedPlaylist.fadeDurationMs / 1000).toFixed(1)}s`}
                onChange={(v) => handleSettingChange('fadeDurationMs', v)}
              />
            </div>

            {/* Auto mode settings */}
            {expandedPlaylist.syncMode === 'auto' && (
              <div className="playlist-settings-section">
                <SliderSetting
                  label="Hold Duration"
                  value={expandedPlaylist.holdDurationMs}
                  min={500}
                  max={30000}
                  step={500}
                  displayValue={`${(expandedPlaylist.holdDurationMs / 1000).toFixed(1)}s`}
                  onChange={(v) => handleSettingChange('holdDurationMs', v)}
                />
                {expandedPlaylist.fadeDurationMs > expandedPlaylist.holdDurationMs && (
                  <div className="playlist-warning">
                    ⚠ Crossfade ({(expandedPlaylist.fadeDurationMs / 1000).toFixed(1)}s) is longer than hold duration ({(expandedPlaylist.holdDurationMs / 1000).toFixed(1)}s). The next scene will start fading before the current one finishes holding.
                  </div>
                )}
              </div>
            )}

            {/* Manual mode: next/prev */}
            {expandedPlaylist.syncMode === 'manual' && runner.playbackState === 'playing' && (
              <div className="playlist-settings-section">
                <label className="playlist-setting-label">Navigate</label>
                <div className="playlist-manual-controls">
                  <button className="playlist-nav-btn" onClick={runner.previous}>◄ Prev</button>
                  <span className="playlist-cue-indicator mono">
                    {runner.currentCueIndex + 1} / {expandedPlaylist.cues.length}
                  </span>
                  <button className="playlist-nav-btn" onClick={runner.next}>Next ►</button>
                </div>
              </div>
            )}

            {/* Music mode: gain + threshold + VU meter */}
            {expandedPlaylist.syncMode === 'music' && (
              <div className="playlist-settings-section">
                <VuMeter threshold={(expandedPlaylist.audioThreshold ?? 50) / 100} />
                <SliderSetting
                  label="Audio Gain"
                  value={expandedPlaylist.audioGain}
                  min={0}
                  max={100}
                  step={1}
                  displayValue={`${expandedPlaylist.audioGain}%`}
                  onChange={(v) => handleSettingChange('audioGain', v)}
                />
                <SliderSetting
                  label="Threshold"
                  value={expandedPlaylist.audioThreshold}
                  min={5}
                  max={100}
                  step={1}
                  displayValue={`${expandedPlaylist.audioThreshold}%`}
                  onChange={(v) => handleSettingChange('audioThreshold', v)}
                />
                <SliderSetting
                  label="Cooldown"
                  value={expandedPlaylist.audioCooldown ?? 300}
                  min={100}
                  max={3000}
                  step={50}
                  displayValue={`${((expandedPlaylist.audioCooldown ?? 300) / 1000).toFixed(1)}s`}
                  onChange={(v) => handleSettingChange('audioCooldown', v)}
                />
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Modals ──────────────────────────────────────────────────────────── */}

      {/* New Playlist Modal */}
      {showNewModal && (
        <div className="scene-name-overlay" onClick={() => setShowNewModal(false)}>
          <div className="scene-name-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="scene-name-title">New Playlist</h3>
            <p className="scene-name-desc text-dim">Chain scenes together with automatic or manual transitions.</p>

            <label className="playlist-form-label">Name</label>
            <input
              type="text"
              className="scene-name-input"
              id="input-playlist-name"
              placeholder="Playlist name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleCreatePlaylist(); if (e.key === 'Escape') setShowNewModal(false); }}
              autoFocus
              maxLength={40}
            />

            <label className="playlist-form-label">Sync Mode</label>
            <div className="playlist-mode-tabs modal-tabs">
              {(['auto', 'manual', 'music'] as PlaylistSyncMode[]).map((mode) => (
                <button
                  key={mode}
                  className={`playlist-mode-tab ${newMode === mode ? 'active' : ''}`}
                  onClick={() => setNewMode(mode)}
                >
                  {MODE_LABELS[mode]}
                </button>
              ))}
            </div>

            <div className="scene-name-actions" style={{ marginTop: 20 }}>
              <button className="confirm-btn confirm-btn-cancel" onClick={() => setShowNewModal(false)}>Cancel</button>
              <button
                className="confirm-btn confirm-btn-warning"
                id="btn-create-playlist"
                onClick={handleCreatePlaylist}
                disabled={!newName.trim()}
              >
                Add Playlist
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Add Scene Modal */}
      {showAddScene && (
        <AddSceneToPlaylistModal
          onSelect={handleAddScene}
          onClose={() => setShowAddScene(false)}
        />
      )}

      {/* Delete confirm */}
      {deleteTarget && (
        <ConfirmDialog
          title="Delete Playlist"
          message="This playlist and all its cues will be permanently removed."
          confirmLabel="Delete"
          variant="danger"
          onConfirm={handleConfirmDelete}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  );
}

/* ── Inline slider setting component ───────────────────────────────────────── */

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
