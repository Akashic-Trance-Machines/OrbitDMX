import React, { useEffect, useRef, useState, useCallback } from 'react';
import { loadRoomFromFile, newRoom, buildCurrentRoomFile } from '../hooks/useAutosave';
import { useRoomFileStore } from '../store/useRoomFileStore';
import { usePlaylistStore } from '../store/usePlaylistStore';
import './RoomPickerModal.css';

interface RoomEntry {
  name: string;
  filePath: string;
  modifiedAt: number;
}

interface RoomPickerModalProps {
  onClose: () => void;
}

function relativeTime(ms: number): string {
  const diff = Date.now() - ms;
  const s = Math.floor(diff / 1000);
  if (s < 60)       return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60)       return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24)       return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

export default function RoomPickerModal({ onClose }: RoomPickerModalProps) {
  const backdropRef         = useRef<HTMLDivElement>(null);
  const newNameRef          = useRef<HTMLInputElement>(null);
  const currentFilePath     = useRoomFileStore((s) => s.filePath);

  const [rooms,    setRooms]    = useState<RoomEntry[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName,  setNewName]  = useState('');
  const [error,    setError]    = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);

  /* ── Load room list ── */
  const loadList = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      if (typeof window.dmx === 'undefined') { setLoading(false); return; }
      const res = await window.dmx.listRoomDir();
      if (res.success && res.data) setRooms(res.data as RoomEntry[]);
    } catch {
      setError('Could not load room list.');
    }
    setLoading(false);
  }, []);

  useEffect(() => { void loadList(); }, [loadList]);

  /* ── Focus the name input when the create form opens ── */
  useEffect(() => {
    if (creating) setTimeout(() => newNameRef.current?.focus(), 50);
  }, [creating]);

  /* ── Close on Escape ── */
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [onClose]);

  /* ── Switch to a room file ── */
  const openRoom = async (filePath: string) => {
    setSwitching(true);
    // Flush the current room to disk before switching so nothing is lost
    const currentPath = useRoomFileStore.getState().filePath;
    if (currentPath && typeof window.dmx !== 'undefined') {
      await window.dmx.saveRoomFile(currentPath, buildCurrentRoomFile());
    }
    // Stop any running playlists/generators before loading new room
    const ps = usePlaylistStore.getState();
    ps.setPlaybackState('stopped');
    ps.setPalettePlaybackState('stopped');
    ps.setHsbPlaybackState('stopped');
    await loadRoomFromFile(filePath);
    setSwitching(false);
    onClose();
  };

  /* ── Create a new room and name it ── */
  const handleCreate = async () => {
    const trimmed = newName.trim();
    if (!trimmed) { newNameRef.current?.focus(); return; }

    setSwitching(true);
    await newRoom();

    // Save immediately with the chosen name so a file appears on disk
    if (typeof window.dmx !== 'undefined') {
      const defaultRes = await window.dmx.getDefaultPath();
      const dir = defaultRes.data as string;
      const safeName = trimmed.replace(/[^a-zA-Z0-9 _-]/g, '').trim() || 'Untitled';
      const filePath = `${dir}/${safeName}.orbitdmx`;

      useRoomFileStore.getState().setFilePath(filePath);
      useRoomFileStore.getState().setFileName(safeName);
    }
    setSwitching(false);
    onClose();
  };

  /* ── Backdrop click to close ── */
  const onBackdropClick = (e: React.MouseEvent) => {
    if (e.target === backdropRef.current) onClose();
  };

  return (
    <div
      ref={backdropRef}
      className="room-picker-backdrop"
      onClick={onBackdropClick}
      aria-modal="true"
      role="dialog"
      aria-label="Room Picker"
    >
      <div className="room-picker-panel">

        {/* Header */}
        <div className="room-picker-header">
          <h2 className="room-picker-title">Switch Room</h2>
          <button className="room-picker-close" onClick={onClose} title="Close">✕</button>
        </div>

        {/* Body */}
        <div className="room-picker-body">

          {/* Create new room section */}
          {creating ? (
            <div className="room-picker-create-form">
              <input
                ref={newNameRef}
                className="room-picker-name-input"
                type="text"
                placeholder="Room name…"
                value={newName}
                maxLength={48}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleCreate();
                  if (e.key === 'Escape') setCreating(false);
                }}
              />
              <div className="room-picker-create-actions">
                <button
                  className="room-picker-btn-primary"
                  disabled={!newName.trim() || switching}
                  onClick={() => void handleCreate()}
                >
                  {switching ? 'Creating…' : 'Create'}
                </button>
                <button className="room-picker-btn-ghost" onClick={() => setCreating(false)}>
                  Cancel
                </button>
              </div>
            </div>
          ) : (
            <button
              id="room-picker-new-btn"
              className="room-picker-new-btn"
              onClick={() => { setCreating(true); setNewName(''); }}
            >
              <span className="room-picker-new-icon">＋</span>
              New Room
            </button>
          )}

          <div className="room-picker-divider" />

          {/* Room list */}
          {loading ? (
            <div className="room-picker-empty">Loading…</div>
          ) : error ? (
            <div className="room-picker-empty room-picker-error">{error}</div>
          ) : rooms.length === 0 ? (
            <div className="room-picker-empty">No saved rooms yet.</div>
          ) : (
            <ul className="room-picker-list" role="listbox">
              {rooms.map((room) => {
                const isCurrent = room.filePath === currentFilePath;
                return (
                  <li key={room.filePath} role="option" aria-selected={isCurrent}>
                    <button
                      className={`room-picker-item ${isCurrent ? 'current' : ''}`}
                      disabled={switching}
                      onClick={() => !isCurrent && void openRoom(room.filePath)}
                      title={room.filePath}
                    >
                      <span className="room-picker-item-icon">
                        {isCurrent ? '◉' : '⬡'}
                      </span>
                      <span className="room-picker-item-name">{room.name}</span>
                      <span className="room-picker-item-time">
                        {isCurrent
                          ? <span className="room-picker-badge">Open</span>
                          : relativeTime(room.modifiedAt)
                        }
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Browse for file outside the default dir */}
          <div className="room-picker-divider" />
          <button
            className="room-picker-browse-btn"
            disabled={switching}
            onClick={async () => {
              const res = await window.dmx.pickOpenRoomFile();
              if (res.success && res.data) {
                const { filePath } = res.data as { filePath: string; data: any };
                setSwitching(true);
                // Flush current room first
                const currentPath = useRoomFileStore.getState().filePath;
                if (currentPath && typeof window.dmx !== 'undefined') {
                  await window.dmx.saveRoomFile(currentPath, buildCurrentRoomFile());
                }
                const ps = usePlaylistStore.getState();
                ps.setPlaybackState('stopped');
                ps.setPalettePlaybackState('stopped');
                ps.setHsbPlaybackState('stopped');
                await loadRoomFromFile(filePath);
                setSwitching(false);
                onClose();
              }
            }}
          >
            Browse for file…
          </button>
        </div>
      </div>
    </div>
  );
}
