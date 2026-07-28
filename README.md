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

**Planning.** This repository currently contains the researched assessment,
architecture and contracts, and the milestone roadmap. Implementation begins
at milestone F0.

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
