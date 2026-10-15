// Catio Prowl's painted textures: fur, lawn, floorboards, siding, shingles, fence boards, a rug, book
// spines and a few pictures for the walls. All drawn on canvases at load (no image files to fetch), and
// cached, so a texture is made once per session. Browser only.
import * as THREE from 'three';

const cache = new Map<string, THREE.Texture>();

/** Small deterministic random numbers, so every visit paints the same textures. */
export function rng(seed: number) {
  let s = seed >>> 0 || 1;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}

function canvasTexture(key: string, w: number, h: number, paint: (g: CanvasRenderingContext2D, w: number, h: number) => void, opts: { repeat?: boolean; color?: boolean } = {}): THREE.Texture {
  const hit = cache.get(key);
  if (hit) return hit;
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d')!;
  paint(g, w, h);
  const t = new THREE.CanvasTexture(c);
  if (opts.color !== false) t.colorSpace = THREE.SRGBColorSpace;
  if (opts.repeat !== false) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
  t.anisotropy = 4;
  cache.set(key, t);
  return t;
}

const hex = (c: string) => new THREE.Color(c);
const css = (c: THREE.Color) => `#${c.getHexString()}`;
const mix = (a: string, b: string, k: number) => css(hex(a).lerp(hex(b), k));
/** sRGB 0–255 channels of a #rrggbb colour (no colour management: canvas pixels are sRGB). */

/** Speckle a painted canvas with ±amp brightness noise. */
function grain(g: CanvasRenderingContext2D, w: number, h: number, amp: number, seed: number) {
  const img = g.getImageData(0, 0, w, h);
  const r = rng(seed);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = (r() - 0.5) * 2 * amp;
    img.data[i] = Math.max(0, Math.min(255, img.data[i] * (1 + n)));
    img.data[i + 1] = Math.max(0, Math.min(255, img.data[i + 1] * (1 + n)));
    img.data[i + 2] = Math.max(0, Math.min(255, img.data[i + 2] * (1 + n)));
  }
  g.putImageData(img, 0, 0);
}

// ---------- fur ----------

export interface Coat { base: string; dark: string; light: string; stripes: number; eye: string; nose: string }
const COATS: Record<string, Coat> = {
  '#d98a3d': { base: '#d4823a', dark: '#9c4f1c', light: '#f3d9b5', stripes: 0.75, eye: '#d9a62e', nose: '#d98a8a' },
  '#7d7f86': { base: '#8a8c92', dark: '#45474d', light: '#d5d7db', stripes: 0.7, eye: '#a3c44c', nose: '#c98c95' },
  '#2b2b2e': { base: '#26262a', dark: '#18181b', light: '#38383d', stripes: 0.1, eye: '#d9c43a', nose: '#3a3336' },
  '#e8d5b0': { base: '#e6cfa6', dark: '#c49d68', light: '#f8efde', stripes: 0.45, eye: '#c9a43a', nose: '#e0a3a3' },
  '#9a6b47': { base: '#94694a', dark: '#3b281b', light: '#dcc4a0', stripes: 0.9, eye: '#a9c24a', nose: '#b97a6e' },
  '#f2f0ea': { base: '#f2efe8', dark: '#e2ddd2', light: '#ffffff', stripes: 0.05, eye: '#6fa8dc', nose: '#eba9b2' }
};
export const coatOf = (c: string): Coat => COATS[c] ?? { base: c, dark: mix(c, '#000000', 0.45), light: mix(c, '#ffffff', 0.55), stripes: 0.5, eye: '#c9a43a', nose: '#d98a8a' };


/** Head fur (sphere UVs, the face at u = 0.25): forehead "M" stripes and cheek lines. */
export function furHead(coat: string): THREE.Texture {
  const k = coatOf(coat);
  return canvasTexture(`fur-head:${coat}`, 256, 128, (g, w, h) => {
    g.fillStyle = k.base; g.fillRect(0, 0, w, h);
    // Lighter lower face.
    const lg = g.createLinearGradient(0, h * 0.45, 0, h);
    lg.addColorStop(0, k.base); lg.addColorStop(1, k.light);
    g.fillStyle = lg; g.fillRect(0, h * 0.45, w, h * 0.55);
    if (k.stripes > 0.2) {
      g.strokeStyle = k.dark; g.globalAlpha = Math.min(1, k.stripes); g.lineCap = 'round';
      g.lineWidth = 3;
      for (const dx of [-14, -5, 5, 14]) { g.beginPath(); g.moveTo(w * 0.25 + dx, h * 0.12); g.lineTo(w * 0.25 + dx * 0.7, h * 0.36); g.stroke(); }
      g.lineWidth = 2.2;
      for (const side of [-1, 1]) for (const dy of [0, 7]) { g.beginPath(); g.moveTo(w * 0.25 + side * 22, h * 0.5 + dy); g.lineTo(w * 0.25 + side * 44, h * 0.46 + dy); g.stroke(); }
      // Stripes over the back of the head.
      g.lineWidth = 5;
      for (let i = 0; i < 5; i++) { const x = w * 0.62 + i * 14; g.beginPath(); g.moveTo(x, 0); g.lineTo(x + 4, h * 0.4); g.stroke(); }
      g.globalAlpha = 1;
    }
    grain(g, w, h, 0.05, 12);
  }, { repeat: false });
}

/** Tail and legs: one ring per capsule (rings on the tail, faint bars on the legs). */
export function furRings(coat: string, strength = 1): THREE.Texture {
  const k = coatOf(coat);
  return canvasTexture(`fur-rings:${coat}:${strength}`, 32, 64, (g, w, h) => {
    g.fillStyle = k.base; g.fillRect(0, 0, w, h);
    const band = g.createLinearGradient(0, h * 0.25, 0, h * 0.75);
    band.addColorStop(0, 'rgba(0,0,0,0)'); band.addColorStop(0.5, k.dark); band.addColorStop(1, 'rgba(0,0,0,0)');
    g.globalAlpha = Math.min(1, k.stripes * strength * 0.8);
    g.fillStyle = band; g.fillRect(0, h * 0.25, w, h * 0.5);
    g.globalAlpha = 1;
    grain(g, w, h, 0.05, 13);
  });
}

// ---------- outdoors ----------

export function lawn(): THREE.Texture {
  return canvasTexture('lawn', 512, 512, (g, w, h) => {
    g.fillStyle = '#7fa35a'; g.fillRect(0, 0, w, h);
    const r = rng(21);
    // Mottled patches, then thousands of blades.
    for (let i = 0; i < 70; i++) {
      const x = r() * w, y = r() * h, rad = 20 + r() * 60;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      const c = r() < 0.5 ? 'rgba(98,140,62,0.35)' : 'rgba(160,180,90,0.25)';
      gr.addColorStop(0, c); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr;
      for (const ox of [-w, 0, w]) for (const oy of [-h, 0, h]) { g.save(); g.translate(ox, oy); g.fillRect(x - rad, y - rad, rad * 2, rad * 2); g.restore(); }
    }
    for (let i = 0; i < 9000; i++) {
      const x = r() * w, y = r() * h, l = 3 + r() * 6;
      const t = r();
      g.strokeStyle = t < 0.33 ? '#5f8a3e' : t < 0.66 ? '#8fb865' : '#a7c77a';
      g.globalAlpha = 0.55;
      g.lineWidth = 1;
      g.beginPath(); g.moveTo(x, y); g.lineTo(x + (r() - 0.5) * 2, y - l); g.stroke();
    }
    g.globalAlpha = 1;
  });
}

export function concrete(): THREE.Texture {
  return canvasTexture('concrete', 256, 256, (g, w, h) => {
    g.fillStyle = '#b9b5ad'; g.fillRect(0, 0, w, h);
    const r = rng(15);
    for (let i = 0; i < 40; i++) {
      const x = r() * w, y = r() * h, rad = 10 + r() * 40;
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, r() < 0.5 ? 'rgba(120,115,105,0.18)' : 'rgba(225,222,215,0.2)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    g.fillStyle = 'rgba(70,65,60,0.5)';
    g.fillRect(0, 0, w, 2); g.fillRect(0, 0, 2, h);
    grain(g, w, h, 0.07, 16);
  });
}

export function pavers(): THREE.Texture {
  return canvasTexture('pavers', 256, 256, (g, w, h) => {
    g.fillStyle = '#9d968b'; g.fillRect(0, 0, w, h);
    const r = rng(5);
    for (let j = 0; j < 4; j++) for (let i = 0; i < 4; i++) {
      const off = j % 2 ? w / 8 : 0;
      g.fillStyle = mix('#c2b9aa', '#a99f90', r());
      g.fillRect(((i * w) / 4 + off) % w + 2, (j * h) / 4 + 2, w / 4 - 4, h / 4 - 4);
      if (off) g.fillRect(-w / 8 + 2, (j * h) / 4 + 2, w / 8 - 4, h / 4 - 4);
    }
    grain(g, w, h, 0.08, 6);
  });
}

export function fenceBoards(): THREE.Texture {
  return canvasTexture('fence', 256, 256, (g, w, h) => {
    const r = rng(9);
    const n = 8;
    for (let i = 0; i < n; i++) {
      g.fillStyle = mix('#a77b52', '#8a6240', r() * 0.8);
      g.fillRect((i * w) / n, 0, w / n, h);
      g.strokeStyle = 'rgba(60,40,25,0.25)';
      for (let k = 0; k < 6; k++) { const x = (i * w) / n + 3 + r() * (w / n - 6); g.beginPath(); g.moveTo(x, 0); g.bezierCurveTo(x + 2, h * 0.3, x - 2, h * 0.6, x + 1, h); g.stroke(); }
      g.fillStyle = 'rgba(40,25,15,0.55)';
      g.fillRect(((i + 1) * w) / n - 2, 0, 2, h);
    }
    grain(g, w, h, 0.06, 10);
  });
}

export function siding(color = '#dfe4e6'): THREE.Texture {
  return canvasTexture(`siding:${color}`, 128, 256, (g, w, h) => {
    const n = 8;
    for (let i = 0; i < n; i++) {
      const y = (i * h) / n;
      const gr = g.createLinearGradient(0, y, 0, y + h / n);
      gr.addColorStop(0, mix(color, '#000000', 0.18)); gr.addColorStop(0.15, color); gr.addColorStop(1, mix(color, '#ffffff', 0.12));
      g.fillStyle = gr; g.fillRect(0, y, w, h / n);
    }
    grain(g, w, h, 0.03, 4);
  });
}

export function shingles(): THREE.Texture {
  return canvasTexture('shingles', 256, 256, (g, w, h) => {
    g.fillStyle = '#4d4f55'; g.fillRect(0, 0, w, h);
    const r = rng(3);
    const rows = 8, cols = 6;
    for (let j = 0; j < rows; j++) for (let i = -1; i < cols; i++) {
      const x = (i + (j % 2) * 0.5) * (w / cols), y = (j * h) / rows;
      g.fillStyle = mix('#5b5e66', '#3e4046', r());
      g.fillRect(x + 1, y + 1, w / cols - 2, h / rows - 2);
      g.fillStyle = 'rgba(0,0,0,0.35)'; g.fillRect(x, y + h / rows - 3, w / cols, 3);
    }
    grain(g, w, h, 0.1, 8);
  });
}

/** Windows of a neighbour's house: a wall colour with two rows of windows. */
export function houseFace(color: string): THREE.Texture {
  return canvasTexture(`house:${color}`, 256, 128, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    for (let i = 0; i < 16; i++) { g.fillStyle = 'rgba(0,0,0,0.05)'; g.fillRect(0, i * 8, w, 1); }
    for (const row of [0.16, 0.58]) for (let i = 0; i < 4; i++) {
      const x = w * (0.08 + i * 0.24), y = h * row;
      g.fillStyle = '#f7f5ef'; g.fillRect(x - 3, y - 3, w * 0.14 + 6, h * 0.26 + 6);
      const gr = g.createLinearGradient(x, y, x, y + h * 0.26);
      gr.addColorStop(0, '#9fc3dc'); gr.addColorStop(1, '#4f6f86');
      g.fillStyle = gr; g.fillRect(x, y, w * 0.14, h * 0.26);
      g.fillStyle = '#f7f5ef'; g.fillRect(x + w * 0.07 - 1, y, 2, h * 0.26);
    }
  }, { repeat: false });
}

export function cloud(seed: number): THREE.Texture {
  return canvasTexture(`cloud:${seed}`, 256, 128, (g, w, h) => {
    const r = rng(seed);
    for (let i = 0; i < 22; i++) {
      const x = w * (0.18 + r() * 0.64), y = h * (0.45 + (r() - 0.5) * 0.35), rad = h * (0.16 + r() * 0.22);
      const gr = g.createRadialGradient(x, y, 0, x, y, rad);
      gr.addColorStop(0, 'rgba(255,255,255,0.9)'); gr.addColorStop(0.6, 'rgba(255,255,255,0.5)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
      g.fillStyle = gr; g.fillRect(x - rad, y - rad, rad * 2, rad * 2);
    }
    // Slightly grey undersides.
    g.globalCompositeOperation = 'source-atop';
    const sh = g.createLinearGradient(0, h * 0.35, 0, h * 0.8);
    sh.addColorStop(0, 'rgba(255,255,255,0)'); sh.addColorStop(1, 'rgba(170,180,195,0.6)');
    g.fillStyle = sh; g.fillRect(0, 0, w, h);
  }, { repeat: false });
}

// ---------- indoors ----------

export function floorboards(): THREE.Texture {
  return canvasTexture('floor', 512, 512, (g, w, h) => {
    const r = rng(17);
    const rows = 8; // 8 boards across the texture (it spans 1.2 m)
    for (let j = 0; j < rows; j++) {
      let x = -r() * w;
      while (x < w) {
        const len = w * (0.35 + r() * 0.5);
        g.fillStyle = mix('#c49a6c', '#a5774c', r());
        g.fillRect(x, (j * h) / rows, len, h / rows);
        g.strokeStyle = 'rgba(90,55,30,0.18)';
        for (let k = 0; k < 5; k++) { const y = (j * h) / rows + 4 + r() * (h / rows - 8); g.beginPath(); g.moveTo(x, y); g.bezierCurveTo(x + len * 0.3, y + 3, x + len * 0.6, y - 3, x + len, y + 1); g.stroke(); }
        g.fillStyle = 'rgba(60,35,20,0.45)'; g.fillRect(x + len - 1.5, (j * h) / rows, 1.5, h / rows);
        x += len;
      }
      g.fillStyle = 'rgba(60,35,20,0.5)'; g.fillRect(0, ((j + 1) * h) / rows - 2, w, 2);
    }
    grain(g, w, h, 0.05, 18);
  });
}

export function wallpaper(color: string): THREE.Texture {
  return canvasTexture(`paper:${color}`, 128, 128, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    g.fillStyle = mix(color, '#ffffff', 0.35);
    for (let i = 0; i < 4; i++) g.fillRect(i * 32 + 14, 0, 4, h);
    g.fillStyle = mix(color, '#b49a7a', 0.25);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { g.beginPath(); g.arc(i * 32 + 32, j * 32 + (i % 2) * 16, 2.2, 0, 7); g.fill(); }
    grain(g, w, h, 0.025, 19);
  });
}

export function rug(): THREE.Texture {
  return canvasTexture('rug', 512, 384, (g, w, h) => {
    g.fillStyle = '#8f3f3f'; g.fillRect(0, 0, w, h);
    g.strokeStyle = '#e9d8b4'; g.lineWidth = 10; g.strokeRect(22, 22, w - 44, h - 44);
    g.strokeStyle = '#2f4a5e'; g.lineWidth = 6; g.strokeRect(40, 40, w - 80, h - 80);
    g.fillStyle = '#e9d8b4';
    for (let i = 0; i < 6; i++) for (let j = 0; j < 4; j++) {
      const x = 80 + i * ((w - 160) / 5), y = 80 + j * ((h - 160) / 3);
      g.beginPath(); g.moveTo(x, y - 18); g.lineTo(x + 14, y); g.lineTo(x, y + 18); g.lineTo(x - 14, y); g.closePath(); g.fill();
    }
    g.fillStyle = '#c98d3a';
    g.beginPath(); g.moveTo(w / 2, h / 2 - 60); g.lineTo(w / 2 + 90, h / 2); g.lineTo(w / 2, h / 2 + 60); g.lineTo(w / 2 - 90, h / 2); g.closePath(); g.fill();
    grain(g, w, h, 0.12, 20);
  }, { repeat: false });
}

export function books(): THREE.Texture {
  return canvasTexture('books', 256, 512, (g, w, h) => {
    g.fillStyle = '#5c4636'; g.fillRect(0, 0, w, h);
    const r = rng(31);
    const shelves = 4;
    const cols = ['#8f3f3f', '#2f5d8a', '#3f6f4f', '#c98d3a', '#e9d8b4', '#4a4a52', '#a15c00', '#6f4b8a'];
    for (let s = 0; s < shelves; s++) {
      const y1 = ((s + 1) * h) / shelves - 10, y0 = (s * h) / shelves + 14;
      let x = 10;
      while (x < w - 16) {
        const bw = 8 + r() * 14, bh = (y1 - y0) * (0.7 + r() * 0.3);
        g.fillStyle = cols[Math.floor(r() * cols.length)];
        if (r() < 0.08) { x += 12; continue; }
        g.fillRect(x, y1 - bh, bw, bh);
        g.fillStyle = 'rgba(255,255,255,0.25)'; g.fillRect(x + 2, y1 - bh + 6, bw - 4, 3);
        x += bw + 1;
      }
      g.fillStyle = '#7a5f48'; g.fillRect(0, y1, w, 10);
    }
  }, { repeat: false });
}

export function cabinetDoors(color: string, rows = 1, cols = 2): THREE.Texture {
  return canvasTexture(`cab:${color}:${rows}:${cols}`, 256, 256, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    for (let i = 0; i < cols; i++) for (let j = 0; j < rows; j++) {
      const x = (i * w) / cols, y = (j * h) / rows, cw = w / cols, ch = h / rows;
      g.strokeStyle = 'rgba(0,0,0,0.3)'; g.lineWidth = 3; g.strokeRect(x + 4, y + 4, cw - 8, ch - 8);
      g.strokeStyle = 'rgba(255,255,255,0.18)'; g.lineWidth = 2; g.strokeRect(x + 14, y + 14, cw - 28, ch - 28);
      g.fillStyle = '#c9c4ba';
      const hx = rows > 1 ? x + cw / 2 - 12 : i % 2 ? x + 16 : x + cw - 20;
      const hy = rows > 1 ? y + 16 : y + ch / 2 - 14;
      if (rows > 1) g.fillRect(hx, hy, 24, 4); else g.fillRect(hx, hy, 4, 28);
    }
    grain(g, w, h, 0.03, 22);
  }, { repeat: false });
}

/** A framed picture: 0 hills at sunset, 1 a cat silhouette on a moon, 2 an abstract of stripes. */
export function picture(kind: number): THREE.Texture {
  return canvasTexture(`pic:${kind}`, 192, 144, (g, w, h) => {
    g.fillStyle = '#2b2622'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f4efe6'; g.fillRect(8, 8, w - 16, h - 16);
    const x0 = 20, y0 = 20, iw = w - 40, ih = h - 40;
    g.save(); g.beginPath(); g.rect(x0, y0, iw, ih); g.clip();
    if (kind === 0) {
      const sky = g.createLinearGradient(0, y0, 0, y0 + ih);
      sky.addColorStop(0, '#f0b36b'); sky.addColorStop(1, '#f6dcb0');
      g.fillStyle = sky; g.fillRect(x0, y0, iw, ih);
      g.fillStyle = '#f7e08a'; g.beginPath(); g.arc(x0 + iw * 0.65, y0 + ih * 0.45, 14, 0, 7); g.fill();
      g.fillStyle = '#6f8f5a'; g.beginPath(); g.moveTo(x0, y0 + ih); g.quadraticCurveTo(x0 + iw * 0.3, y0 + ih * 0.35, x0 + iw * 0.6, y0 + ih * 0.8); g.quadraticCurveTo(x0 + iw * 0.85, y0 + ih * 0.5, x0 + iw, y0 + ih * 0.7); g.lineTo(x0 + iw, y0 + ih); g.fill();
    } else if (kind === 1) {
      g.fillStyle = '#2f3f5e'; g.fillRect(x0, y0, iw, ih);
      g.fillStyle = '#f4e6b0'; g.beginPath(); g.arc(x0 + iw / 2, y0 + ih / 2, ih * 0.36, 0, 7); g.fill();
      g.fillStyle = '#1b1b1f';
      const cx = x0 + iw / 2, cy = y0 + ih * 0.8;
      g.beginPath(); g.ellipse(cx, cy - 12, 14, 18, 0, 0, 7); g.fill();
      g.beginPath(); g.arc(cx, cy - 36, 9, 0, 7); g.fill();
      g.beginPath(); g.moveTo(cx - 8, cy - 40); g.lineTo(cx - 6, cy - 50); g.lineTo(cx - 2, cy - 43); g.fill();
      g.beginPath(); g.moveTo(cx + 8, cy - 40); g.lineTo(cx + 6, cy - 50); g.lineTo(cx + 2, cy - 43); g.fill();
      g.lineWidth = 4; g.strokeStyle = '#1b1b1f'; g.beginPath(); g.moveTo(cx + 12, cy - 2); g.quadraticCurveTo(cx + 34, cy, cx + 30, cy - 24); g.stroke();
      g.fillRect(x0, cy + 4, iw, ih);
    } else {
      const cols = ['#c98d3a', '#2f5d8a', '#e9d8b4', '#8f3f3f', '#3f6f4f'];
      for (let i = 0; i < 9; i++) { g.fillStyle = cols[i % cols.length]; g.fillRect(x0 + (i * iw) / 9, y0, iw / 9 + 1, ih); }
      g.fillStyle = 'rgba(244,239,230,0.85)'; g.beginPath(); g.arc(x0 + iw * 0.35, y0 + ih * 0.55, ih * 0.28, 0, 7); g.fill();
    }
    g.restore();
  }, { repeat: false });
}

export function soft(color: string): THREE.Texture {
  return canvasTexture(`soft:${color}`, 128, 128, (g, w, h) => {
    g.fillStyle = color; g.fillRect(0, 0, w, h);
    g.strokeStyle = mix(color, '#000000', 0.12); g.globalAlpha = 0.4;
    for (let i = 0; i < w; i += 3) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, h); g.stroke(); }
    g.globalAlpha = 1;
    grain(g, w, h, 0.05, 23);
  });
}

/** A soft round shadow for under the cat. */
export function blob(): THREE.Texture {
  return canvasTexture('blob', 64, 64, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(0,0,0,0.5)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, { repeat: false });
}

/** A soft dot for dust motes. */
export function mote(): THREE.Texture {
  return canvasTexture('mote', 32, 32, (g, w, h) => {
    const gr = g.createRadialGradient(w / 2, h / 2, 0, w / 2, h / 2, w / 2);
    gr.addColorStop(0, 'rgba(255,245,220,1)'); gr.addColorStop(1, 'rgba(255,245,220,0)');
    g.fillStyle = gr; g.fillRect(0, 0, w, h);
  }, { repeat: false });
}

export function foliage(): THREE.Texture {
  return canvasTexture('foliage', 256, 256, (g, w, h) => {
    g.fillStyle = '#ffffff'; g.fillRect(0, 0, w, h);
    const r = rng(41);
    for (let i = 0; i < 1400; i++) {
      const x = r() * w, y = r() * h, rad = 2 + r() * 5;
      g.fillStyle = `rgba(${r() < 0.5 ? '40,70,30' : '230,245,200'},${0.15 + r() * 0.25})`;
      g.beginPath(); g.ellipse(x, y, rad, rad * 0.6, r() * 3, 0, 7); g.fill();
    }
  });
}

export function clockFace(): THREE.Texture {
  return canvasTexture('clock', 128, 128, (g, w, h) => {
    g.fillStyle = '#2b2622'; g.fillRect(0, 0, w, h);
    g.fillStyle = '#f7f3ea'; g.beginPath(); g.arc(w / 2, h / 2, w * 0.44, 0, 7); g.fill();
    g.fillStyle = '#2b2622';
    for (let i = 0; i < 12; i++) { const a = (i / 12) * Math.PI * 2; g.fillRect(w / 2 + Math.cos(a) * w * 0.36 - 2, h / 2 + Math.sin(a) * h * 0.36 - 2, 4, 4); }
    g.strokeStyle = '#2b2622'; g.lineCap = 'round';
    g.lineWidth = 4; g.beginPath(); g.moveTo(w / 2, h / 2); g.lineTo(w / 2 + w * 0.18, h / 2 - h * 0.1); g.stroke();
    g.lineWidth = 3; g.beginPath(); g.moveTo(w / 2, h / 2); g.lineTo(w / 2 - w * 0.05, h / 2 - h * 0.32); g.stroke();
  }, { repeat: false });
}

export function disposeTextures() {
  for (const t of cache.values()) t.dispose();
  cache.clear();
}
