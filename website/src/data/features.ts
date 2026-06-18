// Feature cards rendered in the Features section.
// `icon` keys map to inline SVGs in FeatureCard.astro.

export interface Feature {
  icon: string;
  title: string;
  description: string;
}

export const features: Feature[] = [
  {
    icon: 'rooms',
    title: 'Rooms, rigs & scenes',
    description:
      'Define a room of fixtures, patch DMX addresses, and snapshot looks as scenes.',
  },
  {
    icon: 'playlist',
    title: 'Scene playlists with crossfade',
    description:
      'Chain scenes with per-cue hold and fade timing, auto-play, and BPM sync.',
  },
  {
    icon: 'palette',
    title: 'Colour generators',
    description:
      'Palette and HSB generator playlists build evolving colour washes without hand-building every scene.',
  },
  {
    icon: 'fx',
    title: 'Real-time FX engine',
    description:
      'Strobe, strobe-colour, breath, fire, candle, twinkle and hue-rotator effects — layerable and targetable per fixture.',
  },
  {
    icon: 'controls',
    title: 'Type-driven Controls page',
    description:
      'Build a custom control surface: sliders, buttons, and colour wheels mapped to channels, FX, and playlists.',
  },
  {
    icon: 'midi',
    title: 'MIDI learn',
    description:
      'Map any control to a MIDI CC or note with auto-link capture, and drive your show from a hardware controller live.',
  },
  {
    icon: 'output',
    title: 'Rock-solid DMX output',
    description:
      'A dedicated 40 Hz output worker keeps light output smooth and flicker-free, even under load.',
  },
  {
    icon: 'library',
    title: 'AYRA fixture library',
    description:
      'Built-in profiles for many AYRA fixtures (Compar, Armageddon, ALO, and more), plus generic RGB/RGBW types.',
  },
  {
    icon: 'open',
    title: 'Free & open source',
    description:
      'MIT licensed. Inspect it, build it, contribute. No accounts, no telemetry, no paywalls.',
  },
];
