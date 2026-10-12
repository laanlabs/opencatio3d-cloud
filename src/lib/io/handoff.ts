// "Open in OpenPlan3D": POST the prepared RoomPlan JSON to OpenPlan3D's handoff endpoint and open
// the editor import link (same contract as the iOS apps). If the browser can't reach the endpoint
// (CORS, offline, quota) the caller falls back to downloading the JSON for OpenPlan3D's Import JSON.
import { sortedJson } from './openplan';

export const HANDOFF_ENDPOINT = 'https://app.openplan3d.com/api/handoffs';
export const OPENPLAN_EDITOR = 'https://app.openplan3d.com/editor';
const MAX_BYTES = 1024 * 1024;
const ALPHABET = /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{8}$/;

export class HandoffError extends Error {
  constructor(message: string, readonly fallback = true) { super(message); }
}

export async function sendToOpenPlan(json: unknown, fetcher: typeof fetch = fetch): Promise<string> {
  const body = sortedJson(json);
  if (new TextEncoder().encode(body).length > MAX_BYTES) throw new HandoffError('This plan is too large for link sharing. Export the JSON file instead.');
  let res: Response;
  try {
    res = await fetcher(HANDOFF_ENDPOINT, { method: 'POST', headers: { 'Content-Type': 'application/json', Accept: 'application/json' }, body });
  } catch {
    throw new HandoffError('OpenPlan3D could not be reached from this browser.');
  }
  if (res.status === 413) throw new HandoffError('This plan is too large for link sharing. Export the JSON file instead.');
  if (res.status === 422) throw new HandoffError('OpenPlan3D could not read this plan.');
  if (res.status === 429) throw new HandoffError('Link sharing has reached its limit. Try again later.');
  if (!res.ok) throw new HandoffError(`Link sharing is unavailable (HTTP ${res.status}).`);
  const reply = await res.json().catch(() => null);
  if (!reply || typeof reply.code !== 'string' || !ALPHABET.test(reply.code)) throw new HandoffError('The sharing server returned an unexpected response.');
  return `${OPENPLAN_EDITOR}?import=${reply.code}`;
}
