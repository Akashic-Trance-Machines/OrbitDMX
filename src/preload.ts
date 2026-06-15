import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './shared/ipcChannels';
import type { Scene, SerialPortInfo, SerialStatus, RunnerStatus, ChannelDefinition, FxConfig, LedAddress, RoomFile, FixtureProfile, ShowFile, ObdProgress } from './shared/types';
import type { IpcResponse } from './shared/types';

/**
 * Secure contextBridge API exposed to the renderer.
 * Only specific, typed functions are exposed — no raw Node APIs.
 *
 * IMPORTANT: Push subscriptions use removeListener (not removeAllListeners)
 * so multiple React components can independently subscribe/unsubscribe without
 * clobbering each other's listeners.
 */
contextBridge.exposeInMainWorld('dmx', {
  // ── Serial ────────────────────────────────────────────────────────────────
  listPorts: (): Promise<IpcResponse<SerialPortInfo[]>> =>
    ipcRenderer.invoke(IPC.SERIAL_LIST_PORTS),

  connect: (path: string): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.SERIAL_CONNECT, path),

  disconnect: (): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.SERIAL_DISCONNECT),

  /** Query the current serial connection status (useful on component mount). */
  getSerialStatus: (): Promise<IpcResponse<SerialStatus>> =>
    ipcRenderer.invoke(IPC.SERIAL_GET_STATUS),

  /** Get the current DMX output mode from the engine. */
  getOutputMode: (): Promise<IpcResponse<{ mode: string; autoDetected: boolean }>> =>
    ipcRenderer.invoke(IPC.SERIAL_GET_OUTPUT_MODE),

  /** Set the DMX output mode (takes effect on next connect). */
  setOutputMode: (mode: string): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.SERIAL_SET_OUTPUT_MODE, mode),

  // ── DMX ───────────────────────────────────────────────────────────────────
  sendScene: (scene: Scene): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.DMX_SEND_SCENE, scene),

  blackout: (): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.DMX_BLACKOUT),

  setChannel: (address: number, value: number): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.DMX_SET_CHANNEL, address, value),

  getUniverse: (): Promise<IpcResponse<number[]>> =>
    ipcRenderer.invoke(IPC.DMX_GET_UNIVERSE),

  cancelFade: (): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.DMX_CANCEL_FADE),

  setRoomDimmer: (value: number): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.DMX_SET_ROOM_DIMMER, value),

  setDimmerAddresses: (addresses: number[]): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.DMX_SET_DIMMER_ADDRESSES, addresses),

  // ── FX ────────────────────────────────────────────────────────────────────
  setFx: (config: FxConfig | null): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.DMX_SET_FX, config),

  setFxLedAddresses: (addresses: LedAddress[]): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.DMX_SET_FX_LED_ADDRESSES, addresses),

  setFxLedAddressesForType: (type: string, addresses: LedAddress[]): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.DMX_SET_FX_LED_ADDRESSES_FOR_TYPE, type, addresses),

  setChannelBatch: (updates: Array<{ address: number; value: number }>): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.DMX_SET_CHANNEL_BATCH, updates),

  // ── Post-processing modifiers ─────────────────────────────────────────────
  setColorShift: (id: string, addresses: LedAddress[], degrees: number): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.DMX_SET_COLOR_SHIFT, id, addresses, degrees),

  clearColorShift: (id: string): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.DMX_CLEAR_COLOR_SHIFT, id),

  setLedDimmer: (id: string, addresses: number[], factor: number): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.DMX_SET_LED_DIMMER, id, addresses, factor),

  clearLedDimmer: (id: string): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.DMX_CLEAR_LED_DIMMER, id),

  // ── Runner ────────────────────────────────────────────────────────────────
  playScene: (scene: Scene, fadeDurationMs: number): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.RUNNER_PLAY_SCENE, scene, fadeDurationMs),

  stop: (): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.RUNNER_STOP),

  testFlash: (startAddress: number, channels: ChannelDefinition[]): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.FIXTURE_TEST_FLASH, { startAddress, channels }),

  // ── Room file I/O ─────────────────────────────────────────────────────────
  saveRoomFile: (filePath: string, data: RoomFile): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.ROOM_FILE_SAVE, filePath, data),

  loadRoomFile: (filePath: string): Promise<IpcResponse<RoomFile>> =>
    ipcRenderer.invoke(IPC.ROOM_FILE_LOAD, filePath),

  /** Show native open dialog, returns { filePath, data } or null if cancelled. */
  pickOpenRoomFile: (): Promise<IpcResponse<{ filePath: string; data: RoomFile } | null>> =>
    ipcRenderer.invoke(IPC.ROOM_FILE_PICK_OPEN),

  /** Show native save-as dialog, returns the chosen file path or null. */
  pickSaveAsRoomFile: (data: RoomFile): Promise<IpcResponse<string | null>> =>
    ipcRenderer.invoke(IPC.ROOM_FILE_PICK_SAVE_AS, data),

  /** Get the default save directory (~/Documents/OrbitDMX/). */
  getDefaultPath: (): Promise<IpcResponse<string>> =>
    ipcRenderer.invoke(IPC.ROOM_FILE_GET_DEFAULT_PATH),

  /** Get the last-used file path from app config. */
  getLastFilePath: (): Promise<IpcResponse<string | null>> =>
    ipcRenderer.invoke(IPC.ROOM_FILE_GET_LAST_PATH),

  /** Store the last-used file path in app config. */
  setLastFilePath: (filePath: string | null): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.ROOM_FILE_SET_LAST_PATH, filePath),

  /** List all .orbitdmx files in ~/Documents/OrbitDMX/, sorted newest first. */
  listRoomDir: (): Promise<IpcResponse<Array<{ name: string; filePath: string; modifiedAt: number }>>> =>
    ipcRenderer.invoke(IPC.ROOM_FILE_LIST_DIR),

  // ── Show file I/O (.orbitshow) ─────────────────────────────────────────
  exportShow: (roomData: RoomFile, fixtureProfiles: FixtureProfile[]): Promise<IpcResponse<string | null>> =>
    ipcRenderer.invoke(IPC.SHOW_FILE_EXPORT, roomData, fixtureProfiles),

  importShow: (): Promise<IpcResponse<ShowFile | null>> =>
    ipcRenderer.invoke(IPC.SHOW_FILE_IMPORT),

  // ── OBD standalone push ────────────────────────────────────────────────
  pushToObd: (
    roomData: RoomFile, fixtureProfiles: FixtureProfile[], bpm: number,
    baseSceneId?: string | null,
    fxConfigs?: any[], fxTargets?: Record<string, any>,
  ): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.OBD_PUSH_SHOW, roomData, fixtureProfiles, bpm,
      baseSceneId ?? null, fxConfigs ?? [], fxTargets ?? {}),

  queryObdShow: (): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.OBD_QUERY_SHOW),

  // ── Push subscriptions (main → renderer) ──────────────────────────────────
  // Each returns a cleanup function that removes only THIS listener,
  // so multiple concurrent subscribers don't clobber each other.

  onUniverseUpdate: (cb: (snapshot: number[]) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, snapshot: number[]) => cb(snapshot);
    ipcRenderer.on(IPC.PUSH_UNIVERSE_UPDATE, handler);
    return () => ipcRenderer.removeListener(IPC.PUSH_UNIVERSE_UPDATE, handler);
  },

  onSerialStatus: (cb: (status: SerialStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: SerialStatus) => cb(status);
    ipcRenderer.on(IPC.PUSH_SERIAL_STATUS, handler);
    return () => ipcRenderer.removeListener(IPC.PUSH_SERIAL_STATUS, handler);
  },

  onRunnerState: (cb: (status: RunnerStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: RunnerStatus) => cb(status);
    ipcRenderer.on(IPC.PUSH_RUNNER_STATE, handler);
    return () => ipcRenderer.removeListener(IPC.PUSH_RUNNER_STATE, handler);
  },

  onObdProgress: (cb: (progress: ObdProgress) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, progress: ObdProgress) => cb(progress);
    ipcRenderer.on(IPC.PUSH_OBD_PROGRESS, handler);
    return () => ipcRenderer.removeListener(IPC.PUSH_OBD_PROGRESS, handler);
  },
});

// ── Menu event forwarding ──────────────────────────────────────────────────
// The Electron menu sends events via webContents.send. We listen here in
// the preload and dispatch custom DOM events that the renderer can handle.
const MENU_EVENTS = ['menu:new-room', 'menu:open-room', 'menu:save-as', 'menu:undo', 'menu:redo', 'menu:export-show', 'menu:import-show'] as const;
for (const eventName of MENU_EVENTS) {
  ipcRenderer.on(eventName, () => {
    window.dispatchEvent(new CustomEvent(eventName));
  });
}
