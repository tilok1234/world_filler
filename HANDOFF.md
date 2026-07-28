# World Filler — handoff (2026-07-28, F0–F7 complete)

HANDOFF.md is the tiebreaker over any machine-local assistant memory.
Read `AGENTS.md` and the `README.md` reading list before changing anything.

## 0. State right now

**F0–F7 complete, committed, and pushed** to
`tilok1234/world_filler`, branch `claude/world-director-planning-vvvudl`
(head at "F7: content pack format 1 (frozen), gate-refusing export, dual
consumption proof", `9a1178d`). **114 tests green** (`npm test`).
WorldForge checkout untouched throughout — verified clean after every
milestone; it is READ-ONLY upstream, forever (AGENTS.md isolation
contract; the user has re-confirmed this twice).

Pipeline that exists end to end, all deterministic, explained, rendered:
`inspect | parity | analyze | plan | place | explain | territories |
validate | lock | export | verify-pack` (see `node dist/src/cli.js help`).
Both proof worlds pass the nine-gate audit and export content packs that
verify in the TypeScript lane AND inside headless Godot 4.6.2
(`consumers/godot-proof/verify_content_pack.gd`).

## 1. The F7 freeze review — RESOLVED

The interrupted review's 38 findings were verified (all confirmed,
collapsing to 15 distinct defects), fixed, and committed; the missing
fifth lens (importer-buildability) was run and folded into
docs/CONTENT_PACK_FORMAT.md. See docs/FREEZE_REVIEW_FINDINGS.md for the
per-defect resolution record. **Content pack format 1 is FINAL.**
Evidence: 134 tests green (new adversarial verifier battery + committed
golden pack, re-record only via `node dist/tools/updateGoldenPack.js`);
the rewritten GDScript verifier refuses all 12 tampered packs in
headless Godot 4.6.2 identically to the TS lane; pre-fix and post-fix
exports of fen-hollow/basic-direction are byte-identical (behavior
version stays 5 — every fix was refusal-path tightening).

## 2. Milestone map (docs/ROADMAP.md carries detail + exit criteria)

- F0 clean-room reader + walkability ladder + flood; bit-for-bit parity
  vs reference grids (fixtures committed; canonical world flood 33893).
- F1 kernel: uint32 mixers, hierarchical channels
  (`world/<regionId>/reroll.<n>/<system>/<slot>`), golden vectors
  (`fixtures/golden/kernel.json`, re-record ONLY via
  `node dist/tools/updateGolden.js`), hygiene bans, 3-OS CI.
- F2 analysis: components, BFS distance fields, clearance, corridors,
  safe zones, region segmentation + adjacency, hashed cached summaries,
  11 heatmap renders (`analyze`).
- F3 DirectorRecipe (strict vocabulary, defaults, identity hash), danger
  bands from median spawn path-distance, budgets on hostile-walkable
  ground, named waivers, minimax progression-trap check (`plan`).
- F4 placement solver (bosses on clearance-proven arenas via arenaOrigin,
  dungeon bindings on the world's own anchor POIs), symmetric
  physical/buffer reservation semantics, funnels + explanations
  (`place`/`explain`). Survived a 22-agent ultracode review — 3 criticals
  fixed; **the honest reroll contract** is documented in ROADMAP F4 exit
  criteria: rerolls re-seed only that region's channels; spatially
  UNCOUPLED regions byte-identical; coupled regions re-solve
  deterministically; hard pinning = locks.
- F5 territories: content library (placeholder enemy defaults — game
  supplies real ones), pocket-aware growth, run-encoded cells, rosters by
  biome x band, coverage metrics (`territories`).
- F6 nine-gate audit (`validate`, report.json/txt), locks (`lock` prints
  recipe entries; held locks byte-stable + reroll-immune; per-lock
  invalidity diagnosis; `--strict`), painted noContent/preferContent.
- F7 export (`export` refuses on failed gates; byte-stable) + frozen
  format doc `docs/CONTENT_PACK_FORMAT.md` + dual verifiers.

**Next: F8** — single-file read-only browser viewer (layer toggles,
hover explanations), iteration-verb polish, workflow docs. Then the
first-arc close-out per ROADMAP (deferred list stays deferred).

## 3. Toolchain and environment gotchas

- Node **>= 24.15 required** (engines pin, matches upstream). Container
  default node is 22 — use `/opt/nvm/versions/node/v24.18.0/bin` in PATH,
  or `source /opt/nvm/nvm.sh && nvm install 24`.
- `npm install && npm test` from a clean clone works offline with no
  WorldForge checkout present — that is a tested isolation invariant.
- CLI writes only under `outputs/` unless
  `WORLD_FILLER_EXTRA_OUT_ROOTS=<dir>` whitelists more (path guard;
  scratch dirs need it).
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
  consumption proof.
- Upstream behavior bumps move walkable cells (flood history 33845→33893).
  The parity suite + pinned `fixtures/expected-coverage.json` are the
  tripwires; adopting a new upstream base = regenerate fixtures +
  re-record coverage + note it in the commit, an explicit logged decision.

## 4. Standing user preferences (confirmed in-session)

- world_filler is a separate isolated repo; WorldForge is read-only
  reference. Never mix.
- Standing permission to commit and push to world_filler (this branch).
- Ultracode swarms: user opts in per-turn, wants them for hard
  review/audit milestones, **max 8 agents concurrent**.
- Verdict loop: send upscaled renders (terrain/danger/placements/
  territories) for visual approval; scratch script pattern lives in the
  session log — re-render via the render modules at scale 3x (256²) or
  8x (64²). **Verdict status: F2 analysis APPROVED; F3 danger APPROVED
  after adopting area-share banding (bandSharesPermille 320/280/250/150
  in basic-direction; the "too little green / no purple" note drove
  behavior 6). F4 placements and F5 territories still PENDING** —
  structural success ≠ design approval (AGENTS.md).

## 5. Versions at handoff

director behavior **6** (danger.bandSharesPermille area-share banding,
F3 design verdict; linear cut unchanged when absent) · rule packs:
analysis 1, plan 2, placement 2, territory 2, validate 1, export 1 ·
recipe format 1 · plan/placements/
territories/report formats 1 · content pack format 1 (frozen, pending
review outcome) · supported upstream: artifact format 8, game pack 1,
walkability 1. Bump doctrine in `src/core/version.ts` + AGENTS.md
(append-only vocabularies; sequential bumps; stamp everything).

## 6. Commands

    export PATH=/opt/nvm/versions/node/v24.18.0/bin:$PATH
    npm test                                   # build + 114 tests
    node dist/src/cli.js help                  # all verbs
    node dist/src/cli.js validate fixtures/packs/fen-hollow fixtures/recipes/basic-direction.json
    node dist/src/cli.js export   fixtures/packs/fen-hollow fixtures/recipes/basic-direction.json
    node dist/src/cli.js verify-pack fixtures/packs/fen-hollow outputs/export/fen-hollow-basic-direction-content
    godot --headless --script consumers/godot-proof/verify_content_pack.gd -- <world-pack> <content-pack>
