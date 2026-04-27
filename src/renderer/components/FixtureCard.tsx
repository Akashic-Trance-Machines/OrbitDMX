import React from 'react';
import type { FixtureInstance } from '../../shared/types';
import { useRoomStore } from '../store/useRoomStore';
import { getFixtureLedColors } from '../utils/ledColors';
import './FixtureCard.css';

interface FixtureCardProps {
  fixture: FixtureInstance;
  onTest: (fixture: FixtureInstance) => void;
  isTesting: boolean;
  isSelected?: boolean;
  onSelect?: (fixture: FixtureInstance) => void;
  universe?: number[];
}

export default function FixtureCard({ fixture, onTest, isTesting, isSelected, onSelect, universe }: FixtureCardProps) {
  const removeFixture = useRoomStore((s) => s.removeFixture);

  const endAddress = fixture.startAddress + fixture.channelCount - 1;

  // Get live LED colours from universe snapshot
  const leds = universe ? getFixtureLedColors(fixture, universe) : [];

  const handleTest = (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!isTesting) onTest(fixture);
  };

  const handleRemove = (e: React.MouseEvent) => {
    e.stopPropagation();
    removeFixture(fixture.id);
  };

  return (
    <div
      className={`fixture-card ${isSelected ? 'selected' : ''}`}
      id={`fixture-${fixture.id}`}
      onClick={() => onSelect?.(fixture)}
      role="button"
      tabIndex={0}
    >
      <div className="fixture-card-accent" style={{ background: isSelected ? 'var(--color-accent)' : 'var(--color-text-dim)' }} />

      <div className="fixture-card-body">
        <div className="fixture-card-main">
          <span className="fixture-card-label">{fixture.label}</span>
          <span className="fixture-card-meta">
            {fixture.personalityName} · {fixture.channelCount}ch
          </span>
        </div>

        {/* Live LED colour dots */}
        {leds.length > 0 && (
          <div className="fixture-card-leds">
            {leds.map((led) => (
              <span
                key={`${led.fixtureId}-${led.ledIndex}`}
                className="fixture-card-led"
                style={{ background: led.color }}
              />
            ))}
          </div>
        )}

        <div className="fixture-card-address mono">
          CH {fixture.startAddress}–{endAddress}
        </div>

        <div className="fixture-card-actions">
          <button
            className={`fixture-btn-test ${isTesting ? 'testing' : ''}`}
            id={`btn-test-${fixture.id}`}
            title="Flash fixture 3× RGB"
            onClick={handleTest}
            disabled={isTesting}
          >
            {isTesting ? (
              <span className="testing-dots">
                <span style={{ color: '#f74f6a' }}>●</span>
                <span style={{ color: '#4fd97a' }}>●</span>
                <span style={{ color: '#4fa8f7' }}>●</span>
              </span>
            ) : (
              '⚡'
            )}
          </button>
          <button
            className="fixture-btn-remove"
            id={`btn-remove-${fixture.id}`}
            title="Remove fixture"
            onClick={handleRemove}
          >
            ×
          </button>
        </div>
      </div>
    </div>
  );
}
