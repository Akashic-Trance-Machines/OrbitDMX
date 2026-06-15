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
    baseSceneId: string | null,
    fxConfigs: any[],
    fxTargetsObj: Record<string, any>,
  ): Promise<IpcResponse> => {
    try {
      const wc = webContents();

      // 1. Build the ShowFile
      const showFile: ShowFile = {
        orbitshow: '1.0',
        room: roomData.room,
        fixtureProfiles,
      };

      // 2. Reconstruct fxTargets as a Map (IPC serializes Maps as plain objects)
      const fxTargets = new Map(Object.entries(fxTargetsObj || {}));

      // 3. Compile to .osb binary
      const showName = roomData.room.name || 'Untitled';
      const osbData = compileShow(showFile, {
        name: showName,
        bpm: bpm || 120,
        baseSceneId: baseSceneId ?? undefined,
        fxConfigs: fxConfigs && fxConfigs.length > 0 ? fxConfigs : undefined,
        fxTargets: fxTargets.size > 0 ? fxTargets : undefined,
      });

      // Debug: inspect the compiled binary header flags
      const flagsInBinary = osbData[6] | (osbData[7] << 8);  // u16 LE at offset 6
      const bpmInBinary = osbData[8] | (osbData[9] << 8);
      const baseSceneInBinary = osbData[10] | (osbData[11] << 8);
      console.log(`[OBD] Compiled show "${showName}" → ${osbData.length} bytes`);
      console.log(`[OBD]   flags=0x${flagsInBinary.toString(16).padStart(4, '0')} (NO_AUTO_PLAYLIST=${!!(flagsInBinary & 0x0002)}, GENS_ACTIVE=${!!(flagsInBinary & 0x0004)})`);
      console.log(`[OBD]   bpm_centi=${bpmInBinary}, base_scene_index=${baseSceneInBinary === 0xFFFF ? 'NONE' : baseSceneInBinary}`);
      console.log(`[OBD]   selectedPlaylistId=${roomData.room.obdStandalone?.selectedPlaylistId ?? '(none)'}`);
      console.log(`[OBD]   scene playlists=${roomData.room.playlists.length}, palette gens=${(roomData.room as any).paletteGenerators?.length ?? 0}, hsb gens=${(roomData.room as any).hsbGenerators?.length ?? 0}`);
      console.log(`[OBD]   fxConfigs=${fxConfigs?.length ?? 0}`);

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
        for (let ci = 0; ci < pl.cues.length; ci++) {
          const cue = pl.cues[ci];
          const sceneIdx = roomData.room.scenes.findIndex((s: any) => s.id === cue.sceneId);
          const sceneName = sceneIdx >= 0 ? roomData.room.scenes[sceneIdx].name : '???';
          console.log(`[OBD]     cue[${ci}]: sceneId=${cue.sceneId.substring(0, 8)}… → index=${sceneIdx} ("${sceneName}")`);
        }
      }

      // Hex dump the section directory from the compiled binary
      const sectionCount = osbData[44] | (osbData[45] << 8);  // section_count at offset 44
      console.log(`[OBD] Binary section directory (${sectionCount} sections):`);
      for (let i = 0; i < sectionCount; i++) {
        const dirOff = 72 + i * 10;  // header=72, each entry=10 bytes
        const secType = osbData[dirOff] | (osbData[dirOff + 1] << 8);
        const secOffset = osbData[dirOff + 2] | (osbData[dirOff + 3] << 8) | (osbData[dirOff + 4] << 16) | (osbData[dirOff + 5] << 24);
        const secLen = osbData[dirOff + 6] | (osbData[dirOff + 7] << 8) | (osbData[dirOff + 8] << 16) | (osbData[dirOff + 9] << 24);
        const typeNames: Record<number, string> = {
          0x0010: 'PATCH', 0x0020: 'SCENES', 0x0030: 'PLAYLISTS',
          0x0040: 'PALETTES', 0x0050: 'PAL_GEN', 0x0060: 'HSB_GEN',
          0x0070: 'FX', 0x0080: 'BINDINGS',
        };
        console.log(`[OBD]   [${i}] type=0x${secType.toString(16).padStart(4, '0')} (${typeNames[secType] ?? '?'}) offset=${secOffset} len=${secLen}`);
        // Hex dump first 32 bytes of each section payload
        const hexBytes: string[] = [];
        for (let b = 0; b < Math.min(32, secLen); b++) {
          hexBytes.push(osbData[secOffset + b].toString(16).padStart(2, '0'));
        }
        console.log(`[OBD]     hex: ${hexBytes.join(' ')}`);
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

        // Verify what's actually on flash by querying SHOW_INFO
        try {
          const info = await engine.queryObdShowInfo();
          if (info) {
            console.log(`[OBD] VERIFY: flash show "${info.name}" size=${info.size} bpm=${info.bpmCenti} v${info.versionMajor}.${info.versionMinor}`);
            if (info.flags !== undefined) {
              console.log(`[OBD] VERIFY:   flags=0x${info.flags.toString(16).padStart(4, '0')} sections=${info.sectionCount} base_scene=${info.baseSceneIndex === 0xFFFF ? 'NONE' : info.baseSceneIndex}`);
            } else {
              console.log(`[OBD] VERIFY:   (old firmware — no extended fields)`);
            }
          } else {
            console.log(`[OBD] VERIFY: no show info returned from OBD`);
          }
        } catch (e) {
          console.log(`[OBD] VERIFY: query failed: ${e}`);
        }

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
