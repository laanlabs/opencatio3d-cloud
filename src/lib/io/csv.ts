// CSV exports with the exact column sets from EXPORT_FORMAT.md. RFC 4180 quoting, CRLF line ends
// and a UTF-8 BOM so spreadsheets open them with the right encoding.
import type { Assembly } from '../generate/assembly';

export const BOM_COLUMNS = ['category', 'material_id', 'name', 'quantity', 'unit', 'stock_length_m', 'unit_price_low', 'unit_price_high', 'total_low', 'total_high', 'detail'] as const;
export const CUT_COLUMNS = ['material_id', 'stock_piece', 'stock_length_m', 'label', 'cut_length_m', 'offcut_m'] as const;

/**
 * One CSV field. Text that starts with `=`, `+`, `-`, `@`, a tab or a carriage return would be read
 * as a formula by spreadsheets, so it gets a leading apostrophe. Numbers and booleans are never prefixed.
 */
export function cell(v: string | number | boolean | undefined): string {
  if (v === undefined) return '';
  let s = typeof v === 'boolean' ? (v ? 'yes' : 'no') : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const csv = (rows: (string | number | boolean | undefined)[][]) => '\ufeff' + rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

export function bomCsv(a: Assembly): string {
  return csv([[...BOM_COLUMNS], ...a.bom.map((l) => [l.category, l.materialId, l.name, l.qty, l.unit, l.stockLength, l.unitLow, l.unitHigh, l.low, l.high, l.detail])]);
}

export function cutListCsv(a: Assembly): string {
  const rows: (string | number | undefined)[][] = [];
  for (const m of a.cuts.materials) {
    m.bins.forEach((b, i) => b.cuts.forEach((c, j) => rows.push([m.materialId, i + 1, b.stock, c.label, c.length, j === b.cuts.length - 1 ? b.offcut : undefined])));
    for (const c of m.overlong) rows.push([m.materialId, 'overlong', undefined, c.label, c.length, undefined]);
  }
  return csv([[...CUT_COLUMNS], ...rows]);
}
