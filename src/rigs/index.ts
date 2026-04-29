import type { Rig } from '../shared/types';

// Auto-generated rig imports — all AI-parsed fixture definitions
import armageddon648Rgb from './ayra-armageddon-648-rgb-led.json';
import armageddon648W from './ayra-armageddon-648-w-led.json';
import compar10 from './ayra-compar-10.json';
import compar2Rgb from './ayra-compar-2-rgb-smd.json';
import compar20 from './ayra-compar-20.json';
import compar30Rgbw from './ayra-compar-30-rgbw-led.json';
import compar5060 from './ayra-compar-50-60-rgbawuv-led-spot.json';
import comparKit12Mkii from './ayra-compar-kit-1-2-mkii.json';
import comparKitJr from './ayra-compar-kit-jr.json';
import comparKit3 from './ayra-compar-kit3.json';
import dancefxSp from './ayra-dancefx-sp12x3-sp15x1-spotlights.json';
import ero075 from './ayra-ero-075-moving-head.json';
import ero150bsw from './ayra-ero-150bsw-mkii-led-movinghead.json';
import ero404 from './ayra-ero-404-led-movinghead.json';
import ero406 from './ayra-ero-406-led-movinghead.json';
import ero506 from './ayra-ero-506-movinghead.json';
import eroHexabeam from './ayra-ero-hexabeam.json';
import eroMicroSpot from './ayra-ero-micro-spot-led-movinghead.json';
import ledTriBar12 from './ayra-led-tri-bar-12.json';

/** All built-in rig definitions. */
export const RIGS: Rig[] = [
  armageddon648Rgb,
  armageddon648W,
  compar10,
  compar2Rgb,
  compar20,
  compar30Rgbw,
  compar5060,
  comparKit12Mkii,
  comparKitJr,
  comparKit3,
  dancefxSp,
  ero075,
  ero150bsw,
  ero404,
  ero406,
  ero506,
  eroHexabeam,
  eroMicroSpot,
  ledTriBar12,
] as unknown as Rig[];

export function getRigById(id: string): Rig | undefined {
  return RIGS.find((r) => r.id === id);
}
