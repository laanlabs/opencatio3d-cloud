// Local-first project library in IndexedDB. Nothing leaves the browser unless the user exports or shares.
import { createStore, del, entries, get, set } from 'idb-keyval';
import type { Project } from '../model/types';
import { normalizeProject } from './openplan';

const store = createStore('opencatio3d', 'projects');

export interface ProjectSummary {
  id: string;
  name: string;
  updatedAt: string;
  structures: number;
  templates: string[];
  /** Set when the project is a copy of a sample (`web.sampleId`). */
  sampleId?: string;
  createdAt?: string;
}

const str = (v: unknown, fallback = '') => (typeof v === 'string' ? v : v == null ? fallback : String(v));

/** Library rows from raw stored records, newest first. Tolerant of damaged records. */
export function summarizeProjects(records: [IDBValidKey, unknown][]): ProjectSummary[] {
  const out: ProjectSummary[] = [];
  for (const [key, p] of records) {
    if (!p || typeof p !== 'object' || Array.isArray(p)) continue;
    const r = p as Record<string, any>;
    const web = r.web && typeof r.web === 'object' ? r.web : {};
    const structures = Array.isArray(r.structures) ? r.structures : [];
    out.push({
      id: typeof key === 'string' ? key : str(r.id),
      name: str(r.name, 'Untitled catio'),
      updatedAt: String(r?.updatedAt ?? ''),
      structures: structures.length,
      templates: structures.map((s: any) => str(s?.template)).filter(Boolean),
      ...(typeof web.sampleId === 'string' ? { sampleId: web.sampleId } : {}),
      ...(r.createdAt != null ? { createdAt: String(r.createdAt) } : {})
    });
  }
  return out.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function listProjects(): Promise<ProjectSummary[]> {
  return summarizeProjects(await entries<IDBValidKey, unknown>(store));
}

/** Library copies of a sample (projects whose `web.sampleId` matches), newest first. */
export async function findSampleCopies(sampleId: string): Promise<ProjectSummary[]> {
  return (await listProjects()).filter((s) => s.sampleId === sampleId);
}

export async function loadProject(id: string): Promise<Project | undefined> {
  const p = await get<Project>(id, store);
  return p && typeof p === 'object' ? normalizeProject(p) : undefined;
}
export const saveProject = (p: Project) => set(p.id, JSON.parse(JSON.stringify(p)), store);
export const deleteProject = (id: string) => del(id, store);
