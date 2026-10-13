// The Catio Quest result card: a 1200×630 PNG drawn on a canvas in the browser (score breakdown, a
// plan thumbnail of the catio, the cats' names). Shared with the Web Share API or downloaded — never
// uploaded anywhere.
import type { Project } from '../model/types';
import { catalog } from '../catalog/catalog';
import { mainStructure } from './design';
import { SCORE_ICON, SCORE_LABEL } from './score';
import { SCORE_KEYS, type Scenario, type Scores } from './types';

const C = { cream: '#faf7f1', ink: '#1d1c1a', dusk: '#26364d', cedar: '#9a5a2c', sun: '#e8a93a', leaf: '#3f6f4f', line: '#e5dfd4', muted: '#6b665e', bad: '#b3261e' };
const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Helvetica Neue', sans-serif";

function roundRect(g: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  g.beginPath();
  g.moveTo(x + r, y);
  g.arcTo(x + w, y, x + w, y + h, r);
  g.arcTo(x + w, y + h, x, y + h, r);
  g.arcTo(x, y + h, x, y, r);
  g.arcTo(x, y, x + w, y, r);
  g.closePath();
}

/** Top-down plan of the catio inside a box. */
function drawPlan(g: CanvasRenderingContext2D, p: Project, x: number, y: number, w: number, h: number) {
  const s = mainStructure(p);
  if (!s) return;
  const k = Math.min((w - 40) / s.width, (h - 60) / s.depth);
  const ox = x + (w - s.width * k) / 2, oy = y + 30;
  g.fillStyle = '#ebe5da';
  if (s.template !== 'freestanding') g.fillRect(x + 10, oy - 22, w - 20, 16);
  g.fillStyle = s.base.kind === 'pavers' ? '#d9d3c7' : '#e4ecd6';
  g.fillRect(ox, oy, s.width * k, s.depth * k);
  const cover = s.roof.kind === 'mesh' ? 0 : s.roof.kind === 'partial' ? s.roof.coverFraction ?? 0.5 : 1;
  if (cover) { g.fillStyle = 'rgba(120,128,138,.25)'; g.fillRect(ox, oy, s.width * k, s.depth * k * cover); }
  g.strokeStyle = C.cedar; g.lineWidth = 5;
  g.strokeRect(ox, oy, s.width * k, s.depth * k);
  for (const f of s.furnishings) {
    const c = catalog.component(f.componentId);
    if (!c) continue;
    const len = (f.length ?? c.defaults.length) * k, dep = Math.max(8, c.defaults.depth * k), t = f.offset * k;
    let r: [number, number, number, number];
    switch (f.side) {
      case 'back': r = [ox + t, oy + 4, len, dep]; break;
      case 'front': r = [ox + t, oy + s.depth * k - dep - 4, len, dep]; break;
      case 'left': r = [ox + 4, oy + t, dep, len]; break;
      case 'right': r = [ox + s.width * k - dep - 4, oy + t, dep, len]; break;
      default: r = [ox + 6, oy + t - dep / 2, s.width * k - 12, dep];
    }
    g.fillStyle = c.category === 'planter' ? '#7fa36a' : c.mount === 'floor' ? '#f0dcc0' : '#d8b384';
    roundRect(g, ...r, 4);
    g.fill();
  }
}

export async function resultCard(sc: Scenario, layout: Project, r: Scores): Promise<Blob> {
  const W = 1200, H = 630;
  const cv = document.createElement('canvas');
  cv.width = W; cv.height = H;
  const g = cv.getContext('2d')!;
  g.fillStyle = C.cream; g.fillRect(0, 0, W, H);
  g.fillStyle = C.dusk; g.fillRect(0, 0, W, 96);
  g.fillStyle = '#fff';
  g.font = `800 40px ${FONT}`;
  g.fillText('Catio Quest', 40, 62);
  g.font = `600 24px ${FONT}`;
  g.fillStyle = '#e8eef6';
  g.textAlign = 'right';
  g.fillText(sc.title, W - 40, 60);
  g.textAlign = 'left';

  // Stars and overall.
  g.font = `52px ${FONT}`;
  g.fillStyle = C.sun;
  g.fillText('★'.repeat(r.stars) + '☆'.repeat(3 - r.stars), 40, 170);
  g.fillStyle = C.ink;
  g.font = `800 64px ${FONT}`;
  g.fillText(`${r.overall}`, 260, 172);
  g.font = `600 22px ${FONT}`;
  g.fillStyle = r.passed ? C.leaf : C.muted;
  g.fillText(r.passed ? 'Passed' : 'Keep designing', 360, 168);

  // Score bars.
  let y = 220;
  for (const k of SCORE_KEYS) {
    const v = r.scores[k].value;
    g.font = `600 22px ${FONT}`;
    g.fillStyle = C.ink;
    g.fillText(`${SCORE_ICON[k]} ${SCORE_LABEL[k]}`, 40, y + 20);
    g.fillStyle = C.line; roundRect(g, 260, y + 4, 330, 20, 10); g.fill();
    g.fillStyle = v >= 70 ? C.leaf : v >= 45 ? C.sun : C.bad; roundRect(g, 260, y + 4, Math.max(20, 3.3 * v), 20, 10); g.fill();
    g.fillStyle = C.ink; g.font = `700 20px ${FONT}`;
    g.fillText(String(v), 604, y + 21);
    y += 44;
  }

  // Plan and cats.
  g.fillStyle = '#fff'; roundRect(g, 680, 120, 480, 380, 18); g.fill();
  g.strokeStyle = C.line; g.lineWidth = 2; g.stroke();
  drawPlan(g, layout, 680, 140, 480, 340);
  let cx = 690;
  g.font = `600 20px ${FONT}`;
  for (const c of sc.cats) {
    g.fillStyle = c.coat; g.beginPath(); g.arc(cx + 10, 532, 10, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(0,0,0,.25)'; g.lineWidth = 1; g.stroke();
    g.fillStyle = C.ink; g.fillText(c.name, cx + 26, 539);
    cx += 30 + g.measureText(c.name).width + 18;
  }
  g.fillStyle = C.muted;
  g.font = `500 18px ${FONT}`;
  g.fillText('opencatio3d.com · Game layouts are concepts, not build plans.', 40, H - 30);
  return await new Promise<Blob>((res, rej) => cv.toBlob((b) => (b ? res(b) : rej(new Error('Could not draw the card.'))), 'image/png'));
}

/** Shares the card with the system share sheet when it can, otherwise downloads it. */
export async function shareCard(blob: Blob, sc: Scenario): Promise<'shared' | 'downloaded'> {
  const file = new File([blob], `catio-quest-${sc.id}.png`, { type: 'image/png' });
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (nav.canShare?.({ files: [file] }) && nav.share) {
    try { await nav.share({ files: [file], title: `Catio Quest: ${sc.title}` }); return 'shared'; }
    catch (e) { if (e instanceof DOMException && e.name === 'AbortError') return 'shared'; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return 'downloaded';
}
