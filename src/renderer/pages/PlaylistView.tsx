import React, { useState, useCallback, useRef } from 'react';

import { usePlaylistStore } from '../store/usePlaylistStore';
import { useColourStore } from '../store/useColourStore';
import { useSceneStore } from '../store/useSceneStore';
import { useRoomStore } from '../store/useRoomStore';
import { useTempoStore } from '../store/useTempoStore';
import { usePlaylistControls } from '../hooks/usePlaylistRunner';
import { getFixtureLedColors } from '../utils/ledColors';
import AddSceneToPlaylistModal from '../components/AddSceneToPlaylistModal';
import PalettePlaylistPanel from '../components/PalettePlaylistPanel';
import HsbPlaylistPanel from '../components/HsbPlaylistPanel';
import VuMeter from '../components/VuMeter';
import ConfirmDialog from '../components/ConfirmDialog';
import type { Playlist, PalettePlaylist, HsbPlaylist, Cue, PlaylistSyncMode, PlayDirection, Scene, FixtureInstance } from '../../shared/types';
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
  // ── Scene playlists ──────────────────────────────────────────────────────
  const playlists = usePlaylistStore((s) => s.playlists);
  const activePlaylistId = usePlaylistStore((s) => s.activePlaylistId);
  const addPlaylist = usePlaylistStore((s) => s.addPlaylist);
  const updatePlaylist = usePlaylistStore((s) => s.updatePlaylist);
  const deletePlaylist = usePlaylistStore((s) => s.deletePlaylist);
  const selectPlaylist = usePlaylistStore((s) => s.selectPlaylist);
  const addCue = usePlaylistStore((s) => s.addCue);
  const removeCue = usePlaylistStore((s) => s.removeCue);
  const reorderCues = usePlaylistStore((s) => s.reorderCues);
  const holdStartedAt = usePlaylistStore((s) => s.holdStartedAt);

  // ── Palette playlists ────────────────────────────────────────────────────
  const palettePlayists = usePlaylistStore((s) => s.palettePlayists);
  const activePalettePlaylistId = usePlaylistStore((s) => s.activePalettePlaylistId);
  const palettePlaybackState = usePlaylistStore((s) => s.palettePlaybackState);
  const addPalettePlaylist = usePlaylistStore((s) => s.addPalettePlaylist);
  const deletePalettePlaylist = usePlaylistStore((s) => s.deletePalettePlaylist);
  const selectPalettePlaylist = usePlaylistStore((s) => s.selectPalettePlaylist);
  const setPalettePlaybackState = usePlaylistStore((s) => s.setPalettePlaybackState);

  // ── HSB playlists ────────────────────────────────────────────────────────
  const hsbPlaylists = usePlaylistStore((s) => s.hsbPlaylists);
  const activeHsbPlaylistId = usePlaylistStore((s) => s.activeHsbPlaylistId);
  const hsbPlaybackState = usePlaylistStore((s) => s.hsbPlaybackState);
  const addHsbPlaylist = usePlaylistStore((s) => s.addHsbPlaylist);
  const deleteHsbPlaylist = usePlaylistStore((s) => s.deleteHsbPlaylist);
  const selectHsbPlaylist = usePlaylistStore((s) => s.selectHsbPlaylist);
  const setHsbPlaybackState = usePlaylistStore((s) => s.setHsbPlaybackState);

  const palettes = useColourStore((s) => s.palettes);
  const scenes = useSceneStore((s) => s.scenes);
  const fixtures = useRoomStore((s) => s.fixtures);

  const bpm = useTempoStore((s) => s.bpm);

  const runner = usePlaylistControls();

  // ── Expand/collapse: unify both types under one expanded ID ─────────────
  // Format: 'scene:id' or 'palette:id'
  const [expandedKey, setExpandedKey] = useState<string | null>(
    activePlaylistId ? `scene:${activePlaylistId}` : null,
  );

  const expandedSceneId   = expandedKey?.startsWith('scene:')   ? expandedKey.slice(6)   : null;
  const expandedPaletteId = expandedKey?.startsWith('palette:') ? expandedKey.slice(8) : null;
  const expandedHsbId     = expandedKey?.startsWith('hsb:')     ? expandedKey.slice(4)   : null;

  const expandedPlaylist        = playlists.find((p) => p.id === expandedSceneId) ?? null;
  const expandedPalettePlaylist = palettePlayists.find((p) => p.id === expandedPaletteId) ?? null;
  const expandedHsbPlaylist     = hsbPlaylists.find((p) => p.id === expandedHsbId) ?? null;

  // ── New playlist modal ───────────────────────────────────────────────────
  const [showNewModal, setShowNewModal] = useState(false);
  const [newPlaylistKind, setNewPlaylistKind] = useState<'scene' | 'palette' | 'hsb'>('scene');
  const [newName, setNewName] = useState('');
  const [newMode, setNewMode] = useState<PlaylistSyncMode>('auto');
  const [newPaletteId, setNewPaletteId] = useState<string>('');

  const openNewModal = () => {
    setNewName('');
    setNewMode('auto');
    setNewPlaylistKind('scene');
    setNewPaletteId(palettes[0]?.id ?? '');
    setShowNewModal(true);
  };

  const handleCreatePlaylist = useCallback(() => {
    const name = newName.trim();
    if (!name) return;

    if (newPlaylistKind === 'hsb') {
      const hp: HsbPlaylist = {
        id: crypto.randomUUID(),
        roomId: 'default',
        name,
        kind: 'hsb',
        hueCenter:  180,
        hueWidth:   360,
        saturation: { min: 60, max: 100 },
        brightness: { min: 60, max: 100 },
        syncMode: 'auto',
        holdMs: 2000,
        bpmSync: false,
        bpmDivider: 1,
        fadeMs: 500,
        audioGain: 50,
        audioThreshold: 50,
        audioCooldown: 300,
        target: { mode: 'all', fixtureIds: [] },
      };
      addHsbPlaylist(hp);
      setExpandedKey(`hsb:${hp.id}`);
    } else if (newPlaylistKind === 'palette') {
      const pp: PalettePlaylist = {
        id: crypto.randomUUID(),
        roomId: 'default',
        name,
        kind: 'palette',
        paletteId: newPaletteId || (palettes[0]?.id ?? ''),
        syncMode: 'auto',
        holdMs: 2000,
        bpmSync: false,
        bpmDivider: 1,
        fadeMs: 500,
        audioGain: 50,
        audioThreshold: 50,
        audioCooldown: 300,
        playDirection: 'forward',
        target: { mode: 'all', fixtureIds: [] },
      };
      addPalettePlaylist(pp);
      setExpandedKey(`palette:${pp.id}`);
    } else {
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
      setExpandedKey(`scene:${playlist.id}`);
    }
    setShowNewModal(false);
  }, [newName, newPlaylistKind, newMode, newPaletteId, palettes, addPlaylist, addPalettePlaylist, addHsbPlaylist]);

  // ── Add scene modal ──────────────────────────────────────────────────────
  const [showAddScene, setShowAddScene] = useState(false);

  const handleAddScene = useCallback(
    (scene: Scene) => {
      if (!expandedSceneId) return;
      const cue: Cue = { id: crypto.randomUUID(), sceneId: scene.id };
      addCue(expandedSceneId, cue);
      setShowAddScene(false);
    },
    [expandedSceneId, addCue],
  );

  // ── Delete confirmation ──────────────────────────────────────────────────
  const [deleteTarget, setDeleteTarget] = useState<{ kind: 'scene' | 'palette' | 'hsb'; id: string } | null>(null);

  const handleConfirmDelete = useCallback(() => {
    if (!deleteTarget) return;
    if (deleteTarget.kind === 'scene') {
      if (runner.playbackState !== 'stopped' && activePlaylistId === deleteTarget.id) runner.stop();
      deletePlaylist(deleteTarget.id);
    } else if (deleteTarget.kind === 'hsb') {
      if (hsbPlaybackState !== 'stopped' && activeHsbPlaylistId === deleteTarget.id) setHsbPlaybackState('stopped');
      deleteHsbPlaylist(deleteTarget.id);
    } else {
      if (palettePlaybackState !== 'stopped' && activePalettePlaylistId === deleteTarget.id) setPalettePlaybackState('stopped');
      deletePalettePlaylist(deleteTarget.id);
    }
    setDeleteTarget(null);
  }, [deleteTarget, deletePlaylist, deletePalettePlaylist, deleteHsbPlaylist, runner, activePlaylistId, activePalettePlaylistId, activeHsbPlaylistId, palettePlaybackState, hsbPlaybackState, setPalettePlaybackState, setHsbPlaybackState]);

  // ── Drag-and-drop cue reorder ────────────────────────────────────────────
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

  // ── Settings change handlers ─────────────────────────────────────────────
  const handleSettingChange = useCallback(
    (field: keyof Playlist, value: number | string) => {
      if (!expandedSceneId) return;
      updatePlaylist(expandedSceneId, { [field]: value } as Partial<Playlist>);
    },
    [expandedSceneId, updatePlaylist],
  );

  // ── Render ───────────────────────────────────────────────────────────────

  const hasPanel = expandedPlaylist !== null || expandedPalettePlaylist !== null || expandedHsbPlaylist !== null;

  return (
    <div className={`playlist-view ${hasPanel ? 'has-panel' : ''}`}>
      {/* Left pane: playlist list + cue list */}
      <div className="playlist-list-pane">
        {/* Header */}
        <div className="playlist-view-header">
          <h1>Playlists</h1>
          <button
            className="btn-primary"
            id="btn-new-playlist"
            onClick={openNewModal}
          >
            + New Playlist
          </button>
        </div>

        {/* Playlist cards */}
        {playlists.length === 0 && palettePlayists.length === 0 && hsbPlaylists.length === 0 ? (
          <div className="playlist-view-empty">
            <div className="playlist-view-empty-icon">▶</div>
            <h2>No playlists yet</h2>
            <p className="text-dim">Create a playlist to chain scenes or cycle through a colour palette.</p>
          </div>
        ) : (
          <div className="playlist-scroll-area">
            <div className="playlist-card-list">
              {/* Scene Playlist cards */}
              {playlists.map((pl) => {
                const isExpanded = `scene:${pl.id}` === expandedKey;
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
                        setExpandedKey(isExpanded ? null : `scene:${pl.id}`);
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
                            // Stop all other playlist types first
                            if (palettePlaybackState !== 'stopped') setPalettePlaybackState('stopped');
                            if (hsbPlaybackState !== 'stopped') setHsbPlaybackState('stopped');
                            if (!isActivePlayback) {
                              if (runner.playbackState !== 'stopped') runner.stop();
                              selectPlaylist(pl.id);
                            }
                            usePlaylistStore.getState().setPlaybackState('playing');
                          }} disabled={pl.cues.length === 0}>▶</button>
                        )}
                        {(isPlaying || isPaused) && (
                          <button className="playlist-btn" title="Stop" onClick={(e) => { e.stopPropagation(); runner.stop(); }}>⏹</button>
                        )}
                        <button
                          className="playlist-btn playlist-btn-delete"
                          title="Delete"
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget({ kind: 'scene', id: pl.id }); }}
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
                              const showBar = isCurrent && expandedPlaylist!.syncMode === 'auto' && runner.playbackState === 'playing';

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
                                  {showBar && (
                                    <CueHoldBar
                                      holdDurationMs={expandedPlaylist!.holdDurationMs}
                                      holdStartedAt={holdStartedAt}
                                    />
                                  )}
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

              {/* Palette Generator cards */}
              {palettePlayists.map((pp) => {
                const isExpanded = `palette:${pp.id}` === expandedKey;
                const isPlaying = pp.id === activePalettePlaylistId && palettePlaybackState === 'playing';
                const palette = palettes.find((p) => p.id === pp.paletteId);
                const colours = palette?.colours ?? [];

                return (
                  <div
                    key={pp.id}
                    className={`playlist-card ${isExpanded ? 'active' : ''} ${isPlaying ? 'playing' : ''}`}
                  >
                    <div
                      className="playlist-card-header"
                      onClick={() => setExpandedKey(isExpanded ? null : `palette:${pp.id}`)}
                    >
                      <div className="playlist-card-info">
                        <span className="playlist-card-name">
                          <span style={{ marginRight: 6, opacity: 0.7 }}>✦</span>
                          {pp.name}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                          <span className="playlist-card-meta text-dim" style={{ fontSize: 11 }}>
                            Palette Generator · {DIRECTION_LABELS[pp.playDirection].icon}
                          </span>
                          {/* Mini colour strip */}
                          <div style={{ display: 'flex', gap: 3 }}>
                            {colours.slice(0, 8).map((hex, i) => (
                              <span
                                key={i}
                                style={{
                                  width: 10, height: 10, borderRadius: '50%',
                                  background: hex, flexShrink: 0,
                                  border: isPlaying && i === (usePlaylistStore.getState().paletteCurrentIndex % colours.length) ? '1.5px solid #fff' : '1px solid rgba(255,255,255,0.15)',
                                }}
                              />
                            ))}
                            {colours.length > 8 && (
                              <span style={{ fontSize: 10, color: 'var(--color-text-dim)', lineHeight: '10px' }}>+{colours.length - 8}</span>
                            )}
                          </div>
                        </div>
                      </div>
                      <div className="playlist-card-controls">
                        {isPlaying ? (
                          <button
                            className="playlist-btn"
                            title="Stop"
                            onClick={(e) => { e.stopPropagation(); setPalettePlaybackState('stopped'); }}
                          >⏹</button>
                        ) : (
                          <button
                            className="playlist-btn playlist-btn-play"
                            title="Play"
                            onClick={(e) => {
                              e.stopPropagation();
                              // Stop all other playlist types
                              if (runner.playbackState !== 'stopped') runner.stop();
                              usePlaylistStore.getState().setPlaybackState('stopped');
                              if (hsbPlaybackState !== 'stopped') setHsbPlaybackState('stopped');
                              selectPalettePlaylist(pp.id);
                              usePlaylistStore.getState().setPalettePlaybackState('playing');
                            }}
                            disabled={colours.length < 2}
                          >▶</button>
                        )}
                        <button
                          className="playlist-btn playlist-btn-delete"
                          title="Delete"
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget({ kind: 'palette', id: pp.id }); }}
                        >✕</button>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* HSB Generator cards */}
              {hsbPlaylists.map((hp) => {
                const isExpanded = `hsb:${hp.id}` === expandedKey;
                const isPlaying = hp.id === activeHsbPlaylistId && hsbPlaybackState === 'playing';

                return (
                  <div
                    key={hp.id}
                    className={`playlist-card ${isExpanded ? 'active' : ''} ${isPlaying ? 'playing' : ''}`}
                  >
                    <div
                      className="playlist-card-header"
                      onClick={() => setExpandedKey(isExpanded ? null : `hsb:${hp.id}`)}
                    >
                      <div className="playlist-card-info">
                        <span className="playlist-card-name">
                          <span style={{ marginRight: 6, opacity: 0.7 }}>〜</span>
                          {hp.name}
                        </span>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 4 }}>
                          <span className="playlist-card-meta text-dim" style={{ fontSize: 11 }}>
                            HSB Generator · ±{Math.round(hp.hueWidth / 2)}°
                          </span>
                          {/* Hue arc gradient strip */}
                          <div style={{
                            width: 48, height: 8, borderRadius: 4, flexShrink: 0,
                            background: `linear-gradient(to right,
                              hsl(${hp.hueCenter - hp.hueWidth / 2}, 80%, 55%),
                              hsl(${hp.hueCenter}, 80%, 55%),
                              hsl(${hp.hueCenter + hp.hueWidth / 2}, 80%, 55%))`,
                          }} />
                        </div>
                      </div>
                      <div className="playlist-card-controls">
                        {isPlaying ? (
                          <button
                            className="playlist-btn"
                            title="Stop"
                            onClick={(e) => { e.stopPropagation(); setHsbPlaybackState('stopped'); }}
                          >⏹</button>
                        ) : (
                          <button
                            className="playlist-btn playlist-btn-play"
                            title="Play"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (runner.playbackState !== 'stopped') runner.stop();
                              if (palettePlaybackState !== 'stopped') setPalettePlaybackState('stopped');
                              selectHsbPlaylist(hp.id);
                              usePlaylistStore.getState().setHsbPlaybackState('playing');
                            }}
                          >▶</button>
                        )}
                        <button
                          className="playlist-btn playlist-btn-delete"
                          title="Delete"
                          onClick={(e) => { e.stopPropagation(); setDeleteTarget({ kind: 'hsb', id: hp.id }); }}
                        >✕</button>
                      </div>
                    </div>
                  </div>
                );
              })}

            </div>
          </div>
        )}
      </div>

      {/* Right pane: settings panel — scene playlist OR palette/hsb generator */}
      {(expandedPlaylist || expandedPalettePlaylist || expandedHsbPlaylist) && (
        <div className="playlist-control-pane">
          <div className="playlist-panel-header">
            <h2 className="playlist-panel-title">
              {expandedHsbPlaylist
                ? <><span style={{ marginRight: 6, opacity: 0.7 }}>〜</span>{expandedHsbPlaylist.name}</>
                : expandedPalettePlaylist
                ? <><span style={{ marginRight: 6, opacity: 0.7 }}>✦</span>{expandedPalettePlaylist.name}</>
                : expandedPlaylist!.name
              }
            </h2>
            <button className="playlist-panel-close" title="Close" onClick={() => setExpandedKey(null)}>✕</button>
          </div>

          {/* Route to the right panel body */}
          {expandedHsbPlaylist ? (
            <div className="playlist-panel-body" style={{ padding: 0 }}>
              <HsbPlaylistPanel playlist={expandedHsbPlaylist} />
            </div>
          ) : expandedPalettePlaylist ? (
            <div className="playlist-panel-body" style={{ padding: 0 }}>
              <PalettePlaylistPanel playlist={expandedPalettePlaylist} />
            </div>
          ) : (
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
                  disabled={expandedPlaylist!.cues.length === 0}
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
                  Cue {runner.currentCueIndex + 1} / {expandedPlaylist!.cues.length}
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
            {expandedPlaylist!.syncMode === 'auto' && (
              <div className="playlist-settings-section">

                {/* BPM sync toggle */}
                <div className="pp-sync-row" style={{ marginBottom: 10 }}>
                  <label className="playlist-setting-label">Sync to Global Tempo</label>
                  <button
                    className={`pp-sync-btn ${expandedPlaylist!.bpmSync ? 'active' : ''}`}
                    onClick={() => handleSettingChange('bpmSync', !expandedPlaylist!.bpmSync)}
                    role="switch"
                    aria-checked={!!expandedPlaylist!.bpmSync}
                    title={`Global BPM: ${bpm.toFixed(1)}`}
                  >
                    <span className="pp-sync-thumb" />
                  </button>
                </div>

                {expandedPlaylist!.bpmSync ? (
                  <div className="playlist-settings-row">
                    <label className="playlist-setting-label">Divider</label>
                    <select
                      className="pp-divider-select"
                      value={expandedPlaylist!.bpmDivider ?? 1}
                      onChange={(e) => handleSettingChange('bpmDivider', parseFloat(e.target.value))}
                    >
                      {([{value:4,label:'4 bars'},{value:2,label:'2 bars'},{value:1,label:'1/1'},{value:0.5,label:'1/2'},{value:0.25,label:'1/4'},{value:0.125,label:'1/8'},{value:0.0625,label:'1/16'}]).map((d) => (
                        <option key={d.value} value={d.value}>{d.label}</option>
                      ))}
                    </select>
                    <span className="playlist-slider-value mono">
                      = {((60_000 / bpm) * (expandedPlaylist!.bpmDivider ?? 1) / 1000).toFixed(2)}s @ {bpm.toFixed(0)}
                    </span>
                  </div>
                ) : (
                  <SliderSetting
                    label="Hold Duration"
                    value={expandedPlaylist!.holdDurationMs}
                    min={500}
                    max={30000}
                    step={500}
                    displayValue={`${(expandedPlaylist!.holdDurationMs / 1000).toFixed(1)}s`}
                    onChange={(v) => handleSettingChange('holdDurationMs', v)}
                  />
                )}

                {!expandedPlaylist!.bpmSync && expandedPlaylist!.fadeDurationMs > expandedPlaylist!.holdDurationMs && (
                  <div className="playlist-warning">
                    ⚠ Crossfade ({(expandedPlaylist!.fadeDurationMs / 1000).toFixed(1)}s) is longer than hold duration ({(expandedPlaylist!.holdDurationMs / 1000).toFixed(1)}s). The next scene will start fading before the current one finishes holding.
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
          )}
        </div>
      )}

      {/* ── Modals ──────────────────────────────────────────────────────────── */}

      {/* New Playlist Modal */}
      {showNewModal && (
        <div className="scene-name-overlay" onClick={() => setShowNewModal(false)}>
          <div className="scene-name-modal" onClick={(e) => e.stopPropagation()} style={{ maxWidth: 480 }}>
            <h3 className="scene-name-title">New Playlist</h3>

            {/* Type picker */}
            <label className="playlist-form-label">Generator Type</label>
            <div className="playlist-mode-tabs modal-tabs">
              <button
                className={`playlist-mode-tab ${newPlaylistKind === 'scene' ? 'active' : ''}`}
                onClick={() => setNewPlaylistKind('scene')}
              >
                ▶ Scene Playlist
              </button>
              <button
                className={`playlist-mode-tab ${newPlaylistKind === 'palette' ? 'active' : ''}`}
                onClick={() => setNewPlaylistKind('palette')}
              >
                ✦ Palette Generator
              </button>
              <button
                className={`playlist-mode-tab ${newPlaylistKind === 'hsb' ? 'active' : ''}`}
                onClick={() => setNewPlaylistKind('hsb')}
              >
                〜 HSB Generator
              </button>
            </div>

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

            {/* Scene-specific: sync mode */}
            {newPlaylistKind === 'scene' && (
              <>
                <label className="playlist-form-label" style={{ marginTop: 14 }}>Sync Mode</label>
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
              </>
            )}

            {/* Palette-specific: palette picker */}
            {newPlaylistKind === 'palette' && (
              <>
                <label className="playlist-form-label" style={{ marginTop: 14 }}>Palette</label>
                {palettes.length === 0 ? (
                  <p className="text-dim" style={{ fontSize: 12 }}>
                    No palettes yet — create one on the Colours page first.
                  </p>
                ) : (
                  <div className="playlist-mode-tabs modal-tabs" style={{ flexWrap: 'wrap' }}>
                    {palettes.map((p) => (
                      <button
                        key={p.id}
                        className={`playlist-mode-tab ${newPaletteId === p.id ? 'active' : ''}`}
                        onClick={() => setNewPaletteId(p.id)}
                      >
                        {p.name}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}

            <div className="scene-name-actions" style={{ marginTop: 20 }}>
              <button className="confirm-btn confirm-btn-cancel" onClick={() => setShowNewModal(false)}>Cancel</button>
              <button
                className="confirm-btn confirm-btn-warning"
                id="btn-create-playlist"
                onClick={handleCreatePlaylist}
                disabled={!newName.trim() || (newPlaylistKind === 'palette' && palettes.length === 0)}
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
          title={deleteTarget.kind === 'palette' ? 'Delete Palette Generator' : 'Delete Playlist'}
          message={
            deleteTarget.kind === 'palette'
              ? 'This palette generator will be permanently removed.'
              : 'This playlist and all its cues will be permanently removed.'
          }
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
/* ── Hold countdown progress bar ─────────────────────────────────────────── */

interface CueHoldBarProps {
  holdDurationMs: number;
  holdStartedAt: number | null;
}

function CueHoldBar({ holdDurationMs, holdStartedAt }: CueHoldBarProps) {
  // Compute how far through the hold we already are.
  // This handles the case where the user navigates away and back mid-hold.
  const elapsed = holdStartedAt ? Math.max(0, Date.now() - holdStartedAt) : 0;
  const remaining = Math.max(0, holdDurationMs - elapsed);

  // CSS animation: scaleX 1 → 0 over `remaining` ms.
  // The bar is positioned at the bottom of the cue row via CSS.
  return (
    <div
      className="playlist-cue-hold-bar"
      style={{
        animationDuration: `${remaining}ms`,
        // Start at the correct width fraction immediately (no delay trick needed
        // because we set the duration to the remaining time, not the full hold).
        transform: `scaleX(${remaining / holdDurationMs})`,
        animationName: 'cue-hold-drain',
        animationTimingFunction: 'linear',
        animationFillMode: 'forwards',
        animationPlayState: 'running',
      }}
    />
  );
}
