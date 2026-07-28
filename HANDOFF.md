# World Filler — handoff (2026-07-28, F0–F7 complete + freeze review resolved)

HANDOFF.md is the tiebreaker over any machine-local assistant memory.
Read `AGENTS.md` and the `README.md` reading list before changing anything.

## 0. State right now

**F0–F7 complete and the F7 freeze review fully resolved, committed, and
pushed** to `tilok1234/world_filler`, branch
`claude/world-filler-repo-focus-9fmr60`. **129 tests green** (`npm test`).
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
- Versions: director behavior **6**; rule packs placement 3,
  territory 3, validate 2, export 2 (analysis 1, plan 1). All formats
  still 1. Coverage now has a row for every plan region (world totals).

Pipeline (all deterministic, explained, rendered):
`inspect | parity | analyze | plan | place | explain | territories |
validate | lock | export | verify-pack` (see `node dist/src/cli.js help`).

## 1. Next: F8 — Director UX loop (docs/ROADMAP.md § F8)

Single-file, no-build, read-only browser viewer (minimap backdrop, layer
toggles for analysis/danger/plan/placements/territories, hover
explanations), iteration-verb polish, workflow docs. Then the first-arc
close-out per ROADMAP (deferred list stays deferred).

Also still open: **visual verdicts on the F2–F5 renders are PENDING user
review** — structural success ≠ design approval (AGENTS.md). Send
upscaled renders (terrain/danger/placements/territories) for approval:
re-render via the render modules at scale 3x (256²) or 8x (64²).

## 2. Milestone map (docs/ROADMAP.md carries detail + exit criteria)

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

## 3. Toolchain and environment gotchas

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

## 4. Standing user preferences (confirmed in-session)

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

## 5. Versions

director behavior **6** · rule packs: analysis 1, plan 1, placement 3,
territory 3, validate 2, export 2 · recipe format 1 · plan/placements/
territories/report formats 1 · content pack format 1 (**frozen, FINAL**)
· supported upstream: artifact format 8, game pack 1, walkability 1.
Bump doctrine in `src/core/version.ts` + AGENTS.md (append-only
vocabularies; sequential bumps; stamp everything).

## 6. Commands

    export PATH=/opt/nvm/versions/node/v24.18.0/bin:$PATH
    npm test                                   # build + 129 tests
    node dist/src/cli.js help                  # all verbs
    node dist/src/cli.js validate fixtures/packs/fen-hollow fixtures/recipes/basic-direction.json
    node dist/src/cli.js export   fixtures/packs/fen-hollow fixtures/recipes/basic-direction.json
    node dist/src/cli.js verify-pack fixtures/packs/fen-hollow outputs/export/fen-hollow-basic-direction-content
    godot --headless --script consumers/godot-proof/verify_content_pack.gd -- <world-pack> <content-pack>
