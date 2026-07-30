# World Filler Roadmap

Status: **F0–F2 complete and green (2026-07-28)** — clean-room reader,
ladder, flood, and parity suite verified (bit-for-bit reference-grid parity
on the three committed fixtures and, locally, the canonical 256² world at
flood 33893); deterministic kernel landed with committed golden vectors,
hierarchical channels, independence proofs, hygiene bans, and a three-OS CI
workflow (first cross-platform run pending on GitHub). F2 spatial analysis
landed: components, distance fields, clearance, corridors, safe zones,
region segmentation + adjacency, hashed cached summaries, and heatmap
renders (`wf-fill analyze`); structural exit criteria verified, island
behavior proven on a synthetic detached-landmass test. F3 landed: strict
versioned DirectorRecipe with identity hashing, median-path-distance danger
bands + overrides, hostile-walkable-scaled budgets with named waivers,
world-boss allocation, the minimax progression-trap check (proven on a
synthetic override trap), and the danger render (`wf-fill plan`). Verified
on fixtures and the canonical 256² world (3/3 bosses to the largest
eligible high-band regions, zero progression warnings). F4 landed
(placement solver, adversarially reviewed — see the F4 exit-criteria
notes for the honest reroll contract) and F5 landed (spawn territories
with content library, pocket-aware growth, coverage metrics; canonical
world: 51 territories, 9 honestly-fragmented failures). F6 landed: the
nine-gate audit battery with report.json/report.txt, live locks with
per-lock invalidity diagnosis and strict/lenient staleness modes, and
painted zones — every gate has an adversarial tripping test, lock
regeneration is byte-stable, and both proof worlds pass the full audit.
F7 landed: content pack format 1 frozen (docs/CONTENT_PACK_FORMAT.md),
gate-refusing byte-stable export, and the consumption proof in both
lanes — the TypeScript verifier and a headless Godot 4.6.2 run of
consumers/godot-proof/verify_content_pack.gd, green on fen-hollow and
the canonical world. The F7 freeze review is resolved (2026-07-28): all
38 salvaged findings verified and fixed as 13 defects — both reference
verifiers now implement every importer obligation and agree
refusal-for-refusal, the format doc passed the importer-buildability
lens (shapes, closed/open enums, id opacity, reader rules), exports
stage atomically and refuse stale pins and incoherent inputs, a golden
content pack pins the frozen serialization, and the Godot battery
re-ran green (behavior 6; docs/FREEZE_REVIEW_FINDINGS.md carries the
disposition). **Content pack format 1 is final.** **All F2–F5 visual
verdicts APPROVED (2026-07-29)** after a four-round user review loop
(behavior 9: quantile bands, endgame-pocket islands, remoteness floors,
spaced band-colored territories). F8 landed (2026-07-29): the
single-file read-only viewer (viewer/worldfiller-viewer.html — layers,
hover explanations, in-browser hash verification; headless Chromium
proof on both fixtures), the `unlock`/`reroll` print verbs, the
workflow doc (docs/WORKFLOW.md), and the full
direct→review→lock→reroll→export cycle run end to end on the canonical
world. The viewer verdict is
**APPROVED (2026-07-29)** — F8 complete (plus post-approval authoring
aids: copy lock/reroll entries, shift+drag paint rects). F9 landed
(2026-07-29): encounter sites — the encounter budgets the plan has
carried since F3 now place (rule `encounter_site.v1`, **pack format 2**;
format 1 remains valid and both reference verifiers accept both formats,
with a frozen format-1 fixture pack pinning backward compatibility).
Encounters are set pieces that PREFER ground near travel routes, placed
last so they route around every earlier claim, lockable like any
placement, with the usual funnels and named failures; G4 accounts for
their budgets. Behavior 10; plan 4, placement 5, validate 3. Behaviors
11–12 (2026-07-29) closed the last verdict thread ("very little yellow
danger"): a min-share rebalance for mid bands, then region subdivision
(MAX_REGION_CELLS 1024, analysis 2) with boss-budget fallback across
eligible regions — canonical wilderness bands came out essentially even
(5148/5519/5714/4775 walkable cells) and the user approved the map.
**All visual verdict threads are CLOSED APPROVED at behavior 12, and
the first arc (F0–F9) is COMPLETE.** 2026-07-30 post-arc work (HANDOFF
§1f–§1h): publish gate + releases-as-transport (pack format 3),
walkability-aware segmentation (sl-0026, analysis 3), and the ratified
behavior-72 walkability adoption (ladder @ `bbc10cdb`, fixtures
re-pinned, released b65 canonical + b72 dusk overworld imported
parity-green — behavior 14). Next per planning docs/20: direct the
dusk overworld (step 1, reference-only consumption + the designer's
feel verdict); the game-side `worldfiller_importer` — prepared in
docs/IMPORTER_READINESS.md (2026-07-29), no game-repo changes made —
follows that verdict at its own planning session.

Milestones are gated: a milestone does not expand until its exit criteria
pass, and every milestone leaves inspectable evidence (tests, reports,
renders). The style deliberately mirrors the upstream roadmap that carried
WorldForge from empty repository to playable consumer proof.

Fixture strategy used throughout: at F0 a small fixture world pack (tiny 64²
for fast tests, plus one small 256² "canonical" world) is generated **once**
from the local WorldForge checkout into this repository's fixtures, with
upstream provenance recorded (generator behavior version, recipe identity,
`generationIdentitySha256`, pack hashes). From then on, clean clones build
and test against committed fixtures with no WorldForge checkout present —
the same pattern WorldForge uses for its committed TileForge package.

## Milestone F0 — Repository, contracts, and the reading proof

The milestone that makes everything else safe: prove we can read a world
correctly before planning anything on top of it.

Deliverables:

- TypeScript project skeleton on the pinned toolchain (Node >= 24, zero
  runtime dependencies, `tsc`, `node --test`), CLI entry point (`wf-fill`),
  source/test/fixture/schema/output directory layout, output-path guard
  (refuse writes outside repo-owned roots, refuse any path into a WorldForge
  or game checkout);
- committed fixture packs (tiny + small) with provenance sidecars, chosen so
  every walkability-ladder rung appears in at least one fixture;
- clean-room pack reader (no WorldForge code anywhere in this repository):
  manifest hash verification, format-version gates, `baseArtifactSha256`
  cross-check, validation-report status check, chunk decoding into flat
  typed arrays;
- clean-room walkability ladder + flood implementation to the exact
  documented spec (nudge scan radius 0..7 dy-outer/dx-inner, 4-connected
  N/E/S/W BFS), with ladder data tables carrying upstream-provenance notes;
- bitgrid parity suite: our derived walkability grid compared bit-for-bit
  against each fixture pack's reference `walkability.json` grid, plus
  `floodCount`/`spawnCell` equality and per-rung fixture-coverage
  reporting;
- `wf-fill inspect <pack>` printing identity, dimensions, vocabularies,
  record counts, and the recomputed flood.

Exit criteria:

- clean clone builds and tests offline, no WorldForge checkout present and
  no WorldForge source anywhere in the tree;
- derived walkability grids match every fixture pack's reference grid
  bit-for-bit, and recomputed floods equal each pack's `floodCount` and
  `spawnCell` (cell-exact parity with the upstream consumers, proven — any
  mismatch reports the exact cells);
- every ladder rung is exercised by at least one fixture, or the gap is
  reported honestly;
- corrupted manifest, wrong `formatVersion`, failing validation report, and
  tampered payload each produce a named refusal;
- no write path can resolve into an upstream repository.

## Milestone F1 — Deterministic kernel

Deliverables:

- uint32 mixing/combining primitives with documented wrapping (murmur3-
  fmix32-style finalizer, FNV-style combine), `hashCells`-shaped helpers;
- named hierarchical seed channels (`world/<region>/<system>/<slot>`) and
  channel-derivation rules;
- deterministic weighted selection and shuffling utilities;
- canonical JSON writer (sorted keys, 2-space indent, LF, trailing newline,
  UTF-8, safe integers only) + sha256 identity helpers;
- golden vectors for all of the above, committed and CI-enforced
  cross-platform.

Exit criteria:

- repeated runs byte-identical; golden vectors reproduce on every CI
  platform;
- adding a new channel does not perturb existing channels' streams;
- floats, `Math.random`, and unordered-iteration effects are structurally
  absent (lint/test enforced).

## Milestone F2 — Spatial analysis

Deliverables:

- connected walkable components (multi-component aware);
- BFS path-distance fields: from spawn, settlements, roads/trails, water;
- clearance field (largest free square per cell);
- biome region segmentation with stable content-derived ids, region
  adjacency graph, dead-end and chokepoint scoring;
- safe-zone mask (settlement radius + approaches);
- analysis cache keyed by base identity + analysis version;
- heatmap PNG renders over the pack minimap for every field;
- `wf-fill analyze <pack>` producing the analysis bundle + renders.

Exit criteria:

- analysis is deterministic (hash-stable) and cache round-trips losslessly;
- renders visually sane on both fixtures (verdict loop with the user);
- component analysis proves correct on an island-world fixture (detached
  landmass reported as separate component, not an error);
- spot asserts hold (e.g. spawn cell distance 0 from spawn; road cells
  distance 0 from roads; known clearing has expected clearance).

## Milestone F3 — DirectorRecipe and the regional content plan

Deliverables:

- versioned DirectorRecipe schema + validation + normalization + identity
  hash (seed, danger model, budgets, content definitions/library reference,
  rule bindings; pins/locks vocabulary present but inert until F6);
- danger model: per-region bands from path-distance curve + recipe
  overrides;
- regional plan compiler: per-region budgets (bosses, dungeon bindings,
  territories, encounter sites) scaled by area/class, with named waivers
  where a budget cannot apply;
- readable `content-plan.json` + a danger/plan render;
- `wf-fill plan <pack> <recipe>`.

Exit criteria:

- same pack + same recipe → byte-identical plan; unknown recipe vocabulary
  rejected with named errors;
- danger bands monotone-sane along the route graph from spawn on fixtures;
- plan document readable enough to review region briefs without a viewer
  (user verdict).

## Milestone F4 — Placement solver: bosses and dungeon bindings

Deliverables:

- candidate enumeration + hard filters + integer soft scoring + seeded
  selection + reservations (arena/exclusion) + explanations;
- world-boss placement rule v1 (clearance, distances, danger band;
  seclusion is expressed through the road-far and settlement-far terms —
  cell-level dead-end preference is deferred to placement-rule tuning,
  since region-level dead-end scoring already steers the plan);
- dungeon-binding rule v1 over existing structure-bearing anchor POIs
  (caves, crypts, mines, ruins, dens; portal structures arrive via
  landmarks and join through a future landmark-binding rule), including
  reachability verification and unbound-anchor reporting;
- named, located, rendered failures on exhaustion;
- `wf-fill place <pack> <recipe>` producing `placements.json` + placement
  render.

Exit criteria:

- all fixture budgets place or explain; zero placements on unwalkable or
  spawn-unreachable cells (when required); reservations never overlap safe
  zones or each other;
- determinism: identical inputs → identical placements; rerolling a region
  re-seeds only that region's channel subtree, and spatially UNCOUPLED
  regions stay byte-identical (channel-scoping proof test on a two-region
  world). Regions coupled through explicit cross-region constraints
  (exclusion buffers crossing a border, world-boss peer distance) re-solve
  deterministically — hard pinning of individual placements is the F6 lock
  feature. This honest contract was adopted after the F4 adversarial
  review proved strict placement-level isolation impossible with shared
  spatial constraints;
- every placement carries a human-readable explanation retrievable via
  `wf-fill explain <placement-id>`.

## Milestone F5 — Spawn territories

Deliverables:

- territory growth over walkable wilderness (excluding safe zones,
  reservations, and other territories), rect-run encoded cell sets;
- roster assignment from biome × danger tables in the recipe's content
  library; budget parameters (pack size, maxActive, respawn pressure, elite
  permille, night modifiers) passed through, schema-validated;
- coverage metrics (wilderness covered / deliberately empty) in the plan
  report;
- territory render layer.

Exit criteria:

- territories never overlap each other, safe zones, or arena reservations;
  every territory cell is walkable and in the intended component;
- coverage meets recipe targets or reports waivers; deterministic and
  channel-scoped like F4;
- roster references all resolve within the recipe's content library.

## Milestone F6 — Validation gates, audit report, and developer control

Deliverables:

- full gate suite as a single `wf-fill validate` phase: reachability,
  overlap, coverage, danger-progression sanity, id resolution, lock
  validity, pack round-trip;
- `report.json` + human-readable report render (the "world gameplay audit");
- pins and locks live: lock placements/regions, reroll region subtrees,
  painted no-content / preferred-content zone overrides honored by the
  solver;
- staleness handling: warn/strict modes when base identity differs from the
  recipe's pin; per-lock invalidity diagnosis.

Exit criteria:

- a seeded suite of deliberately bad configurations trips every gate with a
  named, located error;
- lock → regenerate → locked placements byte-identical, unlocked ones
  re-solved; reroll scoping proven at region granularity;
- directing a fixture against a mutated base produces the staleness report
  naming each invalidated lock.

## Milestone F7 — Content pack export and consumption proof

Deliverables:

- canonical exporter: manifest with base identity + recipe hash + rule-pack
  versions + file hashes; byte-stable, no timestamps; refuses on any failed
  gate;
- `wf-fill export <pack> <recipe> --out <dir>` (the one-command pipeline);
- consumption proof harness: a tiny standalone reader (TypeScript, and a
  minimal headless Godot script in this repository's own scratch scene — not
  the game repo) that loads world pack + content pack, cross-checks base
  identity, and walks every placement cell verifying walkability agreement;
- pack-format documentation frozen at v1.

Exit criteria:

- export twice → byte-identical; tampering any payload fails the reader;
  mismatched world/content base identities refuse at load;
- the consumption harness reports every placement reachable and every
  territory cell walkable, agreeing with `wf-fill validate`;
- pack format v1 documented well enough that the future game-side importer
  can be written from the doc alone.

Freeze review resolution (2026-07-28): the post-freeze adversarial
review's 38 findings were verified and fixed (13 distinct defects — see
docs/FREEZE_REVIEW_FINDINGS.md for the full disposition). The exit
criteria above are now enforced by construction: both reference
verifiers implement all six importer obligations identically (files
completeness, hashed-byte parsing, report.ok, payload-format pins,
closed-enum refusals, manifest/payload agreement), a committed golden
pack (fixtures/golden/content-pack-fen-hollow) pins the frozen
serialization byte-for-byte, export stages atomically and refuses stale
pins in every mode, and the format doc carries every payload shape.
Format 1 is final.

## Milestone F8 — Director UX loop

Deliverables:

- single-file, no-build, read-only browser viewer: minimap backdrop, layer
  toggles (analysis heatmaps, danger, plan, placements, territories), hover
  inspection showing each placement's explanation;
- iteration verbs polished: `inspect`, `analyze`, `plan`, `place`,
  `validate`, `export`, `explain`, `reroll --region`, `lock`/`unlock`;
- workflow documentation: the direct → review → lock → reroll → export loop,
  including the upstream-regenerated-world (staleness) workflow.

Exit criteria:

- a full direct-review-lock-reroll-export cycle on the canonical fixture
  runs end to end through documented commands;
- the viewer opens both fixtures' outputs with no build step and stays
  read-only by contract;
- the user has run the loop and issued a design verdict on the result.

## Milestone F9 — Encounter sites

Deliverables (landed 2026-07-29, behavior 10):

- placement rule `encounter_site.v1`: single-cell set pieces placed after
  bosses, dungeons, and territories, preferring ground near travel routes
  (`road_near` + clearance scoring), with per-region caps, exclusion
  radii honored symmetrically by later passes, locks (id tag
  `encounter`), funnels, and named failures;
- recipe section `encounterRule` {exclusionRadius, roadNearPermille,
  clearancePermille}; budgets had been carried by the plan since F3;
- **content pack format 2** = format 1 + placementsFormat 2 appending the
  encounter rule value; format 1 stays valid and final, both reference
  verifiers accept formats {1, 2} via PACK_FORMAT_PROFILE and refuse
  encounter rules inside format-1 packs.

Exit evidence: amber markers in the placements/territories renders and
the viewer; `fixtures/golden/content-pack-fen-hollow/` re-recorded at
format 2 plus `content-pack-fen-hollow-format1/` (frozen behavior-9
pack) pinning backward compatibility in the suite and in the headless
Godot battery; G4 accounts encounter budgets; all four worlds 9/9 gates.

## Deferred beyond the first arc (F0–F9)

- minibosses, elites, and patrol routes;
- faction territories and territory conflict;
- treasure/resource nodes and rare (one-off) encounters beyond the
  F9 encounter sites;
- quest hooks and progression dependencies (keys, gates, unlocks);
- multi-world campaigns; content migration between artifact format versions;
- interior/dungeon-layout generation (World Filler binds entrances; interiors
  are a separate concern, likely game-side or a future tool);
- the game-repo `worldfiller_importer` addon (needs the game code repo
  separately scoped writable — a user decision; preparation complete, see
  docs/IMPORTER_READINESS.md);
- any AI-assisted recipe authoring (same posture as upstream W9: optional
  client, never in the deterministic path);
- editors that write world or content data by hand.

## Standing risks to watch

1. Walkability drift: any upstream behavior bump can move cells or append
   blocking types — the F0 bit-for-bit parity suite against fixture
   reference grids is the tripwire; updating the clean-room ladder tables
   (and regenerating fixtures) is an explicit, logged decision with
   recorded upstream provenance.
2. Scope gravity toward quests/factions/economy before F4–F5 are approved.
3. Territory/danger tuning is taste: keep the verdict loop human, exactly as
   upstream treats visual baselines.
4. Multi-component worlds: never assume the spawn flood covers the map.
5. Walkable cliffs are coming (TileForge already has walkable high-cliff
   tiles): region segmentation voids terrain.rock by material and must
   become walkability-aware when cliff-walkable worlds are adopted
   (recorded 2026-07-29; see HANDOFF §1e).
