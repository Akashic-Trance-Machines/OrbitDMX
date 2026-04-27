import React from 'react';
import { useSceneStore } from '../store/useSceneStore';
import { useRoomStore } from '../store/useRoomStore';
import { getFixtureLedColors } from '../utils/ledColors';
import type { Scene, FixtureInstance } from '../../shared/types';
import './AddSceneToPlaylistModal.css';

interface AddSceneToPlaylistModalProps {
  onSelect: (scene: Scene) => void;
  onClose: () => void;
}

export default function AddSceneToPlaylistModal({ onSelect, onClose }: AddSceneToPlaylistModalProps) {
  const scenes = useSceneStore((s) => s.scenes);
  const fixtures = useRoomStore((s) => s.fixtures);

  return (
    <div className="scene-picker-overlay" onClick={onClose}>
      <div className="scene-picker-modal" onClick={(e) => e.stopPropagation()}>
        <h3 className="scene-picker-title">Add Scene to Playlist</h3>
        <p className="scene-picker-desc text-dim">Select a scene to add as a cue.</p>

        {scenes.length === 0 ? (
          <div className="scene-picker-empty">
            <p className="text-dim">No scenes saved yet. Create scenes on the Scenes page first.</p>
          </div>
        ) : (
          <div className="scene-picker-list">
            {scenes.map((scene) => (
              <button
                key={scene.id}
                className="scene-picker-item"
                onClick={() => onSelect(scene)}
              >
                <span className="scene-picker-name">{scene.name}</span>
                <div className="scene-picker-dots">
                  {fixtures.map((f) => {
                    const leds = getFixtureLedColors(f, scene.values);
                    return (
                      <div key={f.id} className="scene-picker-fixture-group">
                        {leds.map((led) => (
                          <span
                            key={`${led.fixtureId}-${led.ledIndex}`}
                            className="scene-picker-dot"
                            style={{ background: led.color }}
                          />
                        ))}
                      </div>
                    );
                  })}
                </div>
              </button>
            ))}
          </div>
        )}

        <div className="scene-picker-actions">
          <button className="confirm-btn confirm-btn-cancel" onClick={onClose}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
