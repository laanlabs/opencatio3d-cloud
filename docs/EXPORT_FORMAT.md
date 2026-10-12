# OpenCatio3D interchange format and generator contract (v1)

> **Where this file lives.** It is written in `opencatio3d-cloud/docs/` while the web planner is the
> reference implementation; the iOS builder copies it to `opencatio3d-ios/docs/EXPORT_FORMAT.md`, and
> from then on both copies must change together (like `openlandscape3d-ios/docs/EXPORT_FORMAT.md`).
> The web code is the reference for anything this document leaves ambiguous; the parity fixtures in
> `opencatio3d-cloud/tests/fixtures/web/` pin the numbers.

Units are **metres** and **degrees** everywhere. Plan x → world X, plan y → world Z, y is up. On screen
plan +y points down. Money is the catalog currency (USD in `oc-catalog@0.1`).

## 1. Files and links

### 1.1 Project file — OpenPlan3D "prepared RoomPlan JSON" plus an `opencatio3d` block

```jsonc
{
  "openplanPrepared": true, "openplanHandoffVersion": 1, "version": 2,
  "walls": [], "doors": [], "windows": [], "openings": [],   // house, OpenPlan3D form (§1.3)
  "objects": [],                                              // one per structure (§1.3), then pass-through objects
  "sections": [], "stories": [{ "index": 0, "name": "Ground Floor" }], "floors": [], "defaults": {},
  "planNotes": "Created with OpenCatio3D …",
  "opencatio3d": {
    "schema": "opencatio3d/project@0.1",
    "producer": "web" | "ios",
    "lengthUnit": "m",
    "projectId": "uuid", "name": "…", "createdAt": "ISO", "updatedAt": "ISO",
    "catalogVersion": "oc-catalog@0.1",
    "captureSource": "template" | "sample" | "manual" | "openplan" | "ios" | "ar" | …,
    "units": "imperial" | "metric",          // display units only
    "currency": "USD",
    "region": { "country": "US", "state": "OR", "climate": { "snowLoad": "none|light|heavy", "wind": "normal|high", "hot": false, "rainy": true } },
    "site": Site, "structures": [Structure], "cats": [Cat], "plants": [PlantPlacement],
    "overrides": [Acknowledgement], "alternatives": [Alternative], "observations": [Observation],
    "assumptions": Assumptions,
    "building": null | { verbatim OpenPlan3D arrays },   // only when the project came from an OpenPlan3D plan
    "web": { view state; iOS keeps it verbatim },
    "webProject": { … }                                  // web only, files only, never in links
  }
}
```

Rules:
- **Unknown keys survive.** Every object (block, site, wall, opening, structure, furnishing, cat, plant,
  measurement, acknowledgement) may carry keys the reader does not know; readers keep and re-emit them.
  Unknown top-level block keys go to `project.extra` and are written back at the top level.
- `webProject` is trusted only when `producer == "web"`; iOS reads the block fields and ignores it.
- When `building` is null, the house arrays are generated from `site.walls` (§1.3); when it is present
  (an imported OpenPlan3D plan), they are written verbatim from it.
- Version: bump `schema` only for breaking changes. Additive fields do not bump it. Links carry `/v1/`.

### 1.2 Links (no server)

| Direction | Link |
| --- | --- |
| iOS → web | `https://app.opencatio3d.com/#/import/v1/<payload>` |
| web → iOS | `opencatio3d://import/v1/<payload>` |
| share (read-only) | `https://app.opencatio3d.com/#/view/v1/<payload>` |

`<payload>` = base64url (no padding) of **raw DEFLATE** (RFC 1951; Apple `COMPRESSION_ZLIB`, browser
`deflate-raw`) of the compact project file JSON. Link files never contain `webProject` and drop
`observations[].photoFile`. Readers reject payloads over 262 144 characters or inflating past 16 MiB.

### 1.3 OpenPlan3D arrays written for the house and the structures

- **Wall** per `site.walls[i]` (length > 1 cm): `identifier` = wall id, `dimensions` = `[L, height, 0.2]`,
  `transform` = T(mid, angle, y = height/2) where the wall line is the **outdoor face**, so the OpenPlan3D
  centre line is shifted 0.1 m indoors (−n). `angle = atan2(b.y−a.y, b.x−a.x)`, n = (−dir.y, dir.x).
- **Window** (`kind == window`) and **door** (`door` → style `single`, `patio-door` → style `patio`):
  `identifier` = opening id, `parentIdentifier` = wall id, `dimensions` = `[width, height, 0.2]`,
  transform at the opening centre on the centre line, y = sill + height/2; windows add `sillHeight`.
  Vents, meters, utilities and downspouts exist only in the block.
- **Object** per structure: `identifier` = structure id, category `greenhouse` (window box and tunnel:
  `greenhouse_small`), `dimensions` = `[width, max(height, lowHeight), depth]`, transform at the plan
  centre of the footprint with `angle = rotation` in radians, y = elevation + h/2. Tunnels write one
  object per path segment (`identifier` = stableId(`<id>:segment:<i>`), dimensions `[L, height, width]`).
  Attributes: `{ opencatio3dRole: "structure", opencatio3dKind: <template>, structureId[, segment] }`.
- `T(x, z, a, y)` = column-major `[c,0,s,0, 0,1,0,0, −s,0,c,0, x,y,z,1]`, every value rounded to 1e−6
  and `+0` (no −0).

Import of a plain OpenPlan3D plan (no block): keep the arrays verbatim in `building`, lift each wall into
`site.walls` (outdoor face = centre + n·thickness/2) with its windows/doors as wall openings
(offset = along(centre) − width/2; `style` `patio`/`sliding` → `patio-door`), no structures.

## 2. Project model (`opencatio3d/project@0.1`)

```ts
Site { northDeg, ground: 'grass'|'soil'|'concrete'|'pavers'|'deck', walls: HostWall[], obstacles: SiteObstacle[], measurements: Measurement[] }
HostWall { id, a:[x,y], b:[x,y], height, openings: WallOpening[] }      // outdoor side is n = (−dir.y, dir.x)
WallOpening { id, kind: 'window'|'door'|'patio-door'|'vent'|'dryer-vent'|'utility'|'downspout'|'meter', offset /*from a*/, width, height, sill, egress?, name? }
SiteObstacle { id, kind: 'tree'|'ac-unit'|'hose-bib'|'steps'|'no-build'|'other', x, y /*centre*/, width, depth, rotation, height, name? }
Measurement { id, targetId /*structure id*/, field: 'width'|'depth'|'height'|'elevation'|'path', value, source: 'typed'|'tape'|'ar'|'lidar', confirmed }

Structure {
  id, name, template: 'lean-to'|'freestanding'|'window-box'|'tunnel'|'porch-infill'|'balcony-concept',
  x, y, rotation,            // back-left corner; local u = (cos r, sin r), local v = (−sin r, cos r)
  width, depth, height /*back*/, lowHeight? /*front, default = height*/, elevation?,
  hostWallId?, hostOpeningId?, path?: [u,v][] /*tunnels, local*/,
  frame: { profile: 'wood-2x2'|'wood-2x3'|'wood-2x4', materialId, maxPostSpacing, railSpacing },
  mesh: { materialId }, roof: { kind: 'mesh'|'corrugated'|'polycarbonate'|'partial', coverFraction?, materialId? },
  base: { kind: 'ground-skirt'|'pavers'|'deck'|'raised-floor'|'none', skirtDepth? },
  openings: StructureOpening[], furnishings: Furnishing[]
}
StructureOpening { id, kind: 'human-door'|'cat-door'|'window-access'|'cleaning-hatch'|'vestibule', side: 'back'|'front'|'left'|'right', offset, width, height, sill?, swing?: 'in'|'out', hinge?: 'left'|'right', latch?: 'hasp'|'slide-bolt'|'gravity'|'keyed'|null, selfClosing?, depth? /*vestibule*/ }
Furnishing { id, componentId, side: 'back'|'front'|'left'|'right'|'span', offset, mountHeight, length? }
Cat { id, name, ageClass: 'kitten'|'adult'|'senior', mobility: 'full'|'reduced'|'limited', size: 'small'|'medium'|'large', climber, escapeRisk: 'low'|'medium'|'high' }
PlantPlacement { id, plantId, structureId?, furnishingId?, x?, y? }
Acknowledgement { ruleId, targetId /*'' = project*/, kind: 'acknowledge'|'professional-review', note, by?, at }
Assumptions { stockLengths: number[] /*[] = catalog's*/, kerf /*0.003*/, wasteFactor /*0.1*/, fastenerOverage /*0.1*/ }
Alternative { id, name, createdAt, snapshot: { structures, plants } }
Observation { id, kind, createdAt, author, x?, y?, text?, photoFile?, structureId?, resolved? }
```

Sides: `back` is v = 0 (the house side for attached templates), `front` v = depth, `left` u = 0,
`right` u = width. `offset` runs along the side from its start: back/front from u = 0, left/right from
v = 0. For tunnels `back` = path start, `front` = path end. Attaching to a wall (`attachToWall`): rotation
= wall angle, back-left corner = a + dir·clamp(centre − width/2, 0, L − width) where centre is the
served window's centre (or the wall's middle); a `window-access` opening is lined up with that window.

Key dimensions (CAT-DIM-001): tunnel `width, height, path` (path value = centreline length);
window box `width, depth, height, elevation`; others `width, depth, height`. A measurement counts only
when `confirmed` and |value − current| ≤ 0.005.

## 3. Generator algorithms

`generate(project, catalog) → Assembly { structures, parts, cuts, bom, cost, steps, conceptOnly }`.
Pure and deterministic. Structures are processed in project order; their parts are concatenated.

### 3.1 Conventions

- `EPS = 1e−9`; `ceilE(x) = ceil(x − EPS)`; `r3(x) = round(x·1000)/1000` (half up; inputs are positive);
  `r2(x) = round(x·100)/100`.
- Part id = `stableId(structureId + ":" + key)` (FNV-1a UUID form, same function as the sibling apps).
  Keys below are exact; a vestibule's sub-parts are prefixed `vest:<openingId>:`.
- Member `length = r3(|b − a|)` from its two local points [u, y, v]. Panels report `width = r3(pitch/k +
  OVERLAP)`, `height = r3(h + OVERLAP)` and `rollLength = height`.
- Constants: `OVERLAP 0.025`, `MESH_FASTENER_SPACING 0.15`, `PURLIN_SPACING 0.6`, `END_LAP 0.15`,
  `JOIST_SPACING 0.4`, `LEDGER_SCREW_SPACING 0.4`, `STAPLE_SPACING 0.3`, `DOOR_GAP 0.006`,
  `SCREWS_PER_MEMBER 4`, `ROPE_PER_M 37.5`, `CLEAT_SPACING 0.15`, `KNEE_SPACING 0.9`,
  `VESTIBULE_DEPTH 0.9`, `SKIRT_DEPTH 0.3`, `PARTIAL_COVER 0.5`.
- Materials: frame = `frame.materialId` if it is lumber with `profile == frame.profile`, else the first
  catalog lumber with that profile. Mesh = `mesh.materialId` if a mesh, else the first mesh. Roof panel =
  `roof.materialId` if a roof panel, else `roof-steel-corrugated` for `corrugated`, else
  `roof-polycarb-corrugated`. `d, w` = frame `actual` [thickness, face width] (2×3 → 0.038, 0.064).
- **Splicing.** A member with role in {plate, ledger, purlin, seal, tunnel-rail} longer than the longest
  offered stock (§3.8) is emitted as k = ceilE(L / longest) equal pieces, keys `<key>:p0…p(k−1)`, each
  `r3(L/k)` long. Any other member longer than stock is reported `overlong` (CAT-BLD-003).

### 3.2 Layout by template

| Template | Framed sides | Meshed sides | House back |
| --- | --- | --- | --- |
| lean-to, porch-infill, balcony-concept | front, left, right | same | yes |
| window-box | back, front, left, right | front, left, right | yes |
| freestanding | all four | all four | no |

Wall extent along a side: back/front `[0, W]`; left/right `[hasBackWall ? d : 0, D − d]`.
Height along a side: back `Hb`, front `Hf`, left/right `Hb + (Hf − Hb)·t/D`. Centre-plane point:
back `(t, d/2)`, front `(t, D − d/2)`, left `(d/2, t)`, right `(W − d/2, t)`.

`bayCount(L, s, R) = max(1, ceilE(L/s), ceilE(L/(R − OVERLAP)))` with s = `maxPostSpacing`, R = mesh
`rollWidth`. `stripCount(p, R) = max(1, ceilE((p + OVERLAP)/R))`.

**Openings that fit** are decided first, in array order (`openingFits`): positive size, offset ≥ 0, and
- window-access: house-back template, `side == back`, offset + width ≤ W, sill + height ≤ Hb;
- vestibule: `side == front`, offset + width ≤ W, width ≥ 0.6, 1.0 ≤ height ≤ 2.7;
- others: side is meshed; offset ≥ t0 + w and offset + width ≤ t1 − w; sill ≥ 0; sill + height ≤
  min(h(offset), h(offset + width)) − w; sill is 0 or ≥ w; and its span widened by w on both sides does
  not overlap an earlier framed opening on the same side.
- tunnel: side back/front, kind cat-door or window-access, width ≤ W, sill + height ≤ H.
Non-fitting openings are listed in `skippedOpenings` and generate nothing.

### 3.3 Walls (each framed side, in the order back, front, left, right as listed in §3.2)

1. `<side>:plate-bottom` (plate) from P(t0) to P(t1) at y = w/2; `<side>:plate-top` from (P(t0), h(t0) − w/2)
   to (P(t1), h(t1) − w/2).
2. Studs: `stud:start` at t0 + w/2, `stud:end` at t1 − w/2, intermediates `stud:<i>` at t0 + Lw·i/n
   (i = 1…n−1, n = bayCount(Lw)) **unless** within [o.offset − w, o.offset + o.width + w] (±EPS) of a framed
   opening on this side; jambs `jamb:<openingId>:l` at offset − w/2 if offset − w ≥ t0 + w, and
   `jamb:<openingId>:r` at offset + width + w/2 if offset + width + w ≤ t1 − w. Sort by t, ties by key.
   Each stud/jamb runs y = w → h(t) − w (length h(t) − 2w). Keys are `<side>:<stud key>`.
3. Bays between consecutive studs a, z (index i, pitch = z − a):
   - If a framed opening lies within [a, z]: header `<side>:header:<id>` (length = opening width) at
     y = top + w/2 when top + w < hMin − w; sill `<side>:sill:<id>` at y = sill − w/2 when sill > 0; mesh
     above `<side>:bay<i>:mesh-above` (pitch, height hMax − top) when hMax − top > 0.05; mesh below
     `<side>:bay<i>:mesh-below` (pitch, height sill) when sill > w + 0.05. (top = sill + height.)
   - Otherwise, on meshed sides only: rails `<side>:bay<i>:rail<j>` (j = 1…r) of length pitch − w at
     y = w + inner·j/(r+1), where inner = hMin − 2w, r = max(0, ceilE(inner / railSpacing) − 1), only if
     pitch − w > 0.05 and inner > 0; then mesh `<side>:bay<i>:mesh` (pitch, height hMax).
   - Mesh of pitch p and height h is k = stripCount(p) strips keyed `<key>:<j>`.
   Framed openings = fitting openings except window-access and vestibule.

### 3.4 Roof (box templates)

slope = hypot(D, Hb − Hf); nR = bayCount(W). Rafters `roof:rafter<i>` (i = 1…nR−1) at u = W·i/nR from
(u, Hb + w/2, 0) to (u, Hf + w/2, D) (length = r3(slope)). For `mesh` and `partial`: mesh
`roof:bay<i>:mesh` (pitch W/nR, height slope) for i = 0…nR−1. For solid kinds: covered = slope ·
(partial ? clamp(coverFraction ?? 0.5, 0, 1) : 1); skip if < 0.05; purlins `roof:purlin<j>` (length W),
p = max(2, ceilE(covered/0.6) + 1); `roof:sheets` qty = across·rows with across = ceilE(W / coverWidth),
rows = covered ≤ sheetLength ? 1 : 1 + ceilE((covered − sheetLength)/(sheetLength − 0.15)); connector
`roof:screws` qty = across·p·3.

### 3.5 Base and attachment

perimeter = framed sides minus `back` when the house is the back; corners = house back ? 2 : 4; soft
ground = `grass` or `soil`.
- `pavers`: `base:pavers` qty Σ ceilE(L_side / paver.size); `base:sand` qty ceilE(pavers/4).
- `ground-skirt`: per perimeter side `base:skirt:<side>` (mesh panel, width = skirtDepth, height = L_side,
  rollLength = r3(L_side·skirtDepth/rollWidth)); `base:staples` qty Σ(ceilE(L_side/0.3) + 1);
  `base:anchors` qty = corners on soft ground.
- `deck`: `base:deck-brackets` qty 2·corners (and 8·corners extra frame screws, §3.7).
- `raised-floor`: joists `base:joist<j>` (j = 0…nj−1, nj = ceilE(D/0.4) + 1) from u = d to W − d at
  v = d/2 + (D − d)·j/(nj−1); `base:floor` sheet area r3(W·D); `base:knee-braces` qty ceilE(W/0.9) + 1 when
  elevation > 0.
- `none`: `base:masonry` qty 2·corners.
- House back: if the back is not framed, ledgers `attach:ledger-top` (y = Hb − w/2) and
  `attach:ledger-bottom` (y = w/2), both length W; `attach:ledger-screws` qty 2·(ceilE(W/0.4) + 1); seal
  trim (material `board-1x2-furring`) `attach:seal-left` and `attach:seal-right` (length Hb),
  `attach:seal-top` (length W), and for window boxes `attach:seal-bottom` (length W).

### 3.6 Openings, vestibules and furnishings

Opening hardware key prefix `<side>:<kind>:<openingId>`:
- cat-door → `:kit` (`kit-cat-door`); window-access → `:kit` (`kit-window-insert`).
- human-door, cleaning-hatch (and a vestibule's door): leaf members `:stile-l`, `:stile-r` (length
  height − 2·0.006), `:rail-b`, `:rail-t` (length width − 2·0.006 − 2w), `:brace` when height − 0.012 > 1;
  leaf mesh `:mesh` (pitch width − 0.012, height height − 0.012); `:hinges` qty height > 1.5 ? 3 : 2
  (`hinge-spring-4in` if selfClosing else `hinge-tee-4in`); `:latch` (catalog hardware with that latch)
  when a latch is set; `:handle` for human doors.
- vestibule (front only): a lean-to-like sub-box W' = width, D' = depth ?? 0.9, H = height, framed and
  meshed front/left/right, translated to (offset, D), with a door (width doorW = min(0.76, width − 2w − 0.1), height = min(1.83, height − 2w − 0.02), offset = (width − doorW)/2, hasp, self-closing)
  when doorW > 0.4 and its height > 1, and a mesh roof. Keys prefixed `vest:<openingId>:`.
- Furnishings (key prefix `furn:<id>`, skipped into `skippedFurnishings` unless `furnishingFits`):
  `board-shelf` → `:board` (length L) + `:brackets` qty ceilE(L/0.6) + 1 (4 frame screws each);
  `board-ramp` → `:board` (L), cleats `:cleat<i>` i = 1…floor(L/0.15 + EPS) of length r3(boardWidth − 0.02),
  `:brackets` qty 2 (8 frame screws, 2 small screws per cleat); `board-bridge` → `:board` (length
  `length ?? W − 2d`), `:brackets` 2 (8 screws); `post-scratcher` → `:post` (length mountHeight), `:rope`
  (length r3(mountHeight·37.5)), `:brackets` 2 (8 screws); `kit` → `:kit` qty 1.

### 3.7 Fasteners (per structure, after everything above)

- `fasten:frame-screws` (`screw-ext-3in`) qty = 4 × members with role in {plate, stud, jamb, header,
  sill, rail, rafter, purlin, joist, door-stile, door-rail, door-brace, hoop-post, hoop-bar, tunnel-rail}
  + furnishing screws + 8·corners for deck bases.
- `fasten:corner-brackets` (`bracket-corner`) qty = 4 × (framed walls + 3 per vestibule) — tunnels:
  4 × hoops.
- `fasten:mesh-screws` (`screw-ext-1in-washer`) qty = Σ over wall/roof/door/tunnel mesh panels of
  2·ceilE(width/0.15) + 2·ceilE(height/0.15), + seal trim (ceilE(L/0.3) + 1 each) + ramp cleat screws;
  `fasten:mesh-washers` (`washer-fender-1in`) qty = the mesh part only. Skirts use staples.

### 3.8 Tunnels

Points closer than 0.05 m to the previous one are dropped; < 2 points → no parts. For each segment k
(a → z, length L, unit e, n = (−e.y, e.x)), bays = bayCount(L). Hoops at each segment's bay starts
`a + e·L·i/bays` (i = 0…bays−1) plus the final end, numbered in order: `hoop<i>:post-l|post-r` (y = w →
H − w at ±(W/2 − d/2)), `hoop<i>:top` (±W/2, y = H − w/2), `hoop<i>:bottom` (±(W/2 − d), y = w/2).
Rails `seg<k>:rail-tl|rail-tr|rail-bl|rail-br` along the segment. Mesh per bay `seg<k>:bay<i>:side-l`,
`:side-r` (pitch L/bays, height H) and `:top` (height W). At each bend v ≥ 1 with turn θ > 0.01 rad:
wedge = W·tan(min(θ, 1.4)/2), `corner<v>:side` (wedge, H) and `corner<v>:top` (wedge, W). End panels
`end-start:mesh` / `end-end:mesh` (W, H) unless a window-access sits at that end; opening kits keyed
`<back|front>:<kind>:<id>:kit`. Base: skirt `base:skirt` (perimeter = 2ΣL + 2W) with staples
ceilE(perimeter/0.3) + 2 and 4 anchors on soft ground; or pavers 2·Σ ceilE(L/paver.size) + sand.

### 3.9 Labels, cut plan, BOM, cost, steps

- **Labels:** per structure, letter A, B, … (`S<n>-` beyond 26); every part that is not a `connector` is
  sorted by step order (base, walls, attach, roof-frame, openings, mesh, roof-cover, skirt, furnish,
  inspect) then key (code-unit order) and labelled `<letter><1-based index>`.
- **Stock offered** for a lumber: catalog `stockLengths` ∩ `assumptions.stockLengths` (match within
  0.01 m); empty intersection → the catalog list.
- **Cut plan (FFD):** per lumber material (sorted by id), pieces = each member × qty, sorted by length
  desc then part id; longest = max(stock). A piece > longest + EPS is overlong. Otherwise it goes in the
  first open bin with `used + kerf·cuts + len ≤ longest + EPS`, else a new bin. Each bin is bought as
  the shortest stock ≥ `used + kerf·(cuts − 1)` − EPS; `offcut = r3(stock − that)`.
- **BOM:** lumber lines from the cut plan, one per (material, stock) — qty = bins, unit price =
  r2(stock·pricePerMeter); other materials aggregated over parts: mesh rolls ceilE(Σ rollLength·qty ·
  (1 + wasteFactor) / rollLength); sheets ceilE(Σ area·(1 + wasteFactor) / sheet area); fasteners boxes
  ceilE(Σ qty·(1 + fastenerOverage) / perBox); rope ceilE(Σ length / rollLength); everything else Σ qty.
  Line low/high = r2(qty·price). Sort by category (lumber, mesh, roof, sheet, hardware, fasteners, base,
  enrichment, kits), material id, stock length.
- **Cost:** low = floor(Σ low + EPS), high = ceil(Σ high − EPS) in BOM order.
- **Steps:** per structure, each step key in order that has parts (plus `inspect`, always):
  `{ id: stableId(<structureId>:step:<key>), order, title, partIds, checklist }`.
- **conceptOnly** = any structure from a concept-only template or with dimensions outside the template
  limits (`unsupported`, e.g. `"width 7.2 > 6"`).

## 4. Checks

`runChecks(project, catalog, assembly)` → findings `{ id = stableId(ruleId + ":" + targetIds.join(",")),
ruleId, ruleVersion, severity, title, message, remediation, targetIds, sources, acknowledgeable,
reviewable, status }`, sorted by severity (blocker, warning, advisory, info), then rule id, then id.
Wording, severity and sources come from the catalog's `rules.json`; the conditions are below. The first
target id is what an acknowledgement's `targetId` matches ('' for project-level). Status: `reviewed` if a
`professional-review` acknowledgement exists and the rule is `reviewable`; `acknowledged` if an
`acknowledge` exists and the rule is `acknowledgeable`; else `open`. A build package needs zero open
blockers.

Per structure s (tunnels skip rules marked †):
| Rule | Fires when |
| --- | --- |
| BLD-004 | template is concept-only |
| BLD-005 | `unsupported` is not empty |
| BLD-006 / BLD-007 | per skipped opening / furnishing (targets `[itemId, s.id]`) |
| BLD-003 | an overlong cut belongs to s |
| BLD-001 | maxPostSpacing > 1.22, or 2×2 frame with height > 1.5 |
| BLD-002 † | roof is corrugated/polycarbonate/partial and (Hb − Hf)/D < 1/12 |
| ENC-001 | mesh short opening ≥ 0.05 |
| ENC-002 | else short opening > 0.02 and a kitten is in the household |
| ENC-003 | mesh gauge ≥ 19 |
| MAT-001 | coating galvanized-before-welding |
| ENC-006 | a cat has escapeRisk high, s has a human door and no vestibule |
| ACC-001 / 002 / 003 / 004 | per opening: leaf without latch; human door not self-closing; gravity latch on an outward leaf; human door < 0.6 wide or < 1.5 high on a structure ≥ 1.8 high |
| ACC-005 † | no human door, cleaning hatch or vestibule |
| ACC-006 † | house-back template without window-access or cat door, and no tunnel end within 0.3 m |
| ENC-005 | tunnel without window-access/cat-door whose ends are > 0.3 m from house windows/doors and other structures |
| MAT-002 | elevation ≤ 0, base ground-skirt or none, soft ground, frame not ground-contact |
| MAT-003 | frame treatment ≠ none |
| WX-001 † / WX-002 † | mesh roof and hot climate / mesh roof otherwise |
| WX-003 / WX-004 | heavy snow / high wind |
| GND-001 | elevation ≤ 0, soft ground, base none or deck |
| GND-002 | freestanding or tunnel on pavers on soft ground |
| HOME-* / ENC-004 | house-back template on its host wall (both back corners within 0.3 m): HOME-006 if Hb + elevation > wall height; for each wall opening overlapping the contact span (> 0.01) and the height band [elev, elev + Hb] (> 0.01): dryer-vent → HOME-001, meter/utility → HOME-002, vent → HOME-004, downspout → HOME-005, egress window → HOME-003, and a window/door not fully inside (±0.01) and not the hostOpening served by a window-access → ENC-004 |
| ELEV-002 / ELEV-001 | elevation > 1.8 / > 0.9 |
| ELEV-003 | footprint area > 20 m² or Hb > 2.7 |
| DIM-002 | footprint overlaps an obstacle rectangle (separating axis, touching doesn't count) |
| DIM-001 | any key dimension not confirmed at its current value |
| WEL-001/002/004 † | area ≥ 1 m²: no rest/hide provider; < 2 distinct perch heights (cubby counts 0.4); no scratch |
| WEL-003 † | ≥ 2 cats and ≤ 1 perch furnishing |
| WEL-005 † | area ≥ 1.5 m² and no water |
| WEL-006 † | a litter and a water furnishing centre < 1 m apart |
| MOB-001 † | a senior or less-mobile cat, a step > 0.3 between sorted perch levels (incl. 0), and no ramp |

Project level: per plant placement PLT-003 (unknown plant, insufficient data or conflicting), PLT-001
(known hazard, severe), PLT-002 (known hazard, moderate/mild); PLT-004 once if any plants; MAT-004 once
if any structures.

## 5. Parity fixtures

`opencatio3d-cloud/tests/fixtures/web/<case>.openplan3d.json` (the file, `embedWebProject: false`) and
`<case>.expected.json`: `{ catalogVersion, structures, parts: [{ id, key, kind, role, materialId, qty,
step, label?, length?, width?, height?, rollLength?, area? }] (generation order, numbers rounded to
1e−6), cuts: { kerf, materials: [{ materialId, bins: [{ stock, cuts: [partId], offcut }], overlong:
[partId] }] }, bom: [{ key, qty, low, high }], cost: { low, high }, steps: [{ structureId, key, order,
parts }], findings: [{ ruleId, severity, targetIds, status }] }`, all with sorted keys. Cases: the three
samples, every template at min/default/max, and `all-rules` (every rule fires somewhere). iOS imports
each web file and must reproduce the expected JSON exactly; it writes its own cases to
`tests/fixtures/ios/`, which the web test checks when present. Geometry (`geom`) is not pinned but should
use the same formulas so the 3D views match.

Regenerate: `npm run fixtures` (web). Intended changes regenerate both sides in the same change.
