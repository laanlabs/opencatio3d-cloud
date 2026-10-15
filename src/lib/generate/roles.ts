// Plain names and sizes for generated parts, shared by the build package and Build mode.
import type { Units } from '../model/types';
import { fmtLen } from '../model/units';
import type { Part } from './parts';

export const ROLE_NAME: Record<string, string> = {
  plate: 'Plate', stud: 'Stud', jamb: 'Jamb stud', header: 'Header', sill: 'Sill', rail: 'Rail', rafter: 'Rafter', purlin: 'Purlin', joist: 'Floor joist', ledger: 'Ledger',
  seal: 'Seal trim', 'door-stile': 'Door stile', 'door-rail': 'Door rail', 'door-brace': 'Door brace', 'hoop-post': 'Hoop post', 'hoop-bar': 'Hoop bar', 'tunnel-rail': 'Tunnel rail',
  'mesh-wall': 'Wall mesh', 'mesh-roof': 'Roof mesh', 'mesh-door': 'Door mesh', 'mesh-skirt': 'Ground skirt', 'mesh-tunnel': 'Tunnel mesh', 'roof-sheet': 'Roof sheets', 'floor-sheet': 'Floor',
  hinge: 'Hinges', latch: 'Latch', handle: 'Handle', bracket: 'Brackets', 'corner-bracket': 'Corner brackets', 'deck-bracket': 'Deck brackets', 'knee-brace': 'Knee braces',
  paver: 'Pavers', sand: 'Leveling sand', anchor: 'Ground anchors', 'shelf-board': 'Shelf', 'ramp-board': 'Ramp', 'ramp-cleat': 'Ramp cleat', 'bridge-board': 'Bridge', 'scratch-post': 'Scratching post', sisal: 'Sisal rope',
  'window-insert': 'Window insert', 'cat-door': 'Cat door'
};

export const roleName = (p: Pick<Part, 'role' | 'side'>) => `${ROLE_NAME[p.role] ?? p.role}${p.side && p.side !== 'span' ? ` (${p.side})` : ''}`;

/** Cut length for members, width × height for panels, length for rope; '' otherwise. */
export const partSize = (p: Part, u: Units) =>
  p.length != null && p.kind === 'member' ? fmtLen(p.length, u) : p.width != null && p.height != null ? `${fmtLen(p.width, u)} × ${fmtLen(p.height, u)}` : p.length != null ? fmtLen(p.length, u) : '';

/** Label order: A2 before A10. */
const labelNo = (l?: string) => Number(/(\d+)$/.exec(l ?? '')?.[1] ?? 0);
export const byLabel = (a: Pick<Part, 'label'>, b: Pick<Part, 'label'>) => labelNo(a.label) - labelNo(b.label);
