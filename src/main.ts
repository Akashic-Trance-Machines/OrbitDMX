import { app, BrowserWindow, Menu, powerMonitor } from 'electron';
import path from 'node:path';
import started from 'electron-squirrel-startup';
import { DmxEngine } from './main/dmx/DmxEngine';
import { registerIpcHandlers } from './main/ipc/handlers';
import { registerRoomFileHandlers } from './main/ipc/roomFileHandlers';
import { registerShowFileHandlers } from './main/ipc/showFileHandlers';

// Handle creating/removing shortcuts on Windows when installing/uninstalling.
if (started) {
  app.quit();
}

// Single shared engine instance — lives for the lifetime of the app
const engine = new DmxEngine();

let mainWindow: BrowserWindow | null = null;

function buildMenu(): void {
  const isMac = process.platform === 'darwin';
  const template: Electron.MenuItemConstructorOptions[] = [
    // App menu (macOS only)
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    }] : []),

    // File menu
    {
      label: 'File',
      submenu: [
        {
          label: 'New Room',
          accelerator: 'CmdOrCtrl+N',
          click: () => mainWindow?.webContents.send('menu:new-room'),
        },
        {
          label: 'Open Room…',
          accelerator: 'CmdOrCtrl+O',
          click: () => mainWindow?.webContents.send('menu:open-room'),
        },
        { type: 'separator' },
        {
          label: 'Save As…',
          accelerator: 'CmdOrCtrl+Shift+S',
          click: () => mainWindow?.webContents.send('menu:save-as'),
        },
        { type: 'separator' },
        {
          label: 'Export Show…',
          click: () => mainWindow?.webContents.send('menu:export-show'),
        },
        {
          label: 'Import Show…',
          click: () => mainWindow?.webContents.send('menu:import-show'),
        },
        { type: 'separator' },
        isMac ? { role: 'close' as const } : { role: 'quit' as const },
      ],
    },

    // Edit menu (undo/redo + standard clipboard)
    {
      label: 'Edit',
      submenu: [
        {
          label: 'Undo',
          accelerator: 'CmdOrCtrl+Z',
          click: () => mainWindow?.webContents.send('menu:undo'),
        },
        {
          label: 'Redo',
          accelerator: 'CmdOrCtrl+Shift+Z',
          click: () => mainWindow?.webContents.send('menu:redo'),
        },
        { type: 'separator' },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'selectAll' as const },
      ],
    },

    // View menu
    {
      label: 'View',
      submenu: [
        { role: 'reload' as const },
        { role: 'forceReload' as const },
        { role: 'toggleDevTools' as const },
        { type: 'separator' },
        { role: 'resetZoom' as const },
        { role: 'zoomIn' as const },
        { role: 'zoomOut' as const },
        { type: 'separator' },
        { role: 'togglefullscreen' as const },
      ],
    },

    // Window menu
    {
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        ...(isMac ? [
          { type: 'separator' as const },
          { role: 'front' as const },
        ] : [
          { role: 'close' as const },
        ]),
      ],
    },
  ];

  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);
}

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
  registerRoomFileHandlers();
  registerShowFileHandlers();
  buildMenu();
  createWindow();

  // ── Sleep / wake handling ──────────────────────────────────────────────────
  // When macOS suspends (lid close, menu sleep), the USB-serial adapter
  // is depowered and the connection is lost. On resume we automatically
  // attempt to reconnect so the DMX signal resumes without user interaction.
  powerMonitor.on('suspend', () => {
    console.log('[main] System suspending — DMX output will be interrupted');
  });

  powerMonitor.on('resume', async () => {
    console.log('[main] System resumed — attempting serial reconnect…');
    const ok = await engine.reconnect();
    if (ok) {
      console.log('[main] Serial reconnected after wake');
      // Notify the renderer so the UI updates its connection status
      mainWindow?.webContents.send('push:serial-status', 'connected');
    } else {
      console.warn('[main] Serial reconnect failed — user will need to reconnect manually');
      mainWindow?.webContents.send('push:serial-status', 'disconnected');
    }
  });
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
