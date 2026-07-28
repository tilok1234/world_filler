# World Filler Agent Rules

Status: **Normative repository instructions**

These instructions govern AI-assisted work in this repository. They follow the
same doctrine as WorldForge's `AGENTS.md`; where the two repositories interact,
the stricter rule wins.

## What this repository is

World Filler is the **world director**: a deterministic content compiler that
reads a finished WorldForge world artifact and plans the gameplay content layer
— bosses, dungeon entrances, enemy spawn territories, encounter sites,
progression bands — as a separate versioned content pack that the game composes
with the terrain at load time.

World Filler is a **consumer** of WorldForge. It is not a terrain generator,
not a WorldForge fork, and not a game runtime.

## Required opening sequence

Before changing World Filler, an AI agent must:

1. Confirm the exact World Filler repository path.
2. Read this file and the documents listed in `README.md`.
3. Inspect Git status and recent history; identify user-owned or other-agent
   dirty work.
4. State the files and systems within the current task.
5. Confirm that no planned write resolves into the WorldForge repository, a
   TileForge checkout, or the game repository.

## Isolation contract

World Filler is a separate, isolated project. It lives in its own repository
and folder, permanently distinct from the WorldForge checkout.

- **The only coupling to WorldForge is the versioned world-artifact file
  format.** World Filler reads a world directory it is pointed at, exactly as
  the Godot and TypeScript consumers do. It is a third consumer lane.
- No source imports from WorldForge paths — no relative imports into another
  checkout, no `npm link`, no shared build outputs, no copying private
  generator modules.
- World Filler must build, test, and run on a clean clone **without a
  WorldForge checkout present**, using small committed fixture artifacts whose
  WorldForge generator version, recipe identity, and artifact hash are
  recorded as provenance (the same pattern WorldForge uses for its committed
  TileForge package fixtures).
- A locally available WorldForge checkout is a convenience for generating
  fresh reference worlds into World-Filler-owned output directories — never a
  build or runtime dependency.

## Absolute upstream rules

- **WorldForge is read-only upstream.** Browse, inspect, and run its CLI to
  produce reference artifacts into World-Filler-owned output directories; never
  edit its source, write into its checkout, commit, or push it. If a task seems
  to require a WorldForge change (for example a missing semantic layer), stop,
  record the gap in World Filler's docs, describe the smallest upstream
  request, and hand it to the user as a separate WorldForge task.
- **TileForge is doubly upstream** and inherits every WorldForge restriction.
  World Filler should not need TileForge at all: it consumes WorldForge
  semantic data, not tile art.
- **The game repository is out of scope** unless the user separately scopes it
  writable for a specific task. World Filler ships content packs; the game
  imports them.

## Source-of-truth discipline

- The WorldForge **world artifact** (plus its recorded hashes and versions) is
  the source of truth for geography. World Filler must never mutate it,
  "repair" it, or maintain a second copy of terrain truth.
- The **DirectorRecipe** (authored input: seed, budgets, content definitions,
  placement rules, pins and locks) is the source of truth for content intent.
  Prose chat history is provenance, not contract.
- The **content pack** is derived output: reproducible from artifact +
  normalized recipe + compiler version. It is never hand-edited to conceal a
  solver or validator failure; authored corrections go through recipe pins and
  locks.
- Walkability and traversal semantics come from the WorldForge public loader
  contract. World Filler must not invent its own interpretation of which cells
  block movement; parity with the upstream flood check is a standing test.
- When docs and code disagree, report the discrepancy; do not silently choose
  the more convenient behavior.

## Deterministic implementation rules

Same doctrine as WorldForge, restated as binding here:

- Explicitly sized integer hash operations; no `Math.random()`; no
  process-global random state; no platform transcendental functions as hidden
  random sources.
- Every placement system draws from a **named channel** under a hierarchical
  seed path (`world → region → system → slot`), so rerolling one region's
  dungeons cannot reshuffle another region's bosses.
- Never let iteration order of unordered collections affect output.
- Canonical serialization: defined key order, number encoding, newline
  behavior, UTF-8.
- The content pack records: World Filler version, rule-pack versions,
  normalized recipe hash, and the **base artifact hash** it was generated
  against. A pack that does not identify its base artifact is invalid.
- Identical inputs must reproduce byte-identical packs; determinism is tested,
  not assumed.
- Bounded solver retries with deterministic, explained failure — never an
  unbounded search for a perfect layout.

## Append-only vocabularies

Content type IDs, placement-rule IDs, channel names, and pack-format enums are
append-only once a pack version has shipped. Renaming or deleting a shipped ID
requires an explicit migration decision by the user.

## Safe write rules

- Resolve and verify every output root; refuse paths outside World-Filler-owned
  directories.
- Generated packs and reports go under ignored output directories, never into
  fixtures, until explicitly promoted.
- Never overwrite the only copy of a user-authored recipe, pin set, or approved
  pack baseline.

## Evidence requirements

Do not claim a pass from code inspection alone when a test can be run.
Completion evidence includes: changed files, deterministic test results, the
validation report of a generated pack, artifact/pack paths, and remaining
warnings. Do not call a content layout "approved" without the user's verdict —
structural success and design approval are separate, exactly as in WorldForge.

## Decisions requiring user authority

- creating or changing repositories, visibility, or releases;
- changing pack-format compatibility;
- replacing an approved content-layout baseline;
- re-running generation over a world whose saves already exist;
- expanding scope into quest logic, dialogue, economy simulation, or runtime
  systems;
- any WorldForge or game-repository change.

## Definition of done

A World Filler task is done only when the behavior exists, deterministic and
structural tests pass, outputs stay inside World-Filler-owned paths, upstream
repositories are untouched, docs and schemas match the implementation, any
visual/layout candidate is honestly marked approved or pending, and remaining
risks are stated.
