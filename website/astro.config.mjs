// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// --- Deployment target (keep these two values together) -------------------
// GitHub Pages project site lives under a subpath. If a custom domain is
// added later, set `site` to the domain and `base` to '/' — a 2-line change.
const SITE = 'https://akashic-trance-machines.github.io';
const BASE = '/OrbitDMX/';
// --------------------------------------------------------------------------

export default defineConfig({
  site: SITE,
  base: BASE,
  output: 'static',
  trailingSlash: 'ignore',
  integrations: [sitemap()],
});
