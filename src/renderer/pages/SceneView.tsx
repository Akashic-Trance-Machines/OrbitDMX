import React, { useState, useCallback } from 'react';
import { useSceneStore } from '../store/useSceneStore';
import { useRoomStore } from '../store/useRoomStore';
import SceneCard from '../components/SceneCard';
import type { Scene } from '../../shared/types';
import './SceneView.css';

export default function SceneView() {
  const scenes = useSceneStore((s) => s.scenes);
  const activeSceneId = useSceneStore((s) => s.activeSceneId);
  const fadeDurationMs = useSceneStore((s) => s.fadeDurationMs);
  const addScene = useSceneStore((s) => s.addScene);
  const updateScene = useSceneStore((s) => s.updateScene);
  const deleteScene = useSceneStore((s) => s.deleteScene);
  const setActiveScene = useSceneStore((s) => s.setActiveScene);
  const setFadeDuration = useSceneStore((s) => s.setFadeDuration);

  const fixtures = useRoomStore((s) => s.fixtures);

  const [showNamePrompt, setShowNamePrompt] = useState(false);
  const [newName, setNewName] = useState('');

  // ── New Scene flow ─────────────────────────────────────────────────

  const handleNewScene = () => {
    setNewName('');
    setShowNamePrompt(true);
  };

  const handleCreateScene = useCallback(async () => {
    const name = newName.trim();
    if (!name) return;

    // Grab the current universe state
    let values: number[] = new Array(512).fill(0);
    if (typeof window.dmx !== 'undefined') {
      const res = await window.dmx.getUniverse();
      if (res.success && res.data) {
        values = res.data;
      }
    }

    const scene: Scene = {
      id: crypto.randomUUID(),
      roomId: 'default',
      name,
      values,
    };

    addScene(scene);
    setShowNamePrompt(false);
  }, [newName, addScene]);

  const handleNameKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleCreateScene();
    if (e.key === 'Escape') setShowNamePrompt(false);
  };

  // ── Scene actions ──────────────────────────────────────────────────

  const handleRecall = useCallback(async (scene: Scene) => {
    setActiveScene(scene.id);
    if (typeof window.dmx !== 'undefined') {
      await window.dmx.playScene(scene, fadeDurationMs);
    }
  }, [fadeDurationMs, setActiveScene]);

  const handleSave = useCallback(async (sceneId: string) => {
    let values: number[] = new Array(512).fill(0);
    if (typeof window.dmx !== 'undefined') {
      const res = await window.dmx.getUniverse();
      if (res.success && res.data) {
        values = res.data;
      }
    }
    updateScene(sceneId, values);
  }, [updateScene]);

  const handleDelete = useCallback((sceneId: string) => {
    deleteScene(sceneId);
  }, [deleteScene]);

  // ── Fade slider ────────────────────────────────────────────────────

  const fadeSec = fadeDurationMs / 1000;

  const handleFadeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFadeDuration(parseFloat(e.target.value) * 1000);
  };

  const fadePct = (fadeDurationMs / 10000) * 100;

  // ── Render ─────────────────────────────────────────────────────────

  return (
    <div className="scene-view">
      {/* Header */}
      <div className="scene-view-header">
        <h1>Scenes</h1>
        <button
          className="btn-primary"
          id="btn-add-scene"
          onClick={handleNewScene}
        >
          + New Scene
        </button>
      </div>

      {/* Fade slider */}
      <div className="scene-fade-bar">
        <label className="scene-fade-label" htmlFor="input-fade-slider">
          <span className="scene-fade-icon">⟿</span>
          Crossfade
        </label>
        <input
          type="range"
          id="input-fade-slider"
          className="scene-fade-slider"
          min={0}
          max={10}
          step={0.1}
          value={fadeSec}
          onChange={handleFadeChange}
          style={{
            background: `linear-gradient(to right, var(--color-accent) ${fadePct}%, var(--color-surface-3) ${fadePct}%)`,
          }}
        />
        <span className="scene-fade-value mono">
          {fadeSec.toFixed(1)}s
        </span>
      </div>

      {/* Scene list or empty state */}
      {scenes.length === 0 && !showNamePrompt ? (
        <div className="scene-view-empty">
          <div className="scene-view-empty-icon">◈</div>
          <h2>No scenes yet</h2>
          <p className="text-dim">Create a scene to capture your current light setup.</p>
        </div>
      ) : (
        <div className="scene-list">
          {scenes.map((scene) => (
            <SceneCard
              key={scene.id}
              scene={scene}
              fixtures={fixtures}
              isActive={activeSceneId === scene.id}
              onRecall={handleRecall}
              onSave={handleSave}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      {/* New Scene name prompt (inline modal) */}
      {showNamePrompt && (
        <div className="scene-name-overlay" onClick={() => setShowNamePrompt(false)}>
          <div className="scene-name-modal" onClick={(e) => e.stopPropagation()}>
            <h3 className="scene-name-title">New Scene</h3>
            <p className="scene-name-desc text-dim">
              Capture the current room state as a new scene.
            </p>
            <input
              type="text"
              className="scene-name-input"
              id="input-scene-name"
              placeholder="Scene name…"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={handleNameKeyDown}
              autoFocus
              maxLength={40}
            />
            <div className="scene-name-actions">
              <button
                className="confirm-btn confirm-btn-cancel"
                onClick={() => setShowNamePrompt(false)}
              >
                Cancel
              </button>
              <button
                className="confirm-btn confirm-btn-warning"
                id="btn-create-scene"
                onClick={handleCreateScene}
                disabled={!newName.trim()}
              >
                Create
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
