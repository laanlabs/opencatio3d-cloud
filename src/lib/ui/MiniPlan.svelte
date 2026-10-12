<script lang="ts">
  // Thumbnail plan: house walls, obstacles and structure footprints, fitted to the box.
  import type { Project } from '../model/types';
  import { footprints } from '../model/geometry';
  import { sceneBounds } from '../scene/bounds';
  let { project, height = 120 }: { project: Project; height?: number } = $props();
  const b = $derived(sceneBounds(project));
  const pad = 0.8;
  const vb = $derived(`${b.min[0] - pad} ${b.min[1] - pad} ${b.max[0] - b.min[0] + pad * 2} ${b.max[1] - b.min[1] + pad * 2}`);
</script>

<svg viewBox={vb} style:height="{height}px" preserveAspectRatio="xMidYMid meet" role="img" aria-label="Plan of {project.name}">
  {#each project.site.walls as w (w.id)}
    <line x1={w.a[0]} y1={w.a[1]} x2={w.b[0]} y2={w.b[1]} stroke="var(--house)" stroke-width="0.2" stroke-linecap="round" />
  {/each}
  {#each project.site.obstacles as o (o.id)}
    <circle cx={o.x} cy={o.y} r={Math.max(o.width, o.depth) / 2} fill="#9db88a" opacity=".7" />
  {/each}
  {#each project.structures as s (s.id)}
    {#each footprints(s) as f}
      <polygon points={f.map((p) => p.join(',')).join(' ')} fill="var(--cedar-tint)" stroke="var(--cedar)" stroke-width="0.06" />
    {/each}
  {/each}
</svg>

<style>
  svg { width: 100%; display: block; background: var(--plan-bg); border-radius: 8px; }
</style>
