# The director workflow — direct, review, lock, reroll, export

This is the F8 iteration loop: how a human directs a world, judges the
result, keeps what they like, re-rolls what they don't, and ships a frozen
content pack. Every step is a documented command; no step edits a file the
tool does not own. Recipes are **user-authored** — the CLI prints recipe
edits for you to paste, it never writes them (safe write rules).

Throughout: `<pack>` is a WorldForge game-pack directory, `<recipe>` a
DirectorRecipe JSON file (`fixtures/recipes/basic-direction.json` is the
committed example), and outputs land under `outputs/` unless you pass an
out-dir that the output guard accepts.

## 1. Direct

```sh
wf-fill inspect <pack>                 # identity, dimensions, parity summary
wf-fill analyze <pack>                 # spatial analysis + 11 heatmap renders
wf-fill plan <pack> <recipe>           # danger bands, budgets, waivers (+ danger render)
wf-fill place <pack> <recipe>          # bosses + dungeon bindings (+ placements render)
wf-fill territories <pack> <recipe>    # spawn territories (+ territories render)
wf-fill validate <pack> <recipe>       # the nine-gate audit -> report.json/report.txt
```

Each verb is deterministic: same pack + same recipe + same build = the
same bytes. `plan`/`place`/`territories`/`validate`/`export` all refuse a
recipe whose `base.generationIdentitySha256` pin does not match the pack
("stale base") — pin deliberately, re-pin deliberately.

## 2. Review

- **Viewer** (read-only, no build): open `viewer/index.html` in a browser
  and drop the export directory (and the `analyze` output directory, for
  heatmap backdrops) onto the page. Layer toggles for backdrop renders,
  territory fills, placement markers, exclusion radii, and arenas; hover
  any cell for the full explanation of what sits there — score terms,
  candidate funnel, top candidates, rosters, region brief, gate results,
  coverage. The viewer never writes, uploads, or fetches anything.
- **Terminal**: `wf-fill explain <placements.json> <placement-id>` prints
  the same explanation for one placement.

Structural success is not design approval: the audit passing means the
layout is *legal*, the review verdict is yours.

## 3. Lock what you like

```sh
wf-fill lock <placements.json> <placement-id>
```

prints the recipe entry; paste it under `locks.placements` in your recipe.
A held lock is emitted verbatim in every future solve (marked
`"locked": true`), is byte-stable across rerolls, and claims its ground
before any fresh solving. Lock ids are validated against the frozen
placement id scheme at recipe load. An invalid lock (the world changed
underneath it, budget shrank, zone painted over it) is never silently
dropped: it is named in `lockReport` with reasons, and `--strict` turns
invalid locks into a hard audit failure.

## 4. Reroll what you don't

```sh
wf-fill reroll <recipe> <region-id>
```

prints the `rerolls` entry (iteration bumped by one); paste it into the
recipe, replacing any existing entry for that region. The honest reroll
contract (ROADMAP F4): a reroll re-seeds ONLY that region's draw streams —
spatially uncoupled regions stay byte-identical, coupled regions re-solve
deterministically under their own unchanged channels, and locked
placements ignore rerolls entirely. To release a lock so its slot
re-solves fresh:

```sh
wf-fill unlock <recipe> <placement-id>
```

prints the `locks.placements` array with that lock removed; paste it in.

Iterate 1–4 until the review verdict is yes.

## 5. Export

```sh
wf-fill validate <pack> <recipe> --strict   # locks + pins become hard gates
wf-fill export   <pack> <recipe> [out] [--strict]
```

`export` runs the full pipeline and refuses to write anything unless the
audit passes; writes are staged with `manifest.json` last (a directory
without a manifest is not a pack). The result is a frozen format-1
content pack (docs/CONTENT_PACK_FORMAT.md); verify it in both lanes:

```sh
wf-fill verify-pack <pack> <content-pack>
godot --headless --script consumers/godot-proof/verify_content_pack.gd -- <pack> <content-pack>
```

## Using packs in the game (Godot)

`consumers/godot_addon/worldfiller_importer/` is the game-side importer:
copy that folder into a Godot 4 project, ship the world pack + content
pack as game data, and `WorldfillerImporter.load_packs(world_dir,
content_dir)` returns verified, decoded data (placements, territories
with cell arrays, walkability, POIs) plus query helpers
(`walkable`, `territory_at`, `placement_by_id`). Its README carries the
integration example and the runtime-split rules. Proof:
`godot --headless --script consumers/godot_addon/test_importer.gd --
<world-pack> <content-pack> <wrong-world-pack>`.

## The no-terminal loop (Windows)

Drop WorldForge world-pack folders into `worlds\`, optionally give each
one a recipe as `recipes\<world-folder-name>.json`, and double-click
`START-HERE.bat`: every world without a content pack gets directed and
the newest map opens. To regenerate after editing a recipe, delete that
world's folder under `outputs\export` and run it again. Refused worlds
are named in the console — a refusal is the audit working, not a crash.

## The regenerated-world (staleness) workflow

When the upstream world regenerates (new WorldForge behavior, new seed),
its `generationIdentitySha256` changes and everything downstream is
deliberately stale:

1. Every recipe-consuming verb refuses the old pin: "recipe pins base …
   re-pin deliberately". Nothing silently re-directs the wrong world.
2. Decide the regeneration was intended, then update
   `base.generationIdentitySha256` in the recipe to the new identity
   (`wf-fill inspect <pack>` prints it).
3. Re-run `validate`. Locks carry survivable intent across the boundary:
   each lock is re-checked against the new geography and either held
   (ground unchanged) or named invalid in `lockReport` with the reason
   (`anchor_missing`, `cell_not_walkable`, `arena_blocked`, …).
4. Re-lock or release the invalid ones (`lock`/`unlock`), re-review,
   re-export. The new pack records the new base identity; a game save
   keyed to the old pack's ids treats the new pack as a new derivative
   (packs are replaceable, pinned by recipe sha + base identity).

## Determinism notes for reviewers

- Byte-stability is the tripwire for accidental behavior change: export
  twice, `cmp` the packs. The committed golden pack
  (`fixtures/golden/content-pack/`) pins the frozen serialization in CI.
- Any legitimate behavior change bumps `DIRECTOR_BEHAVIOR_VERSION` plus
  the touched rule packs (src/core/version.ts) and re-records the golden
  pack — an explicit, logged decision, never a drive-by.
