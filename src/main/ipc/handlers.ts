import { ipcMain, WebContents } from 'electron';
import { DmxEngine } from '../dmx/DmxEngine';
import { IPC } from '../../shared/ipcChannels';
import type { IpcResponse, Scene, ChannelDefinition } from '../../shared/types';

const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface TestFlashParams {
  startAddress: number;
  channels: ChannelDefinition[];
}

/**
 * Registers all IPC handlers that bridge the renderer to the DMX engine.
 * Call this once from main.ts after creating the engine and window.
 */
export function registerIpcHandlers(engine: DmxEngine, webContents: () => WebContents | null): void {

  // ── Serial ──────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.SERIAL_LIST_PORTS, async (): Promise<IpcResponse> => {
    try {
      const ports = await engine.listPorts();
      return { success: true, data: ports };
    } catch (e) {
      console.error('[IPC] list-ports error:', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle(IPC.SERIAL_CONNECT, async (_event, path: string): Promise<IpcResponse> => {
    try {
      await engine.connect(path);
      return { success: true };
    } catch (e) {
      console.error('[IPC] connect error:', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle(IPC.SERIAL_DISCONNECT, async (): Promise<IpcResponse> => {
    try {
      await engine.disconnect();
      return { success: true };
    } catch (e) {
      console.error('[IPC] disconnect error:', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle(IPC.SERIAL_GET_STATUS, async (): Promise<IpcResponse> => {
    return {
      success: true,
      data: {
        status: engine.getSerialStatus(),
        port: engine.getConnectedPort(),
      },
    };
  });

  // ── DMX control ─────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.DMX_SEND_SCENE, async (_event, scene: Scene): Promise<IpcResponse> => {
    try {
      engine.playScene(scene);
      return { success: true };
    } catch (e) {
      console.error('[IPC] send-scene error:', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle(IPC.DMX_BLACKOUT, async (): Promise<IpcResponse> => {
    try {
      engine.blackout();
      return { success: true };
    } catch (e) {
      console.error('[IPC] blackout error:', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle(IPC.DMX_SET_CHANNEL, async (_event, address: number, value: number): Promise<IpcResponse> => {
    try {
      engine.setChannel(address, value);
      return { success: true };
    } catch (e) {
      console.error('[IPC] set-channel error:', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle(IPC.DMX_GET_UNIVERSE, async (): Promise<IpcResponse> => {
    try {
      const snapshot = engine.getUniverseSnapshot();
      return { success: true, data: snapshot };
    } catch (e) {
      console.error('[IPC] get-universe error:', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle(IPC.DMX_CANCEL_FADE, async (): Promise<IpcResponse> => {
    try {
      engine.stopFade();
      return { success: true };
    } catch (e) {
      console.error('[IPC] cancel-fade error:', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle(IPC.DMX_SET_ROOM_DIMMER, async (_event, value: number): Promise<IpcResponse> => {
    try {
      engine.setRoomDimmer(value);
      return { success: true };
    } catch (e) {
      console.error('[IPC] set-room-dimmer error:', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle(IPC.DMX_SET_DIMMER_ADDRESSES, async (_event, addresses: number[]): Promise<IpcResponse> => {
    try {
      engine.setDimmerAddresses(addresses);
      return { success: true };
    } catch (e) {
      console.error('[IPC] set-dimmer-addresses error:', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle(IPC.DMX_SET_FX, async (_event, config: any): Promise<IpcResponse> => {
    try {
      engine.setFx(config);
      return { success: true };
    } catch (e) {
      console.error('[IPC] set-fx error:', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle(IPC.DMX_SET_FX_LED_ADDRESSES, async (_event, addresses: any[]): Promise<IpcResponse> => {
    try {
      engine.setFxLedAddresses(addresses);
      return { success: true };
    } catch (e) {
      console.error('[IPC] set-fx-led-addresses error:', e);
      return { success: false, error: String(e) };
    }
  });

  // ── Runner ──────────────────────────────────────────────────────────────────

  ipcMain.handle(IPC.RUNNER_PLAY_SCENE, async (_event, scene: Scene, fadeDurationMs: number): Promise<IpcResponse> => {
    try {
      if (fadeDurationMs > 0) {
        engine.fadeToScene(scene, fadeDurationMs);
      } else {
        engine.playScene(scene);
      }
      return { success: true };
    } catch (e) {
      console.error('[IPC] play-scene error:', e);
      return { success: false, error: String(e) };
    }
  });

  ipcMain.handle(IPC.RUNNER_STOP, async (): Promise<IpcResponse> => {
    try {
      engine.blackout();
      return { success: true };
    } catch (e) {
      console.error('[IPC] runner-stop error:', e);
      return { success: false, error: String(e) };
    }
  });

  // ── Fixture test flash ───────────────────────────────────────────────────────

  ipcMain.handle(IPC.FIXTURE_TEST_FLASH, async (_event, params: TestFlashParams): Promise<IpcResponse> => {
    try {
      const { startAddress, channels } = params;

      const getByType = (type: string) => channels.find((c) => c.type === type);
      const rCh  = getByType('red');
      const gCh  = getByType('green');
      const bCh  = getByType('blue');
      const dimCh = getByType('dimmer');

      const sendColor = (r: number, g: number, b: number) => {
        if (dimCh) engine.setChannel(startAddress + dimCh.offset, 255);
        if (rCh)  engine.setChannel(startAddress + rCh.offset, r);
        if (gCh)  engine.setChannel(startAddress + gCh.offset, g);
        if (bCh)  engine.setChannel(startAddress + bCh.offset, b);
      };

      const clearFixture = () => {
        for (const ch of channels) {
          engine.setChannel(startAddress + ch.offset, 0);
        }
      };

      // 3 RGB flashes: Red → Green → Blue
      const colors: [number, number, number][] = [[255, 0, 0], [0, 255, 0], [0, 0, 255]];
      for (const [r, g, b] of colors) {
        sendColor(r, g, b);
        await delay(400);
        clearFixture();
        await delay(150);
      }

      return { success: true };
    } catch (e) {
      console.error('[IPC] test-flash error:', e);
      return { success: false, error: String(e) };
    }
  });

  // ── Push events: engine → renderer ─────────────────────────────────────────

  engine.onUniverseUpdateCallback((snapshot) => {
    webContents()?.send(IPC.PUSH_UNIVERSE_UPDATE, snapshot);
  });

  engine.onRunnerStateCallback((status) => {
    webContents()?.send(IPC.PUSH_RUNNER_STATE, status);
  });

  engine.onSerialStatusCallback((status) => {
    webContents()?.send(IPC.PUSH_SERIAL_STATUS, status);
  });
}
