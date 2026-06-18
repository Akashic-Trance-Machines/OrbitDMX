// Single source of truth for product names, URLs, and taglines.
// Edit copy here — components read from this file.

export const site = {
  name: 'OrbitDMX',
  shortName: 'OD',
  hardwareName: 'OrbitBridgeDeck',
  hardwareShort: 'OBD',
  org: 'Akashic Trance Machines',

  tagline: 'Open-source stage lighting control that just works.',
  subTagline:
    'A fast, modern DMX controller for your USB-DMX rig. Free, cross-platform, no subscriptions.',
  description:
    'OrbitDMX is a free, open-source stage-lighting DMX controller for small USB-DMX rigs. Build rooms, scenes and playlists, run real-time FX, and control your show live over MIDI.',

  trustRow: 'MIT licensed · Windows · macOS · Linux · No account needed.',

  // Repositories / API
  repo: 'https://github.com/Akashic-Trance-Machines/OrbitDMX',
  firmwareRepo: 'https://github.com/Akashic-Trance-Machines/OrbitBridgeDeck',
  releasesLatest:
    'https://github.com/Akashic-Trance-Machines/OrbitDMX/releases/latest',
  releasesAll:
    'https://github.com/Akashic-Trance-Machines/OrbitDMX/releases',
  releasesApi:
    'https://api.github.com/repos/Akashic-Trance-Machines/OrbitDMX/releases/latest',
  license: 'https://github.com/Akashic-Trance-Machines/OrbitDMX/blob/main/LICENSE',

  // Contact
  notifyMailto:
    'mailto:toon@toonnelissen.eu?subject=OrbitBridgeDeck%20updates',

  year: new Date().getFullYear(),
} as const;

// Nav anchor links (label + hash target)
export const navLinks = [
  { label: 'Features', href: '#features' },
  { label: 'Screenshots', href: '#screenshots' },
  { label: 'Download', href: '#download' },
  { label: 'Hardware', href: '#hardware' },
] as const;
