import React, { useState, useEffect, useMemo, useRef } from 'react';
import { FIXTURE_PROFILES } from '../../fixtures';
import { useRoomStore } from '../store/useRoomStore';
import type { FixtureProfile, FixturePersonality } from '../../shared/types';
import './AddFixtureModal.css';

interface AddFixtureModalProps {
  onClose: () => void;
}

export default function AddFixtureModal({ onClose }: AddFixtureModalProps) {
  // ── Brand / fixture selection state ──────────────────────────────────────
  const fixtureBrands = useMemo(() => {
    const set = new Set(FIXTURE_PROFILES.map((r) => r.brand));
    return [...set].sort((a, b) => a.localeCompare(b, undefined, { sensitivity: 'base' }));
  }, []);

  const [selectedBrand, setSelectedBrand] = useState<string>(fixtureBrands[0] ?? '');
  const [fixtureSearch, setFixtureSearch] = useState<string>('');
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(-1);
  const [selectedProfileId, setSelectedProfileId] = useState<string>('');
  const [selectedPersonalityName, setSelectedPersonalityName] = useState<string>('');
  const [label, setLabel] = useState<string>('');
  const [startAddress, setStartAddress] = useState<number>(1);

  const searchInputRef = useRef<HTMLInputElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const { fixtures, getConflicts, addFixture } = useRoomStore();

  // ── Derived data ────────────────────────────────────────────────────────
  const profilesForBrand = useMemo(
    () => FIXTURE_PROFILES.filter((r) => r.brand === selectedBrand).sort((a, b) => a.model.localeCompare(b.model)),
    [selectedBrand],
  );

  const filteredProfiles = useMemo(() => {
    const q = fixtureSearch.toLowerCase().trim();
    if (!q) return profilesForBrand;
    return profilesForBrand.filter((r) => r.model.toLowerCase().includes(q));
  }, [profilesForBrand, fixtureSearch]);

  const selectedProfile: FixtureProfile | undefined = FIXTURE_PROFILES.find((r) => r.id === selectedProfileId);

  const selectedPersonality: FixturePersonality | undefined = selectedProfile?.personalities.find(
    (p) => p.name === selectedPersonalityName,
  );

  const channelCount = selectedPersonality?.channelCount ?? 0;

  // ── First free address helper ───────────────────────────────────────────
  const firstFreeAddress = (count: number): number => {
    const occupied = new Set<number>();
    for (const f of fixtures) {
      for (let ch = f.startAddress; ch < f.startAddress + f.channelCount; ch++) {
        occupied.add(ch);
      }
    }
    for (let addr = 1; addr <= 512 - count + 1; addr++) {
      let free = true;
      for (let ch = addr; ch < addr + count; ch++) {
        if (occupied.has(ch)) { free = false; break; }
      }
      if (free) return addr;
    }
    return 1;
  };

  // ── When brand changes, reset fixture selection ─────────────────────────
  useEffect(() => {
    setFixtureSearch('');
    setSelectedProfileId('');
    setSelectedPersonalityName('');
    setHighlightIndex(-1);
  }, [selectedBrand]);

  // ── When profile changes, reset personality to default ──────────────────
  useEffect(() => {
    if (!selectedProfile) return;
    const defaultName = selectedProfile.defaultPersonality ?? selectedProfile.personalities[0]?.name ?? '';
    setSelectedPersonalityName(defaultName);
    setLabel(`${selectedProfile.model} ${fixtures.length + 1}`);
  }, [selectedProfileId]);

  // ── Auto-set start address to first free slot ───────────────────────────
  useEffect(() => {
    if (channelCount > 0) setStartAddress(firstFreeAddress(channelCount));
  }, [channelCount, fixtures.length]);

  // ── Close dropdown on outside click ─────────────────────────────────────
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setIsDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // ── Scroll highlighted item into view ───────────────────────────────────
  useEffect(() => {
    if (highlightIndex >= 0) {
      const el = dropdownRef.current?.querySelector(`[data-index="${highlightIndex}"]`);
      el?.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightIndex]);

  // ── Validation ──────────────────────────────────────────────────────────
  const endAddress = startAddress + channelCount - 1;
  const addressValid = startAddress >= 1 && endAddress <= 512;
  const conflicts = useMemo(
    () => (addressValid ? getConflicts(startAddress, channelCount) : []),
    [startAddress, channelCount, fixtures],
  );
  const hasConflict = conflicts.length > 0;
  const canAdd =
    label.trim().length > 0 &&
    selectedProfile != null &&
    selectedPersonality != null &&
    addressValid &&
    !hasConflict;

  // ── Handlers ────────────────────────────────────────────────────────────
  const handleSelectProfile = (profile: FixtureProfile) => {
    setSelectedProfileId(profile.id);
    setFixtureSearch(profile.model);
    setIsDropdownOpen(false);
    setHighlightIndex(-1);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent) => {
    if (!isDropdownOpen && e.key !== 'Escape') {
      setIsDropdownOpen(true);
    }

    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault();
        setHighlightIndex((prev) => Math.min(prev + 1, filteredProfiles.length - 1));
        break;
      case 'ArrowUp':
        e.preventDefault();
        setHighlightIndex((prev) => Math.max(prev - 1, 0));
        break;
      case 'Enter':
        e.preventDefault();
        if (highlightIndex >= 0 && highlightIndex < filteredProfiles.length) {
          handleSelectProfile(filteredProfiles[highlightIndex]);
        } else if (filteredProfiles.length === 1) {
          handleSelectProfile(filteredProfiles[0]);
        }
        break;
      case 'Escape':
        setIsDropdownOpen(false);
        setHighlightIndex(-1);
        break;
    }
  };

  const handleSearchFocus = () => {
    setIsDropdownOpen(true);
    if (selectedProfileId && fixtureSearch) {
      setFixtureSearch('');
      setSelectedProfileId('');
    }
  };

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    setFixtureSearch(e.target.value);
    setSelectedProfileId('');
    setHighlightIndex(0);
    if (!isDropdownOpen) setIsDropdownOpen(true);
  };

  const handleAdd = () => {
    if (!canAdd || !selectedPersonality || !selectedProfile) return;
    addFixture({
      id: crypto.randomUUID(),
      profileId: selectedProfileId,
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

          {/* Brand selector */}
          <div className="form-group">
            <label className="form-label" htmlFor="fixture-brand">Brand</label>
            <select
              id="fixture-brand"
              className="form-select"
              value={selectedBrand}
              onChange={(e) => setSelectedBrand(e.target.value)}
            >
              {fixtureBrands.map((b) => (
                <option key={b} value={b}>{b}</option>
              ))}
            </select>
            <p className="form-hint">
              {profilesForBrand.length} {profilesForBrand.length === 1 ? 'fixture' : 'fixtures'} available
            </p>
          </div>

          {/* Fixture search dropdown */}
          <div className="form-group" ref={dropdownRef}>
            <label className="form-label" htmlFor="fixture-search">Fixture</label>
            <div className="fixture-search-wrapper">
              <input
                ref={searchInputRef}
                id="fixture-search"
                type="text"
                className={`form-input fixture-search-input ${selectedProfile ? 'has-selection' : ''}`}
                value={fixtureSearch}
                onChange={handleSearchChange}
                onFocus={handleSearchFocus}
                onKeyDown={handleSearchKeyDown}
                placeholder="Search fixtures…"
                autoComplete="off"
                role="combobox"
                aria-expanded={isDropdownOpen}
                aria-autocomplete="list"
                aria-controls="fixture-listbox"
              />
              {selectedProfile && !isDropdownOpen && (
                <span className="fixture-search-check">✓</span>
              )}
              {isDropdownOpen && (
                <div className="fixture-dropdown" id="fixture-listbox" role="listbox">
                  {filteredProfiles.length > 0 ? (
                    filteredProfiles.map((r, i) => (
                      <div
                        key={r.id}
                        data-index={i}
                        className={`fixture-dropdown-item ${
                          r.id === selectedProfileId ? 'selected' : ''
                        } ${i === highlightIndex ? 'highlighted' : ''}`}
                        role="option"
                        aria-selected={r.id === selectedProfileId}
                        onClick={() => handleSelectProfile(r)}
                        onMouseEnter={() => setHighlightIndex(i)}
                      >
                        <span className="fixture-dropdown-model">{r.model}</span>
                        <span className="fixture-dropdown-meta">
                          {r.personalities.length} {r.personalities.length === 1 ? 'mode' : 'modes'}
                        </span>
                      </div>
                    ))
                  ) : (
                    <div className="fixture-dropdown-empty">
                      No fixtures match "{fixtureSearch}"
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* DMX mode / personality */}
          {selectedProfile && (
            <div className="form-group">
              <label className="form-label" htmlFor="fixture-mode">DMX Mode</label>
              <select
                id="fixture-mode"
                className="form-select"
                value={selectedPersonalityName}
                onChange={(e) => setSelectedPersonalityName(e.target.value)}
              >
                {selectedProfile.personalities.map((p) => (
                  <option key={p.name} value={p.name}>
                    {p.name}
                    {p.name === selectedProfile.defaultPersonality ? ' ★' : ''}
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
          )}

          {/* Start address */}
          {selectedProfile && (
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
          )}
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
