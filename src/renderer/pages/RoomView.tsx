import React, { useState, useEffect, useCallback } from 'react';
import { useRoomStore } from '../store/useRoomStore';
import { useSceneStore } from '../store/useSceneStore';
import { getRigById } from '../../rigs';
import FixtureCard from '../components/FixtureCard';
import FixtureControlPanel from '../components/FixtureControlPanel';
import AddFixtureModal from '../components/AddFixtureModal';
import EditFixtureModal from '../components/EditFixtureModal';
import FloorPlanView from './FloorPlanView';
import type { FixtureInstance } from '../../shared/types';
import './RoomView.css';

/**
 * Collect all dimmer-type DMX addresses (1-indexed) from the fixture list.
 * Used to tell the engine which channels should be scaled by the room dimmer.
 */
function collectDimmerAddresses(fixtures: FixtureInstance[]): number[] {
  const addresses: number[] = [];
  for (const f of fixtures) {
    const rig = getRigById(f.rigId);
    const personality = rig?.personalities.find((p) => p.name === f.personalityName);
    if (!personality) continue;
    for (const ch of personality.channels) {
      if (ch.type === 'dimmer') {
        addresses.push(f.startAddress + ch.offset);
      }
    }
  }
  return addresses;
}

export type RoomViewMode = 'list' | 'floorplan';

export default function RoomView() {
  const fixtures = useRoomStore((s) => s.fixtures);
  const roomDimmer = useRoomStore((s) => s.roomDimmer);
  const setRoomDimmer = useRoomStore((s) => s.setRoomDimmer);
  const [showAddModal, setShowAddModal] = useState(false);
  const [editingFixtureId, setEditingFixtureId] = useState<string | null>(null);
  const [testingId, setTestingId] = useState<string | null>(null);
  const [selectedFixtureId, setSelectedFixtureId] = useState<string | null>(null);
  const [universe, setUniverse] = useState<number[]>(() => new Array(512).fill(0));
  const [viewMode, setViewMode] = useState<RoomViewMode>('list');

  const selectedFixture = fixtures.find((f) => f.id === selectedFixtureId) ?? null;

  // ── Sync dimmer addresses to engine whenever fixtures change ──────────────
  useEffect(() => {
    if (typeof window.dmx === 'undefined') return;
    const addresses = collectDimmerAddresses(fixtures);
    window.dmx.setDimmerAddresses(addresses);
  }, [fixtures]);

  // ── Subscribe to live universe updates for LED dots ────────────────────────
  useEffect(() => {
    if (typeof window.dmx === 'undefined') return;
    const cleanup = window.dmx.onUniverseUpdate((snapshot) => {
      setUniverse(snapshot);
    });
    return cleanup;
  }, []);

  // ── Room dimmer → engine ──────────────────────────────────────────────────
  const handleRoomDimmerChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    setRoomDimmer(parseInt(e.target.value));
  }, [setRoomDimmer]);

  // ── Blackout ──────────────────────────────────────────────────────────────
  const handleBlackout = useCallback(() => {
    setRoomDimmer(0);
    if (typeof window.dmx !== 'undefined') {
      window.dmx.setRoomDimmer(0);
    }
  }, []);

  const handleTest = async (fixture: FixtureInstance) => {
    const rig = getRigById(fixture.rigId);
    if (!rig) return;

    const personality = rig.personalities.find((p) => p.name === fixture.personalityName);
    if (!personality) return;

    setTestingId(fixture.id);
    try {
      if (typeof window.dmx !== 'undefined') {
        await window.dmx.testFlash(fixture.startAddress, personality.channels);
      } else {
        // Dev preview: just simulate the delay
        await new Promise((r) => setTimeout(r, 1650));
      }
    } finally {
      setTestingId(null);
    }
  };

  const handleSelectFixture = (fixture: FixtureInstance) => {
    setSelectedFixtureId((prev) => (prev === fixture.id ? null : fixture.id));
  };

  const dimmerPct = (roomDimmer / 255) * 100;

  return (
    <div className={`room-view ${selectedFixture ? 'has-panel' : ''}`}>
      {/* Left: fixture list */}
      <div className="room-list-pane">
        {/* Header */}
        <div className="room-header">
          <div className="room-header-left">
            <h1>Room</h1>
            <span className="room-fixture-count">
              {fixtures.length} {fixtures.length === 1 ? 'fixture' : 'fixtures'}
            </span>
          </div>
          <div className="room-header-right">
            {/* View toggle */}
            <div className="room-view-toggle">
              <button
                className={`room-view-toggle-btn ${viewMode === 'list' ? 'active' : ''}`}
                id="btn-view-list"
                onClick={() => setViewMode('list')}
              >
                ☰ List
              </button>
              <button
                className={`room-view-toggle-btn ${viewMode === 'floorplan' ? 'active' : ''}`}
                id="btn-view-floorplan"
                onClick={() => setViewMode('floorplan')}
              >
                ▦ Floor Plan
              </button>
            </div>
            <button
              className="btn-primary"
              id="btn-add-fixture"
              onClick={() => setShowAddModal(true)}
            >
              + Add Fixture
            </button>
          </div>
        </div>

        {/* Room dimmer bar */}
        {fixtures.length > 0 && (
          <div className="room-dimmer-bar">
            <div className="room-dimmer-left">
              <span className="room-dimmer-icon">☀</span>
              <label className="room-dimmer-label" htmlFor="input-room-dimmer">
                Room Dimmer
              </label>
            </div>
            <input
              type="range"
              id="input-room-dimmer"
              className="room-dimmer-slider"
              min={0}
              max={255}
              value={roomDimmer}
              onChange={handleRoomDimmerChange}
              style={{
                background: `linear-gradient(to right, var(--color-accent) ${dimmerPct}%, var(--color-surface-3) ${dimmerPct}%)`,
              }}
            />
            <span className="room-dimmer-value mono">
              {Math.round(dimmerPct)}%
            </span>
            <button
              className="room-blackout-btn"
              id="btn-room-blackout"
              onClick={handleBlackout}
              title="Blackout — all lights off"
            >
              Blackout
            </button>
          </div>
        )}

        {/* Content */}
        {/* View content — List or Floor Plan */}
        {viewMode === 'list' ? (
          <>
            {fixtures.length === 0 ? (
              <div className="room-empty-state">
                <div className="room-empty-icon">💡</div>
                <h3>No fixtures in room</h3>
                <p>Add your DMX fixtures to get started.<br />Each fixture gets a DMX start address and mode.</p>
                <button
                  className="btn-primary"
                  id="btn-add-fixture-empty"
                  onClick={() => setShowAddModal(true)}
                >
                  + Add Fixture
                </button>
              </div>
            ) : (
              <div className="room-fixture-list">
                {/* Universe strip */}
                <div className="universe-strip">
                  <span className="universe-strip-label">DMX Universe 1 — 512 ch</span>
                  <div className="universe-strip-bar" title="Channel usage">
                    {/* Gap segments (unused address ranges) */}
                    {(() => {
                      const gaps: { start: number; end: number }[] = [];
                      const sorted = [...fixtures].sort((a, b) => a.startAddress - b.startAddress);
                      let cursor = 1;
                      for (const f of sorted) {
                        if (f.startAddress > cursor) {
                          gaps.push({ start: cursor, end: f.startAddress - 1 });
                        }
                        cursor = Math.max(cursor, f.startAddress + f.channelCount);
                      }
                      if (cursor <= 512 && sorted.length > 0) {
                        gaps.push({ start: cursor, end: 512 });
                      }
                      return gaps.map((g) => {
                        const left = ((g.start - 1) / 512) * 100;
                        const width = ((g.end - g.start + 1) / 512) * 100;
                        return (
                          <div
                            key={`gap-${g.start}`}
                            className="universe-strip-gap"
                            style={{ left: `${left}%`, width: `${width}%` }}
                            title={`Gap: CH ${g.start}–${g.end}`}
                          />
                        );
                      });
                    })()}

                    {/* Fixture segments */}
                    {fixtures.map((f) => {
                      // Check if this fixture overlaps with any other
                      const hasOverlap = fixtures.some((other) => {
                        if (other.id === f.id) return false;
                        const fEnd = f.startAddress + f.channelCount - 1;
                        const oEnd = other.startAddress + other.channelCount - 1;
                        return !(fEnd < other.startAddress || f.startAddress > oEnd);
                      });

                      const left = ((f.startAddress - 1) / 512) * 100;
                      const width = (f.channelCount / 512) * 100;
                      return (
                        <div
                          key={f.id}
                          className={`universe-strip-segment ${f.id === selectedFixtureId ? 'active' : ''} ${hasOverlap ? 'overlap' : ''}`}
                          style={{ left: `${left}%`, width: `${width}%` }}
                          title={`${f.label}: CH ${f.startAddress}–${f.startAddress + f.channelCount - 1}${hasOverlap ? ' ⚠ OVERLAP' : ''}`}
                        />
                      );
                    })}
                  </div>
                </div>

                {/* Fixture cards */}
                <div className="fixture-cards">
                  {fixtures.map((f) => (
                    <FixtureCard
                      key={f.id}
                      fixture={f}
                      onTest={handleTest}
                      isTesting={testingId === f.id}
                      isSelected={selectedFixtureId === f.id}
                      onSelect={handleSelectFixture}
                      universe={universe}
                    />
                  ))}
                </div>
              </div>
            )}
          </>
        ) : (
          <FloorPlanView
            selectedFixtureId={selectedFixtureId}
            onSelectFixture={handleSelectFixture}
            universe={universe}
          />
        )}
      </div>

      {/* Right: fixture control panel */}
      {selectedFixture && (
        <div className="room-control-pane">
          <FixtureControlPanel
            key={selectedFixture.id}
            fixture={selectedFixture}
            onClose={() => setSelectedFixtureId(null)}
            onEditSetup={() => setEditingFixtureId(selectedFixture.id)}
          />
        </div>
      )}

      {/* Add Fixture modal */}
      {showAddModal && (
        <AddFixtureModal onClose={() => setShowAddModal(false)} />
      )}

      {/* Edit Fixture modal */}
      {editingFixtureId && (
        <EditFixtureModal 
          fixture={fixtures.find(f => f.id === editingFixtureId)!} 
          onClose={() => setEditingFixtureId(null)} 
        />
      )}
    </div>
  );
}
