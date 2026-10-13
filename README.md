# OpenCatio3D — web planner

Design a safe, buildable catio around your home — in 3D. This is the browser planner at
**app.opencatio3d.com**: Svelte 5 + Vite + three.js, local-first (projects live in IndexedDB), served
as a static SPA from Firebase App Hosting (project `opencatio3d`).

Sibling repos: `opencatio3d-www` (marketing site; owns the shared `catalog/`) and `opencatio3d-ios`
(iPhone, iPad and Mac app). The interchange and generator contract is
[`docs/EXPORT_FORMAT.md`](docs/EXPORT_FORMAT.md).

## What it does

- **Templates:** attached lean-to, freestanding catio, window box and tunnel run (porch infill and
  balcony as concept-only), attached to a house wall and centred on the window the cats use.
- **Site:** house walls with windows, doors, vents, dryer vents, meters and downspouts; obstacles and
  no-build zones; ground type and climate; measurement confirmation for build outputs.
- **Parametric construction:** studs, plates, rails, rafters, purlins, ledgers, door leaves, vestibules,
  mesh panels by roll width, roof sheets, bases and fasteners — every part with a stable id and label.
  The 3D view is drawn from the same parts the cut list counts.
- **Checks:** 51 sourced rules (escape gaps, latches, house vents and egress windows, shade and weather,
  digging, welfare and enrichment, senior cats, cat-safe plants, buildability). Warnings can be
  acknowledged; reviewable blockers take a recorded professional review. Wording follows the safety plan:
  "No issue detected by the current rules", never "safe".
- **Outputs:** cost range, shopping list, FFD cut plan, assembly steps, printable build package
  (cover sheet with assumptions/limitations/reviewer fields, plan, elevations, schedules, findings,
  maintenance checklist) — watermarked "concept" until no blockers remain. CSV, project JSON, plan PNG,
  3D PNG, GLB, view-only share links, links into the iOS app, and Open in OpenPlan3D.
- **Cats & plants:** household cats (age, mobility, size, door dashing) drive the welfare checks; the
  plant list carries ASPCA-checked safety status with source links.
- **Catio Quest (`#/quest`):** a free browser game on the same model. Seven scenarios and a daily
  challenge (seeded from the UTC date); 39 tray pieces from the real catalog; six cat personalities. The
  layout is a real project, so the generator, catalog and checks run on it unchanged. "Let them explore"
  runs a deterministic, seeded simulation (`quest/sim.ts`): cats move on a navigation graph built from the
  furnishings (`quest/nav.ts`), limited by their jump reach, chasing needs; weather, a bird, cleaning time
  and escape tests happen on a fixed timeline. Seven 0–100 scores (`quest/score.ts`) explain every point
  lost. Result cards are drawn on a canvas; progress stays in localStorage; "Continue in OpenCatio3D"
  copies the layout into the library as a concept (dimensions unconfirmed). No purchases, accounts or chat.

## Develop

```sh
npm install
npm run catalog   # copy ../opencatio3d-www/catalog/data/*.json into src/lib/catalog/
npm run dev       # http://localhost:5173
npm test          # vitest: generator, checks, interchange, io, editor, parity fixtures
npm run check     # svelte-check
npm run build     # dist/
npm run fixtures  # regenerate tests/fixtures/web after an intended generator/check change
```

`tests/openplan.test.ts` runs every fixture case through OpenPlan3D's real importer when a sibling
checkout exists at `../../openplan/openPlan3D-cloud` (or `OPENPLAN3D_DIR`); otherwise it is skipped.

## Deep links

| Hash | Opens |
| --- | --- |
| `#/new?template=window-box&units=imperial&cats=2&name=…` | a new project (templates: `lean-to`, `freestanding`, `window-box`, `tunnel`, `porch-infill`, `balcony-concept`, `blank`) |
| `#/sample/<id>` | your copy of a sample: `lean-to-window`, `garden-retreat`, `window-box` |
| `#/p/<id>?ws=checks` | a saved project on a workspace (`site`, `structure`, `access`, `enrichment`, `materials`, `checks`, `output`) |
| `#/print/<id>` | the build package |
| `#/import/v1/<payload>` · `#/view/v1/<payload>` | transfer from iOS · read-only share |
| `#/quest` · `#/quest/<scenario>` · `#/quest/daily` | Catio Quest: the hub, a scenario, today's daily challenge |

## Layout

```
src/App.svelte                 hash router; editor, print, import and Catio Quest load on demand
src/lib/model/                 types (project@0.1), geometry, units
src/lib/catalog/               catalog.ts + JSON copied from opencatio3d-www
src/lib/generate/              parts.ts (constants), structure.ts (recipes), assembly.ts (labels, cut plan, BOM, cost, steps)
src/lib/analysis/checks.ts     CAT-* rule logic
src/lib/site/                  templates (factories, attach to wall), samples
src/lib/io/                    openplan (interchange), validate, storage, transfer, routes, csv, handoff, download
src/lib/scene/                 three.js builders, SVG drawings (plan, elevations), bounds
src/lib/ui/                    Home, EditorView, PlanView, Viewer3D, workspace panels, PrintView, ImportView
src/lib/quest/                 Catio Quest: scenarios, daily, pieces, design edits, nav graph, sim, scores, convert, card, render
src/lib/quest/ui/              QuestApp (stages), hub, intro, build board + inspector, 3D explore view, results
tests/                         vitest suites + fixtures/web (parity with iOS)
```

## Deploy

App Hosting runs `node server.mjs` (serves `dist/`, SPA fallback, immutable `/assets/**`). The backend is
not created yet: connect this repo to an App Hosting backend in project `opencatio3d` and map
`app.opencatio3d.com`. Analytics stays off until `GA_MEASUREMENT_ID` in `src/lib/analytics.ts` is set.

MIT licensed © 2026 theLodgeStudio. Planning guidance, not certification.
