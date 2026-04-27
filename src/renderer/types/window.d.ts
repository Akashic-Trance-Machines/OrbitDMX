import type { SerialPortInfo, SerialStatus, RunnerStatus, Scene, ChannelDefinition, FxConfig, LedAddress } from '../shared/types';
import type { IpcResponse } from '../shared/types';

/**
 * Type declaration for the contextBridge API exposed in preload.ts.
 * This makes window.dmx fully typed in the renderer.
 */
declare global {
  interface Window {
    dmx: {
      listPorts: () => Promise<IpcResponse<SerialPortInfo[]>>;
      connect: (path: string) => Promise<IpcResponse>;
      disconnect: () => Promise<IpcResponse>;
      /** Query current status synchronously from the main process (useful on mount). */
      getSerialStatus: () => Promise<IpcResponse<{ status: SerialStatus; port: string | null }>>;

      sendScene: (scene: Scene) => Promise<IpcResponse>;
      blackout: () => Promise<IpcResponse>;
      setChannel: (address: number, value: number) => Promise<IpcResponse>;
      getUniverse: () => Promise<IpcResponse<number[]>>;
      cancelFade: () => Promise<IpcResponse>;
      setRoomDimmer: (value: number) => Promise<IpcResponse>;
      setDimmerAddresses: (addresses: number[]) => Promise<IpcResponse>;

      setFx: (config: FxConfig | null) => Promise<IpcResponse>;
      setFxLedAddresses: (addresses: LedAddress[]) => Promise<IpcResponse>;

      playScene: (scene: Scene, fadeDurationMs: number) => Promise<IpcResponse>;
      stop: () => Promise<IpcResponse>;

      /** Flash the fixture at startAddress 3 times: Red → Green → Blue */
      testFlash: (startAddress: number, channels: ChannelDefinition[]) => Promise<IpcResponse>;

      onUniverseUpdate: (cb: (snapshot: number[]) => void) => () => void;
      onSerialStatus: (cb: (status: SerialStatus) => void) => () => void;
      onRunnerState: (cb: (status: RunnerStatus) => void) => () => void;
    };
  }
}

export {};
