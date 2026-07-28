# World Filler Vision and Scope

Status: **Draft, planning stage**

## Concept identity

World Filler is a deterministic, inspectable **world director** for top-down
games built on WorldForge worlds.

It reads a finished, versioned world artifact and compiles the gameplay
content layer: world bosses, dungeon entrances, enemy spawn territories,
danger progression, encounter sites, and content density — as a separate
versioned content pack the game composes with the terrain.

It is to gameplay structure what WorldForge is to geography: not a random
scatterer, but a compiler that turns intent (a DirectorRecipe) plus source
data (the world artifact) into validated, reproducible output.

## The problem it solves

A generated world, however coherent, is an enormous decorated surface. The
hard problem after terrain is not "more map" — it is deliberate structure:

- what the player encounters, and where difficulty rises;
- where bosses live and why those places feel right;
- which existing caves, crypts, mines, and ruins are *actual* dungeons;
- which wilderness belongs to which enemies, and how crowded it feels;
- how content connects into progression instead of noise;
- how a designer can audit, lock, and iterate on all of the above without
  hand-placing thousands of objects.

WorldForge deliberately refuses to answer these (its doctrine assigns content
to the game or a versioned content pack). World Filler answers them.

## Design pillars

### 1. Geography is read-only truth

The world artifact is never edited, "fixed", or reinterpreted. World Filler
assigns meaning to existing geography. If the geography lacks something
(a cave where a dungeon should be), that is an upstream WorldRecipe request,
surfaced explicitly — never a silent workaround.

### 2. Constraints create purpose

Every content definition carries hard requirements (allowed biomes, clearance,
reachability, distances) and soft preferences (near ruins, far from roads,
dead-end regions). Candidates are filtered, scored, and selected with seeded
randomness. Every placement can explain itself.

### 3. Plan before position

Regions receive an abstract content budget — counts, danger band, identity —
before any coordinate is chosen. A huge world becomes manageable as a set of
regional briefs, not a soup of spawn points.

### 4. Deterministic by contract

Same base artifact + same normalized DirectorRecipe + same compiler version =
byte-identical content pack. Hierarchical named seed channels
(world → region → system → slot) keep rerolls local: regenerating one
region's dungeons cannot move another region's bosses. Determinism is tested,
not assumed.

### 5. Bake structure, not activity

The pack carries permanent decisions: boss sites and arenas, dungeon
bindings, territory shapes and rosters, danger bands, safe zones. The game
runtime owns live activity: actual spawning, pack sizes in the moment,
respawn pressure, kill state (stored as game-side deltas per upstream
doctrine). The director defines the stage; the game plays on it.

### 6. Validation is a product feature

A pack ships only after gates pass: every placement reachable under the
canonical walkability contract, spacing and exclusion respected, budgets met
or explained, progression sane (no endgame territory blocking the only path
to an early region), no content in safe zones. The audit report is as
important as the pack — it replaces hours of walk-testing.

### 7. The developer outranks the generator

Pins, locks, per-region rerolls, painted no-content/preferred-content zones,
and placement explanations are contract features. "Press generate and accept
everything" is explicitly not the product.

### 8. Isolated consumer, same doctrine

World Filler is a third consumer lane beside the Godot and TypeScript
consumers: separate repository, coupled only through the versioned artifact
format, carrying the same determinism, canonical serialization, append-only
vocabulary, and evidence doctrine as the upstream it consumes.

## Intended developer-facing result

- Import a world pack; see analysis heatmaps (reachability, clearance,
  distance-from-civilization, danger) within seconds.
- Generate a content layout from a recipe; read the report; view placements
  over the minimap.
- Lock what is good, reroll what is not, region by region.
- Export a validated content pack the game imports beside the world pack.
- Regenerate either side (new terrain, or new content over kept terrain)
  without losing the other.

## Non-goals

World Filler does not:

- generate or modify terrain, water, routes, settlements, or decoration;
- change walkability or stamp physical structures into the world;
- write to the WorldForge, TileForge, or game repositories;
- own combat, enemy AI, loot tables, quest logic, dialogue, or economy;
- simulate populations, factions, or ecology (it places static structure;
  simulation is a possible later layer, game-side);
- spawn anything at runtime — the game does, from the pack's territories;
- decide final game balance (danger bands are structure, not tuning);
- require AI/LLM services for generation (like WorldForge, any AI authoring
  assistance stays outside the deterministic compiler);
- promise a validated layout is automatically fun without human review.

## Product boundaries

| Concern | Owner |
|---|---|
| Terrain, hydrology, routes, settlements, landmarks, POIs | WorldForge |
| World artifact / game pack | WorldForge (read-only input here) |
| Content intent: budgets, danger model, definitions, pins | DirectorRecipe (user-authored) |
| Spatial analysis, content planning, placement, validation | World Filler |
| Content pack: bosses, dungeons, territories, danger bands | World Filler output |
| Enemy stats, boss mechanics, loot, quests, scenes | Game |
| Runtime spawning, respawns, kill state, persistence | Game |
| Physical new structures (arena ruins, extra cave mouths) | Upstream WorldRecipe request |

## First playable proof

One approved fixture world (a small 256² world with cities, towns, villages,
landmarks, and 100+ POIs) directed into: per-region danger bands, one world
boss with a validated arena site, every dungeon-suitable anchor bound or
explicitly skipped with a reason, wilderness covered by spawn territories
with biome-appropriate rosters, safe zones around settlements — exported as a
validated content pack, rendered over the minimap, and loaded by a minimal
Godot proof scene.
