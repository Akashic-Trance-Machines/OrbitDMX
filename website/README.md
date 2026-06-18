# OrbitDMX Website

Marketing site for **OrbitDMX** (the app) and **OrbitBridgeDeck** (the in-development hardware).
Built with [Astro](https://astro.build) → static output, deployed to GitHub Pages.

## Develop

```bash
nvm use            # Node 20 (see .nvmrc)
npm install
npm run dev        # http://localhost:4321/OrbitDMX/
```

## Build & check

```bash
npm run check      # astro check (types)
npm run build      # → dist/
npm run preview    # serve the production build under /OrbitDMX/
```

## Deploy

This site lives in `website/` inside the **OrbitDMX** app repo and is published to
that repo's GitHub Pages. The workflow at the repo root
`.github/workflows/deploy-website.yml` builds from `website/` and runs on pushes
to `main` that touch `website/**` (or via manual dispatch). Pages source must be
set to **GitHub Actions**. Live at `https://akashic-trance-machines.github.io/OrbitDMX/`.

## Editing content

- **Copy, URLs, taglines:** `src/data/site.ts`
- **Feature cards:** `src/data/features.ts`
- **Design tokens:** `src/styles/global.css`
- **Real screenshots:** drop images in `public/images/screenshots/`, then pass
  `src="images/screenshots/<file>"` to the `Placeholder` component (it swaps the
  dashed placeholder for the real `<img>`). Replace `public/images/og-image.png`
  (1200×630) with a real social card when ready.

## Custom domain later

In `astro.config.mjs`, set `BASE = '/'` and `SITE = 'https://yourdomain'`, add
`public/CNAME`, and configure DNS. Those two constants are the only code change.

## Notes

- Downloads auto-fetch the latest GitHub Release (`src/components/Downloads.astro`)
  with a graceful static fallback if the API is rate-limited/offline.
- No hardware design files (schematics/PCB/BOM/Gerber) are referenced — the OBD
  hardware design is closed source; only the firmware repo is linked.
