# World Filler — handoff (2026-07-28, format 1 FINAL, studio live, F9 in flight)

> **ECOSYSTEM POINTER (2026-07-29, designer-accepted doc 16).** This
> repo is one of seven in the Wildshot project (it directs content onto
> WorldForge worlds; the game consumes its packs post-Gate-1 per
> planning docs/17). The shared map — repo ownership, authority docs,
> hard cross-repo rules — lives at
> `Wildshot_adventure_final_planning/docs/16-ECOSYSTEM_MAP.md`.
> Read your repo's row before working here.

HANDOFF.md is the tiebreaker over any machine-local assistant memory.
Read `AGENTS.md` and the `README.md` reading list before changing anything.

## 0. State right now

Everything below is committed and pushed to `tilok1234/world_filler`,
branch `claude/freeze-review-resolution-tf6bkf` (the session's designated
branch; the repo default branch is still the older
`claude/world-director-planning-vvvudl` — the user downloads branch ZIPs,
so keep pushing here unless they ask to merge). **149 tests green**
(`npm test`). WorldForge remains READ-ONLY upstream, forever; no
WorldForge checkout exists in this container.

Arc so far, in order, all complete:

1. **F7 freeze review RESOLVED — content pack format 1 is FINAL.** All
   38 salvaged findings verified empirically and confirmed (zero
   refuted), all fixed with zero exportable-byte changes; golden pack
   fixture pins the serialization; both reference verifiers agree
   refusal-for-refusal (20-case cross-lane battery, headless Godot
   4.6.2 included). Record: `docs/FREEZE_REVIEW_FINDINGS.md`.
2. **F8 landed**: read-only viewer (`viewer/index.html`), `reroll`/
   `unlock` print-pattern verbs, `docs/WORKFLOW.md`, full
   direct→lock→reroll→export cycle in tests.
3. **User-driven usability layer** (the user is non-terminal; friction
   findings drove all of this): **dist/ is COMMITTED** (zero runtime
   deps → a plain ZIP download runs with only Node; **every commit
   touching src/ must rebuild and include dist/**), `START-HERE.bat`
   (one-click: exports examples + every world in `worlds\`, opens the
   newest map), `setup.bat` (installs to the real Documents, OneDrive
   aware), `open-viewer.bat`, exports bake a self-contained
   **view.html** per pack, `worlds\` drop-folder with
   `recipes\<world>.json` overrides.
4. **Godot game-side importer**:
   `consumers/godot_addon/worldfiller_importer/` — copy the folder into
   a Godot 4 project; full blessed verification, decoded territories,
   walkable/territory_at/placement_by_id helpers; headless-proven via
   `consumers/godot_addon/test_importer.gd`.
5. **Director Studio live** (`wf-fill serve`, `STUDIO.bat`, port 8787,
   127.0.0.1 only): JSON API over the unchanged pipeline; the DESIGNED
   front-end (produced by the user's external claude-design session
   from `docs/DESIGN_BRIEF.md` + `docs/sample-api.json`) is installed
   at `src/serve/ui.html` and headless-proven (live-mode, direct, map,
   region→placement→lock, strict re-direct holds the lock). The
   load-bearing invariant is tested: a server-directed pack is
   BYTE-IDENTICAL to `wf-fill export`.

## 1. IN FLIGHT: F9 — manual intent in the studio

Full plan: `docs/ROADMAP.md` Milestone F9. Status:

- **Phase A DONE** (server foundations, all tested in
  `tests/serve.test.ts`): `GET /api/analysis` (region-label +
  clearance grids run-length encoded, safe-zone + walkable bitpacks —
  walkable asserted byte-equal to the reference grid; cached per world
  identity); recipe history (every save snapshots the previous recipe
  to `recipes/.history/<world>/NNNN.json`, sequence numbers only;
  `GET /api/history`, `POST /api/restore` — restore snapshots first,
  so undo is itself undoable); pack diff (`direct()` keeps the
  outgoing export under `outputs/export/.previous/<world>/`;
  `GET /api/diff` reports placements added/moved/unchanged with exact
  accounting, territory resize/coverage deltas, gate changes).
- **Phase B DONE**: `docs/DESIGN_BRIEF_2.md` (zone painting, pin/bind
  with advisory valid-site glow — formula and lock id-minting grammar
  spelled out in the brief — danger overrides, intent layer + pending
  revert, diff panel, undo, enemy-library editor, seed control) +
  `docs/sample-api-2.json` (real captured responses incl. a real
  diff). Handoff zip delivered to the user.
- **Phase C PENDING (user-side)**: the user runs their external design
  session to EXTEND the current `src/serve/ui.html` per brief 2 and
  brings back one updated file. Priority order if the session trims
  scope: zones → pins → intent layer + diff → undo → rest.
- **Phase D (next session's work when the file arrives)**: install at
  `src/serve/ui.html`, wire against the real server, extend the
  headless studio smoke (scratch pattern: a Playwright script driving
  `createStudioServer` + chromium at
  `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`; prior smokes
  in the session scratchpad). Must prove: zone painted over the boss →
  boss moves and the diff names it; pin at a valid cell → held there;
  pin at an invalid cell → named lockReport reason shown; danger
  override round-trips; **restore + direct reproduces the prior pack
  byte-for-byte**. Then full suite, dist rebuild, push.
- **Phase E**: user drives it and issues design verdicts — the
  **still-pending F2–F5 visual verdicts fold in here**.

Parked as F10 (schema decisions, NOT free): per-region budget
overrides; named recipe variants.

**Standing ultracode offer (user-approved pattern):** when the user
says "ultracode", run an adversarial review swarm (max 8 concurrent)
over the studio server surface (`src/serve/server.ts` — the one
component that writes user files: `recipes/<world>.json` and history)
and/or the Phase D result. The F7 review precedent: verify claims
empirically, fix what survives.

## 2. Milestone map (docs/ROADMAP.md carries detail + exit criteria)

- F0 clean-room reader + walkability parity (flood 33893 canonical).
- F1 deterministic kernel + golden vectors + hygiene bans + 3-OS CI.
- F2 analysis (components, fields, clearance, regions, 11 heatmaps).
- F3 DirectorRecipe + danger bands + budgets + waivers (`plan`).
- F4 placement solver + honest reroll contract (22-agent review
  survived; contract in ROADMAP F4).
- F5 territories (library, pocket growth, run-encoded cells, coverage).
- F6 nine-gate audit + locks + painted zones (`validate`, `--strict`).
- F7 export + frozen format + dual verifiers; **freeze review resolved,
  format 1 FINAL** (38/38 confirmed+fixed; golden pack fixture;
  `tools/recordGoldenPack.js` re-record = logged decision).
- F8 director UX loop + user usability layer + Godot addon + studio.
- F9 manual intent (phases A+B done; C user-side; D+E remain).

## 3. Toolchain and environment gotchas

- Node **>= 24.15** (engines pin). Container default is 22:
  `source /opt/nvm/nvm.sh && nvm install 24` (24 is NOT preinstalled).
  Shell state does not persist between commands — re-export PATH.
- **dist/ is committed**: rebuild + include dist/ in every commit that
  touches src/ (`npm run build`; `npm test` also builds). `.gitignore`
  documents the doctrine.
- `npm install && npm test` works offline from a clean clone with no
  WorldForge checkout — tested isolation invariant.
- CLI writes only under `outputs/` unless
  `WORLD_FILLER_EXTRA_OUT_ROOTS=<dir>` whitelists more. Protected
  trees include consumers/, viewer/, worlds/, recipes/, dist/.
- Committed fixture worlds: fen-hollow, dust-hollow, tiny-temperate
  (64², WorldForge `bb7832f`, behavior 47; provenance sidecars). The
  canonical 256² world is NOT committed and NOT regenerable here (needs
  a WorldForge checkout — user-side only, per fixtures/README.md).
- Official Godot 4.6.2 Linux zip downloads and runs headless here
  (godotengine GitHub releases) — used for both GDScript proofs
  (verify_content_pack.gd and the addon's test_importer.gd). Manual
  step, not in CI.
- Playwright: use `playwright-core` npm-installed in the session
  scratchpad + `/opt/pw-browsers/chromium-1194/chrome-linux/chrome`
  (never `playwright install`).
- Upstream behavior bumps move walkable cells; parity suite +
  `fixtures/expected-coverage.json` are the tripwires; adopting a new
  base = regenerate fixtures + re-record + log it.
- The user's machine is Windows + OneDrive; they use branch ZIP
  downloads, not git. Batch files are the UX surface — keep them
  working (`START-HERE.bat`, `STUDIO.bat`, `setup.bat`,
  `open-viewer.bat`).

## 4. Standing user preferences (confirmed in-session)

- world_filler is isolated; WorldForge read-only reference. Never mix.
- Standing permission to commit and push to THIS branch. Do not merge
  to the default branch without an explicit ask (offered, not yet
  taken).
- Ultracode swarms: opt-in per turn by the user saying so; for
  review/audit work, **max 8 concurrent**. Building solo is fine.
- The user is not a terminal person: every capability must end as a
  double-clickable .bat or a studio interaction. Explain in plain
  words; short messages land better than walls of text.
- The external claude-design session is the UI production pipeline:
  ship it a self-contained brief + captured sample data + the current
  ui.html; it returns one file; verify headless before pushing.
- Verdict loop: renders/screenshots for visual approval; **F2–F5
  design verdicts still PENDING** (8x renders for both fixture worlds
  were delivered; verdicts fold into F9 Phase E).

## 5. Versions

director behavior **5** · rule packs: analysis 1, plan 1, placement 2,
territory 2, validate 1, export 1 · recipe format 1 · plan/placements/
territories/report formats 1 · **content pack format 1 (FINAL)** ·
supported upstream: artifact format 8, game pack 1, walkability 1.
The freeze resolution and everything since required NO bumps (all
refusal-side/verifier-side/serve-side; server-vs-CLI byte equality is
tested). Bump doctrine: `src/core/version.ts` + AGENTS.md.

## 6. Commands

    source /opt/nvm/nvm.sh && nvm use 24
    npm test                                   # build + 149 tests
    node dist/src/cli.js help                  # all verbs (incl. serve, reroll, unlock)
    node dist/src/cli.js serve 8787            # Director Studio (STUDIO.bat on Windows)
    node dist/src/cli.js export fixtures/packs/fen-hollow fixtures/recipes/basic-direction.json
    godot --headless --script consumers/godot-proof/verify_content_pack.gd -- <world-pack> <content-pack>
    godot --headless --script consumers/godot_addon/test_importer.gd -- <world-pack> <content-pack> <wrong-world-pack>
    node dist/tools/recordGoldenPack.js        # re-record frozen pack fixture (logged decision only)
