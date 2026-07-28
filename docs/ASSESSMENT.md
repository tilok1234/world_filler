# Assessment: is a separate world director the right move?

Status: **Researched assessment, 2026-07-28** — based on reading the WorldForge
repository at behavior 47 (artifact format 8, recipe compiler 28, game pack
format 1). File and line references are to that state.

## Verdict

Yes — and not merely as a good idea. After reading the upstream codebase, a
separate content director is the *doctrinally required* shape for this
capability, and the integration seams for it already exist. The alternatives
are all worse:

- **Growing content systems inside WorldForge** is explicitly forbidden
  ground: `AGENTS.md` lists "expanding WorldForge into game-specific
  progression or content systems" under decisions an agent must never take
  implicitly, the W8 exit criteria require that "no game-specific quest,
  enemy, progression, or lore system enters the core", and the roadmap defers
  "quest and narrative generation" and "enemy population simulation"
  indefinitely.
- **Hand-placing content in Godot** does not scale past one small map and
  throws away the regenerate-and-compare workflow that makes the WorldForge
  pipeline productive.
- **Runtime-random spawning in the game** produces the "randomly scatter
  enemies on empty ground" failure: no progression structure, no regional
  identity, nothing to lock or iterate on.

A separate deterministic compiler that reads the world artifact and emits a
versioned content pack gives the same properties that make WorldForge itself
pleasant to work with: reproducibility, seeded iteration, validation gates,
inspectable intermediate data, and an approval workflow.

## What WorldForge already provides (the input is rich)

The world artifact (`world.json`, format 8) is not a picture of terrain — it
is semantic data a director can reason over directly:

- **Materials with meaning:** a 12-entry semantic palette
  (`terrain.grass`, `terrain.swamp`, `water.deep`, `terrain.packed_road`, …)
  per cell, plus elevation in integer permille, river tiers, trails, moss,
  crops, fences, piers.
- **Civilization records:** settlements with kind (`city`/`town`/`outpost`),
  purpose (`harbor`/`crossing`/`farming`/`mining`/`waypoint`), anchor, radius,
  and every structure with footprint and entrance; landmarks with footprints
  and entrances; routes as endpoint pairs with bridge/ford crossings.
- **Ready-made content anchors:** 28 append-only POI types, many of them
  dungeon-shaped — `poi.cave`, `poi.mine`, `poi.crypt`, `poi.ruin`,
  `poi.city_ruin`, `poi.beast_den`, `poi.bandit_camp`, `poi.witch_circle`,
  `poi.giant_skeleton` — carrying structures like `structure.cave_mouth`,
  `structure.mine_shaft`, `structure.crypt`, `structure.portal`,
  `structure.ruin_temple` with defined pass cells. A generated 256² world
  ships with 100+ story POIs that currently *mean nothing*. Assigning meaning
  to them is the director's cheapest, highest-value move.
- **A canonical traversal contract:** walkability is defined by a documented
  ladder in the public TypeScript loader (structures with pass cells,
  blocking props, fences, trails/piers walk, crossings walk, rivers block,
  `water.deep`/`terrain.rock`/`terrain.swamp` block, shallow water wades),
  proven cell-identical across the Godot and TypeScript consumers, with a
  canonical flood count published in the game pack for verification.
- **Identity and versioning:** every artifact records generator behavior
  version, recipe hashes, and a generation identity SHA; the game pack
  manifest hashes every payload file. A derivative tool can prove exactly
  which world it was generated against — and detect staleness.

## What WorldForge deliberately does not provide (the gap is real)

- **No gameplay content.** No spawns, encounters, bosses, dungeons-as-
  gameplay, difficulty, or progression. Grepping the source for content
  systems finds only the doctrine statements assigning them elsewhere.
- **No extension interface yet.** "Exact extension interface for
  game-specific content" is listed as an open decision; the ratified game
  integration plan's content is geography-only. The Godot demo consumer has
  no content layer — its chunk load/unload hooks are empty seams.
- **No region cell-membership.** `regions[]` carries only biome + cell count;
  zones exist only in the recipe, not the artifact. A director must build its
  own spatial analysis (region extents, distance fields, clearances,
  chokepoints) — which is fine, because that analysis is director-specific
  anyway.
- **No danger/difficulty model.** The architecture doc mentions "optional
  progression or difficulty bands" as a future planner concern; nothing
  exists. The director owns this.

The gap between "geography with anchors" and "a game world with structure" is
exactly one tool wide, and that tool is this repository.

## Design conclusions the research forces

These fell out of reading the upstream contracts, and the architecture doc
adopts them:

1. **Consume the game pack, not the repo.** `export-game-pack` output is the
   ratified consumer boundary: 8 hashed payload files + manifest, refusing to
   export unless validation passes and every destination is reachable. World
   Filler validates the same invariants the game-side importer validates
   (format version match, `baseArtifactSha256 == files["world.json"]`,
   recomputed flood == `floodCount`).
2. **Never change walkability.** An entire class of upstream bugs (behavior
   47's "trails stay open") came from content severing corridors. World
   Filler sidesteps the class: it places logical content on existing walkable
   geography and validates reachability with the exact upstream flood
   algorithm; it never stamps blocking cells. Physical additions (a boss
   arena's ruins, a new cave mouth) are upstream WorldRecipe/authored-stamp
   requests, a lane WorldForge already ships.
3. **Bind dungeons to existing anchors first.** Placement quality is highest
   where geography already agrees — the artifact's caves, crypts, mines, and
   ruins have entrances, approach trails, and visual identity. Free-floating
   content (spawn territories, roaming elite ranges) needs no terrain at all.
4. **Bake structure, not activity.** The pack carries permanent decisions
   (boss sites, dungeon bindings, territory shapes, danger bands); the game
   runtime owns actual spawning, respawn pressure, and kill-state (which
   upstream doctrine already routes into `user://` delta files, not the
   artifact).
5. **Mirror the determinism kernel, do not import it.** Canonical JSON
   (sorted keys, LF, safe integers only — permille instead of floats),
   murmur3-style fixed-width integer mixing, named hierarchical seed
   channels, golden-vector tests. Same doctrine, own implementation, proven
   against committed fixtures.

## Risks and honest warnings

- **Stale packs on behavior bumps.** Upstream behavior bumps legitimately
  move POIs and walkable cells (the canonical world's flood shifted
  33845 → 33893 at behavior 47). Every content pack must hard-record its base
  `generationIdentitySha256` and the tool must refuse or clearly warn when
  directing against a changed world. This is a first-class feature, not an
  edge case.
- **Multi-component worlds.** Island worlds can carry detached, uninhabited
  landmasses; upstream multi-component routing is an open designer decision.
  The director must analyze per-component and must not assume one flood
  covers the map — uninhabited components are legal content targets only for
  content that does not require reachability from spawn.
- **Scope gravity.** The failure mode is building quests, factions, economy,
  and events before boss placement works. The roadmap gates hard: the first
  slice is analysis + danger bands + bosses + dungeon bindings + territories
  on one fixture world, nothing else.
- **Design taste still rules.** A validated layout is not a fun layout. The
  workflow keeps the human verdict loop (renders, reports, locks, rerolls)
  exactly as WorldForge does for terrain — structural success and design
  approval stay separate.

## What this unlocks once it exists

Regenerate five content layouts over one approved world (boss-heavy,
dungeon-heavy, sparse-dangerous, dense-MMO, exploration-focused) and compare
them; keep a layout while the terrain team iterates upstream (rebind or
re-validate against the new base); audit any world for dead regions, blocked
progression, or unreachable content before a tester ever walks it; and later,
feed the same content pack to both the Godot game and any TypeScript tooling,
because the pack follows the same engine-neutral, hash-identified conventions
as its input.
