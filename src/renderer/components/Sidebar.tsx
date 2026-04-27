import React from 'react';
import type { AppView } from '../App';
import './Sidebar.css';

interface SidebarProps {
  activeView: AppView;
  onNavigate: (view: AppView) => void;
}

const NAV_ITEMS: { id: AppView; label: string; icon: string }[] = [
  { id: 'room',      label: 'Room',      icon: '⬡' },
  { id: 'scenes',    label: 'Scenes',    icon: '◈' },
  { id: 'playlists', label: 'Playlists', icon: '▶' },
  { id: 'fx',        label: 'FX',        icon: '✦' },
];

export default function Sidebar({ activeView, onNavigate }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="sidebar-logo-icon">✦</span>
        <span className="sidebar-logo-text">OrbitDMX</span>
      </div>

      <nav className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.id}
            id={`nav-${item.id}`}
            className={`sidebar-nav-item ${activeView === item.id ? 'active' : ''}`}
            onClick={() => onNavigate(item.id)}
          >
            <span className="sidebar-nav-icon">{item.icon}</span>
            <span className="sidebar-nav-label">{item.label}</span>
          </button>
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
        <div className="sidebar-version text-muted mono">v0.1.0</div>
      </div>
    </aside>
  );
}
