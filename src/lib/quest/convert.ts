// "Continue in OpenCatio3D": a game layout already is a production project, so continuing is a copy —
// new id, the household's cats, every key dimension recorded as typed and unconfirmed (so the planner
// treats it as a concept until someone measures), then the planner's own sanitizer.
import type { Catalog } from '../catalog/catalog';
import type { Project } from '../model/types';
import { clone, uid } from '../model/types';
import { measurementsFor } from '../site/templates';
import { sanitizeProject } from '../io/validate';
import { withHousehold } from './evaluate';
import type { Scenario, Scores } from './types';

export function toPlannerProject(sc: Scenario, layout: Project, cat: Catalog, opts: { now?: string; id?: string; result?: Pick<Scores, 'overall' | 'stars'> } = {}): Project {
  const now = opts.now ?? new Date().toISOString();
  const p = clone(withHousehold(layout, sc));
  p.id = opts.id ?? uid();
  p.name = `${sc.title} (from Catio Quest)`;
  p.createdAt = now;
  p.updatedAt = now;
  p.captureSource = 'quest';
  p.catalogVersion = cat.version;
  p.site.measurements = p.structures.flatMap(measurementsFor);
  p.web = { workspace: 'checks', view: 'split', quest: { scenarioId: sc.id, ...(opts.result ? { overall: opts.result.overall, stars: opts.result.stars } : {}) } };
  return sanitizeProject(p, cat).project;
}
