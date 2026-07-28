# Director Studio — brief 2: manual intent

An ADDENDUM to DESIGN_BRIEF.md (read that first; every rule in it still
holds). You are extending the existing `ui.html` you built — same single
self-contained file, same API origin, same dark tool aesthetic, same
data-act interaction style. This round adds the *manual editing* layer:
the user authors intent on the map, and the engine honors or refuses it
by name.

The design idea in one line: **make the user's will a first-class,
visible layer** — distinct from what the solver chose — with drawing,
pinning, and overriding done directly on the map, an exact diff after
every regenerate, and a real undo.

## New capabilities to design

### 1. Zone painting (spatial rules)

The recipe supports rectangular zones the engine enforces:
`paint.noContent` (nothing may be placed inside) and
`paint.preferContent` (a scoring bonus, `bonusPermille` 1–1000).

- A paint mode/tool on the map: drag a rectangle → choose *No content* /
  *Prefer content* (with a bonus amount for prefer).
- Zones render as a distinct overlay (e.g. red hatch vs green tint with
  intensity by bonus); click a zone to select → edit bonus / delete.
- Data shape in the recipe (rect = `[x0, y0, x1, y1]` inclusive):
  `paint: { noContent: [{rect}], preferContent: [{rect, bonusPermille}] }`
- Saving is a normal `PUT /api/recipe`. After the next Direct, gate G9
  proves compliance; a zone painted over existing content simply moves
  that content on the next Direct (the diff will show it).

### 2. Pin a boss / bind a dungeon (hand-authored locks)

The sanctioned "place it THERE" path — a pin is a recipe lock the engine
validates honestly.

- **Pin world boss**: an action on a map cell (e.g. from the cell's
  inspector or a context action in pin mode). The UI composes the lock:
  - `rule: "world_boss.v1"`, `cell` = the chosen cell (arena center),
  - `arenaSide` = recipe `worldBossRule.minClearance`,
  - `arenaOrigin` = `[cx - floor((side-1)/2), cy - floor((side-1)/2)]`,
  - `exclusionRadius` = `worldBossRule.exclusionRadius`,
  - `regionId` = the region of that cell (from `/api/analysis`),
  - `id` = `placement.world_boss.<regionId>.<slot>` where `<slot>` is
    the smallest integer not used by existing locks/placements of that
    rule+region (ids are opaque atoms to READ, but pins must MINT them
    with exactly this grammar — the server refuses anything else).
  Then merge into `locks.placements` via `PUT /api/recipe` (or reuse the
  shape `POST /api/lock` returns for solved placements).
- **Valid-site glow** while in pin mode: advisory shading of cells where
  a boss center can plausibly sit, computed from `/api/analysis`:
  center (cx,cy) is plausible when
  `clearance[(cy + side-1-floor((side-1)/2)) * width + (cx + side-1-floor((side-1)/2))] >= side`
  and the cell is not inside a noContent zone. **The glow is advisory —
  the engine is the authority.** After Direct, an invalid pin shows in
  `placements.lockReport` as `status:"invalid"` with named `reasons`
  (`arena_blocked`, `cell_not_walkable`, `over_budget`, …): surface that
  on the pin's map marker and inspector card, with one-click release
  (unlock). Never silently drop or nudge a pin.
- **Bind a dungeon**: the pack's `unboundAnchors[]` lists every
  dungeon-capable cave that ISN'T a dungeon (with cell + reason). Show
  them as faint markers; action *Bind as dungeon* composes a
  `dungeon_binding.v1` lock (`anchorPoiId`, `cell` = the anchor's cell,
  `exclusionRadius` = `dungeonRule.exclusionRadius`, same id minting).

### 3. Danger band override

`danger.overrides: [{regionId, band}]` (band `0..bandCount-1`, one entry
per region). In the region card: show the computed band
(`plan.regions[].dangerBand`, `dangerOverridden` flag), let the user set
or clear an override. Overridden regions get a badge on map + lists.
After Direct, surface `plan.checks.progressionWarnings` right where the
override was made — the engine warns when an override creates a
progression trap.

### 4. The intent layer

One toggleable overlay + panel showing everything the USER authored, as
distinct from what the solver chose:

- map: locks/pins (gold), zones, overridden regions, rerolled regions;
- panel: the live list — every lock (held/invalid/pending), every zone,
  every override, every reroll iteration — each with a remove action;
- **pending changes**: recipe edits since the last Direct (compare the
  current recipe against a snapshot taken at Direct time), listed with
  per-item revert, feeding the existing "stale — Direct to apply" state.

### 5. Diff after Direct (`GET /api/diff?world=W`)

After every Direct, show what changed — the engine is deterministic so
this is exact, not approximate:

```jsonc
{ "hasPrevious": true,
  "placements": { "added": [{id, cell}], "removed": [{id, cell}],
                  "moved": [{id, from, to, locked}], "unchanged": 3 },
  "territories": { "added": [ids], "removed": [ids],
                   "resized": [{id, from, to}],
                   "coverage": {"from": 1649, "to": 1702} },
  "gates": [{ "id": "G6", "from": "pass", "to": "fail" }] }
```

Design a compact "what changed" readout (toast/panel) with click-through
to the affected things on the map. `hasPrevious:false` on the first
Direct — say "first generation" rather than showing an empty diff.

### 6. Undo / history

- `GET /api/history?world=W` → `{entries: [1,2,…]}` — numbered recipe
  snapshots, oldest first (every save creates one; a restore snapshots
  the pre-restore state first, so undo is itself undoable).
- `POST /api/restore {world, entry}` → recipe becomes that snapshot.
- Design: an Undo affordance (restore latest entry) plus a small history
  list. After restore, the map is stale until Direct — the existing
  pending state covers it. Because generation is deterministic,
  restore + Direct reproduces the earlier pack EXACTLY — the UI can say
  so with confidence.

### 7. Enemy library editor

`contentLibrary.enemies[]`: `{id, biomes: [..], minBand, maxBand,
weightPercent (1..100), nightOnly}`. A proper table editor: add/remove
rows, biome multi-pick (offer the world's actual biomes from
`/api/analysis` `regions[].biome`, deduplicated — but allow free text,
it is game-owned vocabulary), band range, weight, nightOnly.
**Pre-Direct warning**: for each budgeted region (from `plan.regions`
with `budgets.territories > 0`), warn when no enemy matches
(`biomes.includes(region.biome) && minBand <= region.dangerBand <=
maxBand`) — today the user only finds out via `no_matching_roster`
failures afterward.

### 8. Seed control

`directorSeed` in the recipe identity. A "new seed" action (random or
+1) with an explicit confirm — it re-randomizes everything unlocked.
Locked placements survive seed changes; say so in the confirm copy.

## New API surface (additions to brief 1's table)

| Route | Response |
| --- | --- |
| `GET /api/analysis?world=W` | `{width, height, generationIdentitySha256, regions:[{label,id,biome}], regionLabels:{encoding:"runs-row-major", runs:[[value,count],…]}, clearance:{same}, safeZone:{encoding:"base64-bitpacked-row-major-lsb-first", grid}, walkable:{same}}`. Label `-1` = no region. Decode runs row-major (`index = y*width+x`); bit i of the masks = cell i, LSB-first. Fetch once per world and cache — it is immutable per world identity. |
| `GET /api/history?world=W` | `{entries:[1,2,…], hasOwnRecipe}` |
| `POST /api/restore` `{world, entry}` | `{ok, restored}` — 404 for unknown entries |
| `GET /api/diff?world=W` | shape shown above |

`docs/sample-api-2.json` holds real captured responses for all of these
(over the same fen-hollow world as brief 1's samples), including the
diff after an actual seed change and the error shapes.

## Constraints carried over, plus two new ones

Everything from brief 1 (single file, offline, verbatim errors, opaque
ids — with the one pin-minting exception spelled out above, busy state
on Direct). New:

- **Advisory vs authority**: any client-side validity hint (the pin
  glow, the roster warning) must be visually framed as advice; the
  engine's post-Direct verdicts (lockReport, gates, failures) are the
  truth and always win the display.
- **The intent layer is not a second data model**: it renders from the
  recipe (+ pending edits) only. No UI-side state that the recipe can't
  reproduce.

## Acceptance checklist (additions)

- Paint a noContent zone over an existing boss → Direct → the boss moves
  elsewhere, the diff names the move, the zone shows on the intent layer.
- Pin a boss on glowing ground → Direct → held at that cell, gold pin.
- Pin a boss on hostile ground (e.g. water) → Direct → the pin's marker
  and card show the engine's named reason; one click releases it.
- Bind an unbound cave → Direct → it is a dungeon placement.
- Override a region's band → Direct → band changes; any progression
  warning appears at the override.
- Every save is undoable; Undo → Direct visibly restores the previous
  layout and the diff confirms it.
- The enemy-library editor round-trips and the no-roster warning fires
  before Direct when a biome/band has no matching enemy.
- Works at 256×256 (analysis payload is fetched once and decoded to
  typed arrays; no per-frame decoding).
