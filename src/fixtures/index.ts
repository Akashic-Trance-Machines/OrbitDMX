import type { FixtureProfile } from '../shared/types';

// ---------------------------------------------------------------------------
// Built-in fixture profiles — auto-discovered via Vite's import.meta.glob.
// Any .json file added to this folder is automatically included; no manual
// imports needed.
// ---------------------------------------------------------------------------

const _builtInModules = import.meta.glob('./*.json', { eager: true });

/** All built-in fixture profiles, sourced from the bundled JSON files. */
export const BUILT_IN_FIXTURE_PROFILES: FixtureProfile[] = Object.values(_builtInModules).map(
  (mod) => (mod as { default: FixtureProfile }).default ?? (mod as FixtureProfile),
) as FixtureProfile[];

// ---------------------------------------------------------------------------
// User-imported fixture profiles — populated at runtime via loadFixtureProfiles().
//
// Because these are separate from the bundled ones, the application can start
// with a clean slate of built-in profiles, and the
// future fixture-import feature can merge user-supplied definitions without
// mutating the built-in library state permanently across reloads.

let _importedFixtureProfiles: FixtureProfile[] = [];

/**
 * Merge a set of externally loaded fixture profile definitions into the active list.
 * Any profile with an ID that already exists is ignored.
 *
 * @param profiles - Array of FixtureProfile objects parsed from imported JSON files.
 * @returns        The number of profiles that were actually added.
 */
export function loadFixtureProfiles(profiles: FixtureProfile[]): number {
  const existing = new Set(getAllFixtureProfiles().map((r) => r.id));
  const fresh = profiles.filter((r) => !existing.has(r.id));
  _importedFixtureProfiles = [..._importedFixtureProfiles, ...fresh];
  return fresh.length;
}

/** Remove all previously loaded (non-built-in) fixture profiles. */
export function clearImportedFixtureProfiles(): void {
  _importedFixtureProfiles = [];
}

// ---------------------------------------------------------------------------
// ─── Exported Constants / Getters ──────────────────────────────────────────────
// We export a proxy array so existing code can treat FIXTURE_PROFILES like an array
// but reading from it will dynamically combine the built-in and
// imported profiles transparently.

/** All active fixture profiles: built-in + any user-imported profiles. */
export function getAllFixtureProfiles(): FixtureProfile[] {
  return [...BUILT_IN_FIXTURE_PROFILES, ..._importedFixtureProfiles];
}

/**
 * All active fixture profiles — kept as a getter-backed alias so existing code that
 * references `FIXTURE_PROFILES` continues to work after profiles are imported at runtime.
 */
export const FIXTURE_PROFILES: FixtureProfile[] = new Proxy([] as FixtureProfile[], {
  get(target, prop) {
    const live = getAllFixtureProfiles();
    // Forward array methods/properties to the merged array
    if (prop in live) {
      const val = (live as any)[prop];
      return typeof val === 'function' ? val.bind(live) : val;
    }
    return undefined;
  },
}) as unknown as FixtureProfile[];

export function getFixtureProfileById(id: string): FixtureProfile | undefined {
  return getAllFixtureProfiles().find((r) => r.id === id);
}
