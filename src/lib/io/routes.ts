// Hash routes, parsed without touching the DOM so they can be unit-tested.
//
//   #/p/<id>[?ws=<workspace>]                 open a saved project (optionally on a workspace)
//   #/print/<id>                              build package (print / save as PDF)
//   #/sample/<id>                             open (or reuse) your copy of a sample catio
//   #/new?template=…&units=…&name=…&cats=…    start a project (links from opencatio3d.com)
//   #/import/v1/<payload>, #/view/v1/<payload>   transfer and view-only links (payload may contain '/', never '?')
//
// Query parameters come from the marketing site, so every value is validated; anything unknown
// falls back to a safe default.
import type { TemplateId, Units, Workspace } from '../model/types';
import { TEMPLATE_IDS } from '../model/types';
import type { NewProjectOptions } from '../site/templates';

export interface ParsedRoute {
  head: string;
  rest: string[];
  query: URLSearchParams;
}

export function parseRoute(hash: string): ParsedRoute {
  const h = hash.replace(/^#\/?/, '');
  const q = h.indexOf('?');
  const path = q >= 0 ? h.slice(0, q) : h;
  const query = new URLSearchParams(q >= 0 ? h.slice(q + 1) : '');
  const [head = '', ...rest] = path.split('/');
  return { head, rest, query };
}

export const WORKSPACES: Workspace[] = ['site', 'structure', 'access', 'enrichment', 'materials', 'checks', 'output'];

export function parseWorkspace(query: URLSearchParams): Workspace | undefined {
  const w = query.get('ws') as Workspace | null;
  return w && WORKSPACES.includes(w) ? w : undefined;
}

/** Options for `#/new`; unknown or missing values fall back to defaults. */
export function newProjectOptions(query: URLSearchParams, defaultUnits: Units): NewProjectOptions {
  const template = query.get('template');
  const units = query.get('units');
  const name = (query.get('name') ?? '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80);
  const cats = Number(query.get('cats'));
  return {
    name: name || 'My catio',
    units: units === 'metric' || units === 'imperial' ? units : defaultUnits,
    template: template === 'blank' ? 'blank' : TEMPLATE_IDS.includes(template as TemplateId) ? (template as TemplateId) : 'lean-to',
    cats: Number.isInteger(cats) && cats >= 0 && cats <= 12 ? cats : 1
  };
}
