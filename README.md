# OpenCatio3D — web planner

[![CI](https://github.com/laanlabs/opencatio3d-cloud/actions/workflows/ci.yml/badge.svg)](https://github.com/laanlabs/opencatio3d-cloud/actions/workflows/ci.yml)
[![MIT licence](https://img.shields.io/badge/licence-MIT-blue.svg)](LICENSE)

Design a safe, buildable catio around your home — in 3D. Free, with no accounts and no paid plans.

- **Planner:** https://app.opencatio3d.com
- **Catio Quest (the game):** https://app.opencatio3d.com/#/quest
- **Website:** https://opencatio3d.com

Svelte 5 + Vite + three.js, local-first (projects live in IndexedDB in your browser; a plan leaves it only
when you export, share a link or choose Open in OpenPlan3D), served as a static SPA from Firebase App Hosting.

Sibling repos (not public yet): `opencatio3d-www` (website; owns the shared catalog) and
`opencatio3d-ios` (iPhone, iPad and Mac app). The interchange and generator contract is
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

- **Catio Prowl (`#/prowl`):** a free third-person game where you are the cat. A furnished room joins the
  catio through the open window it is built over (catio-only for freestanding designs). The catio's shelves,
  ramps, bridges, beds and posts are walkable surfaces taken from the generator's own parts
  (`prowl/world.ts`); the cat is kept inside the room, the window passage and the catio's inside volume, so it
  can never reach the yard. "Context" leaps show a ring where the cat will land, and the arc is checked
  against walls, furniture, boards and the roof (`prowl/physics.ts`). A day's to-do list (`prowl/game.ts`):
  knock things off the counter, find toy mice, scratch, drink, sniff the plants (with their real cat-safety
  status), watch a visiting bird from the catio and nap in a sunbeam. Keyboard, mouse and touch controls;
  works on any catio in your library (`#/prowl/p/<id>`). No purchases, accounts or chat.

## Develop

Node 22 or newer.

```sh
npm install
npm run dev       # http://localhost:5173
npm test          # vitest: generator, checks, interchange, io, editor, parity fixtures
npm run check     # svelte-check
npm run build     # dist/
npm run fixtures  # regenerate tests/fixtures/web after an intended generator/check change
npm run catalog   # maintainers: refresh src/lib/catalog/*.json from ../opencatio3d-www/catalog/data
```

The catalog JSON (materials, components, templates, plants, rules, sources) is committed, so a plain
clone builds and tests without the website repo.

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
| `#/prowl` · `#/prowl/<sample>` · `#/prowl/p/<id>` | Catio Prowl: the hub, a sample home and catio, one of your own catios |

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
src/lib/prowl/                 Catio Prowl: world (surfaces, volumes, room), physics (walk, leap), game (tasks, bird), render, sound
src/lib/prowl/ui/              ProwlApp, hub (pick a cat and a space), play view (controls, to-do list, end card)
tests/                         vitest suites + fixtures/web (parity with iOS)
```

## Contributing

Issues and pull requests are welcome. CI runs `npm run check`, `npm test` and `npm run build` on every
pull request. If you change the generator or the checks on purpose, regenerate the fixtures
(`npm run fixtures`) and commit them with the change. The iOS app is held to the same fixtures, so
mention any change to `docs/EXPORT_FORMAT.md` in the pull request. Keep the safety wording: the checks
report "No issue detected by the current rules", never "safe".

## Deploy

Firebase App Hosting (project `opencatio3d`, backend `opencatio3d-cloud`, us-east4) builds and rolls out
every push to `main`; it runs `node server.mjs` (serves `dist/`, SPA fallback, immutable `/assets/**`)
at app.opencatio3d.com. Analytics stays off until `GA_MEASUREMENT_ID` in `src/lib/analytics.ts` is set.

MIT licensed © 2026 theLodgeStudio. Planning guidance, not certification.
