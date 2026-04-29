import React, { useCallback, useRef, useMemo, useEffect, useState } from 'react';
import { useRoomStore } from '../store/useRoomStore';
import FloorPlanFixture from '../components/FloorPlanFixture';
import type { FixtureInstance } from '../../shared/types';
import './FloorPlanView.css';

interface FloorPlanViewProps {
  selectedFixtureId: string | null;
  onSelectFixture: (fixture: FixtureInstance) => void;
  universe: number[];
}

const MIN_SCALE = 30;   // px per meter minimum
const MAX_SCALE = 120;  // px per meter maximum
const PADDING = 40;     // px padding around the room rectangle

export default function FloorPlanView({ selectedFixtureId, onSelectFixture, universe }: FloorPlanViewProps) {
  const fixtures = useRoomStore((s) => s.fixtures);
  const floorPlan = useRoomStore((s) => s.floorPlan);
  const updateFixture = useRoomStore((s) => s.updateFixture);
  const setFloorPlan = useRoomStore((s) => s.setFloorPlan);

  const containerRef = useRef<HTMLDivElement>(null);
  const [containerSize, setContainerSize] = useState({ width: 800, height: 600 });

  // Observe container size to calculate scale
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerSize({
          width: entry.contentRect.width,
          height: entry.contentRect.height,
        });
      }
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // Calculate scale: fit the room into the container with padding
  const scale = useMemo(() => {
    const availableWidth = containerSize.width - PADDING * 2;
    const availableHeight = containerSize.height - PADDING * 2;
    const scaleX = availableWidth / floorPlan.widthM;
    const scaleY = availableHeight / floorPlan.depthM;
    return Math.max(MIN_SCALE, Math.min(MAX_SCALE, Math.min(scaleX, scaleY)));
  }, [containerSize, floorPlan]);

  const roomPxWidth = floorPlan.widthM * scale;
  const roomPxHeight = floorPlan.depthM * scale;

  // Handle fixture position change — clamp to room bounds
  const handlePositionChange = useCallback((id: string, x: number, y: number) => {
    const clampedX = Math.max(0, Math.min(floorPlan.widthM - 0.5, x));
    const clampedY = Math.max(0, Math.min(floorPlan.depthM - 0.5, y));
    updateFixture(id, { x: Math.round(clampedX * 100) / 100, y: Math.round(clampedY * 100) / 100 });
  }, [floorPlan, updateFixture]);

  // Handle fixture rotation — cycle 0 → 45 → 90 ... → 315 → 0
  const handleRotate = useCallback((id: string) => {
    const fixture = fixtures.find((f) => f.id === id);
    if (!fixture) return;
    const nextRotation = (((fixture.rotation ?? 0) + 45) % 360);
    updateFixture(id, { rotation: nextRotation });
  }, [fixtures, updateFixture]);

  // Handle room dimension change
  const handleDimensionChange = useCallback((dim: 'widthM' | 'depthM', value: string) => {
    const num = parseFloat(value);
    if (isNaN(num) || num <= 0) return;
    setFloorPlan({ ...floorPlan, [dim]: Math.min(50, Math.max(1, num)) });
  }, [floorPlan, setFloorPlan]);

  // Generate grid lines (every meter)
  const gridLines = useMemo(() => {
    const lines: React.ReactNode[] = [];
    for (let x = 1; x < floorPlan.widthM; x++) {
      lines.push(
        <line
          key={`v${x}`}
          x1={x * scale} y1={0}
          x2={x * scale} y2={roomPxHeight}
          className="fp-grid-line"
        />
      );
    }
    for (let y = 1; y < floorPlan.depthM; y++) {
      lines.push(
        <line
          key={`h${y}`}
          x1={0} y1={y * scale}
          x2={roomPxWidth} y2={y * scale}
          className="fp-grid-line"
        />
      );
    }
    return lines;
  }, [floorPlan, scale, roomPxWidth, roomPxHeight]);

  return (
    <div className="floor-plan-view">
      {/* Dimension controls */}
      <div className="fp-controls">
        <div className="fp-dim-group">
          <label className="fp-dim-label" htmlFor="fp-width">Width</label>
          <input
            id="fp-width"
            type="number"
            className="fp-dim-input mono"
            value={floorPlan.widthM}
            min={1}
            max={50}
            step={0.5}
            onChange={(e) => handleDimensionChange('widthM', e.target.value)}
          />
          <span className="fp-dim-unit">m</span>
        </div>
        <span className="fp-dim-separator">×</span>
        <div className="fp-dim-group">
          <label className="fp-dim-label" htmlFor="fp-depth">Depth</label>
          <input
            id="fp-depth"
            type="number"
            className="fp-dim-input mono"
            value={floorPlan.depthM}
            min={1}
            max={50}
            step={0.5}
            onChange={(e) => handleDimensionChange('depthM', e.target.value)}
          />
          <span className="fp-dim-unit">m</span>
        </div>
        <span className="fp-scale-info text-muted">
          {Math.round(scale)}px/m · {fixtures.length} fixture{fixtures.length !== 1 ? 's' : ''}
        </span>
      </div>

      {/* Floor plan canvas */}
      <div className="fp-canvas-container" ref={containerRef}>
        <div
          className="fp-room"
          style={{ width: `${roomPxWidth}px`, height: `${roomPxHeight}px` }}
        >
          {/* Grid */}
          <svg className="fp-grid" width={roomPxWidth} height={roomPxHeight}>
            {gridLines}
          </svg>

          {/* Room dimension labels */}
          <span className="fp-room-label fp-room-label-width">{floorPlan.widthM}m</span>
          <span className="fp-room-label fp-room-label-depth">{floorPlan.depthM}m</span>

          {/* Fixtures */}
          {fixtures.map((f) => (
            <FloorPlanFixture
              key={f.id}
              fixture={f}
              isSelected={f.id === selectedFixtureId}
              onSelect={onSelectFixture}
              onPositionChange={handlePositionChange}
              onRotate={handleRotate}
              scale={scale}
              universe={universe}
            />
          ))}

          {/* Empty state */}
          {fixtures.length === 0 && (
            <div className="fp-empty">
              <span>Add fixtures to see them on the floor plan</span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
