<script lang="ts">
  // The build package: cover sheet (version, assumptions, limitations, reviewer fields), site plan,
  // elevations, shopping list, cut list, parts schedule, assembly steps, findings, plants and the
  // maintenance checklist. "Save as PDF" is the browser's print dialog. Without a clean check (open
  // blockers) every page carries a CONCEPT watermark.
  import type { Project } from '../model/types';
  import { frontHeight } from '../model/types';
  import { catalog } from '../catalog/catalog';
  import { generate } from '../generate/assembly';
  import { activeBlockers, runChecks } from '../analysis/checks';
  import { elevationSvg, planSvg } from '../scene/drawings';
  import { fmtLen, fmtStock, money, moneyRange } from '../model/units';
  import { SAFETY_LABEL } from '../catalog/catalog';
  import { track } from '../analytics';
  import { byLabel, partSize, roleName } from '../generate/roles';

  let { project }: { project: Project } = $props();
  const a = $derived(generate(project, catalog));
  const findings = $derived(runChecks(project, catalog, a));
  const blockers = $derived(activeBlockers(findings));
  const ready = $derived(!blockers.length && project.structures.length > 0);
  const u = $derived(project.units);
  const generatedAt = new Date();
  const fmtDate = (d: Date | string) => new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' });
  const partsOf = (id: string) => a.parts.filter((p) => p.structureId === id);
  const labelOf = (id: string) => a.parts.find((p) => p.id === id)?.label;
  const matName = (id: string) => catalog.material(id)?.name ?? id;
  const size = (p: (typeof a.parts)[number]) => partSize(p, u);
  const plants = $derived(project.plants.map((pl) => ({ pl, plant: catalog.plant(pl.plantId) })));
  const measured = $derived(project.site.measurements.filter((m) => m.confirmed));
  $effect(() => { track('build_package', { ready }); });
</script>

<div class="print" class:concept={!ready}>
  <div class="toolbar">
    <a class="btn" href="#/p/{project.id}">← Back to the planner</a>
    <button class="btn primary" onclick={() => print()}>Print / Save as PDF</button>
    <a class="btn" href="#/build/{project.id}">Build step by step</a>
    {#if !ready}<span class="muted">Concept preview: {blockers.length} {blockers.length === 1 ? 'item blocks' : 'items block'} a build package.</span>{/if}
  </div>
  {#if !ready}<div class="watermark" aria-hidden="true">CONCEPT — NOT FOR CONSTRUCTION</div>{/if}

  <section class="page cover">
    <p class="brand">OpenCatio3D · {ready ? 'Build package' : 'Concept package'}</p>
    <h1>{project.name}</h1>
    <table class="kv">
      <tbody>
        <tr><th>Generated</th><td>{fmtDate(generatedAt)}</td></tr>
        <tr><th>Design version</th><td>{fmtDate(project.updatedAt)} · project {project.id.slice(0, 8)}</td></tr>
        <tr><th>Catalog & rules</th><td>{a.catalogVersion} · prices as of {a.pricesAsOf}</td></tr>
        <tr><th>Estimated materials</th><td><strong>{moneyRange(a.cost.low, a.cost.high, a.cost.currency)}</strong> (indicative; excludes tools, finish, delivery and tax)</td></tr>
        <tr><th>Structures</th><td>{#each a.structures as s}{@const st = project.structures.find((x) => x.id === s.id)!}<div><b>{s.letter}</b> {st.name} — {catalog.template(st.template)?.name}{st.template === 'tunnel' ? '' : `, ${fmtLen(st.width, u)} × ${fmtLen(st.depth, u)}, ${fmtLen(st.height, u)}${frontHeight(st) !== st.height ? ` to ${fmtLen(frontHeight(st), u)}` : ''} high`}{st.elevation ? `, ${fmtLen(st.elevation, u)} above ground` : ''}</div>{/each}</td></tr>
        <tr><th>Cats</th><td>{project.cats.map((c) => `${c.name} (${c.ageClass}${c.mobility !== 'full' ? `, ${c.mobility} mobility` : ''})`).join(', ') || '—'}</td></tr>
        <tr><th>Assumptions</th><td>Lumber in {project.assumptions.stockLengths.length ? project.assumptions.stockLengths.map((x) => fmtStock(x, u)).join(', ') : 'catalog stock lengths'}; saw kerf {fmtLen(project.assumptions.kerf, u)}; {Math.round(project.assumptions.wasteFactor * 100)}% extra mesh and sheet goods; {Math.round(project.assumptions.fastenerOverage * 100)}% extra fasteners. Ground: {project.site.ground}.</td></tr>
        <tr><th>Measurements</th><td>{measured.length ? `${measured.length} key dimensions confirmed (${[...new Set(measured.map((m) => m.source))].join(', ')})` : 'Not confirmed — typed values only'}</td></tr>
      </tbody>
    </table>
    <div class="limits">
      <h3>Limitations</h3>
      <p>This package is planning and construction guidance within the supported templates. It is not a stamped engineering document, a permit set, or a veterinary or code approval. Checks report what the current rules detect — “no issue detected” is not a safety guarantee. Confirm dimensions on site before cutting. Elevated, roof-mounted or structurally attached work, unusual wind or snow, and large structures need professional review. Check local building codes, HOA and landlord rules.</p>
    </div>
    <div class="review">
      <div><span>Reviewed by</span></div>
      <div><span>Role / licence</span></div>
      <div><span>Date</span></div>
    </div>
  </section>

  <section class="page">
    <h2>Site plan</h2>
    <div class="drawing">{@html planSvg(project, a, u, { width: 1400 })}</div>
  </section>

  {#each a.structures as s}
    {@const st = project.structures.find((x) => x.id === s.id)!}
    <section class="page">
      <h2>{s.letter} · {st.name} — elevations</h2>
      {#if st.template === 'tunnel'}
        <h4>Plan</h4><div class="drawing">{@html elevationSvg(st, partsOf(st.id), 'top', u, { width: 1000 })}</div>
      {:else}
        <div class="two">
          <div><h4>Front</h4><div class="drawing">{@html elevationSvg(st, partsOf(st.id), 'front', u)}</div></div>
          <div><h4>Side</h4><div class="drawing">{@html elevationSvg(st, partsOf(st.id), 'side', u)}</div></div>
        </div>
        <h4>Roof and floor plan</h4>
        <div class="drawing narrowdraw">{@html elevationSvg(st, partsOf(st.id), 'top', u, { labels: false })}</div>
      {/if}
      {#if st.openings.length}
        <h4>Openings</h4>
        <ul class="small">{#each st.openings as o}<li>{o.kind.replace('-', ' ')} on the {o.side}, {fmtLen(o.offset, u)} from its start: {fmtLen(o.width, u)} × {fmtLen(o.height, u)}{o.latch ? `, ${o.latch} latch` : ''}{o.selfClosing ? ', self-closing' : ''}</li>{/each}</ul>
      {/if}
    </section>
  {/each}

  <section class="page">
    <h2>Shopping list</h2>
    <table class="grid">
      <thead><tr><th>Qty</th><th>Item</th><th>Detail</th><th class="num">Each</th><th class="num">Total</th></tr></thead>
      <tbody>
        {#each a.bom as l}
          <tr><td class="num">{l.qty}</td><td>{l.name}{l.stockLength ? ` — ${fmtStock(l.stockLength, u)}` : ''}</td><td>{l.detail ?? ''}</td><td class="num">{money(l.unitLow)}–{money(l.unitHigh).slice(1)}</td><td class="num">{money(l.low)}–{money(l.high).slice(1)}</td></tr>
        {/each}
        <tr class="total"><td></td><td colspan="3">Total (materials)</td><td class="num">{moneyRange(a.cost.low, a.cost.high, a.cost.currency)}</td></tr>
      </tbody>
    </table>
  </section>

  <section class="page">
    <h2>Cut list</h2>
    <p class="small muted">Cut each stock piece in order; ⌁ marks the offcut. Kerf {fmtLen(a.cuts.kerf, u)} between cuts. Square cuts throughout — mark angled ends on site.</p>
    {#each a.cuts.materials as m}
      <h4>{matName(m.materialId)}</h4>
      <table class="grid">
        <thead><tr><th>Piece</th><th>Stock</th><th>Cuts (label: length)</th><th class="num">Offcut</th></tr></thead>
        <tbody>
          {#each m.bins as b, i}<tr><td>{i + 1}</td><td>{fmtStock(b.stock, u)}</td><td>{b.cuts.map((c) => `${c.label}: ${fmtLen(c.length, u)}`).join(' · ')}</td><td class="num">⌁ {fmtLen(b.offcut, u)}</td></tr>{/each}
          {#each m.overlong as c}<tr class="bad"><td>—</td><td>too long</td><td>{c.label}: {fmtLen(c.length, u)} — needs a splice or a design change</td><td></td></tr>{/each}
        </tbody>
      </table>
    {/each}
  </section>

  <section class="page">
    <h2>Parts schedule</h2>
    {#each a.structures as s}
      <h4>{s.letter} · {project.structures.find((x) => x.id === s.id)?.name}</h4>
      <table class="grid compact">
        <thead><tr><th>Label</th><th>Part</th><th>Material</th><th>Size</th><th class="num">Qty</th></tr></thead>
        <tbody>
          {#each partsOf(s.id).filter((p) => p.label).sort(byLabel) as p}
            <tr><td>{p.label}</td><td>{roleName(p)}</td><td>{matName(p.materialId)}</td><td>{size(p)}</td><td class="num">{p.qty}</td></tr>
          {/each}
        </tbody>
      </table>
    {/each}
  </section>

  <section class="page">
    <h2>Assembly sequence</h2>
    {#each a.structures as s}
      <h4>{s.letter} · {project.structures.find((x) => x.id === s.id)?.name}</h4>
      <ol class="steps">
        {#each a.steps.filter((x) => x.structureId === s.id) as st}
          {@const labels = st.partIds.map(labelOf).filter(Boolean)}
          <li>
            <strong>{st.title}</strong>
            {#if labels.length}<div class="small muted">Parts: {labels.length > 24 ? `${labels.slice(0, 24).join(', ')} … (${labels.length})` : labels.join(', ')}</div>{/if}
            <ul class="check">{#each st.checklist as c}<li>☐ {c}</li>{/each}</ul>
          </li>
        {/each}
      </ol>
    {/each}
  </section>

  <section class="page">
    <h2>Design checks</h2>
    {#if !findings.some((f) => f.severity !== 'info' && f.status === 'open')}<p><strong>No issue detected by the current rules.</strong></p>{/if}
    <table class="grid compact">
      <thead><tr><th>Rule</th><th>Severity</th><th>Finding</th><th>Status</th></tr></thead>
      <tbody>
        {#each findings as f}
          <tr><td>{f.ruleId} v{f.ruleVersion}</td><td>{f.severity}</td><td><b>{f.title}.</b> {f.message} <i>{f.remediation}</i>{#if f.sources.length}<div class="small muted">{f.sources.map((s) => s.title).join('; ')}</div>{/if}</td><td>{f.status}{f.note ? `: ${f.note}` : ''}</td></tr>
        {/each}
      </tbody>
    </table>
    {#if plants.length}
      <h2>Plants</h2>
      <table class="grid compact">
        <thead><tr><th>Plant</th><th>Cat safety (reviewed source)</th><th>Source</th></tr></thead>
        <tbody>
          {#each plants as { pl, plant }}
            <tr><td>{plant ? `${plant.name} (${plant.scientificName})` : pl.plantId}</td><td>{plant ? SAFETY_LABEL[plant.catSafety] : 'Unknown'}{plant?.hazardLevel === 'severe' ? ' — severe' : ''}</td><td class="small">{plant?.sources[0]?.url ?? ''} {plant ? `(${plant.reviewedAt})` : ''}</td></tr>
          {/each}
        </tbody>
      </table>
      <p class="small">Plant lists are not exhaustive. If a cat may have eaten a plant, call your veterinarian or ASPCA Animal Poison Control.</p>
    {/if}
  </section>

  <section class="page">
    <h2>Living with your catio</h2>
    <div class="two">
      <div>
        <h4>Before the first visit</h4>
        <ul class="check">
          <li>☐ Walk the inside at cat height: no gaps, sharp wire or loose staples</li>
          <li>☐ Let cats explore with you present for the first few sessions</li>
          <li>☐ Water, shade and a hiding place available from day one</li>
          <li>☐ Know how you will bring every cat inside fast (storm, fire, predator)</li>
        </ul>
        <h4>Monthly</h4>
        <ul class="check">
          <li>☐ Latches engage and self-closers pull doors shut</li>
          <li>☐ Mesh edges still fastened; no rust at welds; no new gaps at the house wall</li>
          <li>☐ Shelves and ramps firm; replace worn sisal</li>
          <li>☐ Plants still on the reviewed list; nothing new has grown in</li>
        </ul>
      </div>
      <div>
        <h4>Seasonal</h4>
        <ul class="check">
          <li>☐ Clear leaves and snow from the roof and gutters</li>
          <li>☐ Check roof screws and drainage after storms</li>
          <li>☐ Re-seal or re-paint exposed wood</li>
          <li>☐ Check the ground skirt or pavers for digging</li>
        </ul>
        <h4>Emergency</h4>
        <ul class="check">
          <li>☐ Carriers kept where you can reach them from the catio door</li>
          <li>☐ Heat: shade and water, or bring cats in</li>
          <li>☐ Vet and poison-control numbers posted inside the house door</li>
        </ul>
      </div>
    </div>
    <p class="small muted footer">Made with OpenCatio3D · opencatio3d.com · {a.catalogVersion} · guidance, not certification.</p>
  </section>
</div>

<style>
  .print { background: #f1ede6; min-height: 100vh; padding: 16px; position: relative; }
  .toolbar { display: flex; gap: 8px; align-items: center; flex-wrap: wrap; max-width: 900px; margin: 0 auto 12px; font-size: 13px; }
  .page { background: #fff; max-width: 900px; margin: 0 auto 16px; padding: 32px 36px; box-shadow: 0 2px 10px rgba(0,0,0,.08); position: relative; }
  h1 { font-size: 30px; margin: 4px 0 18px; }
  h2 { font-size: 20px; margin: 0 0 12px; border-bottom: 2px solid var(--dusk); padding-bottom: 6px; }
  h3 { font-size: 15px; margin: 0 0 6px; }
  h4 { font-size: 14px; margin: 14px 0 6px; }
  .brand { color: var(--cedar); font-weight: 800; letter-spacing: .02em; text-transform: uppercase; font-size: 12px; margin: 0; }
  .kv { width: 100%; border-collapse: collapse; font-size: 13px; }
  .kv th { text-align: left; width: 170px; vertical-align: top; padding: 6px 8px 6px 0; color: var(--muted); }
  .kv td { padding: 6px 0; border-bottom: 1px solid var(--border); }
  .limits { margin-top: 18px; background: #faf7f1; border-radius: 8px; padding: 12px 14px; font-size: 12px; }
  .limits p { margin: 0; }
  .review { display: grid; grid-template-columns: 2fr 2fr 1fr; gap: 16px; margin-top: 28px; }
  .review div { border-bottom: 1px solid #333; height: 36px; position: relative; }
  .review span { position: absolute; bottom: -18px; font-size: 11px; color: var(--muted); }
  .drawing :global(svg) { width: 100%; height: auto; display: block; }
  .narrowdraw { max-width: 60%; }
  .two { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .grid { width: 100%; border-collapse: collapse; font-size: 12px; }
  .grid th { text-align: left; border-bottom: 1.5px solid #333; padding: 4px; }
  .grid td { border-bottom: 1px solid #ddd; padding: 4px; vertical-align: top; }
  .grid.compact td { padding: 2px 4px; }
  .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
  .total td { font-weight: 800; border-top: 1.5px solid #333; }
  .bad td { color: var(--blocker); }
  .small { font-size: 12px; }
  .steps { padding-left: 20px; font-size: 13px; display: flex; flex-direction: column; gap: 8px; }
  ul.check { list-style: none; padding: 0; margin: 4px 0; font-size: 13px; display: flex; flex-direction: column; gap: 3px; }
  .footer { margin-top: 24px; text-align: center; }
  .watermark { position: fixed; inset: 0; display: grid; place-items: center; pointer-events: none; z-index: 20; font-size: 64px; font-weight: 900; color: rgba(179, 38, 30, .1); transform: rotate(-30deg); white-space: nowrap; }
  @media print {
    .print { background: #fff; padding: 0; }
    .toolbar { display: none; }
    .page { box-shadow: none; margin: 0; max-width: none; padding: 0; page-break-after: always; break-after: page; }
    .page:last-child { page-break-after: auto; }
    @page { margin: 14mm; }
  }
  @media (max-width: 640px) { .two { grid-template-columns: 1fr; } .page { padding: 20px 16px; } .narrowdraw { max-width: 100%; } }
</style>
