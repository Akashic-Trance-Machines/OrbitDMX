import { ipcMain, dialog, app } from 'electron';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { IPC } from '../../shared/ipcChannels';
import type { IpcResponse, RoomFile } from '../../shared/types';

/** Simple config file for persisting the last-used room file path. */
const CONFIG_FILE = 'orbit-config.json';

function getConfigPath(): string {
  return path.join(app.getPath('userData'), CONFIG_FILE);
}

function readConfig(): Record<string, unknown> {
  try {
    const raw = fs.readFileSync(getConfigPath(), 'utf-8');
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

function writeConfig(config: Record<string, unknown>): void {
  fs.writeFileSync(getConfigPath(), JSON.stringify(config, null, 2), 'utf-8');
}

function getDefaultDir(): string {
  return path.join(app.getPath('documents'), 'OrbitDMX');
}

/**
 * Registers IPC handlers for room file persistence.
 * Call once from main.ts during app.on('ready').
 */
export function registerRoomFileHandlers(): void {

  // ── Save room file ────────────────────────────────────────────────────────
  ipcMain.handle(IPC.ROOM_FILE_SAVE, async (_event, filePath: string, data: RoomFile): Promise<IpcResponse> => {
    try {
      // Ensure directory exists
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');
      // Remember last file
      const config = readConfig();
      config.lastFilePath = filePath;
      writeConfig(config);
      return { success: true };
    } catch (e) {
      console.error('[IPC] room-file-save error:', e);
      return { success: false, error: String(e) };
    }
  });

  // ── Load room file ────────────────────────────────────────────────────────
  ipcMain.handle(IPC.ROOM_FILE_LOAD, async (_event, filePath: string): Promise<IpcResponse> => {
    try {
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data: RoomFile = JSON.parse(raw);
      // Remember last file
      const config = readConfig();
      config.lastFilePath = filePath;
      writeConfig(config);
      return { success: true, data };
    } catch (e) {
      console.error('[IPC] room-file-load error:', e);
      return { success: false, error: String(e) };
    }
  });

  // ── Pick + open ───────────────────────────────────────────────────────────
  ipcMain.handle(IPC.ROOM_FILE_PICK_OPEN, async (): Promise<IpcResponse> => {
    try {
      const result = await dialog.showOpenDialog({
        title: 'Open Room',
        defaultPath: getDefaultDir(),
        filters: [
          { name: 'OrbitDMX Room', extensions: ['orbitdmx'] },
          { name: 'All Files', extensions: ['*'] },
        ],
        properties: ['openFile'],
      });

      if (result.canceled || result.filePaths.length === 0) {
        return { success: true, data: null };
      }

      const filePath = result.filePaths[0];
      const raw = fs.readFileSync(filePath, 'utf-8');
      const data: RoomFile = JSON.parse(raw);

      const config = readConfig();
      config.lastFilePath = filePath;
      writeConfig(config);

      return { success: true, data: { filePath, data } };
    } catch (e) {
      console.error('[IPC] room-file-pick-open error:', e);
      return { success: false, error: String(e) };
    }
  });

  // ── Pick + save-as ────────────────────────────────────────────────────────
  ipcMain.handle(IPC.ROOM_FILE_PICK_SAVE_AS, async (_event, data: RoomFile): Promise<IpcResponse> => {
    try {
      const defaultName = (data.room?.name ?? 'Untitled').replace(/[^a-zA-Z0-9 _-]/g, '') + '.orbitdmx';
      const result = await dialog.showSaveDialog({
        title: 'Save Room As',
        defaultPath: path.join(getDefaultDir(), defaultName),
        filters: [
          { name: 'OrbitDMX Room', extensions: ['orbitdmx'] },
        ],
      });

      if (result.canceled || !result.filePath) {
        return { success: true, data: null };
      }

      const filePath = result.filePath;
      const dir = path.dirname(filePath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
      fs.writeFileSync(filePath, JSON.stringify(data, null, 2), 'utf-8');

      const config = readConfig();
      config.lastFilePath = filePath;
      writeConfig(config);

      return { success: true, data: filePath };
    } catch (e) {
      console.error('[IPC] room-file-pick-save-as error:', e);
      return { success: false, error: String(e) };
    }
  });

  // ── Get default save directory ────────────────────────────────────────────
  ipcMain.handle(IPC.ROOM_FILE_GET_DEFAULT_PATH, async (): Promise<IpcResponse> => {
    const dir = getDefaultDir();
    return { success: true, data: dir };
  });

  // ── Get last file path ────────────────────────────────────────────────────
  ipcMain.handle(IPC.ROOM_FILE_GET_LAST_PATH, async (): Promise<IpcResponse> => {
    const config = readConfig();
    return { success: true, data: (config.lastFilePath as string) ?? null };
  });

  // ── Set last file path ────────────────────────────────────────────────────
  ipcMain.handle(IPC.ROOM_FILE_SET_LAST_PATH, async (_event, filePath: string | null): Promise<IpcResponse> => {
    const config = readConfig();
    config.lastFilePath = filePath;
    writeConfig(config);
    return { success: true };
  });

  // ── List all .orbitdmx files in the default directory ─────────────────────
  ipcMain.handle(IPC.ROOM_FILE_LIST_DIR, async (): Promise<IpcResponse> => {
    try {
      const dir = getDefaultDir();
      if (!fs.existsSync(dir)) {
        return { success: true, data: [] };
      }
      const entries = fs.readdirSync(dir);
      const files = entries
        .filter((f) => f.endsWith('.orbitdmx'))
        .map((f) => {
          const filePath = path.join(dir, f);
          const stat = fs.statSync(filePath);
          return {
            name: f.replace('.orbitdmx', ''),
            filePath,
            modifiedAt: stat.mtimeMs,
          };
        })
        .sort((a, b) => b.modifiedAt - a.modifiedAt); // newest first
      return { success: true, data: files };
    } catch (e) {
      console.error('[IPC] room-file-list-dir error:', e);
      return { success: false, error: String(e) };
    }
  });
}
