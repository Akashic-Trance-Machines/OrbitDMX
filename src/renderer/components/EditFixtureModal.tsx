import React, { useState, useMemo } from 'react';
import { getFixtureProfileById } from '../../fixtures';
import { useRoomStore } from '../store/useRoomStore';
import type { FixtureInstance, FixturePersonality } from '../../shared/types';
import './EditFixtureModal.css';

interface EditFixtureModalProps {
  fixture: FixtureInstance;
  onClose: () => void;
}

export default function EditFixtureModal({ fixture, onClose }: EditFixtureModalProps) {
  const [label, setLabel] = useState<string>(fixture.label);
  const [personalityName, setPersonalityName] = useState<string>(fixture.personalityName);
  const [startAddress, setStartAddress] = useState<number>(fixture.startAddress);

  const { getConflicts, updateFixture } = useRoomStore();
  const profile = getFixtureProfileById(fixture.profileId);

  const selectedPersonality: FixturePersonality | undefined = profile?.personalities.find(
    (p) => p.name === personalityName,
  );

  const channelCount = selectedPersonality?.channelCount ?? fixture.channelCount;
  const endAddress = startAddress + channelCount - 1;
  const addressValid = startAddress >= 1 && endAddress <= 512;
  
  // Check for conflicts, excluding the current fixture being edited
  const conflicts = useMemo(
    () => (addressValid ? getConflicts(startAddress, channelCount, fixture.id) : []),
    [startAddress, channelCount, fixture.id, getConflicts],
  );
  
  const hasConflict = conflicts.length > 0;
  // We allow saving even if there's a conflict, just show a warning (per earlier feature 2 requirement, but user says "to fix overlap we change mode... start address should be adjustable...". Allow save with warning is fine, or maybe block save if there's an overlap? User didn't say to block, just that it should be adjustable to fix the overlap).
  const canSave = label.trim().length > 0 && selectedPersonality != null && addressValid;

  const handleSave = () => {
    if (!canSave || !selectedPersonality) return;
    updateFixture(fixture.id, {
      label: label.trim(),
      personalityName: personalityName,
      channelCount: channelCount,
      startAddress: startAddress,
    });
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  if (!profile) return null;

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal-card">
        <div className="modal-header">
          <h2>Edit Setup: {profile.model}</h2>
          <button className="modal-close" onClick={onClose}>×</button>
        </div>

        <div className="modal-body">
          <div className="form-group">
            <label className="form-label">Name</label>
            <input
              type="text"
              className="form-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Stage Left Par"
            />
          </div>

          <div className="form-group">
            <label className="form-label">DMX Mode</label>
            <select
              className="form-select"
              value={personalityName}
              onChange={(e) => setPersonalityName(e.target.value)}
            >
              {profile.personalities.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name} ({p.channelCount} channels)
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label className="form-label">Start Address</label>
            <input
              type="number"
              className={`form-input ${hasConflict ? 'input-error' : ''}`}
              min="1"
              max="512"
              value={startAddress}
              onChange={(e) => setStartAddress(parseInt(e.target.value, 10) || 1)}
            />
            <span className="form-hint">
              Uses CH {startAddress} — {endAddress}
            </span>
          </div>

          {hasConflict && (
            <div className="form-error">
              ⚠ Overlaps with: {conflicts.map((f) => `${f.label} (CH ${f.startAddress}–${f.startAddress + f.channelCount - 1})`).join(', ')}
            </div>
          )}
          {!addressValid && (
            <div className="form-error">
              Address range exceeds Universe boundary (512)
            </div>
          )}
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" onClick={onClose}>Cancel</button>
          <button
            className="btn-primary"
            onClick={handleSave}
            disabled={!canSave}
          >
            Save Changes
          </button>
        </div>
      </div>
    </div>
  );
}
