import { useEffect, useRef, useCallback } from 'react';
import { useRoomStore } from '../store/useRoomStore';
import { useSceneStore } from '../store/useSceneStore';
import { usePlaylistStore } from '../store/usePlaylistStore';
import { useHistoryStore, type RoomSnapshot } from '../store/useHistoryStore';
import { useRoomFileStore } from '../store/useRoomFileStore';
import type { RoomFile } from '../../shared/types';

const AUTOSAVE_DEBOUNCE_MS = 500;

/** Build a RoomFile from current store state. */
function buildRoomFile(): RoomFile {
  const { fixtures, floorPlan } = useRoomStore.getState();
  const { scenes } = useSceneStore.getState();
  const { playlists } = usePlaylistStore.getState();
  const { fileName } = useRoomFileStore.getState();

  return {
    orbitdmx: '1.0',
    room: {
      id: 'default',
      name: fileName.replace('.orbitdmx', ''),
      fixtures,
      floorPlan,
      scenes,
      playlists,
    },
  };
}

/** Build a RoomSnapshot for undo/redo. */
function buildSnapshot(): RoomSnapshot {
  const { fixtures, floorPlan } = useRoomStore.getState();
  const { scenes } = useSceneStore.getState();
  const { playlists } = usePlaylistStore.getState();
  return { fixtures, scenes, playlists, floorPlan };
}

/** Restore a RoomSnapshot to all stores. */
function restoreSnapshot(snap: RoomSnapshot): void {
  useRoomStore.getState().setFixtures(snap.fixtures);
  useRoomStore.getState().setFloorPlan(snap.floorPlan);
  useSceneStore.getState().setScenes(snap.scenes);
  usePlaylistStore.getState().setPlaylists(snap.playlists);
}

/** Serialize a snapshot for deep comparison. */
function snapshotKey(snap: RoomSnapshot): string {
  return JSON.stringify({
    f: snap.fixtures,
    s: snap.scenes,
    p: snap.playlists,
    fp: snap.floorPlan,
  });
}

/**
 * App-level hook that:
 * 1. Loads the last-used room file on mount (or migrates localStorage data).
 * 2. Debounced autosaves every mutation to the active file.
 * 3. Pushes undo snapshots before each save.
 * 4. Listens for Cmd+Z / Cmd+Shift+Z for undo/redo.
 */
export function useAutosave() {
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastKeyRef = useRef<string>('');
  const isRestoringRef = useRef(false);
  const initializedRef = useRef(false);

  // ── Persist to disk ────────────────────────────────────────────────────
  const saveToDisk = useCallback(async () => {
    const { filePath } = useRoomFileStore.getState();
    if (!filePath) return;
    if (typeof window.dmx === 'undefined') return;

    const data = buildRoomFile();
    const result = await window.dmx.saveRoomFile(filePath, data);
    if (result.success) {
      useRoomFileStore.getState().setIsDirty(false);
    }
  }, []);

  // ── Load file on mount ─────────────────────────────────────────────────
  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;

    (async () => {
      if (typeof window.dmx === 'undefined') return;

      // Try to load the last-used file
      const lastPathRes = await window.dmx.getLastFilePath();
      const lastPath = lastPathRes.success ? (lastPathRes.data as string | null) : null;

      if (lastPath) {
        const loadRes = await window.dmx.loadRoomFile(lastPath);
        if (loadRes.success && loadRes.data) {
          const roomFile = loadRes.data as RoomFile;
          isRestoringRef.current = true;
          useRoomStore.getState().setFixtures(roomFile.room.fixtures ?? []);
          if (roomFile.room.floorPlan) {
            useRoomStore.getState().setFloorPlan(roomFile.room.floorPlan);
          }
          useSceneStore.getState().setScenes(roomFile.room.scenes ?? []);
          usePlaylistStore.getState().setPlaylists(roomFile.room.playlists ?? []);

          const fileName = lastPath.split('/').pop()?.replace('.orbitdmx', '') ?? 'Untitled Room';
          useRoomFileStore.getState().setFilePath(lastPath);
          useRoomFileStore.getState().setFileName(fileName);
          useRoomFileStore.getState().setIsDirty(false);

          lastKeyRef.current = snapshotKey(buildSnapshot());
          isRestoringRef.current = false;
          return;
        }
      }

      // No last file — check for localStorage migration
      const migrateRoom = localStorage.getItem('ayra-room-store');
      const migrateScene = localStorage.getItem('ayra-scene-store');
      const migratePlaylist = localStorage.getItem('ayra-playlist-store');

      if (migrateRoom || migrateScene || migratePlaylist) {
        try {
          isRestoringRef.current = true;
          if (migrateRoom) {
            const parsed = JSON.parse(migrateRoom);
            if (parsed.state?.fixtures) {
              useRoomStore.getState().setFixtures(parsed.state.fixtures);
            }
          }
          if (migrateScene) {
            const parsed = JSON.parse(migrateScene);
            if (parsed.state?.scenes) {
              useSceneStore.getState().setScenes(parsed.state.scenes);
            }
          }
          if (migratePlaylist) {
            const parsed = JSON.parse(migratePlaylist);
            if (parsed.state?.playlists) {
              usePlaylistStore.getState().setPlaylists(parsed.state.playlists);
            }
          }
          // Clear old localStorage
          localStorage.removeItem('ayra-room-store');
          localStorage.removeItem('ayra-scene-store');
          localStorage.removeItem('ayra-playlist-store');

          // Save to default file
          const defaultPathRes = await window.dmx.getDefaultPath();
          const defaultDir = defaultPathRes.data as string;
          const defaultFile = `${defaultDir}/Untitled.orbitdmx`;

          useRoomFileStore.getState().setFilePath(defaultFile);
          useRoomFileStore.getState().setFileName('Untitled Room');

          lastKeyRef.current = snapshotKey(buildSnapshot());
          isRestoringRef.current = false;
          await saveToDisk();
          return;
        } catch {
          // Migration failed — proceed with empty state
        }
        isRestoringRef.current = false;
      }

      // Completely fresh: set up default file path
      const defaultPathRes = await window.dmx.getDefaultPath();
      const defaultDir = defaultPathRes.data as string;
      const defaultFile = `${defaultDir}/Untitled.orbitdmx`;
      useRoomFileStore.getState().setFilePath(defaultFile);
      lastKeyRef.current = snapshotKey(buildSnapshot());
    })();
  }, [saveToDisk]);

  // ── Subscribe to store changes → debounced autosave ────────────────────
  useEffect(() => {
    const unsubs = [
      useRoomStore.subscribe(() => scheduleAutosave()),
      useSceneStore.subscribe(() => scheduleAutosave()),
      usePlaylistStore.subscribe(() => scheduleAutosave()),
    ];

    function scheduleAutosave() {
      if (isRestoringRef.current) return;

      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => {
        const snap = buildSnapshot();
        const key = snapshotKey(snap);
        if (key === lastKeyRef.current) return; // no actual change

        // Push undo snapshot (the PREVIOUS state)
        // The previous state is what lastKeyRef represents
        // We need to push the old snapshot before updating
        const oldSnap = JSON.parse(lastKeyRef.current) as { f: any; s: any; p: any; fp: any };
        useHistoryStore.getState().push({
          fixtures: oldSnap.f,
          scenes: oldSnap.s,
          playlists: oldSnap.p,
          floorPlan: oldSnap.fp,
        });

        lastKeyRef.current = key;
        useRoomFileStore.getState().setIsDirty(true);
        saveToDisk();
      }, AUTOSAVE_DEBOUNCE_MS);
    }

    return () => unsubs.forEach((u) => u());
  }, [saveToDisk]);

  // ── Undo / Redo keyboard handler ───────────────────────────────────────
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent) {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.key.toLowerCase() !== 'z') return;

      e.preventDefault();
      const current = buildSnapshot();

      if (e.shiftKey) {
        // Redo
        const next = useHistoryStore.getState().redo(current);
        if (next) {
          isRestoringRef.current = true;
          restoreSnapshot(next);
          lastKeyRef.current = snapshotKey(next);
          isRestoringRef.current = false;
          saveToDisk();
        }
      } else {
        // Undo
        const prev = useHistoryStore.getState().undo(current);
        if (prev) {
          isRestoringRef.current = true;
          restoreSnapshot(prev);
          lastKeyRef.current = snapshotKey(prev);
          isRestoringRef.current = false;
          saveToDisk();
        }
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [saveToDisk]);
}

/**
 * Load a room file from a path into all stores.
 * Used by the File → Open flow.
 */
export async function loadRoomFromFile(filePath: string): Promise<boolean> {
  if (typeof window.dmx === 'undefined') return false;

  const res = await window.dmx.loadRoomFile(filePath);
  if (!res.success || !res.data) return false;

  const roomFile = res.data as RoomFile;
  useRoomStore.getState().setFixtures(roomFile.room.fixtures ?? []);
  if (roomFile.room.floorPlan) {
    useRoomStore.getState().setFloorPlan(roomFile.room.floorPlan);
  }
  useSceneStore.getState().setScenes(roomFile.room.scenes ?? []);
  usePlaylistStore.getState().setPlaylists(roomFile.room.playlists ?? []);

  const fileName = filePath.split('/').pop()?.replace('.orbitdmx', '') ?? 'Untitled Room';
  useRoomFileStore.getState().setFilePath(filePath);
  useRoomFileStore.getState().setFileName(fileName);
  useRoomFileStore.getState().setIsDirty(false);
  useHistoryStore.getState().clear();

  return true;
}

/**
 * Create a new empty room.
 */
export async function newRoom(): Promise<void> {
  useRoomStore.getState().setFixtures([]);
  useRoomStore.getState().setFloorPlan({ widthM: 10, depthM: 8 });
  useSceneStore.getState().setScenes([]);
  usePlaylistStore.getState().setPlaylists([]);
  useHistoryStore.getState().clear();

  if (typeof window.dmx !== 'undefined') {
    const defaultPathRes = await window.dmx.getDefaultPath();
    const defaultDir = defaultPathRes.data as string;
    const defaultFile = `${defaultDir}/Untitled.orbitdmx`;
    useRoomFileStore.getState().setFilePath(defaultFile);
  }
  useRoomFileStore.getState().setFileName('Untitled Room');
  useRoomFileStore.getState().setIsDirty(false);
}

/**
 * Build and return the current RoomFile for save-as / export.
 */
export function buildCurrentRoomFile(): RoomFile {
  return buildRoomFile();
}
