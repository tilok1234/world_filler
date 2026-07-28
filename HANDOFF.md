# World Filler — handoff (2026-07-28, F0–F8 complete, freeze review RESOLVED)

HANDOFF.md is the tiebreaker over any machine-local assistant memory.
Read `AGENTS.md` and the `README.md` reading list before changing anything.

## 0. State right now

**F0–F7 complete AND the F7 freeze review resolved**, committed and pushed
to `tilok1234/world_filler`, branch `claude/freeze-review-resolution-tf6bkf`
(branched from `claude/world-director-planning-vvvudl`). **140 tests green**
(`npm test`). WorldForge checkout untouched throughout — verified clean
after every milestone; it is READ-ONLY upstream, forever (AGENTS.md
isolation contract; the user has re-confirmed this twice).

**Content pack format 1 is FINAL.** The interrupted F7 adversarial review
was resolved: all 38 salvaged findings were verified empirically (tamper
experiments in both verifier lanes) and **all 38 confirmed, zero refuted**;
every fix landed; the missing fifth lens (importer buildability) ran
against the rewritten doc. See `docs/FREEZE_REVIEW_FINDINGS.md` for the
cluster-by-cluster resolution. Key facts:

- Both reference verifiers now enforce the full blessed-check battery
  (report.ok, exact-four files table, payload format pins, closed enums,
  manifest self-consistency, run-shape refusals) and agree
  refusal-for-refusal — a 20-case cross-verifier battery proved alignment,
  no hangs, in TS and headless Godot 4.6.2.
- A pre-fix export is byte-identical to a post-fix export (compared
  directly), so no behavior/rule-pack version bump was needed: every fix
  is refusal-side, verifier-side, or documentation.
- The frozen serialization is pinned by `fixtures/golden/content-pack/`
  (five files, byte-asserted in tests). Re-record ONLY via
  `node dist/tools/recordGoldenPack.js` — an explicit, logged decision.
- `wf-fill export`/`validate` now refuse stale base pins pre-flight
  (unconditionally, like plan/place/territories); unknown CLI flags are
  refusals; consumers/, dist/, node_modules/ are guard-protected;
  exports are staged with manifest.json as the commit record.

Pipeline unchanged end to end, all deterministic, explained, rendered:
`inspect | parity | analyze | plan | place | explain | territories |
validate | lock | export | verify-pack` (see `node dist/src/cli.js help`).
Both proof worlds pass the nine-gate audit and export content packs that
verify in the TypeScript lane AND inside headless Godot 4.6.2
(`consumers/godot-proof/verify_content_pack.gd`), strict mode included.

## 1. F8 landed; what remains is user-side

**F8 shipped in the same session**: `viewer/index.html` (single-file,
no-build, READ-ONLY inspector — drop a content-pack dir + optionally an
analyze dir onto it; backdrop select over any dropped render, JSON-driven
overlays for territories/placements/exclusions/arenas, hover shows the
full explanation: score terms, funnel, top candidates, roster, region
brief, gates, coverage; contract pinned by `tests/viewer.test.ts`,
behavior proven by a headless-Chromium Playwright smoke over real
fen-hollow outputs). New verbs `wf-fill reroll <recipe> <region-id>` and
`wf-fill unlock <recipe> <placement-id>` follow the `lock` print-pattern
(recipes are user-authored; the CLI never writes them).
`docs/WORKFLOW.md` documents the direct→review→lock→reroll→export loop
and the regenerated-world (staleness) workflow.
`tests/workflow.test.ts` runs the full cycle through documented CLI
commands: lock a boss, reroll another region, strict-export, and the
locked placement survives byte-stably (lockReport "held").

**Remaining F8 exit items (user-side, per ROADMAP):** (1) run the loop
on the canonical 256² world — not regenerable here, needs a WorldForge
checkout; (2) the design verdict on the result. **Visual verdicts on
F2–F5 renders also still PENDING** (8x renders for both fixture worlds
were delivered in-session). Then the first-arc close-out (deferred list
stays deferred).

## 1b. Post-F8 user-driven additions (same day)

The user tested the flow on Windows; the friction findings drove these
(all pushed, all covered by tests, dist committed pre-built):

- **START-HERE.bat** one-click flow; **worlds\** drop-folder (auto-
  directed with recipes\<name>.json overrides); export bakes a
  self-contained **view.html** per pack; open-viewer.bat opens the
  newest one. dist/ is committed — see §3 doctrine.
- **consumers/godot_addon/worldfiller_importer/** — the game-side
  importer (copy folder into a Godot 4 project; full blessed
  verification; decoded territories; walkable/territory_at/
  placement_by_id). Headless-proven via consumers/godot_addon/
  test_importer.gd.
- **Director Studio phase 1** (`wf-fill serve`, STUDIO.bat, port 8787,
  127.0.0.1 only): JSON API over the unchanged pipeline — worlds /
  recipe get+put (validated, writes recipes/<world>.json only) /
  direct / pack / render / view / lock / unlock / reroll.
  tests/serve.test.ts pins server-direct BYTE-IDENTICAL to CLI export.
  src/serve/ui.html is a deliberate placeholder: the designed front-end
  is produced externally from **docs/DESIGN_BRIEF.md** +
  **docs/sample-api.json** and swaps that one file (phase 2, pending).

## 1c. NEXT: F9 — manual intent in the studio (planned with the user)

The designed studio UI landed (phase 2) and the user green-lit planning
the manual-editability milestone. **The full F9 plan lives in
docs/ROADMAP.md (Milestone F9)** — phases A (server: analysis endpoint,
recipe history, pack diff), B (DESIGN_BRIEF_2 addendum + samples),
C (user's external design session), D (integration + extended headless
proof), E (user acceptance + the standing design verdicts). Zero format
changes; per-region budget overrides parked as an F10 schema decision.

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
- F7 export (`export` refuses on failed gates; staged writes; byte-stable)
  + frozen format doc `docs/CONTENT_PACK_FORMAT.md` + dual verifiers.
  **Freeze review resolved 2026-07-28; format 1 FINAL** — 38/38 findings
  confirmed and fixed (`docs/FREEZE_REVIEW_FINDINGS.md`), lock id grammar
  enforced, fresh-boss slots consult held locks, export cross-checks the
  identity of every payload it is handed.

## 3. Toolchain and environment gotchas

- **dist/ is COMMITTED** (user-facing decision, 2026-07-28): the project
  has zero runtime deps, so a plain ZIP download runs with nothing but
  Node — `START-HERE.bat` exports the fixture worlds and opens the
  viewer with no npm install and no build. **Every commit that touches
  src/ must rebuild and include dist/** or the shipped program drifts
  from the source. setup.bat / open-viewer.bat support the same flow.

- Node **>= 24.15 required** (engines pin, matches upstream). Container
  default node is 22 — `source /opt/nvm/nvm.sh && nvm install 24` (the
  bare `/opt/nvm` tree may not have 24 preinstalled).
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
  consumption proof. The GDScript lane is a manual proof step, not in CI.
- Upstream behavior bumps move walkable cells (flood history 33845→33893).
  The parity suite + pinned `fixtures/expected-coverage.json` are the
  tripwires; adopting a new upstream base = regenerate fixtures +
  re-record coverage + note it in the commit, an explicit logged decision.

## 4. Standing user preferences (confirmed in-session)

- world_filler is a separate isolated repo; WorldForge is read-only
  reference. Never mix.
- Standing permission to commit and push to world_filler (current branch).
- Ultracode swarms: user opts in per-turn, wants them for hard
  review/audit milestones, **max 8 agents concurrent**. (The freeze-review
  resolution was done solo with empirical tamper experiments instead — the
  user's message said to ask first, so no swarm was spawned.)
- Verdict loop: send upscaled renders (terrain/danger/placements/
  territories) for visual approval; re-render via the render modules at
  scale 3x (256²) or 8x (64²). **Visual verdicts on F2–F5 renders are
  still PENDING** — structural success ≠ design approval (AGENTS.md).

## 5. Versions at handoff

director behavior **5** · rule packs: analysis 1, plan 1, placement 2,
territory 2, validate 1, export 1 · recipe format 1 · plan/placements/
territories/report formats 1 · **content pack format 1 (FINAL)** ·
supported upstream: artifact format 8, game pack 1, walkability 1.
Bump doctrine in `src/core/version.ts` + AGENTS.md (append-only
vocabularies; sequential bumps; stamp everything). The freeze-review
fixes required no bumps: pre-fix and post-fix exports are byte-identical.

## 6. Commands

    source /opt/nvm/nvm.sh && nvm use 24
    npm test                                   # build + 140 tests
    node dist/src/cli.js help                  # all verbs
    node dist/src/cli.js validate fixtures/packs/fen-hollow fixtures/recipes/basic-direction.json
    node dist/src/cli.js export   fixtures/packs/fen-hollow fixtures/recipes/basic-direction.json
    node dist/src/cli.js verify-pack fixtures/packs/fen-hollow outputs/export/fen-hollow-basic-direction-content
    godot --headless --script consumers/godot-proof/verify_content_pack.gd -- <world-pack> <content-pack>
    node dist/tools/recordGoldenPack.js        # re-record frozen pack fixture (logged decision only)
    # F8 loop: docs/WORKFLOW.md; viewer: open viewer/index.html, drop outputs onto it
    node dist/src/cli.js reroll fixtures/recipes/basic-direction.json <region-id>
    node dist/src/cli.js unlock <recipe.json> <placement-id>
