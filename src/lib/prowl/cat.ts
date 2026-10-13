// The player's cat for Catio Prowl: a name and a coat, remembered in this browser.
import { CAT_COATS } from '../scene/build';

export interface PlayerCat { name: string; coat: string }
const KEY = 'oc3d-prowl-cat-v1';
export const COAT_NAMES: Record<string, string> = { '#d98a3d': 'Ginger', '#7d7f86': 'Grey', '#2b2b2e': 'Black', '#e8d5b0': 'Cream', '#9a6b47': 'Brown tabby', '#f2f0ea': 'White' };
export { CAT_COATS };

export function readCat(): PlayerCat {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (raw && typeof raw.name === 'string' && CAT_COATS.includes(raw.coat)) return { name: raw.name.slice(0, 24) || 'Pip', coat: raw.coat };
  } catch { /* storage blocked or damaged */ }
  return { name: 'Pip', coat: CAT_COATS[0] };
}

export function saveCat(c: PlayerCat) {
  try { localStorage.setItem(KEY, JSON.stringify({ name: c.name.slice(0, 24), coat: c.coat })); } catch { /* not remembered this time */ }
}
