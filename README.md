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
coverage metrics and named failures (`wf-fill territories`). F6 is
implemented and green: the nine-gate audit battery (`wf-fill validate`,
report.json + report.txt — ground truth, exclusion symmetry, budget
accounting, progression, locks, staleness, determinism round-trip, painted
zones), live locks (`wf-fill lock` prints the recipe entry; held locks
survive regeneration byte-identically and are immune to rerolls; invalid
locks get per-lock diagnoses, strict mode makes them failures), and
painted no-content / preferred-content zones honored by the solver and
territory growth. F7 is implemented and green: `wf-fill export` runs the
full pipeline and writes the **frozen content pack format 1**
(docs/CONTENT_PACK_FORMAT.md — manifest with base pairing + recipe
identity + hashed payload; refuses on any failed gate; byte-stable, no
timestamps), with two independent consumption verifiers proving packs
from nothing but the files on disk: `wf-fill verify-pack` (TypeScript)
and `consumers/godot-proof/verify_content_pack.gd` — both ran green
against fen-hollow and the canonical 256² world, the latter inside the
official Godot 4.6.2 headless engine. The F7 freeze review is resolved
and **content pack format 1 is final** (2026-07-28): all 38 review
findings were verified and fixed as 13 defects — both reference
verifiers now implement every importer obligation (files-table
completeness, hashed-byte parsing, report.ok, payload-format pins,
closed-enum refusals, manifest/payload identity + count agreement,
dungeon-anchor and run-bounds checks) and agree refusal-for-refusal,
proven by an adversarial tamper battery in both lanes; exports stage
atomically, refuse stale base pins in every mode, and refuse
incoherent pipeline inputs; recipe lock ids must match the frozen id
scheme; the output guard is an outputs/-only allow-list; and a
committed golden pack pins the frozen serialization byte-for-byte
(director behavior 6 — docs/FREEZE_REVIEW_FINDINGS.md has the full
disposition). Visual-verdict round 1 (2026-07-28) turned the user's render feedback
into recipe capability, all opt-in with defaults preserving prior
behavior (director behavior 7; plan 2, placement 4): quantile danger-band
assignment (`danger.assignment` — each band gets an equal share of
reachable walkable ground, so the deepest band exists in several places,
not one), scale-free settlement/road distance floors for world bosses
and dungeon anchors (permille of the world's own max field distance;
floored anchors are unbound as `below_distance_floor`, boss funnels gain
a `road_distance` stage), and a territory render recolored by danger
band with outlined territories. The fixture recipe opts into all three;
the loop ran four rounds (quantile bands + endgame-pocket islands,
remoteness floors, spaced band-colored territories) and **all F2-F5
visual verdicts are APPROVED (2026-07-29)** — heatmaps, danger layout,
placements with honest exhaustion X's, and territories. F8 is
implemented: `viewer/worldfiller-viewer.html`, a single-file no-build
read-only browser viewer (drop an exported pack on it — layer toggles,
hover/click inspection with each placement's full score and funnel, the
audit at a glance, payload hashes re-verified in the browser; proven
headlessly in Chromium on both fixture exports), the missing iteration
verbs `unlock` and `reroll` (read-only print verbs — recipes are never
edited by the tool), and the workflow doc `docs/WORKFLOW.md` (the
direct → review → lock → reroll → export loop plus the stale-world
workflow), with the full cycle run end to end on the canonical world:
lock held byte-stable through a regional reroll, export verified in the
consumption lane. F9 (2026-07-29): encounter sites place the encounter
budgets the plan has carried since F3 — stumbled-on set pieces that
prefer ground near travel routes, placed after bosses and dungeons so
they route around every claim, lockable, funneled, and accounted by G4.
This ships **pack format 2** (placements format 2 appends the
encounter_site.v1 rule; no field shapes changed); format-1 packs remain
valid, both reference verifiers accept both formats, and a frozen
format-1 fixture pack pins backward compatibility in the suite.
Behaviors 11–12 then evened out the danger bands (mid-band min-share
rebalance; region subdivision at MAX_REGION_CELLS 1024 — analysis 2 —
with boss-budget fallback across eligible regions), and the user
approved the resulting map: **all visual verdict threads are closed
approved at behavior 12, and the first arc (F0–F9) is complete**
(2026-07-29). On 2026-07-30 export became a publishing act (planning
doc 18: publish gate, `manifest.sourceCommit` as pack format 3,
GitHub releases as transport), segmentation became walkability-aware
(sl-0026 — fords, wadeable shallows, and piers form regions; analysis
3), and **behavior-72 walkability was adopted** (sl-0039/sl-0040:
ladder tables @ WorldForge `bbc10cdb`, 17 rungs including moss-on-rock
and the WYSIWYG stamp, fixtures re-pinned, the released canonical
`small-cold-coastal-pack-dusk@b65` and overworld
`wildshot-overworld-pack-dusk@b72` imported parity-green — behavior
14). On 2026-08-01 **behavior-77 prop walkability classes were
adopted** (the sl-0041 || base re-pin ruling: the game plays b77, so
the rehearsal directs over it): the four carpet-debris species walk on
behavior-77+ worlds via an era-keyed blocking set (earlier worlds
reproduce their grids bit-for-bit), dust-hollow + tiny-temperate
re-pinned @ WorldForge `1a20bd2`, fen-hollow deliberately frozen at b72
(its gate went unreachable in the b75 route re-plan — fixtures/README),
and the dusk overworld import moved to `@b77` (derived flood 46493 =
manifest) — behavior 15. Next: direct the dusk overworld (planning
docs/20 step 1 — the game consumes that content pack as reference only,
then the designer's feel verdict); the game-side `worldfiller_importer`
(prepared in docs/IMPORTER_READINESS.md) comes after that verdict.

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
5. [docs/ROADMAP.md](docs/ROADMAP.md) — milestones F0–F9 with exit criteria

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
