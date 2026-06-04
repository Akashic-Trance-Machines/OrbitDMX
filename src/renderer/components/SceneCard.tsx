import React, { useState } from 'react';
import type { Scene, FixtureInstance } from '../../shared/types';
import { getFixtureLedColors } from '../utils/ledColors';
import ConfirmDialog from './ConfirmDialog';
import './SceneCard.css';

interface SceneCardProps {
  scene: Scene;
  fixtures: FixtureInstance[];
  isActive: boolean;
  onRecall: (scene: Scene) => void;
  onSave: (sceneId: string) => void;
  onDelete: (sceneId: string) => void;
}

export default function SceneCard({ scene, fixtures, isActive, onRecall, onSave, onDelete }: SceneCardProps) {
  const [confirmAction, setConfirmAction] = useState<'save' | 'delete' | null>(null);

  const handleRecall = () => {
    onRecall(scene);
  };

  const handleSaveClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmAction('save');
  };

  const handleDeleteClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    setConfirmAction('delete');
  };

  const handleConfirm = () => {
    if (confirmAction === 'save') onSave(scene.id);
    if (confirmAction === 'delete') onDelete(scene.id);
    setConfirmAction(null);
  };

  return (
    <>
      <div
        role="button"
        tabIndex={0}
        className={`scene-card ${isActive ? 'scene-card-active' : ''}`}
        id={`scene-card-${scene.id}`}
        onClick={handleRecall}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleRecall(); } }}
      >
        <div className="scene-card-info">
          <span className="scene-card-name">{scene.name}</span>
          <div className="scene-card-dots">
            {fixtures.map((f) => {
              const leds = getFixtureLedColors(f, scene.values);
              return (
                <div key={f.id} className="scene-card-fixture-group" title={f.label}>
                  {leds.map((led) => (
                    <span
                      key={`${led.fixtureId}-${led.ledIndex}`}
                      className="scene-card-dot"
                      style={{ background: led.color }}
                    />
                  ))}
                </div>
              );
            })}
          </div>
        </div>
        <div className="scene-card-actions">
          <button
            className="scene-card-btn scene-card-btn-save"
            id={`btn-save-scene-${scene.id}`}
            onClick={handleSaveClick}
            title="Overwrite with current room settings"
          >
            Save
          </button>
          <button
            className="scene-card-btn scene-card-btn-delete"
            id={`btn-delete-scene-${scene.id}`}
            onClick={handleDeleteClick}
            title="Delete this scene"
          >
            Delete
          </button>
        </div>
      </div>

      {confirmAction === 'delete' && (
        <ConfirmDialog
          title="Delete Scene"
          message={`Are you sure you want to delete "${scene.name}"? This action cannot be undone.`}
          confirmLabel="Delete"
          variant="danger"
          onConfirm={handleConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}

      {confirmAction === 'save' && (
        <ConfirmDialog
          title="Overwrite Scene"
          message={`Overwrite "${scene.name}" with the current room settings? The previous snapshot will be lost.`}
          confirmLabel="Overwrite"
          variant="warning"
          onConfirm={handleConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </>
  );
}
