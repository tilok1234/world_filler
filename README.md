# World Filler

World Filler is the **world director**: a deterministic content compiler that
turns a finished WorldForge world into a deliberately structured game world.

WorldForge decides geography — terrain, water, routes, settlements, landmarks,
decoration. World Filler decides gameplay structure on top of that geography:
where bosses live, which anchors become dungeon entrances, which wilderness
belongs to which enemies, how danger progresses across the map, and how dense
or empty each region should feel. The game composes both at load time.

```text
WorldRecipe
    -> WorldForge (deterministic terrain generation)
    -> versioned world artifact / game pack
    -> World Filler (deterministic content direction)   <- DirectorRecipe
    -> versioned content pack
    -> Godot game (composes terrain + content, owns runtime spawning)
```

World Filler is a **separate, isolated project**. It lives in its own
repository, couples to WorldForge only through the versioned artifact file
format, and behaves as a third consumer lane beside the Godot and TypeScript
consumers. It never modifies WorldForge, TileForge, or the game repository.

## Why this tool exists

WorldForge's own doctrine assigns quests, enemies, progression, and content to
"the consuming game or its explicitly versioned content pack" and forbids
expanding the generator into content systems. Its vision doc lists the "exact
extension interface for game-specific content" as an open decision. World
Filler is that content pack compiler: the tool the upstream documents
anticipate but deliberately do not contain.

The honest assessment, grounded in what WorldForge actually emits today, is in
[docs/ASSESSMENT.md](docs/ASSESSMENT.md). Short version: the world artifact
already carries everything a director needs to make intelligent decisions
(semantic materials, settlements with footprints, landmarks, ~28 kinds of
story POIs, routes, hydrology, a canonical walkability contract) and nothing
that decides gameplay — the seam is clean, documented, and waiting.

## Core behavior

World Filler mirrors the WorldForge compiler doctrine:

- **Constraints, not scatter.** Every content type declares hard requirements
  and soft preferences; the solver filters, scores, then selects with seeded
  randomness. No location without a reason.
- **Plan before coordinates.** Regions receive an abstract content budget
  (bosses, dungeons, territories, danger band) before any cell is chosen.
- **Deterministic by contract.** Same world + same DirectorRecipe + same
  compiler version = byte-identical content pack. Hierarchical seed channels
  mean rerolling one region's dungeons cannot move another region's bosses.
- **Never edits the world.** World Filler assigns meaning to existing
  geography; it does not change terrain or walkability. New physical
  structures are upstream WorldRecipe requests, never director output.
- **Validate, then ship.** A content pack exports only after reachability,
  spacing, overlap, coverage, and progression gates pass, with a
  human-readable audit report and named errors on failure.
- **The developer stays in charge.** Pins, locks, per-region rerolls, and
  placement explanations are part of the contract, not an afterthought.

## Repository status

**F0 + F1 complete (2026-07-28).** The clean-room pack reader, walkability
ladder, flood, and parity suite are green: derived walkability grids are
bit-identical to the reference grids of all committed fixture packs (spawn
and flood counts equal), canonical-JSON serialization round-trips upstream
bytes exactly, and every refusal gate has a named test. Verified at full
scale against the canonical 256² world (65,536 cells bit-identical, flood
33893, all 15 ladder rungs exercised). The deterministic kernel is in:
uint32 hash primitives and hierarchical seed channels with committed golden
vectors (`fixtures/golden/kernel.json`, re-recorded only via
`node dist/tools/updateGolden.js` as an explicit decision), stateless
indexed draws, weighted selection, shuffling, channel-independence tests,
a hygiene test banning hidden nondeterminism from the source tree, and a
three-OS CI workflow. F2 spatial analysis is implemented and green:
walkable components (multi-component aware), path-distance fields (spawn /
settlements / roads / water), clearance, corridor chokepoints, safe zones,
biome region segmentation with adjacency and dead-end scoring, a canonical
hashed analysis summary with a drift-detecting cache, and eleven heatmap
renders per world via a zero-dependency PNG encoder (`wf-fill analyze`).
F3 is implemented and green: the versioned DirectorRecipe (strict
vocabulary, defaults, normalization, identity hash), danger bands from
per-region median path-distance with overrides, region classes and budgets
(territories/encounters count hostile-walkable ground only; dungeon-anchor
candidates counted from the world's own POIs; world bosses allocated to the
largest eligible high-band regions), named waivers everywhere something is
impossible, a minimax progression-trap check over the region graph, and the
danger-band render (`wf-fill plan <pack> <recipe>`). F4 is implemented,
adversarially reviewed, and green: the placement solver (world bosses on
clearance-proven arena squares, dungeon bindings on the world's own anchor
POIs) with hierarchical reroll channels, symmetric physical/buffer
reservation semantics, named located failures with candidate funnels, full
unbound-anchor accounting, `wf-fill place` + `wf-fill explain`, and a
placement render with failure markers. A six-lens ultracode review (22
agents) confirmed and forced fixes for three critical defects — even-side
arena misalignment, one-directional exclusion checks, and an overstated
reroll-isolation claim, now an honest documented contract (uncoupled
regions byte-identical; coupled regions re-solve deterministically; hard
pinning arrives with F6 locks). F5 is implemented and green: the recipe
gains a content library (enemy definitions with biome/band ranges,
weights, night flags — placeholder defaults, game-supplied in production)
and a territory rule; territories grow as run-encoded, non-overlapping
cell sets over hostile walkable ground (never safe zones or F4 claims),
seeded from viable pockets only, rostered by biome × danger band, with
coverage metrics and named failures (`wf-fill territories`). Render
**visual verdicts pending user review** (F2 heatmaps, F3 danger bands,
F4 placements, F5 territories). Next: F6 (validation gates, audit report,
locks and rerolls).

```sh
# Node >= 24.15 required (matches the upstream toolchain pin)
npm install
npm test                                   # build + full suite
node dist/src/cli.js inspect fixtures/packs/fen-hollow
node dist/src/cli.js parity fixtures/packs/fen-hollow
```

## Required reading

1. [AGENTS.md](AGENTS.md) — normative rules for AI-assisted work here
2. [docs/ASSESSMENT.md](docs/ASSESSMENT.md) — researched assessment and verdict
3. [docs/VISION_AND_SCOPE.md](docs/VISION_AND_SCOPE.md) — identity, pillars, non-goals
4. [docs/ARCHITECTURE_AND_CONTRACTS.md](docs/ARCHITECTURE_AND_CONTRACTS.md) — components, input/output contracts, determinism
5. [docs/ROADMAP.md](docs/ROADMAP.md) — milestones F0–F8 with exit criteria

## System ownership

| System | Responsibility |
|---|---|
| User | Creative intent, constraints, review, approval |
| WorldForge | Geography: terrain, water, routes, settlements, landmarks, decoration |
| World artifact / game pack | The read-only geographic source of truth |
| DirectorRecipe | Accepted content intent, including the director seed |
| World Filler | Analysis, content planning, constrained placement, validation, content pack export |
| Content pack | Versioned, derived gameplay structure bound to one base artifact |
| Godot game | Importing both packs, runtime spawning, combat, AI, persistence deltas |
