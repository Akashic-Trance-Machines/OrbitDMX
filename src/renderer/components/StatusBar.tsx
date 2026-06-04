import React, { useState, useRef, useCallback } from 'react';
import './StatusBar.css';
import { useSerialStore } from '../store/useSerialStore';
import { usePlaylistStore } from '../store/usePlaylistStore';
import { useFxStore } from '../store/useFxStore';
import { useTempoStore } from '../store/useTempoStore';
import type { SerialStatus } from '../../shared/types';

const STATUS_LABEL: Record<SerialStatus, string> = {
  disconnected:  'No DMX adapter',
  connecting:    'Connecting…',
  connected:     'DMX connected',
  error:         'DMX error',
  reconnecting:  'Reconnecting…',
};

const STATUS_CLASS: Record<SerialStatus, string> = {
  disconnected:  'status-disconnected',
  connecting:    'status-connecting',
  connected:     'status-connected',
  error:         'status-error',
  reconnecting:  'status-connecting', // amber pulsing dot — same as connecting
};

const FX_ICONS: Record<string, string> = {
  strobe: '⚡',
  strobeColor: '🌈',
  breath: '🫁',
  fire: '🔥',
  candle: '🕯️',
  twinkle: '✨',
};

export default function StatusBar() {
  const status = useSerialStore((s) => s.status);

  // Scene playlist
  const playbackState    = usePlaylistStore((s) => s.playbackState);
  const activePlaylistId = usePlaylistStore((s) => s.activePlaylistId);
  const playlists        = usePlaylistStore((s) => s.playlists);
  const currentCueIndex  = usePlaylistStore((s) => s.currentCueIndex);

  // Palette generator
  const palettePlaybackState    = usePlaylistStore((s) => s.palettePlaybackState);
  const activePalettePlaylistId = usePlaylistStore((s) => s.activePalettePlaylistId);
  const palettePlayists         = usePlaylistStore((s) => s.palettePlayists);

  // HSB generator
  const hsbPlaybackState    = usePlaylistStore((s) => s.hsbPlaybackState);
  const activeHsbPlaylistId = usePlaylistStore((s) => s.activeHsbPlaylistId);
  const hsbPlaylists        = usePlaylistStore((s) => s.hsbPlaylists);

  // FX state
  const fxStates = useFxStore((s) => s.fxStates);
  const activeFxTypes = Object.entries(fxStates)
    .filter(([, s]) => s.isActive)
    .map(([t]) => t as import('../../shared/types').FxType);

  const label = STATUS_LABEL[status];

  const activePlaylist        = playlists.find((p) => p.id === activePlaylistId);
  const activePalettePlaylist = palettePlayists.find((p) => p.id === activePalettePlaylistId);
  const activeHsbPlaylist     = hsbPlaylists.find((p) => p.id === activeHsbPlaylistId);

  const isScenePlaying   = (playbackState === 'playing' || playbackState === 'paused') && !!activePlaylist;
  const isPalettePlaying = (palettePlaybackState === 'playing' || palettePlaybackState === 'paused') && !!activePalettePlaylist;
  const isHsbPlaying     = (hsbPlaybackState === 'playing' || hsbPlaybackState === 'paused') && !!activeHsbPlaylist;

  return (
    <footer className="status-bar" role="status">
      <div className={`status-indicator ${STATUS_CLASS[status]}`}>
        <span className="status-dot" />
        <span className="status-label">{label}</span>
      </div>

      {/* Scene playlist */}
      {isScenePlaying && (
        <div className={`status-indicator status-playlist ${playbackState === 'paused' ? 'paused' : ''}`}>
          <span className="status-playlist-icon">{playbackState === 'playing' ? '▶' : '⏸'}</span>
          <span className="status-label">
            {activePlaylist!.name} — {currentCueIndex + 1}/{activePlaylist!.cues.length}
          </span>
        </div>
      )}

      {/* Palette generator */}
      {isPalettePlaying && (
        <div className={`status-indicator status-playlist ${palettePlaybackState === 'paused' ? 'paused' : ''}`}>
          <span className="status-playlist-icon">{palettePlaybackState === 'playing' ? '▶' : '⏸'}</span>
          <span className="status-label">{activePalettePlaylist!.name}</span>
        </div>
      )}

      {/* HSB generator */}
      {isHsbPlaying && (
        <div className={`status-indicator status-playlist ${hsbPlaybackState === 'paused' ? 'paused' : ''}`}>
          <span className="status-playlist-icon">{hsbPlaybackState === 'playing' ? '▶' : '⏸'}</span>
          <span className="status-label">{activeHsbPlaylist!.name}</span>
        </div>
      )}

      {/* FX indicators — one per active type */}
      {activeFxTypes.map((type) => (
        <div key={type} className="status-indicator status-fx">
          <span className="status-fx-icon">{FX_ICONS[type] ?? '✦'}</span>
          <span className="status-label">FX</span>
        </div>
      ))}

      {/* Spacer */}
      <div className="status-spacer" />

      {/* Tempo widget */}
      <TempoWidget />
    </footer>
  );
}

// ── Tempo Widget ──────────────────────────────────────────────────────────────

function TempoWidget() {
  const bpm = useTempoStore((s) => s.bpm);
  const midiSyncEnabled = useTempoStore((s) => s.midiSyncEnabled);
  const midiClockActive = useTempoStore((s) => s.midiClockActive);
  const { setBpm, tap } = useTempoStore.getState();

  // Clock is considered lost when sync is on but no ticks have arrived
  const midiLost = midiSyncEnabled && !midiClockActive;

  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [tapFlash, setTapFlash] = useState(false);
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleBpmClick = () => {
    if (midiClockActive) return; // read-only while clock is actively driving BPM
    setEditValue(bpm.toFixed(1));
    setEditing(true);
  };

  const commitEdit = useCallback(() => {
    const parsed = parseFloat(editValue);
    if (!isNaN(parsed)) {
      setBpm(parsed);
    }
    setEditing(false);
  }, [editValue, setBpm]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') commitEdit();
    if (e.key === 'Escape') setEditing(false);
  };

  const handleTap = () => {
    tap();

    // Brief flash animation on the button
    setTapFlash(true);
    if (flashTimerRef.current) clearTimeout(flashTimerRef.current);
    flashTimerRef.current = setTimeout(() => setTapFlash(false), 120);
  };

  return (
    <div className="tempo-widget" title="Global Tempo">
      {midiSyncEnabled && (
        <span
          className={`tempo-midi-badge ${midiLost ? 'no-signal' : ''}`}
          title={midiLost ? 'MIDI Sync enabled — no clock signal received' : 'MIDI Clock Sync active'}
        >
          MIDI
        </span>
      )}

      {/* Tempo dot — always blinks at BPM rate.
          midi-lost class gives amber colour when MIDI is selected but no signal */}
      <span
        className={`tempo-dot ${
          midiSyncEnabled
            ? midiClockActive
              ? 'midi'      // purple/accent — MIDI clock driving BPM
              : 'midi-lost' // amber — MIDI enabled, falling back to global BPM
            : ''            // white/muted — plain global BPM
        }`}
        style={{ animationDuration: `${Math.round(60000 / bpm)}ms` }}
        title={midiLost
          ? `${bpm.toFixed(1)} BPM (MIDI sync enabled — using global BPM)`
          : `${bpm.toFixed(1)} BPM`}
      />

      <div
        className={`tempo-bpm ${midiClockActive ? 'readonly' : 'editable'}`}
        onClick={handleBpmClick}
        title={midiClockActive ? 'Controlled by MIDI Clock' : 'Click to edit BPM'}
      >
        {editing ? (
          <input
            className="tempo-bpm-input"
            type="number"
            min={20}
            max={300}
            step={0.1}
            value={editValue}
            autoFocus
            onChange={(e) => setEditValue(e.target.value)}
            onBlur={commitEdit}
            onKeyDown={handleKeyDown}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <>
            <span className="tempo-bpm-value mono">{bpm.toFixed(1)}</span>
            <span className="tempo-bpm-unit">BPM</span>
          </>
        )}
      </div>

      <button
        id="btn-tap-tempo"
        className={`tempo-tap-btn ${tapFlash ? 'flash' : ''}`}
        onClick={handleTap}
        disabled={midiClockActive}
        title={midiClockActive ? 'Tap disabled — MIDI clock active' : 'Tap to set tempo'}
      >
        TAP
      </button>
    </div>
  );
}
