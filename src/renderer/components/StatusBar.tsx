import React from 'react';
import './StatusBar.css';
import { useSerialStore } from '../store/useSerialStore';
import { usePlaylistStore } from '../store/usePlaylistStore';
import { useFxStore } from '../store/useFxStore';
import type { SerialStatus } from '../../shared/types';

const STATUS_LABEL: Record<SerialStatus, string> = {
  disconnected: 'No DMX adapter',
  connecting:   'Connecting…',
  connected:    'DMX connected',
  error:        'DMX error',
};

const STATUS_CLASS: Record<SerialStatus, string> = {
  disconnected: 'status-disconnected',
  connecting:   'status-connecting',
  connected:    'status-connected',
  error:        'status-error',
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
  const port   = useSerialStore((s) => s.connectedPort);

  // Playlist state
  const playbackState = usePlaylistStore((s) => s.playbackState);
  const activePlaylistId = usePlaylistStore((s) => s.activePlaylistId);
  const playlists = usePlaylistStore((s) => s.playlists);
  const currentCueIndex = usePlaylistStore((s) => s.currentCueIndex);

  // FX state
  const fxType = useFxStore((s) => s.selectedType);
  const fxActive = useFxStore((s) => s.isActive);

  const label = status === 'connected' && port
    ? `DMX connected — ${port}`
    : STATUS_LABEL[status];

  const activePlaylist = playlists.find((p) => p.id === activePlaylistId);
  const isPlaylistRunning = playbackState === 'playing' || playbackState === 'paused';

  return (
    <footer className="status-bar" role="status">
      <div className={`status-indicator ${STATUS_CLASS[status]}`}>
        <span className="status-dot" />
        <span className="status-label">{label}</span>
      </div>

      {/* Playlist indicator */}
      {isPlaylistRunning && activePlaylist && (
        <div className={`status-indicator status-playlist ${playbackState === 'paused' ? 'paused' : ''}`}>
          <span className="status-playlist-icon">
            {playbackState === 'playing' ? '▶' : '⏸'}
          </span>
          <span className="status-label">
            {activePlaylist.name} — Cue {currentCueIndex + 1}/{activePlaylist.cues.length}
          </span>
        </div>
      )}

      {/* FX indicator */}
      {fxActive && fxType && (
        <div className="status-indicator status-fx">
          <span className="status-fx-icon">{FX_ICONS[fxType] ?? '✦'}</span>
          <span className="status-label">FX Active</span>
        </div>
      )}
    </footer>
  );
}
