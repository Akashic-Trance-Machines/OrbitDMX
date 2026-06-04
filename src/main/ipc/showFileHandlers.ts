import { ipcMain, dialog, BrowserWindow } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { IPC } from '../../shared/ipcChannels';
import type { IpcResponse, ShowFile, RoomFile, FixtureProfile } from '../../shared/types';

/**
 * Register IPC handlers for .orbitshow export/import.
 */
export function registerShowFileHandlers(): void {

  // ── Export Show ──────────────────────────────────────────────────────────
  ipcMain.handle(IPC.SHOW_FILE_EXPORT, async (_event, roomData: RoomFile, fixtureProfiles: FixtureProfile[]): Promise<IpcResponse> => {
    try {
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showSaveDialog(win!, {
        title: 'Export Show',
        defaultPath: `${roomData.room.name || 'Untitled'}.orbitshow`,
        filters: [{ name: 'OrbitDMX Show', extensions: ['orbitshow'] }],
      });

      if (result.canceled || !result.filePath) {
        return { success: true, data: null };
      }

      const showFile: ShowFile = {
        orbitshow: '1.0',
        room: roomData.room,
        fixtureProfiles,
      };

      fs.writeFileSync(result.filePath, JSON.stringify(showFile, null, 2), 'utf-8');
      console.log(`[ShowFile] Exported to ${result.filePath}`);
      return { success: true, data: result.filePath };
    } catch (e) {
      console.error('[ShowFile] Export error:', e);
      return { success: false, error: String(e) };
    }
  });

  // ── Import Show ──────────────────────────────────────────────────────────
  ipcMain.handle(IPC.SHOW_FILE_IMPORT, async (): Promise<IpcResponse> => {
    try {
      const win = BrowserWindow.getFocusedWindow();
      const result = await dialog.showOpenDialog(win!, {
        title: 'Import Show',
        filters: [{ name: 'OrbitDMX Show', extensions: ['orbitshow'] }],
        properties: ['openFile'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, data: null };
      }

      const filePath = result.filePaths[0];
      const raw = fs.readFileSync(filePath, 'utf-8');
      const showFile = JSON.parse(raw) as ShowFile;

      // Validate basic structure
      if (!showFile.orbitshow || !showFile.room) {
        return { success: false, error: 'Invalid .orbitshow file: missing required fields.' };
      }

      console.log(`[ShowFile] Imported from ${filePath} (${showFile.fixtureProfiles?.length ?? 0} embedded profiles)`);
      return { success: true, data: showFile };
    } catch (e) {
      console.error('[ShowFile] Import error:', e);
      return { success: false, error: String(e) };
    }
  });
}
