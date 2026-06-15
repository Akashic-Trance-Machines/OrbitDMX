import React from 'react';
import type { AppView } from '../App';
import './Sidebar.css';

interface SidebarProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
  roomFileName?: string;
  isDirty?: boolean;
  onOpenRoomPicker?: () => void;
  /** Show the OrbitBridgeDeck nav entry under Controls. */
  isOrbitBridgeDeckConnected?: boolean;
}

const NAV_ITEMS: { id: AppView; label: string; icon: string }[] = [
  { id: 'room',      label: 'Room',      icon: '⬡' },
  { id: 'scenes',    label: 'Scenes',    icon: '◈' },
  { id: 'playlists', label: 'Playlists', icon: '▶' },
  { id: 'controls',  label: 'Controls',  icon: '⊞' },
  { id: 'fx',        label: 'FX',        icon: '✦' },
  { id: 'colours',   label: 'Colours',   icon: '◉' },
];

export default function Sidebar({ activeView, onNavigate, roomFileName, isDirty, onOpenRoomPicker, isOrbitBridgeDeckConnected }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="sidebar-logo-icon">✦</span>
        <span className="sidebar-logo-text">OrbitDMX</span>
      </div>

      {/* Room file indicator — click to switch rooms */}
      {roomFileName && (
        <button
          className="sidebar-room-file"
          title="Switch room…"
          onClick={onOpenRoomPicker}
        >
          <span className="sidebar-room-name">{roomFileName}</span>
          {isDirty
            ? <span className="sidebar-room-dirty">●</span>
            : <span className="sidebar-room-chevron">›</span>}
        </button>
      )}

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <React.Fragment key={item.id}>
            <button
              id={`nav-${item.id}`}
              className={`sidebar-nav-item ${activeView === item.id ? 'active' : ''}`}
              onClick={() => onNavigate(item.id)}
            >
              <span className="sidebar-nav-icon">{item.icon}</span>
              <span className="sidebar-nav-label">{item.label}</span>
            </button>

            {/* OrbitBridgeDeck appears right after Controls when connected */}
            {item.id === 'controls' && isOrbitBridgeDeckConnected && (
              <button
                id="nav-orbit-bridge-deck"
                className={`sidebar-nav-item sidebar-nav-sub ${activeView === 'orbit-bridge-deck' ? 'active' : ''}`}
                onClick={() => onNavigate('orbit-bridge-deck')}
                title="OrbitBridgeDeck MIDI configuration"
              >
                <span className="sidebar-nav-icon sidebar-nav-icon-hw">◎</span>
                <span className="sidebar-nav-label">
                  OrbitBridgeDeck
                  <span className="sidebar-hw-dot" />
                </span>
              </button>
            )}
            {item.id === 'controls' && (
              <button
                id="nav-obd-standalone"
                className={`sidebar-nav-item sidebar-nav-sub ${activeView === 'obd-standalone' ? 'active' : ''}`}
                onClick={() => onNavigate('obd-standalone')}
                title="OBD standalone control configuration"
              >
                <span className="sidebar-nav-icon sidebar-nav-icon-hw">⬡</span>
                <span className="sidebar-nav-label">OBD Standalone</span>
              </button>
            )}
          </React.Fragment>
        ))}
      </nav>

      {/* Footer: version + settings gear */}
      <div className="sidebar-footer">
        <button
          id="nav-settings"
          className={`sidebar-nav-item sidebar-settings-btn ${activeView === 'settings' ? 'active' : ''}`}
          onClick={() => onNavigate('settings')}
          title="Settings"
        >
          <span className="sidebar-nav-icon">⚙</span>
          <span className="sidebar-nav-label">Settings</span>
        </button>
        <div className="sidebar-version text-muted mono">v{__APP_VERSION__}</div>
      </div>
    </aside>
  );
}
