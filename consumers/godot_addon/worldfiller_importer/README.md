# worldfiller_importer — use content packs in your Godot 4 game

This folder is the game-side importer. It turns a WorldForge world pack
plus its worldfiller content pack into game-ready data: where the bosses
are, which caves are dungeon entrances, which ground spawns which
enemies. It verifies everything before trusting a byte — a tampered,
mismatched, or hand-built pack is refused with a named error.

## Install (once)

Copy this whole folder into your Godot 4 project, e.g.:

```text
res://worldfiller/worldfiller_importer/
```

That's it — `WorldfillerImporter` is then available everywhere
(`class_name`, no autoload needed).

## Ship the data with your game

Put the two pack directories somewhere your game can read, e.g.:

```text
res://data/my-big-world/            <- the WorldForge world pack
res://data/my-big-world-content/    <- worldfiller's outputs\export\my-big-world-content
```

(Only the five JSON payload files matter to the importer; `renders/` and
`view.html` are inspection extras you can leave out of the game.)

## Load and use

```gdscript
var pack := WorldfillerImporter.load_packs(
    "res://data/my-big-world",
    "res://data/my-big-world-content",
)
if not pack.ok:
    push_error(pack.error)      # a refusal names exactly what is wrong
    return

# Bosses and dungeon entrances:
for placement: Dictionary in pack.placements:
    match placement.rule:
        "world_boss.v1":
            # placement.cell = arena center, placement.arenaOrigin/arenaSide
            # = the reserved square, placement.exclusionRadius = spacing.
            spawn_boss_marker(placement.id, placement.cell)
        "dungeon_binding.v1":
            # placement.anchorPoiId is the world-pack POI this entrance
            # binds; placement.accessCell is the walk-up ground.
            register_dungeon(placement.id, placement.cell, placement.anchorPoiId)

# Spawn territories — which ground spawns what:
for territory: Dictionary in pack.territories:
    # territory.cells_decoded: PackedInt32Array of cell indexes (y*width+x)
    # territory.roster: [{enemyId, weightPercent, nightOnly}], plus
    # packSize, maxActive, respawnPressure, elitePermille, dangerBand.
    register_spawn_area(territory.id, territory)

# Point queries any time after load:
WorldfillerImporter.walkable(pack, x, y)         # world walkability truth
WorldfillerImporter.territory_at(pack, x, y)      # {} when no territory
WorldfillerImporter.placement_by_id(pack, "placement.world_boss.region.mud.1245.0")
```

## What is the game's job vs the pack's job

The pack is **permanent structure** — deterministic, replaceable, never
edited at runtime. Your game owns everything that *happens*: actually
spawning enemies against a territory's roster/budgets, boss door/kill
state, loot. Persist those as your own save-data deltas **keyed by the
placement/territory `id`** — ids are stable, opaque strings. When a
world is re-directed (new content pack), old deltas keyed to vanished
ids simply retire.

`enemyId` values come from the recipe's content library — they are YOUR
vocabulary. Make them match your enemy scenes/resources.

## Errors you might see

Every failure is a named refusal in `pack.error`, e.g. "directed against
a different world" (you paired the wrong world/content folders),
"payload hash mismatch" (edited or corrupted file), "report.json .ok is
not true" (the pack was never legally exported). The fix is always to
re-export a fresh pack with worldfiller — never to hand-edit one.

The full frozen format contract lives in `docs/CONTENT_PACK_FORMAT.md`
in the worldfiller repository.
