import { getRigById } from '../../rigs';
import type { FixtureInstance, ChannelDefinition } from '../../shared/types';

/** A single LED colour within a fixture. */
export interface LedColor {
  fixtureId: string;
  fixtureLabel: string;
  ledIndex: number;
  color: string; // css rgb() string
}

/**
 * Extract per-LED RGB colours for a fixture from a universe snapshot.
 *
 * Multi-LED fixtures (e.g. 12-ch per-LED RGB) have repeating R/G/B groups.
 * We detect these by grouping channels named "Red N", "Green N", "Blue N"
 * or by counting sequential R/G/B channel sets.
 *
 * Single-LED fixtures return one colour.
 * Fixtures without RGB channels return a gray based on dimmer value.
 */
export function getFixtureLedColors(fixture: FixtureInstance, snapshot: number[]): LedColor[] {
  const rig = getRigById(fixture.rigId);
  const personality = rig?.personalities.find((p) => p.name === fixture.personalityName);
  if (!personality) {
    return [{ fixtureId: fixture.id, fixtureLabel: fixture.label, ledIndex: 0, color: 'rgb(50,50,60)' }];
  }

  const channels = personality.channels;

  // Collect all red/green/blue channels in order
  const reds   = channels.filter((c) => c.type === 'red');
  const greens = channels.filter((c) => c.type === 'green');
  const blues  = channels.filter((c) => c.type === 'blue');

  // If we have matching counts of R/G/B, treat each set as a separate LED
  if (reds.length > 0 && reds.length === greens.length && reds.length === blues.length) {
    return reds.map((rCh, i) => {
      const gCh = greens[i];
      const bCh = blues[i];
      const r = snapshot[fixture.startAddress + rCh.offset - 1] ?? 0;
      const g = snapshot[fixture.startAddress + gCh.offset - 1] ?? 0;
      const b = snapshot[fixture.startAddress + bCh.offset - 1] ?? 0;
      return {
        fixtureId: fixture.id,
        fixtureLabel: fixture.label,
        ledIndex: i,
        color: `rgb(${r},${g},${b})`,
      };
    });
  }

  // Single RGB (mismatched counts — use first of each)
  const rCh = channels.find((c) => c.type === 'red');
  const gCh = channels.find((c) => c.type === 'green');
  const bCh = channels.find((c) => c.type === 'blue');

  if (rCh && gCh && bCh) {
    const r = snapshot[fixture.startAddress + rCh.offset - 1] ?? 0;
    const g = snapshot[fixture.startAddress + gCh.offset - 1] ?? 0;
    const b = snapshot[fixture.startAddress + bCh.offset - 1] ?? 0;
    return [{ fixtureId: fixture.id, fixtureLabel: fixture.label, ledIndex: 0, color: `rgb(${r},${g},${b})` }];
  }

  // No RGB — use dimmer as gray
  const dimCh = channels.find((c) => c.type === 'dimmer');
  if (dimCh) {
    const v = snapshot[fixture.startAddress + dimCh.offset - 1] ?? 0;
    return [{ fixtureId: fixture.id, fixtureLabel: fixture.label, ledIndex: 0, color: `rgb(${v},${v},${v})` }];
  }

  return [{ fixtureId: fixture.id, fixtureLabel: fixture.label, ledIndex: 0, color: 'rgb(50,50,60)' }];
}
