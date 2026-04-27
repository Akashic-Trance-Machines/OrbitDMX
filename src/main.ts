import { app, BrowserWindow } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { DmxEngine } from './main/dmx/DmxEngine';
import { registerIpcHandlers } from './main/ipc/handlers';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Single shared engine instance — lives for the lifetime of the app
const engine = new DmxEngine();

let mainWindow: BrowserWindow | null = null;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1024,
    minHeight: 700,
    titleBarStyle: 'hiddenInset',
    backgroundColor: '#0f0f14',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    mainWindow.loadURL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(
      path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    );
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
};

app.on('ready', () => {
  // Register IPC handlers once for the lifetime of the app.
  // Must NOT be called inside createWindow — on macOS the window can be
  // closed and recreated (activate event), which would try to register the
  // same channels twice and throw.
  registerIpcHandlers(engine, () => mainWindow?.webContents ?? null);
  createWindow();
});

// Safety: blackout and disconnect serial before the process exits
app.on('before-quit', async () => {
  console.log('[main] before-quit: sending blackout and disconnecting serial…');
  engine.blackout();
  await engine.disconnect();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
