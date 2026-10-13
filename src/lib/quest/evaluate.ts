// One round of "Let them explore": the real generator and checks on the layout, the simulated
// afternoon, then the scores. Pure and deterministic for a given (scenario, layout).
import type { Catalog } from '../catalog/catalog';
import type { Project } from '../model/types';
import { generate } from '../generate/assembly';
import { runChecks } from '../analysis/checks';
import { simulate } from './sim';
import { scoreDesign } from './score';
import type { Evaluation, Scenario, Scores } from './types';

/** The household's cats and climate are part of the scenario, so they are written into the layout too. */
export function withHousehold(p: Project, sc: Scenario): Project {
  return {
    ...p,
    cats: sc.cats.map(({ personality, coat, bio, ...c }) => ({ ...c, quest: { personality, coat } })),
    region: { country: 'US', ...(p.region ?? {}), climate: { snowLoad: sc.climate.snowLoad, wind: sc.climate.wind, hot: sc.climate.hot, rainy: sc.climate.rainy } }
  };
}

export function evaluate(sc: Scenario, layout: Project, cat: Catalog): Evaluation & { result: Scores } {
  const project = withHousehold(layout, sc);
  const assembly = generate(project, cat);
  const findings = runChecks(project, cat, assembly);
  const sim = simulate(project, cat, sc.cats, sc.climate, findings, sc.seed);
  const e: Evaluation = { project, assembly, findings, sim };
  return { ...e, result: scoreDesign(sc, e, cat) };
}
