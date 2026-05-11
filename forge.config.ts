import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDMG } from '@electron-forge/maker-dmg';
import 'dotenv/config';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { PublisherGithub } from '@electron-forge/publisher-github';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';

const config: ForgeConfig = {
  packagerConfig: {
    asar: {
      unpack: '**/*.node', // Native binaries cannot be loaded from inside an ASAR
    },
    icon: './OrbitDMX.icns'
  },
  rebuildConfig: {
    // Only rebuild serialport — usb is pre-built manually (binding.gyp has a
    // space-in-path bug with node-addon-api that breaks the Forge rebuild).
    onlyModules: ['serialport'],
  },
  makers: [
    new MakerSquirrel({}),
    new MakerZIP({}, ['darwin']),
    new MakerDMG({}),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  publishers: [
    new PublisherGithub({
      repository: {
        owner: 'Akashic-Trance-Machines',
        name: 'OrbitDMX'
      },
      prerelease: false,
      draft: true // Set to true so you can review releases before making them public
    })
  ],
  hooks: {
    /**
     * After Forge copies the app into the staging directory (but before ASAR
     * creation), copy the production node_modules into the .vite/build folder
     * so that native/external requires (serialport, usb, etc.) are resolvable
     * at runtime inside the packaged app.
     */
    packageAfterCopy: async (_config, buildPath) => {
      const fs = await import('fs');
      const path = await import('path');

      const src = path.join(__dirname, 'node_modules');
      const dest = path.join(buildPath, 'node_modules');

      if (!fs.existsSync(dest)) {
        console.log(`[forge] Copying node_modules → ${dest}`);
        fs.cpSync(src, dest, { recursive: true });
      }
    },
  },
  plugins: [
    // Automatically unpacks native .node modules from the ASAR (required for serialport)
    new AutoUnpackNativesPlugin({}),
    new VitePlugin({
      build: [
        {
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.config.ts',
        },
      ],
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
