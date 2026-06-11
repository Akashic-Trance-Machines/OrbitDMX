import React, { useState, useEffect } from 'react';
import Sidebar from './components/Sidebar';
import RoomPickerModal from './components/RoomPickerModal';
import RoomView from './pages/RoomView';
import SceneView from './pages/SceneView';
import PlaylistView from './pages/PlaylistView';
import ControlsView from './pages/ControlsView';
import FxView from './pages/FxView';
import SettingsView from './pages/SettingsView';
import ColoursView from './pages/ColoursView';
import OrbitBridgeDeckView from './pages/OrbitBridgeDeckView';
import StatusBar from './components/StatusBar';
import { useSerialStore } from './store/useSerialStore';
import { useRoomStore } from './store/useRoomStore';
import { useRoomFileStore } from './store/useRoomFileStore';
import { useHistoryStore } from './store/useHistoryStore';
import { useSceneStore } from './store/useSceneStore';
import { usePlaylistStore } from './store/usePlaylistStore';
import { useMidiStore } from './store/useMidiStore';
import { usePlaylistRunner } from './hooks/usePlaylistRunner';
import { usePalettePlaylistRunner } from './hooks/usePalettePlaylistRunner';
import { useHsbPlaylistRunner } from './hooks/useHsbPlaylistRunner';
import { useMidiListener } from './hooks/useMidiListener';
import { useAutosave, loadRoomFromFile, newRoom, buildCurrentRoomFile } from './hooks/useAutosave';
import type { FixtureInstance } from '../shared/types';
import './styles/app.css';

export type AppView = 'room' | 'scenes' | 'playlists' | 'controls' | 'orbit-bridge-deck' | 'fx' | 'colours' | 'settings';

import { useFxStore } from './store/useFxStore';

export default function App() {
  const [activeView, setActiveView] = useState<AppView>('room');
  const [showRoomPicker, setShowRoomPicker] = useState(false);
  const { setStatus, setConnectedPort } = useSerialStore();
  const fixtures = useRoomStore((s) => s.fixtures);
  const roomFileName = useRoomFileStore((s) => s.fileName);
  const isDirty = useRoomFileStore((s) => s.isDirty);
  const isOrbitBridgeDeckConnected = useMidiStore((s) => s.isOrbitBridgeDeckConnected);

  // ── App-level playlist runner (survives page navigation) ──────────────
  usePlaylistRunner();

  // ── App-level palette generator runner (survives page navigation) ──────
  usePalettePlaylistRunner();

  // ── App-level HSB generator runner (survives page navigation) ─────────────
  useHsbPlaylistRunner();

  // ── App-level MIDI listener (survives page navigation) ────────────────
  useMidiListener();

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
      // Clear port reference only on a final disconnect or error — not during
      // auto-reconnect (status='reconnecting'), so the UI can still show the port name.
      if (status === 'disconnected' || status === 'error') {
        setConnectedPort(null);
      }
    });

    return cleanup;
  }, []);

  // ── App-level FX LED address sync ─────────────────────────────────────
  // Re-sync ALL FX types whenever fixtures or any per-type target changes
  const fxStates = useFxStore((s) => s.fxStates);
  useEffect(() => {
    useFxStore.getState().syncAllLedAddresses(fixtures);
  }, [fixtures, fxStates]);

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

    async function handleMenuExportShow() {
      if (typeof window.dmx === 'undefined') return;
      const data = buildCurrentRoomFile();
      // Gather all referenced profiles
      const profileIds = new Set(data.room.fixtures.map((f) => f.profileId));
      const { FIXTURE_PROFILES } = await import('../fixtures');
      const fixtureProfiles = FIXTURE_PROFILES.filter((r) => profileIds.has(r.id));
      await window.dmx.exportShow(data, fixtureProfiles);
    }

    async function handleMenuImportShow() {
      if (typeof window.dmx === 'undefined') return;
      const res = await window.dmx.importShow();
      if (res.success && res.data) {
        const showFile = res.data as any;
        // Load room data directly into stores
        useRoomStore.getState().setFixtures(showFile.room.fixtures ?? []);
        if (showFile.room.floorPlan) {
          useRoomStore.getState().setFloorPlan(showFile.room.floorPlan);
        }
        useSceneStore.getState().setScenes(showFile.room.scenes ?? []);
        usePlaylistStore.getState().setPlaylists(showFile.room.playlists ?? []);
        const { useControlsStore } = await import('./store/useControlsStore');
        useControlsStore.getState().setControls(showFile.room.controls?.widgets ?? []);
        useHistoryStore.getState().clear();

        useRoomFileStore.getState().setFileName(showFile.room.name || 'Imported Show');
        useRoomFileStore.getState().setIsDirty(true);
      }
    }

    window.addEventListener('menu:new-room', handleMenuNewRoom);
    window.addEventListener('menu:open-room', handleMenuOpenRoom);
    window.addEventListener('menu:save-as', handleMenuSaveAs);
    window.addEventListener('menu:undo', handleMenuUndo);
    window.addEventListener('menu:redo', handleMenuRedo);
    window.addEventListener('menu:export-show', handleMenuExportShow);
    window.addEventListener('menu:import-show', handleMenuImportShow);

    return () => {
      window.removeEventListener('menu:new-room', handleMenuNewRoom);
      window.removeEventListener('menu:open-room', handleMenuOpenRoom);
      window.removeEventListener('menu:save-as', handleMenuSaveAs);
      window.removeEventListener('menu:undo', handleMenuUndo);
      window.removeEventListener('menu:redo', handleMenuRedo);
      window.removeEventListener('menu:export-show', handleMenuExportShow);
      window.removeEventListener('menu:import-show', handleMenuImportShow);
    };
  }, []);

  return (
    <div className="app-shell">
      <Sidebar
        activeView={activeView}
        onNavigate={setActiveView}
        roomFileName={roomFileName}
        isDirty={isDirty}
        onOpenRoomPicker={() => setShowRoomPicker(true)}
        isOrbitBridgeDeckConnected={isOrbitBridgeDeckConnected}
      />
      <main className="app-main">
        {activeView === 'room'               && <RoomView />}
        {activeView === 'scenes'              && <SceneView />}
        {activeView === 'playlists'           && <PlaylistView />}
        {activeView === 'controls'            && <ControlsView />}
        {activeView === 'orbit-bridge-deck'   && <OrbitBridgeDeckView />}
        {activeView === 'fx'                  && <FxView />}
        {activeView === 'colours'             && <ColoursView />}
        {activeView === 'settings'            && <SettingsView />}
      </main>
      <StatusBar onNavigate={setActiveView} />
      {showRoomPicker && (
        <RoomPickerModal onClose={() => setShowRoomPicker(false)} />
      )}
    </div>
  );
}
