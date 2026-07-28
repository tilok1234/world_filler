# Director Studio — front-end design brief

This brief is self-contained: hand it (plus the sample JSON at the
bottom) to a design/build session and it can produce the finished
front-end without reading any other file in this repository.

## What you are building

A single-page browser UI called **Director Studio** for a tool that
generates game content (boss locations, dungeon entrances, enemy spawn
territories) over procedurally generated worlds. The user is a solo game
developer. The engine underneath is deterministic and audited; the UI is
a *shell* over it — it never computes content itself.

The core loop the UI serves, in the user's words: **look at the map →
keep what I like (lock) → re-randomize what I don't (reroll) → tweak the
numbers (recipe) → regenerate (direct) → repeat until it feels right.**

## Deliverable and hard constraints

- **One file: `ui.html`.** Everything inline (CSS + vanilla JS or inline
  framework — no CDNs, no external fonts, no network beyond the API
  below; it must work fully offline). It replaces the placeholder at
  `src/serve/ui.html` and is served at `/` by a local server.
- The API is `same-origin` at `http://localhost:8787` — plain `fetch`.
- **No free-form map editing.** There is deliberately no "drag the boss
  somewhere" — manual intent flows ONLY through the verbs: lock, unlock,
  reroll, recipe edits, direct. Do not design affordances that promise
  otherwise.
- Show engine messages verbatim where the user acts (refusals like
  `refusing — recipe pins base … (stale base; re-pin deliberately)` are
  designed, human-readable sentences — surface them, never swallow).
- Treat all `id` strings as opaque atoms (display, compare, never parse).
- The map is a cell grid (typically 64–256 cells square). Render crisp
  (nearest-neighbor / `image-rendering: pixelated`).
- Directing can take seconds on big worlds: the Direct action needs a
  busy state; everything else is instant.
- Dark-friendly by default; this is a tool people stare at.

## Screens / regions (one page, three zones)

1. **World rail** (left or top): the list from `GET /api/worlds` —
   name, size, badges for "own recipe" / "exported". Selecting a world
   drives everything else. A prominent **Direct** button (with a
   `strict` toggle) regenerates the selected world.
2. **Map** (center): the star of the page.
   - Backdrop: one of four PNGs from `GET /api/render` (terrain, danger,
     placements, territories) — a small switcher; terrain default.
   - Overlays drawn client-side from `GET /api/pack` data: territory
     cell fills (stable distinct color per territory id), placement
     markers (boss vs dungeon distinct; locked state visibly different,
     e.g. pinned/badged), boss arena outlines, optional exclusion-radius
     circles.
   - Hover any cell → inspector updates (no click needed). Click a
     placement/territory → select it (drives the action panel).
3. **Inspector + actions** (right): context for the hovered/selected
   thing plus the verbs:
   - Placement selected → its facts (rule, cell, region, score breakdown
     table `scoreTerms`, candidate funnel, top candidates) and a
     **Lock** or **Unlock** button (`POST /api/lock` / `/api/unlock`).
     Locked placements show sentinel explanations — display "held by
     recipe lock" instead of scores.
   - Territory hovered → danger band, cell count, enemy roster table
     (enemyId, weight%, nightOnly), packSize, maxActive,
     respawnPressure, elite‰.
   - Region context (from `pack.plan.regions` by `regionId`) → biome,
     danger band, budgets, waivers, and a **Reroll region** button
     (`POST /api/reroll`).
   - A collapsible **Audit** section: the nine gates from
     `pack.report.gates` (pass/warn/fail with details), plus counts and
     named failures (`placements.failures`, `territories.failures`,
     `unboundAnchors` summarized by reason).
   - A **Recipe** section: editable form generated from
     `GET /api/recipe` `.normalized` (that object shows every knob with
     defaults filled in — numbers, enums, and the enemy library array).
     Save via `PUT /api/recipe` with the edited **raw** object; the
     server validates and answers either `{ok:true}` or a named error
     pointing at the exact field (`recipe: $.territoryRule.minCells must
     be …`) — show it inline. A raw-JSON fallback editor is fine as an
     "advanced" toggle.

After any verb (lock/unlock/reroll/recipe save), the change is only in
the recipe — the map is stale until **Direct** runs again. Make that
state visible (e.g. "3 pending changes — Direct to apply").

## The API (all JSON unless noted)

Errors: non-2xx with `{ "ok": false, "error": "<human sentence>" }`.

| Route | What it does |
| --- | --- |
| `GET /api/worlds` | `{worlds:[{name, source:"fixtures"\|"worlds", width, height, hasOwnRecipe, hasExport}]}` |
| `POST /api/direct?world=W[&strict=1]` | Runs generation + export. `{ok, counts:{placements,territories,placementFailures,territoryFailures,unboundAnchors}, gates:[{id,name,status}], strict}` — or a refusal error (409). |
| `GET /api/pack?world=W` | `{manifest, plan, placements, territories, report}` — the five exported documents (404 until first direct). |
| `GET /api/render?world=W&name=N` | PNG bytes; N ∈ terrain, danger, placements, territories. |
| `GET /view?world=W` | Standalone read-only map page (link out; don't embed logic against it). |
| `GET /api/recipe?world=W` | `{world, path, own, raw, normalized}`. `raw` = file text; `normalized` = full object with every default filled. |
| `PUT /api/recipe?world=W` (body = recipe JSON) | Validate + save as this world's own recipe. |
| `POST /api/lock` `{world, placementId}` | Adds the lock to the recipe (needs a current export). |
| `POST /api/unlock` `{world, placementId}` | Removes the lock. |
| `POST /api/reroll` `{world, regionId}` | Bumps that region's reroll iteration. |

## Data shapes you will draw from (`GET /api/pack`)

- `placements.placements[]`: `{id, rule:"world_boss.v1"|"dungeon_binding.v1",
  regionId, cell:[x,y], accessCell:[x,y], anchorPoiId, anchorPoiType,
  inSafeZone, arenaOrigin:[x,y]|null, arenaSide:int|null,
  exclusionRadius:int, locked:bool, channel, draw, score,
  scoreTerms:[{term,value,weightPermille,contribution}],
  candidateFunnel:[{stage,remaining}], topCandidates:[{cell,score}]}`
- `territories.territories[]`: `{id, regionId, dangerBand, seedCell,
  cells:{encoding:"runs", runs:[[x,y,length],…]}, cellCount,
  roster:[{enemyId,weightPercent,nightOnly}], packSize:[min,max],
  maxActive, respawnPressure:"low"|"medium"|"high", elitePermille,
  channel, draw}` — decode runs as: cells (x+i, y) for i in 0..length-1.
- `territories.coverage`: per-region coverage stats (budgeted regions
  only) — nice for a small bar per region.
- `plan.regions[]`: `{id, biome, cellCount, hostileWalkableCells,
  dangerBand, regionClass, budgets:{territories, encounterSites,
  dungeonBindings, worldBosses}, waivers:[…]}` plus
  `plan.worldBudget`, `plan.checks.progressionWarnings`.
- `report`: `{ok, strict, gates:[{id,name,status:"pass"|"warn"|"fail",
  details:[…]}]}`.
- Grid geometry: `manifest.base.width/height`; cell index = `y*width+x`.

## Acceptance checklist

- Loads with zero configuration at `/`; works offline; no external
  resources anywhere in the file.
- Pick world → Direct → map renders with overlays → hover shows
  explanations → lock a boss → reroll another region → Direct again →
  the locked boss is visibly unchanged and marked locked.
- A failing direct (e.g. strict + invalid lock) shows the engine's
  refusal text without losing UI state.
- Recipe form round-trips: load, change a number, save, see the saved
  state reflected (`hasOwnRecipe` flips true; direct uses it).
- Degrades sanely for a 256×256 world (map still navigable, lists still
  scannable).

## Sample data for building without the server

`docs/sample-api.json` (next to this brief) holds real captured
responses for every JSON route over a real 64×64 world, including the
error shapes — develop the whole UI against it, then swap in `fetch`.
For live testing, run `node dist/src/cli.js serve` in the repository
(or STUDIO.bat on Windows) and open http://localhost:8787.
