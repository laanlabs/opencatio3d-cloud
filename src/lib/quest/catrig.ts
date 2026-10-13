// Stylised low-poly cat shared by Catio Quest's "Let them explore" and Catio Prowl: a rig of simple
// meshes and the poses both games use (walk, jump, sit, loaf, sleep, scratch…).
import * as THREE from 'three';
import type { Pose } from './sim';

export interface CatRig {
  id: string;
  root: THREE.Group;
  body: THREE.Group;
  head: THREE.Mesh;
  tail: THREE.Mesh;
  legs: THREE.Mesh[];
  heading: number;
  anchor: THREE.Object3D;
}

export const mat = (color: string) => new THREE.MeshStandardMaterial({ color, roughness: 0.9, flatShading: true });

export function makeCat(id: string, coat: string, small: boolean): CatRig {
  const root = new THREE.Group();
  const body = new THREE.Group();
  const fur = mat(coat);
  const torso = new THREE.Mesh(new THREE.IcosahedronGeometry(0.1, 1), fur);
  torso.scale.set(0.85, 0.8, 1.6);
  torso.position.set(0, 0.17, 0);
  const head = new THREE.Mesh(new THREE.IcosahedronGeometry(0.068, 1), fur);
  head.position.set(0, 0.25, 0.16);
  const ear = new THREE.ConeGeometry(0.024, 0.055, 4);
  const e1 = new THREE.Mesh(ear, fur), e2 = new THREE.Mesh(ear, fur);
  e1.position.set(-0.034, 0.055, 0); e2.position.set(0.034, 0.055, 0);
  head.add(e1, e2);
  const eyeMat = new THREE.MeshBasicMaterial({ color: '#1d1c1a' });
  for (const x of [-0.025, 0.025]) { const eye = new THREE.Mesh(new THREE.SphereGeometry(0.009, 6, 6), eyeMat); eye.position.set(x, 0.012, 0.058); head.add(eye); }
  const tail = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.018, 0.26, 6), fur);
  tail.geometry.translate(0, 0.13, 0);
  tail.position.set(0, 0.2, -0.15);
  tail.rotation.x = -0.9;
  const legs: THREE.Mesh[] = [];
  const legGeo = new THREE.CylinderGeometry(0.016, 0.014, 0.12, 5);
  legGeo.translate(0, -0.06, 0);
  for (const [x, z] of [[-0.045, 0.1], [0.045, 0.1], [-0.045, -0.1], [0.045, -0.1]] as const) {
    const leg = new THREE.Mesh(legGeo, fur);
    leg.position.set(x, 0.12, z);
    legs.push(leg);
  }
  body.add(torso, head, tail, ...legs);
  for (const m of [torso, head, tail, ...legs]) m.castShadow = true;
  root.add(body);
  root.scale.setScalar(small ? 0.75 : 1);
  return { id, root, body, head, tail, legs, heading: 0, anchor: new THREE.Object3D() };
}

/** Curl the tail forward along the right flank, inside the torso's footprint. Settled cats face into the catio with their backs to the wall,
 *  so a tail held out behind would poke through the mesh and read as an escape. `tilt` undoes the body's pitch. */
function curl(tail: THREE.Mesh, tilt: number, swish: number) {
  tail.position.set(0.06, 0.06, -0.12);
  tail.rotation.set(1.5 - tilt, 0, swish * 0.05);
}

/** Pose the rig for a moment. `phase` drives walk cycles and idle motion. */
export function pose(rig: CatRig, p: Pose, phase: number, k: number) {
  const { body, head, tail, legs } = rig;
  body.rotation.set(0, 0, 0);
  body.position.set(0, 0, 0);
  body.scale.set(1, 1, 1);
  head.position.set(0, 0.25, 0.16);
  head.rotation.set(0, 0, 0);
  tail.position.set(0, 0.2, -0.15);
  tail.rotation.set(-0.9, 0, Math.sin(phase * 0.7) * 0.25);
  const swish = Math.sin(phase * 0.7);
  legs.forEach((l) => { l.visible = true; l.rotation.set(0, 0, 0); });
  rig.root.visible = !(p === 'gone' || p === 'inside' || p === 'hide');
  switch (p) {
    case 'walk': {
      const sw = Math.sin(phase * 9) * 0.6;
      legs[0].rotation.x = sw; legs[3].rotation.x = sw; legs[1].rotation.x = -sw; legs[2].rotation.x = -sw;
      body.position.y = Math.abs(Math.sin(phase * 9)) * 0.01;
      tail.rotation.x = -1.2;
      break;
    }
    case 'jump': {
      body.scale.set(1, 0.95, 1.15);
      body.rotation.x = -0.35 * Math.cos(Math.PI * k);
      legs[0].rotation.x = -0.9; legs[1].rotation.x = -0.9; legs[2].rotation.x = 0.9; legs[3].rotation.x = 0.9;
      tail.rotation.x = -1.4;
      break;
    }
    case 'sit': case 'lookout': {
      body.rotation.x = -0.55;
      body.position.y = 0.02;
      head.rotation.x = 0.45;
      head.rotation.y = p === 'lookout' ? Math.sin(phase * 0.8) * 0.6 : 0;
      legs[2].visible = legs[3].visible = false;
      curl(tail, -0.55, swish);
      break;
    }
    case 'loaf': {
      body.scale.set(1.05, 0.72, 1);
      body.position.y = -0.04;
      legs.forEach((l) => (l.visible = false));
      head.position.set(0, 0.2, 0.15);
      curl(tail, 0, swish);
      break;
    }
    case 'sleep': {
      body.scale.set(1.15, 0.6, 0.85);
      body.position.y = -0.05;
      body.rotation.y = 0.5;
      legs.forEach((l) => (l.visible = false));
      head.position.set(0.06, 0.15, 0.12);
      head.rotation.set(0.5, 0.6, 0.3);
      curl(tail, 0, 0);
      body.scale.y = 0.6 + Math.sin(phase * 1.5) * 0.02;
      break;
    }
    case 'scratch': case 'paw': {
      body.rotation.x = p === 'scratch' ? -1.05 : -0.3;
      body.position.y = p === 'scratch' ? 0.05 : 0;
      const sw = Math.sin(phase * 10) * 0.5;
      legs[0].rotation.x = -1.4 + sw; legs[1].rotation.x = -1.4 - sw;
      tail.rotation.x = p === 'scratch' ? 0.9 : -0.15;
      break;
    }
    case 'drink': case 'sniff': case 'toilet': {
      body.rotation.x = p === 'toilet' ? -0.25 : 0.2;
      head.position.set(0, 0.17, 0.2);
      head.rotation.x = 0.7 + Math.sin(phase * 4) * 0.08;
      if (p === 'toilet') { body.scale.y = 0.85; legs.forEach((l) => (l.visible = false)); }
      curl(tail, p === 'toilet' ? -0.25 : 0.2, swish);
      break;
    }
    case 'play': {
      const b = Math.abs(Math.sin(phase * 5));
      body.position.y = b * 0.08;
      body.rotation.x = -0.25 * b;
      legs[0].rotation.x = -0.8 * b; legs[1].rotation.x = -0.8 * b;
      tail.rotation.x = -0.15;
      break;
    }
    case 'groom': {
      body.rotation.x = -0.5;
      head.rotation.set(0.5 + Math.sin(phase * 3) * 0.2, 0.7, 0);
      legs[2].visible = legs[3].visible = false;
      curl(tail, -0.5, swish);
      break;
    }
  }
}
