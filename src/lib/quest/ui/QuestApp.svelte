<script lang="ts">
  // Catio Quest, loaded on demand at #/quest (hub), #/quest/<scenarioId> and #/quest/daily. Stages
  // within a scenario (intro → build → explore → results) don't change the URL, so the browser back
  // button returns to the hub.
  import { untrack } from 'svelte';
  import { localeUnits } from '../../model/units';
  import { track } from '../../analytics';
  import { SCENARIOS, scenario } from '../scenarios';
  import { dailyScenario, utcDate } from '../daily';
  import { readDraft } from '../progress';
  import { QuestGame } from '../game.svelte';
  import QuestHub from './QuestHub.svelte';
  import Intro from './Intro.svelte';
  import BuildView from './BuildView.svelte';
  import SimView from './SimView.svelte';
  import Results from './Results.svelte';

  let { arg = '' }: { arg?: string } = $props();

  const units = localeUnits();
  // App remounts this component on every hash change, so the route argument is read once.
  const route = untrack(() => arg);
  const sc = route === 'daily' ? dailyScenario(utcDate()) : route ? scenario(route) : undefined;
  const resumed = !!(sc && readDraft(sc.id));
  const game = sc ? new QuestGame(sc) : null;
  if (game) game.stage = 'intro';
  if (sc) track('quest_start', { scenario: sc.daily ? 'daily' : sc.id });
  const next = sc && !sc.daily ? SCENARIOS[SCENARIOS.findIndex((x) => x.id === sc.id) + 1] : undefined;
  const hub = () => (location.hash = '#/quest');
</script>

{#if route && !sc}
  <div class="missing"><h2>That scenario doesn’t exist</h2><a class="btn primary" href="#/quest">See all scenarios</a></div>
{:else if !game}
  <QuestHub />
{:else if game.stage === 'intro'}
  <Intro sc={game.sc} {resumed} onstart={() => (game.stage = 'build')} onback={hub} />
{:else if game.stage === 'build'}
  <BuildView {game} {units} onexplore={() => game.explore()} onback={hub} />
{:else if game.stage === 'explore' && game.evaluation}
  <SimView {game} ondone={() => (game.stage = 'results')} onback={() => (game.stage = 'build')} />
{:else if game.stage === 'results' && game.evaluation}
  <Results {game} {next} onrevise={() => (game.stage = 'build')} onwatch={() => (game.stage = 'explore')} onhub={hub} />
{/if}

<style>
  .missing { max-width: 520px; margin: 15vh auto; padding: 24px; text-align: center; }
</style>
