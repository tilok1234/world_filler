# The director workflow: direct → review → lock → reroll → export

The working loop for shipping a content pack over a WorldForge world.
Every verb is deterministic; recipes are the only thing you edit, and no
verb ever edits one for you (`lock`, `unlock`, and `reroll` print the
entry to author — pasting it into the recipe is your explicit decision).

## 0. Prerequisites

    npm install && npm test          # node >= 24.15
    node dist/src/cli.js help        # wf-fill

A world pack directory (WorldForge `export-game-pack` output) and a
DirectorRecipe (start from `fixtures/recipes/basic-direction.json`).
`wf-fill` writes only under `outputs/` unless
`WORLD_FILLER_EXTRA_OUT_ROOTS` whitelists more.

## 1. Direct

    wf-fill inspect <pack>                     # identity, parity summary
    wf-fill plan <pack> <recipe.json>          # danger bands + budgets (+ render)
    wf-fill place <pack> <recipe.json>         # bosses + dungeon bindings (+ render)
    wf-fill territories <pack> <recipe.json>   # spawn territories (+ render)

Every verb refuses a world that fails walkability parity or a recipe
pinned to a different world.

## 2. Review

    wf-fill validate <pack> <recipe.json> [--strict]   # the nine-gate audit
    wf-fill explain <placements.json> <placement-id>   # why it landed there

Open `viewer/worldfiller-viewer.html` in a browser and drop an exported
pack (step 5) on it — layer toggles, hover/click inspection with each
placement's full score and funnel, the audit at a glance. Read-only by
contract. Renders are inspection evidence; the user's design verdict is
what approves a layout (AGENTS.md).

## 3. Lock what must survive

    wf-fill lock <placements.json> <placement-id>      # prints the recipe entry

Paste the printed entry under the recipe's `locks.placements`. Held
locks reproduce byte-identically on every future run and are immune to
rerolls. Invalid locks (the world changed under them) are diagnosed
per-lock in `lockReport`; they are warnings by default and failures
under `--strict`. To release one:

    wf-fill unlock <recipe.json> <placement-id>        # prints locks minus that id

## 4. Reroll what should change

    wf-fill reroll <recipe.json> <region-id>           # prints the rerolls entry

Paste it under the recipe's `rerolls`. Only that region's draw streams
re-seed (`world/<region>/reroll.<n>/...`): spatially uncoupled regions
stay byte-identical, coupled regions re-solve deterministically, locked
placements do not move (the honest reroll contract, ROADMAP F4).

Repeat 1–4 until the layout earns the design verdict.

## 5. Export and verify

    wf-fill export <pack> <recipe.json> [--strict]     # audited content pack
    wf-fill verify-pack <pack> <content-pack-dir>      # consumption proof

Export refuses any failed gate and any stale base pin, stages the pack
atomically, and writes byte-stable output (docs/CONTENT_PACK_FORMAT.md,
frozen format 1). The Godot lane proof is
`consumers/godot-proof/verify_content_pack.gd`.

## The stale-world workflow (upstream regenerated)

Recipes should pin their world: `base.generationIdentitySha256`. When
WorldForge regenerates the world under a new behavior:

1. `plan`/`place`/`territories`/`export` refuse the old pin outright —
   nothing silently redirects against moved terrain.
2. `wf-fill validate` still runs: gate G7 names the staleness (warning
   by default, failure under `--strict`) so you can see the damage.
3. Re-pin deliberately: put the new world's identity in the recipe,
   re-run the loop. Locks carry survivable intent across the boundary —
   still-valid ones hold, invalidated ones are named in `lockReport`
   (`anchor_missing`, `cell_not_walkable`, ...) for explicit re-siting.

Adopting a new upstream base for the committed fixtures is an explicit,
logged decision (fixtures/README.md).

## Evidence trail (F8 exit criterion)

The full cycle above ran end to end on the canonical 256² world
(2026-07-29): fresh place → `lock` of the world boss → `reroll` of a
dungeon region → re-place with the authored recipe (lock held
byte-stable; the region's dungeons drew from `reroll.1` channels;
everything else untouched) → `export` → `verify-pack` OK — 11
placements, 53 territories, 6489 cells verified against reference
walkability.
