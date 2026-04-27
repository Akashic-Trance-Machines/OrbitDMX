import React, { useState, useEffect, useMemo } from 'react';
import { RIGS } from '../../rigs';
import { useRoomStore } from '../store/useRoomStore';
import type { Rig, RigPersonality } from '../../shared/types';
import './AddFixtureModal.css';

interface AddFixtureModalProps {
  onClose: () => void;
}

export default function AddFixtureModal({ onClose }: AddFixtureModalProps) {
  const [selectedRigId, setSelectedRigId] = useState<string>(RIGS[0].id);
  const [selectedPersonalityName, setSelectedPersonalityName] = useState<string>('');
  const [label, setLabel] = useState<string>('');
  const [startAddress, setStartAddress] = useState<number>(1);

  const { fixtures, getConflicts, addFixture } = useRoomStore();

  // When rig changes, reset personality to the default one
  const selectedRig: Rig = RIGS.find((r) => r.id === selectedRigId) ?? RIGS[0];
  useEffect(() => {
    const defaultName =
      selectedRig.defaultPersonality ?? selectedRig.personalities[0].name;
    setSelectedPersonalityName(defaultName);
    setLabel(`${selectedRig.model} ${fixtures.length + 1}`);
  }, [selectedRigId]);

  const selectedPersonality: RigPersonality | undefined = selectedRig.personalities.find(
    (p) => p.name === selectedPersonalityName,
  );

  const channelCount = selectedPersonality?.channelCount ?? 0;
  const endAddress = startAddress + channelCount - 1;
  const addressValid = startAddress >= 1 && endAddress <= 512;
  const conflicts = useMemo(
    () => (addressValid ? getConflicts(startAddress, channelCount) : []),
    [startAddress, channelCount, fixtures],
  );
  const hasConflict = conflicts.length > 0;
  const canAdd = label.trim().length > 0 && selectedPersonality != null && addressValid && !hasConflict;

  const handleAdd = () => {
    if (!canAdd || !selectedPersonality) return;
    addFixture({
      id: crypto.randomUUID(),
      rigId: selectedRigId,
      personalityName: selectedPersonalityName,
      channelCount,
      label: label.trim(),
      startAddress,
      universe: 0,
    });
    onClose();
  };

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) onClose();
  };

  return (
    <div className="modal-backdrop" onClick={handleBackdropClick}>
      <div className="modal-card" role="dialog" aria-modal="true" aria-label="Add Fixture">
        <div className="modal-header">
          <h2>Add Fixture</h2>
          <button className="modal-close" onClick={onClose} id="btn-modal-close">×</button>
        </div>

        <div className="modal-body">
          {/* Label */}
          <div className="form-group">
            <label className="form-label" htmlFor="fixture-label">Label</label>
            <input
              id="fixture-label"
              type="text"
              className="form-input"
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              placeholder="e.g. Stage Left"
              autoFocus
            />
          </div>

          {/* Rig type */}
          <div className="form-group">
            <label className="form-label" htmlFor="fixture-rig">Fixture Type</label>
            <select
              id="fixture-rig"
              className="form-select"
              value={selectedRigId}
              onChange={(e) => setSelectedRigId(e.target.value)}
            >
              {RIGS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.brand} {r.model}
                </option>
              ))}
            </select>
          </div>

          {/* DMX mode / personality */}
          <div className="form-group">
            <label className="form-label" htmlFor="fixture-mode">DMX Mode</label>
            <select
              id="fixture-mode"
              className="form-select"
              value={selectedPersonalityName}
              onChange={(e) => setSelectedPersonalityName(e.target.value)}
            >
              {selectedRig.personalities.map((p) => (
                <option key={p.name} value={p.name}>
                  {p.name}
                  {p.name === selectedRig.defaultPersonality ? ' ★' : ''}
                </option>
              ))}
            </select>
            {selectedPersonality && (
              <p className="form-hint">
                Uses <span className="mono">{channelCount}</span> channels ·
                CH {startAddress}–{endAddress}
              </p>
            )}
          </div>

          {/* Start address */}
          <div className="form-group">
            <label className="form-label" htmlFor="fixture-address">Start Address</label>
            <input
              id="fixture-address"
              type="number"
              className={`form-input ${hasConflict || !addressValid ? 'input-error' : ''}`}
              value={startAddress}
              min={1}
              max={512}
              onChange={(e) => setStartAddress(Number(e.target.value))}
            />
            {!addressValid && (
              <p className="form-error">
                Address range CH {startAddress}–{endAddress} exceeds universe (512 channels).
              </p>
            )}
            {hasConflict && addressValid && (
              <p className="form-error">
                ⚠ Overlaps with: {conflicts.map((f) => f.label).join(', ')}
                {' '}(CH {conflicts[0].startAddress}–{conflicts[0].startAddress + conflicts[0].channelCount - 1})
              </p>
            )}
          </div>
        </div>

        <div className="modal-footer">
          <button className="btn-secondary" id="btn-modal-cancel" onClick={onClose}>
            Cancel
          </button>
          <button
            className="btn-primary"
            id="btn-modal-add"
            onClick={handleAdd}
            disabled={!canAdd}
          >
            Add Fixture
          </button>
        </div>
      </div>
    </div>
  );
}
