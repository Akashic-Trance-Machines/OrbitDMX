import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import RoomView from './pages/RoomView';
import SceneView from './pages/SceneView';
import PlaylistView from './pages/PlaylistView';
import FxView from './pages/FxView';
import SettingsView from './pages/SettingsView';
import StatusBar from './components/StatusBar';
import { useSerialStore } from './store/useSerialStore';
import { useRoomStore } from './store/useRoomStore';
import { useRoomFileStore } from './store/useRoomFileStore';
import { useHistoryStore } from './store/useHistoryStore';
import { useSceneStore } from './store/useSceneStore';
import { usePlaylistStore } from './store/usePlaylistStore';
import { usePlaylistRunner } from './hooks/usePlaylistRunner';
import { useAutosave, loadRoomFromFile, newRoom, buildCurrentRoomFile } from './hooks/useAutosave';
import { getRigById } from '../rigs';
import type { FixtureInstance, LedAddress } from '../shared/types';
import './styles/app.css';

export type AppView = 'room' | 'scenes' | 'playlists' | 'fx' | 'settings';

/** Extract all LED RGB address triplets from the fixture list for the FX engine. */
function collectLedAddresses(fixtures: FixtureInstance[]): LedAddress[] {
  const addresses: LedAddress[] = [];
  for (const f of fixtures) {
    const rig = getRigById(f.rigId);
    const personality = rig?.personalities.find((p) => p.name === f.personalityName);
    if (!personality) continue;

    const channels = personality.channels;
    const reds   = channels.filter((c) => c.type === 'red');
    const greens = channels.filter((c) => c.type === 'green');
    const blues  = channels.filter((c) => c.type === 'blue');

    if (reds.length > 0 && reds.length === greens.length && reds.length === blues.length) {
      for (let i = 0; i < reds.length; i++) {
        addresses.push({
          r: f.startAddress + reds[i].offset,
          g: f.startAddress + greens[i].offset,
          b: f.startAddress + blues[i].offset,
        });
      }
    }
  }
  return addresses;
}

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('room');
  const { setStatus, setConnectedPort } = useSerialStore();
  const fixtures = useRoomStore((s) => s.fixtures);
  const roomFileName = useRoomFileStore((s) => s.fileName);
  const isDirty = useRoomFileStore((s) => s.isDirty);

  // ── App-level playlist runner (survives page navigation) ──────────────
  usePlaylistRunner();

  // ── App-level autosave + undo/redo ────────────────────────────────────
  useAutosave();

  // ── App-level serial status subscription ──────────────────────────────
  useEffect(() => {
    if (typeof window.dmx === 'undefined') return;

    window.dmx.getSerialStatus().then((res) => {
      if (res.success && res.data) {
        setStatus(res.data.status);
        setConnectedPort(res.data.port);
      }
    });

    const cleanup = window.dmx.onSerialStatus((status) => {
      setStatus(status);
      if (status === 'disconnected' || status === 'error') {
        setConnectedPort(null);
      }
    });

    return cleanup;
  }, []);

  // ── App-level FX LED address sync ─────────────────────────────────────
  useEffect(() => {
    if (typeof window.dmx === 'undefined') return;
    const addrs = collectLedAddresses(fixtures);
    window.dmx.setFxLedAddresses(addrs);
  }, [fixtures]);

  // ── Menu actions via custom DOM events dispatched from preload ──────────
  useEffect(() => {
    async function handleMenuNewRoom() {
      await newRoom();
    }

    async function handleMenuOpenRoom() {
      if (typeof window.dmx === 'undefined') return;
      const res = await window.dmx.pickOpenRoomFile();
      if (res.success && res.data) {
        const { filePath } = res.data as { filePath: string };
        await loadRoomFromFile(filePath);
      }
    }

    async function handleMenuSaveAs() {
      if (typeof window.dmx === 'undefined') return;
      const data = buildCurrentRoomFile();
      const res = await window.dmx.pickSaveAsRoomFile(data);
      if (res.success && res.data) {
        const filePath = res.data as string;
        const fileName = filePath.split('/').pop()?.replace('.orbitdmx', '') ?? 'Untitled Room';
        useRoomFileStore.getState().setFilePath(filePath);
        useRoomFileStore.getState().setFileName(fileName);
        useRoomFileStore.getState().setIsDirty(false);
      }
    }

    // Undo/redo from menu — synthesize the keyboard event that useAutosave handles
    function handleMenuUndo() {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true }));
    }
    function handleMenuRedo() {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'z', metaKey: true, shiftKey: true }));
    }

    window.addEventListener('menu:new-room', handleMenuNewRoom);
    window.addEventListener('menu:open-room', handleMenuOpenRoom);
    window.addEventListener('menu:save-as', handleMenuSaveAs);
    window.addEventListener('menu:undo', handleMenuUndo);
    window.addEventListener('menu:redo', handleMenuRedo);

    return () => {
      window.removeEventListener('menu:new-room', handleMenuNewRoom);
      window.removeEventListener('menu:open-room', handleMenuOpenRoom);
      window.removeEventListener('menu:save-as', handleMenuSaveAs);
      window.removeEventListener('menu:undo', handleMenuUndo);
      window.removeEventListener('menu:redo', handleMenuRedo);
    };
  }, []);

  return (
    <div className="app-shell">
      <Sidebar
        activeView={activeView}
        onNavigate={setActiveView}
        roomFileName={roomFileName}
        isDirty={isDirty}
      />
      <main className="app-main">
        {activeView === 'room'      && <RoomView />}
        {activeView === 'scenes'    && <SceneView />}
        {activeView === 'playlists' && <PlaylistView />}
        {activeView === 'fx'        && <FxView />}
        {activeView === 'settings'  && <SettingsView />}
      </main>
      <StatusBar />
    </div>
  );
}
