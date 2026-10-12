// Transfer and share links between OpenCatio3D web and iOS, with no server in between.
//
//   iOS → web:  https://app.opencatio3d.com/#/import/v1/<payload>
//   web → iOS:  opencatio3d://import/v1/<payload>
//   share:      https://app.opencatio3d.com/#/view/v1/<payload>   (read-only view)
//
// <payload> = base64url (no padding) of raw DEFLATE (RFC 1951) of the compact OpenPlan3D JSON.
// Raw DEFLATE is Apple's COMPRESSION_ZLIB and the browser's 'deflate-raw'. Links never carry
// `webProject` or photo file names (EXPORT_FORMAT.md "Links").
import type { Catalog } from '../catalog/catalog';
import type { Project } from '../model/types';
import { toOpenPlan } from './openplan';

export const TRANSFER_VERSION = 'v1';
export const WEB_ORIGIN = 'https://app.opencatio3d.com';
export const IOS_SCHEME = 'opencatio3d';

function toBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((s.length + 3) % 4);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Longest payload accepted (characters, before decoding): ~192 KB of compressed data. */
export const MAX_PAYLOAD_CHARS = 262144;
/** Most decompressed bytes accepted; raw DEFLATE reaches ~1000:1, so this bounds a "deflate bomb". */
export const MAX_INFLATED_BYTES = 16 * 1024 * 1024;
const TOO_LARGE = 'This link is too large to open';

async function deflate(bytes: Uint8Array): Promise<Uint8Array> {
  const res = new Response(new Blob([bytes as BlobPart]).stream().pipeThrough(new CompressionStream('deflate-raw')));
  return new Uint8Array(await res.arrayBuffer());
}

/** Inflates chunk by chunk and stops as soon as the output passes `limit` bytes. */
async function inflate(bytes: Uint8Array, limit = MAX_INFLATED_BYTES): Promise<Uint8Array> {
  const reader = new Blob([bytes as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw')).getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > limit) {
      await reader.cancel().catch(() => {});
      throw new Error(TOO_LARGE);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const c of chunks) { out.set(c, at); at += c.byteLength; }
  return out;
}

export async function encodePayload(json: unknown): Promise<string> {
  return toBase64Url(await deflate(new TextEncoder().encode(JSON.stringify(json))));
}

export async function decodePayload(payload: string, limit = MAX_INFLATED_BYTES): Promise<unknown> {
  if (payload.length > MAX_PAYLOAD_CHARS) throw new Error(TOO_LARGE);
  const bytes = await inflate(fromBase64Url(decodeURIComponent(payload.trim())), limit);
  return JSON.parse(new TextDecoder().decode(bytes));
}

/** OpenPlan3D JSON for links: privacy-stripped, no embedded web project. */
export const transferJson = (p: Project, cat: Catalog) => toOpenPlan(p, cat, { forLink: true });

export async function webImportUrl(p: Project, cat: Catalog, origin = WEB_ORIGIN): Promise<string> {
  return `${origin}/#/import/${TRANSFER_VERSION}/${await encodePayload(transferJson(p, cat))}`;
}

export async function iosImportUrl(p: Project, cat: Catalog): Promise<string> {
  return `${IOS_SCHEME}://import/${TRANSFER_VERSION}/${await encodePayload(transferJson(p, cat))}`;
}

export async function shareUrl(p: Project, cat: Catalog, origin = typeof location !== 'undefined' ? location.origin : WEB_ORIGIN): Promise<string> {
  return `${origin}/#/view/${TRANSFER_VERSION}/${await encodePayload(transferJson(p, cat))}`;
}
