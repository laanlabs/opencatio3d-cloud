// Display units. Everything is stored in metres; imperial is a presentation choice. Imperial lengths
// show feet and inches to the nearest ⅛″ (build outputs) or whole inch (short labels).
import type { Units } from './types';
export type { Units };

const FT = 0.3048;
const IN = 0.0254;

/** Prefix a minus sign (U+2212) unless the formatted magnitude rounded to zero. */
const signed = (m: number, body: string) => (m < 0 && /[1-9]/.test(body) ? `−${body}` : body);
const FRACTIONS = ['', '⅛', '¼', '⅜', '½', '⅝', '¾', '⅞'];

/** Default units for a locale: imperial for the US, Liberia and Myanmar, metric elsewhere. */
export function localeUnits(locale = typeof navigator !== 'undefined' ? navigator.language : 'en-US'): Units {
  return /-(US|LR|MM)$/i.test(locale) || locale === 'en' ? 'imperial' : 'metric';
}

export function fmtLen(m: number, units: Units, short = false): string {
  if (!Number.isFinite(m)) return '—';
  const a = Math.abs(m);
  if (units === 'imperial') {
    if (short) {
      const totalIn = Math.round(a / IN);
      const ft = Math.floor(totalIn / 12), inch = totalIn % 12;
      return signed(m, inch ? (ft ? `${ft}′ ${inch}″` : `${inch}″`) : `${ft}′`);
    }
    const eighths = Math.round(a / IN * 8);
    const ft = Math.floor(eighths / 96);
    const rem = eighths - ft * 96;
    const inch = Math.floor(rem / 8), frac = FRACTIONS[rem % 8];
    const inches = inch || frac ? `${inch || ''}${frac || (inch ? '' : '0')}″` : '';
    return signed(m, ft ? (inches ? `${ft}′ ${inches}` : `${ft}′`) : inches || '0″');
  }
  if (a < 1 && !short) return signed(m, `${Math.round(a * 1000) / 10} cm`.replace('.0 cm', ' cm'));
  return signed(m, `${a.toFixed(a >= 10 ? 1 : 2).replace(/\.?0+$/, '')} m`);
}

/** Lumber stock length label: "8 ft" / "2.44 m". */
export const fmtStock = (m: number, units: Units) => (units === 'imperial' ? `${Math.round(m / FT)} ft` : `${m.toFixed(2)} m`);

export function fmtArea(m2: number, units: Units): string {
  if (units === 'imperial') return `${Math.round(m2 / (FT * FT)).toLocaleString('en-US')} ft²`;
  return `${m2 >= 100 ? Math.round(m2).toLocaleString('en-US') : m2.toFixed(1)} m²`;
}

/** Unsigned decimal: "12", "12.5" or ".5". */
const NUM = String.raw`(\d*\.?\d+)`;
/** Inches with an optional fraction: "36", "36 1/2", "1/2", "36½". */
const INCHES = String.raw`(\d*\.?\d+)?\s*(?:(\d+)\s*\/\s*(\d+)|([½¼¾⅛⅜⅝⅞]))?`;
const FEET_INCHES = new RegExp(String.raw`^${NUM}\s*(?:'|′|ft|feet)\s*(?:${INCHES}\s*(?:"|″|in)?)?$`);
const INCH_ONLY = new RegExp(String.raw`^${INCHES}\s*(?:"|″|in)$`);
const SIMPLE = new RegExp(String.raw`^${NUM}\s*(mm|cm|m)?$`);
const VULGAR: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅛': 0.125, '⅜': 0.375, '⅝': 0.625, '⅞': 0.875 };

function inches(whole?: string, num?: string, den?: string, vulgar?: string): number | null {
  let v = whole ? Number(whole) : 0;
  if (num && den) { if (Number(den) === 0) return null; v += Number(num) / Number(den); }
  if (vulgar) v += VULGAR[vulgar];
  return v;
}

/**
 * Parses "12", "12.5m", "40cm", "30'", "30' 6\"", "8' 6 1/2\"", "36 1/2in", "6½″", "30ft", ".5" and a
 * leading "-" or "−". Bare numbers use the display units (m or ft). Smart quotes count as ' and ".
 * A comma is a thousands separator when the text also has a point or exactly three digits follow it.
 */
export function parseLen(s: string, units: Units): number | null {
  let t = s.trim().toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"');
  const neg = t.startsWith('-') || t.startsWith('−');
  if (neg) t = t.slice(1).trim();
  if (!t) return null;
  t = t.includes('.') || /,\d{3}(?!\d)/.test(t) ? t.replace(/,/g, '') : t.replace(/,/g, '.');
  const sign = neg ? -1 : 1;
  const fi = t.match(FEET_INCHES);
  if (fi) {
    const i = inches(fi[2], fi[3], fi[4], fi[5]);
    return i == null ? null : sign * (Number(fi[1]) * FT + i * IN);
  }
  const io = t.match(INCH_ONLY);
  if (io && (io[1] || io[2] || io[4])) {
    const i = inches(io[1], io[2], io[3], io[4]);
    return i == null ? null : sign * i * IN;
  }
  const m = t.match(SIMPLE);
  if (!m) return null;
  const v = Number(m[1]);
  switch (m[2]) {
    case 'mm': return sign * (v / 1000);
    case 'cm': return sign * (v / 100);
    case 'm': return sign * v;
    default: return sign * (units === 'imperial' ? v * FT : v);
  }
}

/** Grid / snap step in metres for the display units (6″ or 10 cm). */
export const gridStep = (units: Units) => (units === 'imperial' ? FT / 2 : 0.1);

export function money(n: number, currency = 'USD') {
  return n.toLocaleString('en-US', { style: 'currency', currency, maximumFractionDigits: 0 });
}
export const moneyRange = (low: number, high: number, currency = 'USD') => `${money(low, currency)}–${money(high, currency).replace(/^[^\d]+/, '')}`;
