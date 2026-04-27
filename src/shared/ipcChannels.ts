// All IPC channel names in one place. Never use magic strings inline.

// Renderer → Main (invoke, returns { success, data?, error? })
export const IPC = {
  // Serial / hardware
  SERIAL_LIST_PORTS: 'serial:list-ports',
  SERIAL_CONNECT: 'serial:connect',
  SERIAL_DISCONNECT: 'serial:disconnect',
  SERIAL_GET_STATUS: 'serial:get-status',   // query current status on mount

  // DMX engine control
  DMX_SEND_SCENE: 'dmx:send-scene',
  DMX_BLACKOUT: 'dmx:blackout',
  DMX_SET_CHANNEL: 'dmx:set-channel',
  DMX_GET_UNIVERSE: 'dmx:get-universe',
  DMX_CANCEL_FADE: 'dmx:cancel-fade',
  DMX_SET_ROOM_DIMMER: 'dmx:set-room-dimmer',
  DMX_SET_DIMMER_ADDRESSES: 'dmx:set-dimmer-addresses',
  DMX_SET_FX: 'dmx:set-fx',
  DMX_SET_FX_LED_ADDRESSES: 'dmx:set-fx-led-addresses',

  // Scene runner
  RUNNER_PLAY_SCENE: 'runner:play-scene',
  RUNNER_PLAY_PLAYLIST: 'runner:play-playlist',
  RUNNER_STOP: 'runner:stop',
  RUNNER_NEXT: 'runner:next',

  // Fixture test (3× RGB flash)
  FIXTURE_TEST_FLASH: 'fixture:test-flash',

  // Persistence (room / scene / rig data stored in user data)
  STORE_GET_ROOMS: 'store:get-rooms',
  STORE_SAVE_ROOM: 'store:save-room',
  STORE_DELETE_ROOM: 'store:delete-room',
  STORE_GET_SCENES: 'store:get-scenes',
  STORE_SAVE_SCENE: 'store:save-scene',
  STORE_DELETE_SCENE: 'store:delete-scene',
  STORE_GET_PLAYLISTS: 'store:get-playlists',
  STORE_SAVE_PLAYLIST: 'store:save-playlist',
  STORE_DELETE_PLAYLIST: 'store:delete-playlist',

  // Main → Renderer (push events via webContents.send)
  PUSH_UNIVERSE_UPDATE: 'push:universe-update',
  PUSH_SERIAL_STATUS: 'push:serial-status',
  PUSH_RUNNER_STATE: 'push:runner-state',
} as const;

export type IpcChannel = (typeof IPC)[keyof typeof IPC];
