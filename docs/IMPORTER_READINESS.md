# Game-side importer readiness (`worldfiller_importer`)

Status: **PREPARED 2026-07-29** — everything the game-side session needs,
gathered read-only. **No game-repo changes have been made.** The user
plans the game-side work from here ("tell me when you are ready for it
and i will plan it out from there"); nothing below is scheduled until
that planning session rules on it.

Read with `docs/CONTENT_PACK_FORMAT.md` (the contract the importer is
written from) and `docs/WORKFLOW.md` (how packs are produced).

## 1. Where the work lands

- **Game CODE repo: `tilok1234/Wildshot-Adventures`** — live since
  2026-07-27 (M0 scaffold, CI, CLAUDE.md contract), **Godot 4.6.2
  pinned** in project.godot — the exact engine World Filler's GDScript
  consumption proof already runs on headless. Not in this session's
  scope; it must be scoped writable when the user schedules the work.
- `Wildshot_adventures_pmanning` is the **planning/design repo** (docs
  only, the design authority). It stays read-only reference; the game
  repo never amends it and neither do we.
- WorldForge and world_filler boundaries are unchanged: the game
  composes packs at load time; no repo edits any other repo.

## 2. The game repo's own integration pattern (what we mirror)

From the planning repo (docs 14 §5, 15 §1–§3, decision register):

- Forge packs integrate as: **raw drop under `assets/`** (committed,
  gd-ignored raw), a **validating importer under `addons/`**, contract
  **frozen at v1**, and a **manifest-driven slice test in CI**. Proven
  three times (TileForge theme, Sprite Forge, doc-14 assembler pack).
- Sequencing precedent (15 §3 step 3, re-ruled 2026-07-28): the
  **consumer-prep half** of an importer (validate + decode + fixtures,
  importing nothing real, no lab surface changes) may land ahead of
  Gate 1; the **consumption half** (using the data in the lab) waits
  for its own ruling. `worldfiller_importer` slots into the same split,
  and pairs naturally with their `worldforge_importer` prep half (the
  content pack pins its base world pack by generation identity — the
  game will load them as a pair).

## 3. What World Filler already ships for this (all proven)

- **Content pack formats {1, 2, 3}** (updated 2026-07-30): format 1
  frozen final, format 2 = format 1 + `encounter_site.v1` (frozen),
  format 3 = format 2 + the OPTIONAL manifest `sourceCommit` embedded
  by publish-gated exports. Readers accept all three via
  PACK_FORMAT_PROFILE and refuse sourceCommit inside frozen formats
  1–2. `docs/CONTENT_PACK_FORMAT.md` passed the freeze-review
  "importer buildable from the doc alone" lens.
- **Six importer obligations**, enforced identically by both reference
  verifiers: files-table completeness, hash-verify-then-parse the same
  bytes, report.ok, payload format pins, closed-enum refusals,
  manifest/payload identity + count agreement.
- **`consumers/godot-proof/verify_content_pack.gd`** — the GDScript
  reference verifier: validation-first, refusal-for-refusal parity with
  the TS `verify-pack`, proven in headless Godot 4.6.2 including the
  adversarial refusal battery (malformed packs exit 1 by name, never
  crash or hang). This file is the seed of the addon's verify layer.
- **Golden packs for fixture-first work**:
  `fixtures/golden/content-pack-fen-hollow/` (format 3, dev-built so no
  sourceCommit) and `content-pack-fen-hollow-format1/` (format-1 compat
  pack, re-extracted from the behavior-14 golden at the 2026-07-30 b72
  adoption — 1 placement, since fen binds no dungeon at behavior 14).
  The canonical 256² content pack regenerates on demand (WORKFLOW).

## 4. Proposed addon shape (recommendation, not a decision)

`addons/worldfiller_importer/`:

1. **verify** — port of the reference verifier: all six obligations,
   named refusals, accepts formats {1, 2, 3}. Trust-but-verify at drop
   time, exactly like their §4 assembler-importer re-validation.
2. **typed access** — read-only data layer over the verified pack:
   placements (boss / dungeon binding / encounter site, with rules and
   explanation payloads), territory runs decoded to cells (refusing
   malformed runs by name, per the normative reader rule), danger band
   per region, respawnPressure (closed enum), coverage/report echo.
3. **No spawning in the addon.** The pack names structure; runtime
   spawning, spawn tables, aggro, and respawn cadence are the game's
   sim (their bitgrid/sim-owns-everything discipline, our README
   boundary). The consumption half is a separate, later ruling.
4. **Slice test in their CI**: verify both golden packs green + the
   refusal battery on adversarial mutations, headless 4.6.2 — a direct
   translation of the battery this repo already runs.

## 5. Decision points for the user's planning session

1. **Timing** — land the prep half now under their re-ruled precedent,
   or wait for Gate 1 (their scope guard; default per docs/15 is
   post-Gate-1 for anything the lab consumes).
2. **Drop convention** — folder name under `assets/` and which world
   ships first (updated 2026-07-30: BOTH candidate worlds now exist as
   verified WorldForge releases — the canonical
   `small-cold-coastal-pack-dusk@b65` and the game's own
   `wildshot-overworld-pack-dusk@b72`, which the game has already
   intaken; per planning docs/20, the dusk overworld's content pack is
   the step-1 hand-rehearsal substrate).
3. **Pairing** — how the game stores/loads the world pack + content
   pack pair and where the base-identity cross-check runs (importer
   refuses a mismatched pair vs load-time check).
4. **Consumption semantics** (later ruling) — what the sim does with
   dangerBand / respawnPressure / territories / encounter sites; pure
   game design, out of World Filler's scope by contract.
5. **Session scoping** — add `Wildshot-Adventures` writable when
   scheduled; the planning repo stays read-only.

## 6. What happens the moment it's scoped

One session, fixture-first (their recorded playbook integrated two
packs in under an hour each): addon skeleton + verify port green on
both golden packs + refusal slice test wired into their CI — importing
nothing real, touching no lab surface, matching the prep-half
precedent. The consumption half then has a clean, verified foundation
whenever its ruling lands.
