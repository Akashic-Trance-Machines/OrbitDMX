import { contextBridge, ipcRenderer } from 'electron';
import { IPC } from './shared/ipcChannels';
import type { Scene, SerialPortInfo, SerialStatus, RunnerStatus, ChannelDefinition, FxConfig, LedAddress } from './shared/types';
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

  // ── Runner ────────────────────────────────────────────────────────────────
  playScene: (scene: Scene, fadeDurationMs: number): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.RUNNER_PLAY_SCENE, scene, fadeDurationMs),

  stop: (): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.RUNNER_STOP),

  testFlash: (startAddress: number, channels: ChannelDefinition[]): Promise<IpcResponse> =>
    ipcRenderer.invoke(IPC.FIXTURE_TEST_FLASH, { startAddress, channels }),

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
});
