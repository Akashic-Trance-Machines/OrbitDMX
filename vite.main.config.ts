import { defineConfig } from 'vite';

// https://vitejs.dev/config
export default defineConfig({
  build: {
    rollupOptions: {
      // Keep native Node modules external — they cannot be bundled by Vite.
      // serialport contains a native .node binary that must be loaded at runtime.
      external: ['serialport', '@serialport/bindings-cpp', 'usb', 'node-gyp-build'],
    },
  },
});
