import React, { useState, useEffect, useCallback } from 'react';
import type { SerialPortInfo } from '../../shared/types';
import { useSerialStore } from '../store/useSerialStore';
import { useMidiStore } from '../store/useMidiStore';
import './SettingsView.css';

export default function SettingsView() {
  const [ports, setPorts] = useState<SerialPortInfo[]>([]);
  const [scanning, setScanning] = useState(false);
  const [selectedPort, setSelectedPort] = useState<string>('');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  // Read connection state from the global store (kept alive by App.tsx)
  const status = useSerialStore((s) => s.status);
  const connectedPort = useSerialStore((s) => s.connectedPort);
  const setConnectedPort = useSerialStore((s) => s.setConnectedPort);

  const isConnected = status === 'connected';
  const isConnecting = status === 'connecting';

  // When navigating back to Settings, pre-select the active port
  useEffect(() => {
    if (connectedPort) setSelectedPort(connectedPort);
  }, [connectedPort]);

  const scanPorts = useCallback(async () => {
    setScanning(true);
    setErrorMsg(null);
    try {
      if (typeof window.dmx === 'undefined') {
        // Dev preview — simulate a port list
        await new Promise((r) => setTimeout(r, 600));
        setPorts([{ path: '/dev/cu.usbserial-0001', manufacturer: 'FTDI', serialNumber: 'A1B2C3' }]);
        return;
      }
      const result = await window.dmx.listPorts();
      if (result.success) {
        setPorts((result.data as SerialPortInfo[]) ?? []);
      } else {
        setErrorMsg(result.error ?? 'Failed to list ports');
      }
    } finally {
      setScanning(false);
    }
  }, []);

  // Auto-scan on mount
  useEffect(() => { scanPorts(); }, []);

  const handleConnect = async () => {
    if (!selectedPort) return;
    setErrorMsg(null);
    try {
      if (typeof window.dmx === 'undefined') {
        // Dev preview
        useSerialStore.getState().setStatus('connecting');
        await new Promise((r) => setTimeout(r, 800));
        useSerialStore.getState().setStatus('connected');
        setConnectedPort(selectedPort);
        return;
      }
      const result = await window.dmx.connect(selectedPort);
      if (!result.success) {
        setErrorMsg(result.error ?? 'Connection failed');
      } else {
        // The push event from main will update the store status.
        // Also record which port we connected to.
        setConnectedPort(selectedPort);
      }
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  const handleDisconnect = async () => {
    setErrorMsg(null);
    try {
      if (typeof window.dmx !== 'undefined') {
        await window.dmx.disconnect();
      }
      setConnectedPort(null);
    } catch (e) {
      setErrorMsg(String(e));
    }
  };

  return (
    <div className="settings-view">
      <div className="settings-header">
        <h1>Settings</h1>
      </div>

      <div className="settings-content">

        {/* DMX Adapter section */}
        <section className="settings-section" id="section-dmx-adapter">
          <div className="settings-section-header">
            <h2>DMX Adapter</h2>
            <p className="settings-section-desc">
              Select the USB-to-DMX dongle (Enttec Open DMX compatible).
            </p>
          </div>

          {/* Connection status badge */}
          <div className={`connection-status status-${status}`}>
            <span className="status-dot" />
            <span className="status-label">
              {status === 'connected'    && `Connected — ${connectedPort ?? selectedPort}`}
              {status === 'connecting'   && 'Connecting…'}
              {status === 'disconnected' && 'No adapter connected'}
              {status === 'error'        && 'Connection error'}
            </span>
          </div>

          {/* Port selector row */}
          <div className="port-selector-row">
            <div className="port-select-wrap">
              <select
                id="select-serial-port"
                className="form-select"
                value={selectedPort}
                onChange={(e) => setSelectedPort(e.target.value)}
                disabled={isConnected || isConnecting}
              >
                <option value="">— Select a port —</option>
                {ports.map((p) => (
                  <option key={p.path} value={p.path}>
                    {p.path}
                    {p.manufacturer ? ` · ${p.manufacturer}` : ''}
                    {p.serialNumber  ? ` [${p.serialNumber}]`  : ''}
                  </option>
                ))}
              </select>
            </div>

            <button
              id="btn-scan-ports"
              className="btn-icon"
              title="Refresh port list"
              onClick={scanPorts}
              disabled={scanning || isConnecting}
            >
              <span className={scanning ? 'spin' : ''}>↺</span>
            </button>

            {!isConnected ? (
              <button
                id="btn-connect"
                className="btn-primary"
                onClick={handleConnect}
                disabled={!selectedPort || isConnecting}
              >
                {isConnecting ? 'Connecting…' : 'Connect'}
              </button>
            ) : (
              <button
                id="btn-disconnect"
                className="btn-danger"
                onClick={handleDisconnect}
              >
                Disconnect
              </button>
            )}
          </div>

          {/* No ports found */}
          {!scanning && ports.length === 0 && (
            <div className="ports-empty">
              <span>No serial ports found.</span>
              <span className="text-muted"> Make sure the USB adapter is plugged in.</span>
            </div>
          )}

          {/* Port list cards */}
          {ports.length > 0 && (
            <div className="port-list">
              {ports.map((p) => (
                <button
                  key={p.path}
                  id={`port-card-${p.path.replace(/[^a-z0-9]/gi, '-')}`}
                  className={`port-card ${selectedPort === p.path ? 'selected' : ''} ${isConnected && connectedPort === p.path ? 'connected' : ''}`}
                  onClick={() => !isConnected && setSelectedPort(p.path)}
                  disabled={isConnected}
                >
                  <div className="port-card-icon">
                    {isConnected && connectedPort === p.path ? '🟢' : '🔌'}
                  </div>
                  <div className="port-card-info">
                    <span className="port-card-path mono">{p.path}</span>
                    {(p.manufacturer || p.serialNumber) && (
                      <span className="port-card-meta">
                        {[p.manufacturer, p.serialNumber].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </div>
                  {selectedPort === p.path && !isConnected && (
                    <span className="port-card-badge">selected</span>
                  )}
                </button>
              ))}
            </div>
          )}

          {/* Error */}
          {errorMsg && (
            <div className="settings-error">
              ⚠ {errorMsg}
            </div>
          )}
        </section>

        {/* MIDI Devices section */}
        <section className="settings-section" id="section-midi">
          <div className="settings-section-header">
            <h2>MIDI Devices</h2>
            <p className="settings-section-desc">
              Connected MIDI input devices for the Controls page.
            </p>
          </div>

          <MidiDeviceList />
        </section>

        {/* Show file section */}
        <section className="settings-section" id="section-show-file">
          <div className="settings-section-header">
            <h2>Show File</h2>
            <p className="settings-section-desc">
              Export or import a portable <code>.orbitshow</code> bundle containing all fixtures, scenes, playlists, controls, and rig definitions.
            </p>
          </div>
          <div className="port-selector-row">
            <button className="btn-primary" onClick={() => window.dispatchEvent(new CustomEvent('menu:export-show'))}>
              📦 Export Show…
            </button>
            <button className="btn-primary" onClick={() => window.dispatchEvent(new CustomEvent('menu:import-show'))}>
              📂 Import Show…
            </button>
          </div>
        </section>

        {/* About section */}
        <section className="settings-section" id="section-about">
          <div className="settings-section-header">
            <h2>About</h2>
          </div>
          <div className="about-item">
            <span className="about-label">Software</span>
            <span className="about-value">OrbitDMX Controller</span>
          </div>
          <div className="about-row">
            <span className="about-label">Version</span>
            <span className="about-value mono">v{__APP_VERSION__}</span>
          </div>
          <div className="about-row">
            <span className="about-label">Protocol</span>
            <span className="about-value">Enttec Open DMX USB (512 ch)</span>
          </div>
        </section>

      </div>
    </div>
  );
}

/* ── MIDI Device List sub-component ───────────────────────────────────────── */

function MidiDeviceList() {
  const devices = useMidiStore((s) => s.devices);
  const isListening = useMidiStore((s) => s.isListening);
  const lastMessage = useMidiStore((s) => s.lastMessage);

  return (
    <div>
      <div className={`connection-status ${isListening ? 'status-connected' : 'status-disconnected'}`}>
        <span className="status-dot" />
        <span className="status-label">
          {isListening
            ? `Listening — ${devices.length} device(s) found`
            : 'Web MIDI not available'}
        </span>
      </div>

      {devices.length > 0 && (
        <div className="port-list">
          {devices.map((d) => (
            <div key={d.id} className="port-card connected" style={{ cursor: 'default' }}>
              <div className="port-card-icon">🎹</div>
              <div className="port-card-info">
                <span className="port-card-path">{d.name}</span>
                <span className="port-card-meta mono">{d.id}</span>
              </div>
            </div>
          ))}
        </div>
      )}

      {devices.length === 0 && isListening && (
        <div className="ports-empty">
          <span>No MIDI input devices detected.</span>
          <span className="text-muted">Connect a MIDI controller via USB.</span>
        </div>
      )}

      {lastMessage && (
        <div style={{ marginTop: 8, fontSize: 11, color: 'var(--color-text-muted)', fontFamily: 'var(--font-mono)' }}>
          Last: CH {lastMessage.channel} / CC {lastMessage.cc} = {lastMessage.value}
        </div>
      )}
    </div>
  );
}
