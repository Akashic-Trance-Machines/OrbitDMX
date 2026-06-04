import React, { useState, useCallback } from 'react';
import { useColourStore } from '../store/useColourStore';
import type { ColourPreset, ColourPalette } from '../store/useColourStore';
import { HexColorPicker } from '../components/HtsColorPicker';
import './ColoursView.css';

function randomId() {
  return Math.random().toString(36).slice(2, 10);
}

// ─── Preset Tile ──────────────────────────────────────────────────────────────

interface PresetTileProps {
  index: number;
  preset: ColourPreset;
  isEditing: boolean;
  onSelect: (index: number) => void;
  onUpdate: (index: number, preset: ColourPreset) => void;
  onClose: () => void;
}

function PresetTile({ index, preset, isEditing, onSelect, onUpdate, onClose }: PresetTileProps) {
  return (
    <div className={`cv-preset-tile${isEditing ? ' cv-preset-tile--editing' : ''}`}>
      <button
        className="cv-preset-swatch"
        style={{ background: preset.hex }}
        onClick={() => isEditing ? onClose() : onSelect(index)}
        title={preset.name}
      />
      {isEditing && (
        <div className="cv-preset-editor">
          <HexColorPicker
            hex={preset.hex}
            onChange={(hex) => onUpdate(index, { ...preset, hex })}
            size={140}
          />
          <button className="cv-btn-close" onClick={onClose} title="Done">✓ Done</button>
        </div>
      )}
    </div>
  );
}

// ─── Palette Editor ───────────────────────────────────────────────────────────

interface PaletteEditorProps {
  palette: ColourPalette;
  onUpdate: (changes: Partial<Omit<ColourPalette, 'id'>>) => void;
  onDelete: () => void;
  onClose: () => void;
}

function PaletteEditor({ palette, onUpdate, onDelete, onClose }: PaletteEditorProps) {
  const [newHex, setNewHex] = useState('#ff0000');
  const [editingRowIdx, setEditingRowIdx] = useState<number | null>(null);
  const [dragIdx, setDragIdx] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState<number | null>(null);

  const handleAddColour = () => {
    onUpdate({ colours: [...palette.colours, newHex] });
  };

  const handleRemove = (i: number) => {
    onUpdate({ colours: palette.colours.filter((_, idx) => idx !== i) });
    if (editingRowIdx === i) setEditingRowIdx(null);
  };

  const handleDragStart = (i: number) => setDragIdx(i);
  const handleDragOver = (e: React.DragEvent, i: number) => { e.preventDefault(); setDragOver(i); };
  const handleDrop = (toIdx: number) => {
    if (dragIdx === null || dragIdx === toIdx) { setDragIdx(null); setDragOver(null); return; }
    const next = [...palette.colours];
    const [moved] = next.splice(dragIdx, 1);
    next.splice(toIdx, 0, moved);
    onUpdate({ colours: next });
    setDragIdx(null); setDragOver(null);
  };

  return (
    <div className="cv-palette-editor">
      <div className="cv-palette-editor-header">
        <input
          className="cv-input cv-palette-name-input"
          value={palette.name}
          onChange={(e) => onUpdate({ name: e.target.value })}
          placeholder="Palette name"
        />
        <button className="cv-icon-btn cv-btn-danger" onClick={onDelete} title="Delete palette">✕</button>
        <button className="cv-icon-btn" onClick={onClose} title="Back">←</button>
      </div>

      <div className="cv-palette-colours">
        {palette.colours.length === 0 && (
          <p className="cv-empty-hint">No colours yet. Add one below.</p>
        )}
        {palette.colours.map((hex, i) => (
          <div key={i}>
            <div
              className={`cv-palette-colour-row${dragOver === i ? ' cv-palette-colour-row--over' : ''}`}
              draggable
              onDragStart={() => handleDragStart(i)}
              onDragOver={(e) => handleDragOver(e, i)}
              onDrop={() => handleDrop(i)}
              onDragEnd={() => { setDragIdx(null); setDragOver(null); }}
            >
              <span className="cv-drag-handle">⠿</span>
              <span className="cv-palette-swatch" style={{ background: hex }} />
              <span className="cv-palette-hex mono">{hex.toUpperCase()}</span>
              <button
                className={`cv-icon-btn${editingRowIdx === i ? ' cv-icon-btn--active' : ''}`}
                onClick={() => setEditingRowIdx(editingRowIdx === i ? null : i)}
                title="Edit colour"
              >✎</button>
              <button className="cv-icon-btn cv-btn-danger" onClick={() => handleRemove(i)} title="Remove">✕</button>
            </div>
            {editingRowIdx === i && (
              <div className="cv-inline-picker">
                <HexColorPicker
                  hex={hex}
                  onChange={(newHex) => {
                    const next = [...palette.colours];
                    next[i] = newHex;
                    onUpdate({ colours: next });
                  }}
                  size={140}
                />
              </div>
            )}
          </div>
        ))}
      </div>

      {/* Add colour row */}
      <div className="cv-palette-add-section">
        <div className="cv-palette-add-row">
          <span className="cv-palette-swatch" style={{ background: newHex }} />
          <span className="cv-palette-hex mono">{newHex.toUpperCase()}</span>
          <button className="cv-btn cv-btn-accent" onClick={handleAddColour}>Add colour</button>
        </div>
        <div className="cv-inline-picker">
          <HexColorPicker hex={newHex} onChange={setNewHex} size={140} />
        </div>
      </div>
    </div>
  );
}

// ─── Main View ────────────────────────────────────────────────────────────────

export default function ColoursView() {
  const { presets, setPreset, resetPresets, palettes, addPalette, updatePalette, deletePalette } = useColourStore();

  const [editingIndex, setEditingIndex] = useState<number | null>(null);

  const handleUpdatePreset = useCallback((index: number, preset: ColourPreset) => {
    setPreset(index, preset);
  }, [setPreset]);

  const [selectedPaletteId, setSelectedPaletteId] = useState<string | null>(null);
  const selectedPalette = palettes.find((p) => p.id === selectedPaletteId) ?? null;

  const handleNewPalette = () => {
    const p: ColourPalette = { id: randomId(), name: 'New Palette', colours: [] };
    addPalette(p);
    setSelectedPaletteId(p.id);
  };

  const handleUpdatePalette = useCallback((changes: Partial<Omit<ColourPalette, 'id'>>) => {
    if (!selectedPaletteId) return;
    updatePalette(selectedPaletteId, changes);
  }, [selectedPaletteId, updatePalette]);

  const handleDeletePalette = () => {
    if (!selectedPaletteId) return;
    deletePalette(selectedPaletteId);
    setSelectedPaletteId(null);
  };

  return (
    <div className="cv-root">
      {/* ── Left: Presets ──────────────────────────────────────────── */}
      <div className="cv-panel cv-panel--presets">
        <div className="cv-panel-header">
          <h2 className="cv-panel-title">Presets</h2>
          <button className="cv-btn" onClick={resetPresets}>Reset defaults</button>
        </div>
        <p className="cv-panel-description">
          12 quick-access colours shown in the colour picker. Click a swatch to edit it.
        </p>

        <div className="cv-presets-grid">
          {presets.map((preset, i) => (
            <PresetTile
              key={preset.id}
              index={i}
              preset={preset}
              isEditing={editingIndex === i}
              onSelect={(idx) => setEditingIndex(idx)}
              onUpdate={handleUpdatePreset}
              onClose={() => setEditingIndex(null)}
            />
          ))}
        </div>

        {/* Live preview strip */}
        <div className="cv-preset-strip">
          {presets.map((p) => (
            <span key={p.id} className="cv-strip-dot" style={{ background: p.hex }} title={p.name} />
          ))}
        </div>
      </div>

      {/* ── Right: Palettes ────────────────────────────────────────── */}
      <div className="cv-panel cv-panel--palettes">
        {selectedPalette ? (
          <PaletteEditor
            palette={selectedPalette}
            onUpdate={handleUpdatePalette}
            onDelete={handleDeletePalette}
            onClose={() => setSelectedPaletteId(null)}
          />
        ) : (
          <>
            <div className="cv-panel-header">
              <h2 className="cv-panel-title">Palettes</h2>
              <button className="cv-btn cv-btn-accent" onClick={handleNewPalette}>+ New palette</button>
            </div>
            <p className="cv-panel-description">
              Named colour collections for future light show generation. Each palette is independent.
            </p>

            {palettes.length === 0 ? (
              <div className="cv-empty-state">
                <span className="cv-empty-icon">◉</span>
                <p>No palettes yet</p>
                <button className="cv-btn cv-btn-accent" onClick={handleNewPalette}>Create your first palette</button>
              </div>
            ) : (
              <div className="cv-palette-list">
                {palettes.map((palette) => (
                  <button
                    key={palette.id}
                    className="cv-palette-card"
                    onClick={() => setSelectedPaletteId(palette.id)}
                  >
                    <div className="cv-palette-card-header">
                      <span className="cv-palette-card-name">{palette.name}</span>
                      <span className="cv-palette-card-count">{palette.colours.length} colour{palette.colours.length !== 1 ? 's' : ''}</span>
                    </div>
                    <div className="cv-palette-card-dots">
                      {palette.colours.slice(0, 12).map((hex, i) => (
                        <span key={i} className="cv-palette-dot" style={{ background: hex }} />
                      ))}
                      {palette.colours.length > 12 && (
                        <span className="cv-palette-dot-more">+{palette.colours.length - 12}</span>
                      )}
                      {palette.colours.length === 0 && (
                        <span className="cv-palette-empty-hint">Empty</span>
                      )}
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
