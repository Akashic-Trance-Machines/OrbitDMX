import type { SerialPortInfo, SerialStatus, RunnerStatus, Scene, ChannelDefinition, FxConfig, LedAddress, RoomFile, FixtureProfile, ShowFile } from '../../shared/types';
import type { IpcResponse } from '../../shared/types';

/**
 * Type declaration for the contextBridge API exposed in preload.ts.
 * This makes window.dmx fully typed in the renderer.
 */
/** Build-time constant injected by Vite (from package.json version). */
declare const __APP_VERSION__: string;

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
      setChannelBatch: (updates: Array<{ address: number; value: number }>) => Promise<IpcResponse>;

      setFx: (config: FxConfig | null) => Promise<IpcResponse>;
      setFxLedAddresses: (addresses: LedAddress[]) => Promise<IpcResponse>;
      setFxLedAddressesForType: (type: string, addresses: LedAddress[]) => Promise<IpcResponse>;

      // Post-processing modifiers
      setColorShift: (id: string, addresses: LedAddress[], degrees: number) => Promise<IpcResponse>;
      clearColorShift: (id: string) => Promise<IpcResponse>;
      setLedDimmer: (id: string, addresses: number[], factor: number) => Promise<IpcResponse>;
      clearLedDimmer: (id: string) => Promise<IpcResponse>;

      playScene: (scene: Scene, fadeDurationMs: number) => Promise<IpcResponse>;
      stop: () => Promise<IpcResponse>;

      /** Flash the fixture at startAddress 3 times: Red → Green → Blue */
      testFlash: (startAddress: number, channels: ChannelDefinition[]) => Promise<IpcResponse>;

      // Room file I/O
      saveRoomFile: (filePath: string, data: RoomFile) => Promise<IpcResponse>;
      loadRoomFile: (filePath: string) => Promise<IpcResponse<RoomFile>>;
      pickOpenRoomFile: () => Promise<IpcResponse<{ filePath: string; data: RoomFile } | null>>;
      pickSaveAsRoomFile: (data: RoomFile) => Promise<IpcResponse<string | null>>;
      getDefaultPath: () => Promise<IpcResponse<string>>;
      getLastFilePath: () => Promise<IpcResponse<string | null>>;
      setLastFilePath: (filePath: string | null) => Promise<IpcResponse>;

      // Show file I/O
      exportShow: (roomData: RoomFile, fixtureProfiles: FixtureProfile[]) => Promise<IpcResponse<string | null>>;
      importShow: () => Promise<IpcResponse<ShowFile | null>>;

      onUniverseUpdate: (cb: (snapshot: number[]) => void) => () => void;
      onSerialStatus: (cb: (status: SerialStatus) => void) => () => void;
      onRunnerState: (cb: (status: RunnerStatus) => void) => () => void;
    };
  }
}

export {};
