/**
 * Shared utility: collect DMX LED addresses from a fixture list,
 * filtered by a FixtureTarget. Used by useFxStore and usePalettePlaylistRunner.
 */
import type { FixtureInstance, FixtureTarget, LedAddress } from '../../shared/types';
import { getFixtureProfileById } from '../../fixtures';

export function collectFilteredLedAddresses(
  fixtures: FixtureInstance[],
  target: FixtureTarget,
): LedAddress[] {
  const addresses: LedAddress[] = [];

  let includedFixtures: FixtureInstance[];
  switch (target.mode) {
    case 'all':
      includedFixtures = fixtures;
      break;
    case 'include':
      includedFixtures = fixtures.filter((f) => target.fixtureIds.includes(f.id));
      break;
    case 'exclude':
      includedFixtures = fixtures.filter((f) => !target.fixtureIds.includes(f.id));
      break;
    default:
      includedFixtures = fixtures;
  }

  for (const f of includedFixtures) {
    const profile = getFixtureProfileById(f.profileId);
    const personality = profile?.personalities.find((p) => p.name === f.personalityName);
    if (!personality) continue;

    const channels = personality.channels;
    const reds   = channels.filter((c) => c.type === 'red');
    const greens = channels.filter((c) => c.type === 'green');
    const blues  = channels.filter((c) => c.type === 'blue');

    if (reds.length > 0 && reds.length === greens.length && reds.length === blues.length) {
      const ledFilter = target.ledIndices?.[f.id];

      for (let i = 0; i < reds.length; i++) {
        if (ledFilter && !ledFilter.includes(i)) continue;
        addresses.push({
          r: f.startAddress + reds[i].offset,
          g: f.startAddress + greens[i].offset,
          b: f.startAddress + blues[i].offset,
        });
      }
    }
  }

  return addresses;
}
