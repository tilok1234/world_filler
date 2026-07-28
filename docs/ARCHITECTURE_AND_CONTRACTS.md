# World Filler Architecture and Contracts

Status: **Draft architecture, planning stage**

Implementation language: **TypeScript** (Node >= 24, zero runtime
dependencies, `tsc` + `node --test`), mirroring the upstream toolchain so the
same development and agent workflow applies to both repositories. This is the
working assumption for F0; record an ADR if it changes.

Upstream facts cited below were verified against WorldForge at behavior 47
(artifact `formatVersion` 8, recipe compiler 28, game pack format 1,
TileForge adapter 6). Version gates, not these prose numbers, are the
enforcement mechanism.

## Architectural principle

World Filler compiles a validated `DirectorRecipe` plus a read-only world
artifact into a versioned content pack, through explicit phases:

```text
world game pack (read-only)      DirectorRecipe (authored, has the seed)
        |                                   |
        v                                   v
   pack reader + validation  ->  normalized recipe + identity hash
        |
        v
   spatial analysis (derived, cacheable, deterministic)
        |
        v
   regional content plan (abstract budgets, no coordinates)
        |
        v
   constrained placement solver (hard filters -> scoring -> seeded pick)
        |
        v
   validation gates + audit report
        |
        v
   versioned content pack + renders
```

Every phase emits inspectable data. A failed phase names its constraint and
location; it never silently degrades.

## Input contract (what we read, all read-only)

World Filler consumes the **game pack** directory produced by WorldForge's
`export-game-pack` — the ratified consumer boundary — and can also accept a
bare `resolve-tileforge` output directory (then walkability verification data
is absent and must be self-derived; packs are preferred).

Game pack layout (pack format 1, frozen; 8 payload files + manifest):

```text
<world>-pack/
  manifest.json            # NOT listed in its own files table
  world.json               # semantic source of truth, artifact format 8
  normalized-recipe.json   # upstream authored intent (zones live here)
  validation-report.json   # {status, errors, warnings}; status must be "pass"
  resolved/resolved-map.tmj
  resolved/tileforge-map-data.json   # theme-coupled tile ids — DO NOT read semantics from this
  resolved/tileforge-slice.json
  walkability.json         # base64 bitgrid + floodCount + spawnCell
  minimap.png              # 1px per cell, used as render backdrop
```

From `world.json` (20 top-level keys) World Filler reads:

- `formatVersion` (gate: exactly the supported value, currently 8),
  `generator` (incl. `generationIdentitySha256`), `coordinates` (top-left
  origin, row-major), `dimensions`, `dependencies`;
- layer chunks: `material` (0-based index into `semanticPalette`),
  `elevation` (integer permille), `river` (0/1/2), `path`, `structure`/
  `prop`/`decal`/`fence`/`pier` (1-based indices into their tables), `moss`,
  `tallgrass`, `crop` (packed type<<4|stage);
- semantic records: `destinations` (index 0 is the canonical spawn/flood
  origin), `settlements` (kind, purpose, anchor, radius, structures with
  footprints and entrances), `landmarks`, `pois` (with optional structure),
  `routes` (endpoint pairs + crossings), `regions` (biome + cellCount only —
  no cell membership), `hydrology` (incl. `seaLevelPermille`);
- vocabularies embedded in the artifact (`semanticPalette`,
  `structureTypes`, `propTypes`, `decalTypes`, `cropTypes`, `fenceTypes`,
  `pierTypes`) — always read from the artifact, never hardcoded, since
  upstream tables are append-only.

Validation on import (mirroring the game-side importer's blessed checks):

1. `world.formatVersion == manifest.artifactFormat`;
2. `manifest.baseArtifactSha256 == manifest.files["world.json"]`;
3. every `manifest.files` entry hash-verifies (canonical-JSON bytes);
4. `validation-report.json.status == "pass"` (warnings are legal content);
5. recomputed walkability flood equals `walkability.json.floodCount` and
   `spawnCell` matches (see traversal contract below);
6. unknown `formatVersion` / `packFormat` / `walkabilityFormat` values are
   refusals, never best-effort reads.

### Traversal contract (must match upstream cell-exactly)

Walkability is derived, not stored, in `world.json`; the canonical rule is
the public loader's ladder, first hit wins:

1. structure cell: walkable only if its type has pass cells and this cell's
   row-major footprint index is listed (unlisted types block fully; painted
   cells without a footprint record default to index 0);
2. blocking prop species block (unlisted species never block);
3. any fence blocks;
4. trail (`path` layer) or pier walks;
5. route crossings walk (bridges/fords, plus derived street fords);
6. river tiers 1 and 2 block;
7. blocked materials block: `water.deep`, `terrain.rock`, `terrain.swamp`
   (shallow water deliberately wades);
8. otherwise walkable.

Canonical flood (identical in all upstream implementations, copied exactly):
seed at `destinations[0]`, nudged by expanding square scan radius 0..7,
`dy` outer / `dx` inner, first in-bounds walkable cell wins; BFS with
4-connected neighbors in order N `[0,-1]`, E `[1,0]`, S `[0,1]`, W `[-1,0]`;
count = dequeued cells. Flood numbers are never hardcoded — always compared
against the pack's own `floodCount`.

**How we obtain the ladder:** vendor the upstream public loader file
(`src/consumers/typescript/loader.ts`) into `vendor/worldforge/` as a
pinned, read-only copy with recorded upstream commit and file hash. It is a
single zero-import file, test-enforced upstream to stay that way, and is the
documented public consumer surface. The vendored copy is never edited except
by re-vendoring a newer pinned version (an explicit, logged decision). The
loader does not expose `settlements`/`landmarks`/`regions`; World Filler
reads those from raw `world.json` beside the handle. A standing parity test
floods every committed fixture world through the vendored loader and compares
against the fixture pack's `floodCount`.

### Staleness contract

Every derived output records the base identity. If the pack under direction
has a different `generationIdentitySha256` than a recipe's pins/locks were
authored against, World Filler must warn (default) or refuse (strict mode),
and can report which locked placements are now invalid (anchor gone, cell no
longer walkable, arena severed). Behavior bumps upstream legitimately move
content — the canonical world's flood shifted 33845 → 33893 at behavior 47;
treat "the map changed under me" as a first-class workflow, not an error.

## Component model

### 1. Pack reader and world model

Loads and validates a pack (above), exposes a `WorldModel`: cell accessors
via the vendored loader, plus typed access to settlements, landmarks, POIs,
routes, destinations, hydrology, vocabularies, and the walkability bitgrid.

### 2. Deterministic kernel

Own implementation, same doctrine as upstream: fixed-width uint32 mixing
(murmur3-fmix32-style finalizer, FNV-style combining), `hashCoords(seed, x,
y, salt)`-shaped primitives, named channels, hierarchical seed paths
(`world/<region>/<system>/<slot>`), deterministic weighted selection, and a
canonical JSON writer (sorted keys, 2-space indent, LF, trailing newline,
UTF-8, **safe integers only** — fractional quantities are expressed in
permille/percent integers exactly as upstream does). Golden vectors committed
for mixers, channel derivation, selection, and serialization. `Math.random`
and iteration-order dependence are forbidden.

### 3. Spatial analysis

Pure derivations from the world model, all deterministic and cacheable
(keyed by `generationIdentitySha256` + analysis version):

- connected walkable components (multi-component worlds are legal — island
  worlds may carry detached uninhabited landmasses; every analysis is
  per-component and content requiring spawn-reachability is confined to the
  spawn component);
- BFS path-distance fields (not Euclidean): from spawn, each settlement,
  roads/trails, water, map edge;
- clearance (largest free square/disc per cell) for arena-sized spaces;
- region segmentation: contiguous biome patches over the material layer with
  stable ids derived from content (upstream `regions[]` has no cell
  membership, and zones exist only in the upstream recipe — segmentation is
  ours);
- dead-end scoring, chokepoint detection, region adjacency graph;
- safe-zone masks (settlement radius + approach corridors);
- heatmap renders (PNG over the minimap) for every field, because trust
  requires inspection.

### 4. DirectorRecipe

The single authored input, schema-validated and normalized, identity-hashed
(`directorRecipeSha256`). Contains: director seed; target base identity
(optional pin); danger model parameters; per-region-class content budgets;
content definitions (or references to a content definition library file);
placement rule bindings; pins, locks, and painted zone overrides; export
options. Same doctrine as upstream recipes: versioned vocabulary, unknown
fields rejected, relational vocabulary only when its solver exists.

Content definition shape (draft, illustrative):

```jsonc
{
  "id": "boss.ancient_forest_guardian",
  "kind": "world_boss",
  "hard": {
    "allowedBiomes": ["terrain.grass"],
    "component": "spawn",
    "minClearance": 11,
    "minPathDistanceFromSettlement": 120,
    "minPathDistanceFromPeer": 250,
    "dangerBand": [12, 18]
  },
  "soft": {
    "nearPoiTypes": { "types": ["poi.ruin", "poi.stone_circle"], "weightPermille": 800 },
    "deadEndPermille": 700,
    "farFromRoadsPermille": 600
  },
  "reserve": { "arenaRadius": 9, "exclusionRadius": 40 },
  "game": { "scene": "res://content/bosses/ancient_forest_guardian.tscn" }
}
```

`game.*` is an opaque, namespaced passthrough — World Filler validates its
presence rules but never interprets engine paths.

### 5. Regional content plan compiler

Assigns each analysis region: a danger band (path-distance from spawn ×
recipe curve, clamped by overrides), a content budget (bosses, dungeon
bindings, territories, encounter sites) scaled by region area and class, and
a regional identity summary. Output is the abstract plan — readable JSON that
answers "what does this region contain?" before any coordinate exists.

### 6. Placement solver

Per plan item, in deterministic order: enumerate candidates from analysis →
apply hard filters → score soft preferences (integer weights) → select via
the item's seed channel among top candidates → reserve exclusion/arena cells
→ record an explanation (winning score terms, rejected-candidate counts).
Bounded retries; exhaustion is a named, located error (`no valid site for
boss.X in region Y: 0 candidates passed minClearance 11`), with the failure
surface rendered for inspection.

Dungeon bindings are placements onto existing structure-bearing anchors
(caves, crypts, mines, ruins, portals…): the solver assigns content identity,
danger, and entrance metadata to an anchor cell it verified reachable —
it never creates geometry.

Spawn territories are grown cell sets (walkable wilderness, excluding safe
zones and reservations) with rosters drawn from biome/danger tables, plus
budget parameters (`maxActive`, pack size range, respawn pressure, elite
chance, night modifiers) that the game runtime interprets.

### 7. Validation gates

A pack exports only if: every placement's cell is walkable and (when
required) flood-reachable from spawn under the exact upstream flood; arena
and exclusion reservations do not overlap each other, safe zones, or
territory cores; every region meets its budget or carries a named waiver;
danger bands are monotone-sane along the route graph from spawn (no early
region reachable only through a much higher band); locked placements still
valid against the base; all ids resolve; the pack round-trips
(re-read == re-validate clean). Warnings (density outliers, empty regions
by design, unbound anchors) are legal and listed in the report.

### 8. Exporter

Writes the content pack through the canonical JSON writer, byte-stable, no
timestamps (identity is hashes).

### 9. Viewer and renders

Static PNG renders (analysis heatmaps, plan map, placement map over the
minimap) are the F2–F6 evidence format. A single-file, no-build, read-only
browser viewer (layer toggles, hover inspection of placements and their
explanations) follows once layers stack — same delivery style and read-only
contract as the upstream artifact viewer.

## Output contract: the content pack

```text
<world>-content/
  manifest.json           # identity + file hashes, not in its own table
  content-plan.json       # abstract per-region plan (budgets, danger bands)
  placements.json         # bosses, dungeon bindings, encounter sites
  territories.json        # spawn territories (cell sets + rosters + budgets)
  danger.json             # per-region bands + optional packed per-cell grid
  report.json             # validation results, waivers, explanations index
  renders/                # placement/danger/analysis PNGs (optional payload)
```

`manifest.json` (draft):

```jsonc
{
  "pack": "worldfiller-content-pack",
  "packFormat": 1,
  "adapter": { "name": "worldfiller", "version": "0.1.0" },
  "base": {
    "generationIdentitySha256": "<from world.json>",
    "artifactFormat": 8,
    "artifactSha256": "<sha256 of world.json bytes>"
  },
  "directorRecipeSha256": "<sha256>",
  "directorBehaviorVersion": 1,
  "rulePacks": { "analysis": 1, "plan": 1, "placement": 1, "territory": 1 },
  "files": { "placements.json": "<sha256>", "...": "..." }
}
```

This follows the upstream derivative rule (every consumer derivative records
base artifact hash + adapter version, shape per `cacheStamp()`), the
manifest-hash conventions of game pack format 1 (byte-stable, no timestamps,
manifest not listing itself), and freezes ids/filenames at pack format 1 —
later versions append fields, never repurpose them.

Placement entry (draft):

```jsonc
{
  "id": "placement.boss.eastern_greenwood.0",
  "contentId": "boss.ancient_forest_guardian",
  "kind": "world_boss",
  "regionId": "region.14",
  "cell": [1842, 927],
  "arenaRadius": 9,
  "exclusionRadius": 40,
  "channel": "world/region.14/boss/0",
  "rule": "world_boss.v1",
  "locked": false,
  "game": { "scene": "res://content/bosses/ancient_forest_guardian.tscn" }
}
```

Territory entry (draft):

```jsonc
{
  "id": "territory.ashen_foothills.041",
  "regionId": "region.7",
  "cells": { "encoding": "rect-runs", "runs": [[812, 300, 24, 1], [810, 301, 28, 1]] },
  "dangerBand": [10, 14],
  "roster": [
    { "enemyId": "enemy.ember_hound", "weightPercent": 45 },
    { "enemyId": "enemy.ash_cultist", "weightPercent": 30 },
    { "enemyId": "enemy.magma_beetle", "weightPercent": 20 },
    { "enemyId": "enemy.cinder_knight", "weightPercent": 5 }
  ],
  "packSize": [3, 7],
  "maxActive": 22,
  "respawnPressure": "medium",
  "elitePermille": 30,
  "night": { "addRoster": ["enemy.ash_cultist"] }
}
```

`enemyId`/`contentId` vocabularies are owned by the game's content
definitions; World Filler validates internal consistency (every referenced id
defined in the recipe's content library), not game truth.

### Godot consumption (deferred, contract-shaped now)

The game repo (separately scoped, later) gains a small
`worldfiller_importer` addon beside its WorldForge importer, following the
same ratified pattern: frozen validated pack in `assets/`, validating
importer, manifest contract frozen at v1. It cross-checks the content pack's
`base.generationIdentitySha256` against the world pack it loads beside — a
mismatched pair refuses at import, not at play time. Runtime: instantiate
placements and activate territories from the chunk streamer's existing
load/unload hooks; kill/loot state lives in game-side delta files per
upstream doctrine. None of this is built in F0–F6; the pack format is
designed so it can be.

## Determinism contract

Generation identity is:

```text
base generationIdentitySha256 (the world)
+ normalized DirectorRecipe (including director seed)
+ director behavior version
+ rule-pack versions
```

Identical identity → byte-identical pack. Every random decision draws from a
named hierarchical channel; adding a content definition must not reshuffle
unrelated channels; rerolling a region re-seeds only that region's subtree.
Analysis is pure derivation (no randomness). Golden fixtures: committed
world packs (with recorded upstream provenance) + committed DirectorRecipes +
expected pack hashes, tested on every change. Cross-platform reproduction is
a target from F1, enforced in CI like upstream.

## Versioning

Distinguish, gate, and stamp: content pack format; director behavior
version; rule-pack versions (analysis / plan / placement / territory);
supported upstream artifact format (exactly 8 until a migration decision);
supported game pack format; vendored loader provenance (upstream commit +
file hash). Append-only vocabularies once shipped: content kinds, placement
rule ids, channel names, pack enums. A behavior change never silently
rewrites an existing approved pack — approved packs stay pinned or go
through an explicit re-direction decision, exactly as upstream treats worlds.
