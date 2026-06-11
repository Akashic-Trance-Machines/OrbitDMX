/**
 * obdPushHandlers.ts — IPC handlers for Push-to-OBD
 *
 * Compiles the current room into an .osb binary and uploads it to the
 * connected OrbitBridgeDeck via the CDC serial port.
 *
 * The upload reuses the existing serial connection managed by the DmxEngine's
 * worker thread. We pause DMX output briefly, send the show data using the
 * Enttec-framed show upload protocol, then resume DMX.
 */

import { ipcMain, BrowserWindow } from 'electron';
import { IPC } from '../../shared/ipcChannels';
import { compileShow } from '../../shared/osbExporter';
import type { IpcResponse, ShowFile, RoomFile, FixtureProfile } from '../../shared/types';
import type { DmxEngine } from '../dmx/DmxEngine';

/**
 * Register IPC handlers for OBD show push.
 *
 * @param engine  The active DmxEngine (needed for serial port access)
 * @param webContents  Getter for the renderer webContents (for progress push)
 */
export function registerObdPushHandlers(
  engine: DmxEngine,
  webContents: () => Electron.WebContents | null,
): void {

  // ── Push Show to OBD ──────────────────────────────────────────────────
  ipcMain.handle(IPC.OBD_PUSH_SHOW, async (
    _event,
    roomData: RoomFile,
    fixtureProfiles: FixtureProfile[],
    bpm: number,
  ): Promise<IpcResponse> => {
    try {
      const wc = webContents();

      // 1. Build the ShowFile
      const showFile: ShowFile = {
        orbitshow: '1.0',
        room: roomData.room,
        fixtureProfiles,
      };

      // 2. Compile to .osb binary
      const showName = roomData.room.name || 'Untitled';
      const osbData = compileShow(showFile, {
        name: showName,
        bpm: bpm || 120,
      });

      console.log(`[OBD] Compiled show "${showName}" → ${osbData.length} bytes`);

      // Debug: inspect the room data going into the compiler
      console.log(`[OBD] Room: ${roomData.room.fixtures.length} fixtures, ${roomData.room.scenes.length} scenes, ${roomData.room.playlists.length} playlists`);
      for (const scene of roomData.room.scenes) {
        const nonZero = scene.values.filter((v: number) => v !== 0 && v !== undefined).length;
        console.log(`[OBD]   Scene "${scene.name}": ${nonZero} non-zero channels`);
        // Print first few non-zero values
        const samples: string[] = [];
        for (let i = 0; i < scene.values.length && samples.length < 8; i++) {
          if (scene.values[i] !== 0 && scene.values[i] !== undefined) {
            samples.push(`ch${i + 1}=${scene.values[i]}`);
          }
        }
        if (samples.length > 0) console.log(`[OBD]     first values: ${samples.join(', ')}`);
      }
      for (const pl of roomData.room.playlists) {
        console.log(`[OBD]   Playlist "${pl.name}": ${pl.cues.length} cues, fade=${pl.fadeDurationMs}ms hold=${pl.holdDurationMs}ms`);
      }

      // 3. Send progress: compiling done
      wc?.send(IPC.PUSH_OBD_PROGRESS, { phase: 'compiled', progress: 0 });

      // 4. Upload via the engine's serial connection
      // The engine exposes a method to send raw bytes through the worker.
      // We use the show upload protocol (Enttec-framed, labels 0x90+).
      const result = await engine.pushShowToObd(osbData, (progress: number) => {
        wc?.send(IPC.PUSH_OBD_PROGRESS, { phase: 'uploading', progress });
      });

      if (result === 'ok') {
        wc?.send(IPC.PUSH_OBD_PROGRESS, { phase: 'done', progress: 1 });
        console.log(`[OBD] Show uploaded successfully`);
        return { success: true };
      } else {
        wc?.send(IPC.PUSH_OBD_PROGRESS, { phase: 'error', progress: 0, error: result });
        console.error(`[OBD] Upload failed: ${result}`);
        return { success: false, error: `Upload failed: ${result}` };
      }
    } catch (e) {
      console.error('[OBD] Push error:', e);
      const wc = webContents();
      wc?.send(IPC.PUSH_OBD_PROGRESS, { phase: 'error', progress: 0, error: String(e) });
      return { success: false, error: String(e) };
    }
  });

  // ── Query stored show info ────────────────────────────────────────────
  ipcMain.handle(IPC.OBD_QUERY_SHOW, async (): Promise<IpcResponse> => {
    try {
      const info = await engine.queryObdShowInfo();
      return { success: true, data: info };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  });
}
