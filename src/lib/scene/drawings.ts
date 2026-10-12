// Standalone SVG drawings (explicit colours, no CSS variables) for the build package and image
// exports: a dimensioned site plan, and per-structure elevations projected from the generated parts,
// so every drawing shows exactly the members the cut list counts.
import type { Assembly } from '../generate/assembly';
import type { Part } from '../generate/parts';
import type { Project, Structure, Units, Vec2 } from '../model/types';
import { footprints, toPlan, wallDir, wallNormal } from '../model/geometry';
import { fmtLen } from '../model/units';
import { sceneBounds } from './bounds';

const esc = (s: string) => s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]!);
const f = (n: number) => (Math.round(n * 1000) / 1000).toString();
const pts = (poly: Vec2[]) => poly.map((q) => `${f(q[0])},${f(q[1])}`).join(' ');

const OPENING: Record<string, string> = { window: '#5b9bd5', door: '#8a5a3c', 'patio-door': '#5b9bd5', vent: '#8f969c', 'dryer-vent': '#c0504d', utility: '#7a6aa8', meter: '#7a6aa8', downspout: '#6b7d8a' };

function dimLine(a: Vec2, b: Vec2, offset: Vec2, label: string, size: number): string {
  const A: Vec2 = [a[0] + offset[0], a[1] + offset[1]], B: Vec2 = [b[0] + offset[0], b[1] + offset[1]];
  const mid: Vec2 = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2];
  const ang = (Math.atan2(B[1] - A[1], B[0] - A[0]) * 180) / Math.PI;
  const up = ang > 90 || ang < -90 ? ang + 180 : ang;
  const tick = size * 0.6;
  return `<g stroke="#26364d" stroke-width="${f(size * 0.08)}" fill="#26364d">` +
    `<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(A[0])}" y2="${f(A[1])}" stroke-opacity=".4"/><line x1="${f(b[0])}" y1="${f(b[1])}" x2="${f(B[0])}" y2="${f(B[1])}" stroke-opacity=".4"/>` +
    `<line x1="${f(A[0])}" y1="${f(A[1])}" x2="${f(B[0])}" y2="${f(B[1])}"/>` +
    `<circle cx="${f(A[0])}" cy="${f(A[1])}" r="${f(tick * 0.18)}"/><circle cx="${f(B[0])}" cy="${f(B[1])}" r="${f(tick * 0.18)}"/>` +
    `<text x="${f(mid[0])}" y="${f(mid[1])}" dy="${f(-size * 0.35)}" font-size="${f(size)}" text-anchor="middle" stroke="none" font-family="-apple-system, Helvetica, Arial, sans-serif" font-weight="600" transform="rotate(${f(up)} ${f(mid[0])} ${f(mid[1])})">${esc(label)}</text></g>`;
}

/** Site plan in metres (viewBox), with house walls, openings, obstacles, structures, posts and labels. */
export function planSvg(p: Project, a: Assembly, units: Units, opts: { width?: number; dims?: boolean } = {}): string {
  const b = sceneBounds(p);
  const pad = 1.4;
  const x0 = b.min[0] - pad, y0 = b.min[1] - pad - 1.2, W = b.max[0] - b.min[0] + pad * 2, H = b.max[1] - b.min[1] + pad * 2 + 1.2;
  const fs = Math.max(0.16, Math.min(W, H) / 45);
  const out: string[] = [];
  out.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(x0)} ${f(y0)} ${f(W)} ${f(H)}" width="${opts.width ?? 1600}" height="${Math.round((opts.width ?? 1600) * (H / W))}" font-family="-apple-system, Helvetica, Arial, sans-serif">`);
  out.push(`<rect x="${f(x0)}" y="${f(y0)}" width="${f(W)}" height="${f(H)}" fill="#ffffff"/>`);
  // 1 m (or 1 ft) grid
  const step = units === 'imperial' ? 0.3048 : 0.5;
  for (let x = Math.ceil(x0 / step) * step; x < x0 + W; x += step) out.push(`<line x1="${f(x)}" y1="${f(y0)}" x2="${f(x)}" y2="${f(y0 + H)}" stroke="#eeeae2" stroke-width="${f(fs * 0.05)}"/>`);
  for (let y = Math.ceil(y0 / step) * step; y < y0 + H; y += step) out.push(`<line x1="${f(x0)}" y1="${f(y)}" x2="${f(x0 + W)}" y2="${f(y)}" stroke="#eeeae2" stroke-width="${f(fs * 0.05)}"/>`);
  for (const w of p.site.walls) {
    const n = wallNormal(w), d = wallDir(w);
    out.push(`<polygon points="${pts([w.a, w.b, [w.b[0] - n[0] * 0.2, w.b[1] - n[1] * 0.2], [w.a[0] - n[0] * 0.2, w.a[1] - n[1] * 0.2]])}" fill="#59544c"/>`);
    out.push(`<polygon points="${pts([[w.a[0] - n[0] * 0.2, w.a[1] - n[1] * 0.2], [w.b[0] - n[0] * 0.2, w.b[1] - n[1] * 0.2], [w.b[0] - n[0] * 1.2, w.b[1] - n[1] * 1.2], [w.a[0] - n[0] * 1.2, w.a[1] - n[1] * 1.2]])}" fill="#ebe5da"/>`);
    out.push(`<text x="${f((w.a[0] + w.b[0]) / 2 - n[0] * 0.7)}" y="${f((w.a[1] + w.b[1]) / 2 - n[1] * 0.7)}" font-size="${f(fs)}" text-anchor="middle" fill="#6b665e">House</text>`);
    for (const o of w.openings) {
      const A: Vec2 = [w.a[0] + d[0] * o.offset, w.a[1] + d[1] * o.offset], B: Vec2 = [A[0] + d[0] * o.width, A[1] + d[1] * o.width];
      out.push(`<line x1="${f(A[0])}" y1="${f(A[1])}" x2="${f(B[0])}" y2="${f(B[1])}" stroke="${OPENING[o.kind] ?? '#999'}" stroke-width="0.12"/>`);
      if (o.kind !== 'window' && o.kind !== 'door' && o.kind !== 'patio-door') out.push(`<text x="${f((A[0] + B[0]) / 2 + n[0] * 0.25)}" y="${f((A[1] + B[1]) / 2 + n[1] * 0.25)}" font-size="${f(fs * 0.7)}" text-anchor="middle" fill="#6b665e">${esc(o.name || o.kind)}</text>`);
    }
  }
  for (const o of p.site.obstacles) out.push(`<circle cx="${f(o.x)}" cy="${f(o.y)}" r="${f(Math.max(o.width, o.depth) / 2)}" fill="${o.kind === 'tree' ? '#9db88a' : '#c9ccd0'}" fill-opacity=".6"/><text x="${f(o.x)}" y="${f(o.y)}" font-size="${f(fs * 0.7)}" text-anchor="middle" fill="#45423d">${esc(o.name || o.kind)}</text>`);
  for (const s of p.structures) {
    const info = a.structures.find((x) => x.id === s.id);
    for (const fp of footprints(s)) out.push(`<polygon points="${pts(fp)}" fill="#f4e6d8" stroke="#9a5a2c" stroke-width="${f(fs * 0.12)}"/>`);
    for (const pt of a.parts) {
      if (pt.structureId !== s.id || pt.geom?.type !== 'bar' || !['stud', 'jamb', 'hoop-post'].includes(pt.role)) continue;
      const q = toPlan(s, pt.geom.a[0], pt.geom.a[2]);
      out.push(`<rect x="${f(q[0] - 0.035)}" y="${f(q[1] - 0.035)}" width="0.07" height="0.07" fill="#9a5a2c"/>`);
    }
    const c = s.template === 'tunnel' ? toPlan(s, ...(s.path?.[Math.floor((s.path.length - 1) / 2)] ?? [0, 0])) : toPlan(s, s.width / 2, s.depth / 2);
    out.push(`<text x="${f(c[0])}" y="${f(c[1])}" font-size="${f(fs * 1.1)}" text-anchor="middle" font-weight="700" fill="#18243a">${esc(`${info?.letter ?? ''} · ${s.name}`)}</text>`);
    if (opts.dims !== false && s.template !== 'tunnel') {
      const o = fs * 2.2;
      const r = (s.rotation * Math.PI) / 180, ux: Vec2 = [Math.cos(r), Math.sin(r)], vy: Vec2 = [-Math.sin(r), Math.cos(r)];
      out.push(dimLine(toPlan(s, 0, s.depth), toPlan(s, s.width, s.depth), [vy[0] * o, vy[1] * o], fmtLen(s.width, units), fs * 0.9));
      out.push(dimLine(toPlan(s, s.width, 0), toPlan(s, s.width, s.depth), [ux[0] * o, ux[1] * o], fmtLen(s.depth, units), fs * 0.9));
    }
  }
  // North arrow and scale bar
  const nx = x0 + W - fs * 3, ny = y0 + fs * 3;
  out.push(`<g transform="rotate(${f(-p.site.northDeg)} ${f(nx)} ${f(ny)})"><path d="M${f(nx)},${f(ny - fs * 1.6)} L${f(nx + fs * 0.6)},${f(ny + fs)} L${f(nx)},${f(ny + fs * 0.5)} L${f(nx - fs * 0.6)},${f(ny + fs)} Z" fill="#26364d"/><text x="${f(nx)}" y="${f(ny - fs * 1.9)}" font-size="${f(fs)}" text-anchor="middle" fill="#26364d" font-weight="700">N</text></g>`);
  const bar = units === 'imperial' ? 0.3048 * 5 : 1;
  out.push(`<g fill="#26364d"><rect x="${f(x0 + fs)}" y="${f(y0 + H - fs * 1.6)}" width="${f(bar)}" height="${f(fs * 0.25)}"/><text x="${f(x0 + fs)}" y="${f(y0 + H - fs * 1.9)}" font-size="${f(fs * 0.8)}">${units === 'imperial' ? '5 ft' : '1 m'}</text></g>`);
  out.push('</svg>');
  return out.join('');
}

export type ElevationView = 'front' | 'side' | 'top';

/** Orthographic elevation of one structure from its parts: front (u, y), side (v, y) or roof plan (u, v). */
export function elevationSvg(s: Structure, parts: Part[], view: ElevationView, units: Units, opts: { width?: number; labels?: boolean } = {}): string {
  const proj = (q: [number, number, number]): Vec2 => (view === 'front' ? [q[0], -q[1]] : view === 'side' ? [q[2], -q[1]] : [q[0], q[2]]);
  const all: Vec2[] = [];
  for (const p of parts) {
    const g = p.geom;
    if (!g) continue;
    if (g.type === 'bar') all.push(proj(g.a), proj(g.b));
    else if (g.type === 'quad') all.push(...g.p.map(proj));
    else all.push(proj([g.c[0] - g.s[0] / 2, g.c[1] - g.s[1] / 2, g.c[2] - g.s[2] / 2]), proj([g.c[0] + g.s[0] / 2, g.c[1] + g.s[1] / 2, g.c[2] + g.s[2] / 2]));
  }
  if (!all.length) all.push([0, 0], [1, -1]);
  const minX = Math.min(...all.map((q) => q[0])), maxX = Math.max(...all.map((q) => q[0])), minY = Math.min(...all.map((q) => q[1])), maxY = Math.max(...all.map((q) => q[1]));
  const fs = Math.max(0.06, (maxX - minX) / 30);
  const pad = fs * 4;
  const vx = minX - pad, vy = minY - pad, vw = maxX - minX + pad * 2, vh = maxY - minY + pad * 2;
  const width = opts.width ?? 700;
  const pat = `mesh-${view}-${s.id.slice(0, 8)}`;
  const out: string[] = [`<svg xmlns="http://www.w3.org/2000/svg" viewBox="${f(vx)} ${f(vy)} ${f(vw)} ${f(vh)}" width="${width}" height="${Math.round((width * vh) / vw)}" font-family="-apple-system, Helvetica, Arial, sans-serif">`];
  out.push(`<rect x="${f(vx)}" y="${f(vy)}" width="${f(vw)}" height="${f(vh)}" fill="#fff"/>`);
  if (view !== 'top') out.push(`<line x1="${f(vx)}" y1="0" x2="${f(vx + vw)}" y2="0" stroke="#8a8378" stroke-width="${f(fs * 0.12)}"/>`);
  // Mesh and sheets first, members on top, labels last.
  const order = (p: Part) => (p.geom?.type === 'quad' ? 0 : p.geom?.type === 'box' ? 1 : 2);
  const sorted = [...parts].filter((p) => p.geom).sort((x, y) => order(x) - order(y));
  for (const p of sorted) {
    const g = p.geom!;
    if (g.type === 'quad') {
      const q = g.p.map(proj);
      const isMesh = p.role.startsWith('mesh');
      out.push(`<polygon points="${pts(q)}" fill="${isMesh ? `url(#${pat})` : p.role === 'roof-sheet' ? '#dbe9f0' : '#eee'}" fill-opacity="${isMesh ? 1 : 0.6}" stroke="${isMesh ? '#b8bec4' : '#9aa1a6'}" stroke-width="${f(fs * 0.03)}"/>`);
    } else if (g.type === 'box') {
      const a = proj([g.c[0] - g.s[0] / 2, g.c[1] - g.s[1] / 2, g.c[2] - g.s[2] / 2]), b = proj([g.c[0] + g.s[0] / 2, g.c[1] + g.s[1] / 2, g.c[2] + g.s[2] / 2]);
      out.push(`<rect x="${f(Math.min(a[0], b[0]))}" y="${f(Math.min(a[1], b[1]))}" width="${f(Math.abs(b[0] - a[0]))}" height="${f(Math.abs(b[1] - a[1]))}" fill="#e7dccd" stroke="#8a7a68" stroke-width="${f(fs * 0.04)}"/>`);
    } else {
      const a = proj(g.a), b = proj(g.b);
      const thick = view === 'top' || p.role.endsWith('-board') ? g.size[0] : g.size[1];
      out.push(`<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="#b77a4f" stroke-width="${f(Math.max(thick, fs * 0.15))}" stroke-linecap="butt"/>`);
      out.push(`<line x1="${f(a[0])}" y1="${f(a[1])}" x2="${f(b[0])}" y2="${f(b[1])}" stroke="#6b4428" stroke-width="${f(fs * 0.03)}"/>`);
    }
  }
  if (opts.labels !== false) {
    const seen = new Set<string>();
    for (const p of sorted) {
      if (!p.label || p.geom?.type !== 'bar' || seen.has(p.label) || p.kind !== 'member') continue;
      const a = proj(p.geom.a), b = proj(p.geom.b);
      const m: Vec2 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      // Skip labels that would sit on top of one already drawn.
      const key = `${Math.round(m[0] / (fs * 1.6))}:${Math.round(m[1] / (fs * 1.2))}`;
      if (seen.has(key)) continue;
      seen.add(key); seen.add(p.label);
      out.push(`<text x="${f(m[0])}" y="${f(m[1])}" font-size="${f(fs * 0.7)}" text-anchor="middle" dominant-baseline="middle" fill="#18243a" stroke="#fff" stroke-width="${f(fs * 0.15)}" paint-order="stroke">${esc(p.label)}</text>`);
    }
  }
  // Overall dimensions.
  const W = maxX - minX, Hh = maxY - minY;
  out.push(dimLine([minX, maxY], [maxX, maxY], [0, fs * 2.2], fmtLen(W, units), fs * 0.85));
  out.push(dimLine([maxX, minY], [maxX, maxY], [fs * 2.2, 0], fmtLen(Hh, units), fs * 0.85));
  out.push(`<defs><pattern id="${pat}" width="${f(Math.max(0.0254, fs * 0.4))}" height="${f(Math.max(0.0254, fs * 0.4))}" patternUnits="userSpaceOnUse"><path d="M0 0H${f(Math.max(0.0254, fs * 0.4))}M0 0V${f(Math.max(0.0254, fs * 0.4))}" stroke="#a7aeb5" stroke-width="${f(fs * 0.02)}"/></pattern></defs>`);
  out.push('</svg>');
  return out.join('');
}

/** Renders an SVG string to a PNG blob (browser only). */
export async function svgToPng(svg: string, width: number): Promise<Blob> {
  const img = new Image();
  const url = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((ok, fail) => { img.onload = () => ok(); img.onerror = () => fail(new Error('Could not draw the plan')); img.src = url; });
    const h = Math.round((img.naturalHeight / img.naturalWidth) * width) || width;
    const c = document.createElement('canvas');
    c.width = width; c.height = h;
    c.getContext('2d')!.drawImage(img, 0, 0, width, h);
    return await new Promise<Blob>((ok, fail) => c.toBlob((b) => (b ? ok(b) : fail(new Error('PNG export failed'))), 'image/png'));
  } finally {
    URL.revokeObjectURL(url);
  }
}
