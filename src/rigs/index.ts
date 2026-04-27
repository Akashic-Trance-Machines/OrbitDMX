import type { Rig } from '../shared/types';
import jr from './ayra-compar-jr.json';
import kit3 from './ayra-compar-kit3.json';
import compar30 from './ayra-compar-30.json';

/** All built-in rig definitions. Add new rigs here. */
export const RIGS: Rig[] = [
  jr as unknown as Rig,
  kit3 as unknown as Rig,
  compar30 as unknown as Rig,
];

export function getRigById(id: string): Rig | undefined {
  return RIGS.find((r) => r.id === id);
}
