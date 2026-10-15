// Catio Quest's cats in "Let them explore": the same cat as Catio Prowl (prowl/catmodel.ts), driven by the
// simulated afternoon's poses instead of a player. Quest scrubs a timeline (play, 1×/2×/4×, skip), so the
// rig keeps its own clock: it animates in real time and works out its walking speed from how far it moved.
import * as THREE from 'three';
import type { Pose } from './sim';
import { type CatBusy, type CatDrive, type CatModel, makeCatModel } from '../prowl/catmodel';

export interface CatRig {
  id: string;
  root: THREE.Group;
  model: CatModel;
  heading: number;
  anchor: THREE.Object3D;
  /** Real time of the last pose (ms), the position then and the smoothed speed (m/s). */
  last: number;
  at: THREE.Vector3 | null;
  speed: number;
}

export const mat = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true });

export function makeCat(id: string, coat: string, small: boolean): CatRig {
  const root = new THREE.Group();
  const model = makeCatModel(coat);
  model.root.traverse((o) => { if (o instanceof THREE.Mesh) o.castShadow = true; });
  root.add(model.root);
  root.scale.setScalar(small ? 0.75 : 1);
  return { id, root, model, heading: 0, anchor: new THREE.Object3D(), last: 0, at: null, speed: 0 };
}

// What the cat is doing for each simulated pose (Prowl's busy poses; null is standing, sitting or loafing).
const BUSY: Partial<Record<Pose, CatBusy>> = { scratch: 'scratch', paw: 'swipe', play: 'swipe', drink: 'drink', sniff: 'sniff', toilet: 'eat', sleep: 'nap', lookout: 'watch' };
// Seconds without input that Prowl's cat takes to sit (1.2) and to loaf (9).
const IDLE: Partial<Record<Pose, number>> = { sit: 2, groom: 2, loaf: 10 };

/** Pose the cat for this moment of the afternoon: `k` is progress through the current move (a leap), `up`
 *  whether a leap goes up, `now` the real time in ms. With `still` (reduced motion) it settles at once. */
export function pose(rig: CatRig, p: Pose, k: number, up: boolean, now: number, still = false) {
  rig.root.visible = !(p === 'gone' || p === 'inside' || p === 'hide');
  const dt = still ? 1 : rig.last ? Math.min(0.1, Math.max(0, (now - rig.last) / 1000)) : 0;
  rig.last = now;
  const pos = rig.root.position;
  if (rig.at && dt > 0 && !still) {
    const v = Math.hypot(pos.x - rig.at.x, pos.z - rig.at.z) / dt;
    rig.speed += (Math.min(v, 3) - rig.speed) * Math.min(1, dt * 8);
  }
  (rig.at ??= new THREE.Vector3()).copy(pos);
  if (!rig.root.visible) return;
  const busy = BUSY[p] ?? null;
  const drive: CatDrive = {
    speed: p === 'walk' ? Math.max(rig.speed, still ? 0.5 : 0) : 0,
    sneak: false,
    ground: p !== 'jump',
    leap: p === 'jump' ? { k, up } : null,
    busy,
    // Swipes and play repeat: a paw every 1.2 s.
    busyK: busy === 'swipe' ? ((now / 1000) % 1.2) / 1.2 : 0,
    idle: IDLE[p] ?? 0,
    look: null,
    frontDy: 0,
    backDy: 0,
    meowAgo: 99
  };
  rig.model.update(dt, drive);
}
