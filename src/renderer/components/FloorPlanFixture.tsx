import React, { useCallback, useRef, useState } from 'react';
import type { FixtureInstance } from '../../shared/types';
import { getFixtureLedColors } from '../utils/ledColors';

interface FloorPlanFixtureProps {
  fixture: FixtureInstance;
  isSelected: boolean;
  onSelect: (fixture: FixtureInstance) => void;
  onPositionChange: (id: string, x: number, y: number) => void;
  onRotate: (id: string) => void;
  /** Pixels per meter — used to convert fixture position to screen coords. */
  scale: number;
  universe?: number[];
}

const FIXTURE_SIZE = 48; // px — the visual size of a fixture icon

export default function FloorPlanFixture({
  fixture,
  isSelected,
  onSelect,
  onPositionChange,
  onRotate,
  scale,
  universe,
}: FloorPlanFixtureProps) {
  const draggingRef = useRef(false);
  const hasDraggedRef = useRef(false);
  const startPosRef = useRef({ x: 0, y: 0 });
  const offsetRef = useRef({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);

  const rotation = fixture.rotation ?? 0;
  const x = (fixture.x ?? 0) * scale;
  const y = (fixture.y ?? 0) * scale;

  // Get live LED colours
  const leds = universe ? getFixtureLedColors(fixture, universe) : [];

  const handlePointerDown = useCallback((e: React.PointerEvent) => {
    e.preventDefault();
    e.stopPropagation();
    draggingRef.current = true;
    hasDraggedRef.current = false;
    setIsDragging(true);

    startPosRef.current = { x: e.clientX, y: e.clientY };

    const el = e.currentTarget as HTMLElement;
    el.setPointerCapture(e.pointerId);

    // Calculate offset from the fixture's top-left corner to the pointer
    const rect = el.parentElement!.getBoundingClientRect();
    offsetRef.current = {
      x: e.clientX - rect.left - x,
      y: e.clientY - rect.top - y,
    };
  }, [x, y]);

  const handlePointerMove = useCallback((e: React.PointerEvent) => {
    if (!draggingRef.current) return;
    e.preventDefault();

    const dx = e.clientX - startPosRef.current.x;
    const dy = e.clientY - startPosRef.current.y;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      hasDraggedRef.current = true;
    }

    const rect = (e.currentTarget as HTMLElement).parentElement!.getBoundingClientRect();
    const newX = (e.clientX - rect.left - offsetRef.current.x) / scale;
    const newY = (e.clientY - rect.top - offsetRef.current.y) / scale;

    onPositionChange(fixture.id, newX, newY);
  }, [fixture.id, scale, onPositionChange]);

  const handlePointerUp = useCallback((e: React.PointerEvent) => {
    draggingRef.current = false;
    setIsDragging(false);
    (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    onRotate(fixture.id);
  }, [fixture.id, onRotate]);

  const handleClick = useCallback((e: React.MouseEvent) => {
    // Only select on click if we didn't drag
    if (!hasDraggedRef.current) {
      onSelect(fixture);
    }
  }, [fixture, onSelect]);

  return (
    <div
      className={`fp-fixture ${isSelected ? 'selected' : ''} ${isDragging ? 'dragging' : ''}`}
      id={`fp-fixture-${fixture.id}`}
      style={{
        left: `${x}px`,
        top: `${y}px`,
        transform: `rotate(${rotation}deg)`,
      }}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onContextMenu={handleContextMenu}
      onClick={handleClick}
      title={`${fixture.label} · CH ${fixture.startAddress} · Right-click to rotate`}
    >
      <div className="fp-fixture-leds">
        {leds.length === 0 ? (
          <div className="fp-fixture-led" style={{ background: 'var(--color-text-muted)' }} />
        ) : (
          leds.map((led, i) => (
            <div key={i} className="fp-fixture-led" style={{ background: led.color, boxShadow: `0 0 8px ${led.color}` }} />
          ))
        )}
      </div>
      <span className="fp-fixture-arrow">
        ↑
      </span>
    </div>
  );
}
