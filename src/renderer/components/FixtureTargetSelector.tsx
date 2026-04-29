import React, { useCallback, useMemo } from 'react';
import { useRoomStore } from '../store/useRoomStore';
import { getRigById } from '../../rigs';
import type { FixtureTarget } from '../../shared/types';
import './FixtureTargetSelector.css';

/**
 * Shared FixtureTargetSelector component.
 * Used by both Controls editor and FX sidebar to select which fixtures/LEDs to target.
 */

interface FixtureTargetSelectorProps {
  target: FixtureTarget;
  onChange: (target: FixtureTarget) => void;
  /**
   * Whether to show per-LED sub-selection within fixtures.
   * Set to false for global channel types (dimmer, strobe, etc.)
   * that exist once per fixture, not once per LED.
   * Defaults to true.
   */
  showLedFilter?: boolean;
}

/** Describes one LED group within a fixture (e.g. "LED 1" with R/G/B offsets). */
interface LedGroup {
  index: number;       // 0-based
  label: string;       // e.g. "LED 1", "Spot 2"
}

/** Resolve LED groups for a fixture. Returns empty if fixture has only 1 LED. */
function getFixtureLedGroups(rigId: string, personalityName: string): LedGroup[] {
  const rig = getRigById(rigId);
  const personality = rig?.personalities.find((p) => p.name === personalityName);
  if (!personality) return [];

  const reds = personality.channels.filter((c) => c.type === 'red');
  if (reds.length <= 1) return []; // Single LED — no sub-selection needed

  return reds.map((_, i) => ({
    index: i,
    label: `LED ${i + 1}`,
  }));
}

export default function FixtureTargetSelector({ target, onChange, showLedFilter = true }: FixtureTargetSelectorProps) {
  const fixtures = useRoomStore((s) => s.fixtures);

  // Build fixture list with LED groups
  const fixtureData = useMemo(() => {
    return fixtures.map((f) => ({
      fixture: f,
      ledGroups: getFixtureLedGroups(f.rigId, f.personalityName),
    }));
  }, [fixtures]);

  const handleModeChange = useCallback(
    (mode: FixtureTarget['mode']) => {
      if (mode === 'all') {
        // Switching to "All" clears any include/exclude selections
        onChange({ mode, fixtureIds: [], ledIndices: {} });
      } else {
        // Switching to include/exclude keeps current selections (or start empty)
        onChange({ ...target, mode });
      }
    },
    [target, onChange],
  );

  const handleFixtureToggle = useCallback(
    (fixtureId: string) => {
      const ids = target.fixtureIds;
      const updated = ids.includes(fixtureId)
        ? ids.filter((id) => id !== fixtureId)
        : [...ids, fixtureId];

      // Clean up ledIndices for removed fixtures
      const newLedIndices = { ...target.ledIndices };
      if (!updated.includes(fixtureId)) {
        delete newLedIndices[fixtureId];
      }

      onChange({ ...target, fixtureIds: updated, ledIndices: newLedIndices });
    },
    [target, onChange],
  );

  const handleSelectAll = useCallback(() => {
    onChange({ ...target, fixtureIds: fixtures.map((f) => f.id) });
  }, [target, fixtures, onChange]);

  const handleSelectNone = useCallback(() => {
    onChange({ ...target, fixtureIds: [], ledIndices: {} });
  }, [target, onChange]);

  const handleLedToggle = useCallback(
    (fixtureId: string, ledIndex: number, totalLeds: number) => {
      const currentLedIndices = { ...target.ledIndices };
      const current = currentLedIndices[fixtureId];

      if (!current) {
        // First LED deselection: start with all LEDs selected, remove this one
        const allIndices = Array.from({ length: totalLeds }, (_, i) => i);
        currentLedIndices[fixtureId] = allIndices.filter((i) => i !== ledIndex);
      } else if (current.includes(ledIndex)) {
        // Deselect this LED
        const updated = current.filter((i) => i !== ledIndex);
        if (updated.length === 0) {
          // If all deselected, remove from map (means all LEDs)
          delete currentLedIndices[fixtureId];
        } else {
          currentLedIndices[fixtureId] = updated;
        }
      } else {
        // Select this LED
        const updated = [...current, ledIndex].sort((a, b) => a - b);
        if (updated.length === totalLeds) {
          // All LEDs selected again — remove from map
          delete currentLedIndices[fixtureId];
        } else {
          currentLedIndices[fixtureId] = updated;
        }
      }

      onChange({ ...target, ledIndices: currentLedIndices });
    },
    [target, onChange],
  );

  const isLedSelected = useCallback(
    (fixtureId: string, ledIndex: number) => {
      const indices = target.ledIndices?.[fixtureId];
      if (!indices) return true; // No filter = all LEDs
      return indices.includes(ledIndex);
    },
    [target.ledIndices],
  );

  const isFixtureIncluded = useCallback(
    (fixtureId: string) => {
      if (target.mode === 'all') return true;
      if (target.mode === 'include') return target.fixtureIds.includes(fixtureId);
      return !target.fixtureIds.includes(fixtureId);
    },
    [target],
  );

  // ── Expanded state for LED sub-lists (track which fixtures have LED lists open) ──
  const [expandedFixtures, setExpandedFixtures] = React.useState<Set<string>>(new Set());

  const toggleExpanded = useCallback((fixtureId: string) => {
    setExpandedFixtures((prev) => {
      const next = new Set(prev);
      if (next.has(fixtureId)) next.delete(fixtureId);
      else next.add(fixtureId);
      return next;
    });
  }, []);

  // Count active LEDs for a fixture
  const getActiveLedCount = useCallback(
    (fixtureId: string, totalLeds: number) => {
      const indices = target.ledIndices?.[fixtureId];
      if (!indices) return totalLeds;
      return indices.length;
    },
    [target.ledIndices],
  );

  return (
    <div className="fixture-target-selector">
      <div className="fixture-target-radios">
        {(['all', 'include', 'exclude'] as const).map((mode) => (
          <button
            key={mode}
            className={`fixture-target-radio ${target.mode === mode ? 'active' : ''}`}
            onClick={() => handleModeChange(mode)}
          >
            {mode === 'all' ? 'All' : mode === 'include' ? 'Include' : 'Exclude'}
          </button>
        ))}
      </div>

      {target.mode !== 'all' && (
        <>
          <div className="fixture-checklist">
            {fixtureData.map(({ fixture, ledGroups }) => {
              const included = target.mode === 'include'
                ? target.fixtureIds.includes(fixture.id)
                : !target.fixtureIds.includes(fixture.id);
              const hasLeds = ledGroups.length > 0;
              const isExpanded = expandedFixtures.has(fixture.id);
              const activeLeds = hasLeds
                ? getActiveLedCount(fixture.id, ledGroups.length)
                : 0;

              return (
                <div key={fixture.id} className="fixture-check-group">
                  <div className="fixture-check-row">
                    <input
                      type="checkbox"
                      checked={target.fixtureIds.includes(fixture.id)}
                      onChange={() => handleFixtureToggle(fixture.id)}
                    />
                    <span className="fixture-check-label">{fixture.label}</span>
                    <span className="fixture-check-addr">CH {fixture.startAddress}</span>

                    {showLedFilter && hasLeds && included && (
                      <button
                        className={`fixture-led-expand ${isExpanded ? 'expanded' : ''}`}
                        onClick={(e) => { e.stopPropagation(); toggleExpanded(fixture.id); }}
                        title={`${activeLeds}/${ledGroups.length} LEDs`}
                      >
                        <span className="fixture-led-count">
                          {activeLeds}/{ledGroups.length}
                        </span>
                        <span className="fixture-led-arrow">{isExpanded ? '▾' : '▸'}</span>
                      </button>
                    )}
                  </div>

                  {/* LED sub-list */}
                  {showLedFilter && hasLeds && included && isExpanded && (
                    <div className="fixture-led-list">
                      {ledGroups.map((led) => (
                        <label key={led.index} className="fixture-led-row">
                          <input
                            type="checkbox"
                            checked={isLedSelected(fixture.id, led.index)}
                            onChange={() => handleLedToggle(fixture.id, led.index, ledGroups.length)}
                          />
                          <span className="fixture-led-label">{led.label}</span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <div className="fixture-quick-btns">
            <button className="fixture-quick-btn" onClick={handleSelectAll}>Select All</button>
            <button className="fixture-quick-btn" onClick={handleSelectNone}>Select None</button>
          </div>
        </>
      )}
    </div>
  );
}
