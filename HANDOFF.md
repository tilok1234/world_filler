# World Filler — handoff (2026-07-28, F0–F7 + freeze review resolved + verdict round 1)

HANDOFF.md is the tiebreaker over any machine-local assistant memory.
Read `AGENTS.md` and the `README.md` reading list before changing anything.

## 0. State right now

**F0–F7 complete and the F7 freeze review fully resolved, committed, and
pushed** to `tilok1234/world_filler`, branch
`claude/world-filler-repo-focus-9fmr60`. **131 tests green** (`npm test`).
WorldForge checkout untouched throughout — verified clean after every
milestone; it is READ-ONLY upstream, forever (AGENTS.md isolation
contract; the user has re-confirmed this twice).

**Content pack format 1 is FINAL.** The interrupted freeze review's 38
salvaged findings were all verified (solo adversarial read + empirical
tamper probes), deduplicated to 13 defects, and fixed; the missing fifth
lens (importer-buildability) ran and its gaps were folded into
`docs/CONTENT_PACK_FORMAT.md`. Full disposition:
`docs/FREEZE_REVIEW_FINDINGS.md` (Resolution section). Highlights:

- Both reference verifiers (TS `verify-pack` + the GDScript proof) now
  implement all six importer obligations and agree refusal-for-refusal;
  proven by tamper batteries in both lanes (the Godot battery ran in
  headless 4.6.2: eight malformed/mismatched packs exit 1 by name,
  positives green on fen-hollow AND dust-hollow with identical counts).
- Export refuses stale base pins in EVERY mode (validate still runs —
  G7 is the diagnosis), refuses incoherent pipeline inputs
  (buildContentPack cross-checks identity across all four payloads), and
  writes via temp-dir staging + rename (manifest last, no partial packs).
- Recipe lock ids must match the frozen id scheme and agree with the
  lock's rule/regionId; fresh boss slots skip held ids.
- decodeRuns refuses malformed/row-crossing runs by name (both lanes,
  G3/G9, and the doc's normative reader rule).
- Output guard is now an outputs/-only allow-list inside the repo
  (consumers/, dist/, node_modules/ no longer writable); unknown CLI
  flags are refused instead of becoming out-dirs.
- `fixtures/golden/content-pack-fen-hollow/` pins the frozen
  serialization byte-for-byte (re-record ONLY via
  `node dist/tools/updateGolden.js`; kernel.json re-recorded
  byte-identical this session — verified no drift).
- Versions after the freeze resolution: behavior 6; the round-1
  verdict changes then bumped to behavior 7, plan 2, placement 4
  (section 1). All formats still 1. Coverage now has a row for every plan region (world totals).

Pipeline (all deterministic, explained, rendered):
`inspect | parity | analyze | plan | place | explain | territories |
validate | lock | export | verify-pack` (see `node dist/src/cli.js help`).

## 1. Visual verdict loop — round 1 done, round 2 pending

Round-1 verdicts (user, this session, on the canonical 256² world at ×3
and the three fixtures at ×8; gallery artifact
`claude.ai/code/artifact/246ef66f-08c0-4403-8b24-777d7b5d22d4`):

1. Danger bands: "could maybe try more than 1 purple place" →
   implemented `danger.assignment: "quantile"` (opt-in recipe knob;
   default "linear" unchanged): bands get equal shares of reachable
   walkable ground, monotone in median spawn distance. Canonical world
   now shows band 4 in three distinct areas.
2. Placements "feel too close to roads and everything" → implemented
   scale-free permille distance floors (opt-in, default 0 = off):
   `worldBossRule.minSettlementDistancePermille` / `minRoadDistancePermille`
   (hard floors as permille of the world's max field distance; boss
   funnel gains open-vocab stage `road_distance`) and
   `dungeonRule.minSettlementDistancePermille` (culled anchors unbound
   with new open-vocab reason `below_distance_floor`). Tuned in
   fixtures/recipes/basic-direction.json to s320/r300/d250 — the
   strongest values at which every fixture world keeps its boss
   (dust-hollow's boss dies at road ≥ ~320). Canonical: 12 dungeons,
   3 honest failure X's (settlement clusters with no remote anchors).
3. Territories render was unreadable to the user → territoryRender now
   fills territories with their danger-band color (same palette as the
   danger map) with darkened edge outlines; signature gained bandCount.
4. "Correct pic for heatmap?" → the four chat images had no heatmap
   (terrain base was the 4th); heatmaps live in the artifact's analysis
   section — clarified, verified correct.

Versions: behavior **7**, plan 2, placement 4 (see version.ts comment).
Golden content pack re-recorded for the retuned recipe (kernel golden
byte-identical). The canonical 256² world regenerates ONLY from
WorldForge pinned commit `bb7832f` (behavior 47) — the checkout's HEAD
has moved to behaviors 49-50 and produces a DIFFERENT world that fails
parity; use `git -C <WorldForge> archive bb7832f | tar -x -C <scratch>`
and build there. Adopting the newer upstream base remains an explicit
user decision (not taken).

**Round 2 pending: user must judge the V2 renders** (quantile bands,
floored placements, band-colored territories). Territory coverage knob
(`targetHostileCoveragePermille`, currently default 350 → ~27% actual)
awaits a density verdict too.

## 2. Then: F8 — Director UX loop (docs/ROADMAP.md § F8)

Single-file, no-build, read-only browser viewer (minimap backdrop, layer
toggles for analysis/danger/plan/placements/territories, hover
explanations), iteration-verb polish, workflow docs. Then the first-arc
close-out per ROADMAP (deferred list stays deferred).

## 3. Milestone map (docs/ROADMAP.md carries detail + exit criteria)

- F0 clean-room reader + walkability ladder + flood; bit-for-bit parity
  vs reference grids (fixtures committed; canonical world flood 33893).
- F1 kernel: uint32 mixers, hierarchical channels
  (`world/<regionId>/reroll.<n>/<system>/<slot>`), golden vectors
  (`fixtures/golden/kernel.json`), hygiene bans, 3-OS CI.
- F2 analysis: components, BFS distance fields, clearance, corridors,
  safe zones, region segmentation + adjacency, hashed cached summaries,
  11 heatmap renders (`analyze`).
- F3 DirectorRecipe (strict vocabulary, defaults, identity hash), danger
  bands, budgets, named waivers, minimax progression-trap check (`plan`).
- F4 placement solver (22-agent review survived; honest reroll contract
  in ROADMAP F4 exit criteria), symmetric reservations, funnels
  (`place`/`explain`).
- F5 territories: content library (placeholder enemies — game supplies
  real ones), pocket-aware growth, rosters, coverage (`territories`).
- F6 nine-gate audit (`validate`), locks (`lock`; held locks byte-stable
  + reroll-immune; per-lock diagnosis; `--strict`), painted zones.
- F7 export + frozen format doc + dual verifiers + **resolved freeze
  review** (format 1 final).

## 4. Toolchain and environment gotchas

- Node **>= 24.15 required**. Container default node is 22 — use
  `/opt/nvm/versions/node/v24.18.0/bin` in PATH, or
  `source /opt/nvm/nvm.sh && nvm install 24`.
- `npm install && npm test` from a clean clone works offline with no
  WorldForge checkout present — a tested isolation invariant.
- CLI writes only under `outputs/` unless
  `WORLD_FILLER_EXTRA_OUT_ROOTS=<dir>` whitelists more (allow-list
  guard; scratch dirs need it).
- **Never build inside the WorldForge checkout.** To regenerate worlds:
  copy WorldForge (minus .git) to scratch, `npm install && npm run build`
  there, then `node dist/src/cli.js export-game-pack
  fixtures/recipes/<name>.json --out <scratch>` and copy the pack over.
  Committed fixtures: fen-hollow, dust-hollow, tiny-temperate (64²,
  WorldForge commit `bb7832f`, behavior 47 — provenance sidecars in
  fixtures/provenance/). The canonical 256² `small-cold-coastal` pack is
  NOT committed (31 MB): regenerate per `fixtures/README.md` into
  `outputs/local-packs/` (parity tests auto-pick it up).
- Official Godot 4.6.2 Linux zip downloads and runs headless in this
  container (godotengine GitHub releases) — used for the GDScript
  consumption proof and the freeze-review refusal battery.
- Upstream behavior bumps move walkable cells (flood history
  33845→33893). The parity suite + pinned
  `fixtures/expected-coverage.json` are the tripwires; adopting a new
  upstream base = regenerate fixtures + re-record coverage + note it in
  the commit, an explicit logged decision.

## 5. Standing user preferences (confirmed in-session)

- world_filler is a separate isolated repo; WorldForge is read-only
  reference. Never mix. (Re-confirmed this session: "we are only gonna
  work in the repo world_filler, the two others are only for
  reference".)
- Standing permission to commit and push to world_filler (this branch).
- Ultracode swarms: user opts in per-turn, wants them for hard
  review/audit milestones, **max 8 agents concurrent**. (The freeze
  review resolution ran solo — no opt-in was given this session.)
- Verdict loop: send upscaled renders for visual approval; **visual
  verdicts on F2–F5 renders are still PENDING** — structural success ≠
  design approval (AGENTS.md).

## 6. Versions

director behavior **7** · rule packs: analysis 1, plan 2, placement 4,
territory 3, validate 2, export 2 · recipe format 1 · plan/placements/
territories/report formats 1 · content pack format 1 (**frozen, FINAL**)
· supported upstream: artifact format 8, game pack 1, walkability 1.
Bump doctrine in `src/core/version.ts` + AGENTS.md (append-only
vocabularies; sequential bumps; stamp everything).

## 7. Commands

    export PATH=/opt/nvm/versions/node/v24.18.0/bin:$PATH
    npm test                                   # build + 131 tests
    node dist/src/cli.js help                  # all verbs
    node dist/src/cli.js validate fixtures/packs/fen-hollow fixtures/recipes/basic-direction.json
    node dist/src/cli.js export   fixtures/packs/fen-hollow fixtures/recipes/basic-direction.json
    node dist/src/cli.js verify-pack fixtures/packs/fen-hollow outputs/export/fen-hollow-basic-direction-content
    godot --headless --script consumers/godot-proof/verify_content_pack.gd -- <world-pack> <content-pack>
