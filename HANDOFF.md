# World Filler — handoff (2026-08-01, F0–F9 closed + b77 ADOPTED + dusk rehearsal rounds 1–5 LIVE at behavior 18 — the dusk map is the game's TEST SLICE)

HANDOFF.md is the tiebreaker over any machine-local assistant memory.
Read `AGENTS.md` and the `README.md` reading list before changing anything.

> **ECOSYSTEM POINTER (doc 16, designer-accepted).** This repo is one of
> seven in the Wildshot project (the world director: compiles content
> packs the game will consume post-Gate-1). The shared map — repo
> ownership, authority docs, hard cross-repo rules — lives at
> `Wildshot_adventure_final_planning/docs/16-ECOSYSTEM_MAP.md`.
> Read your repo's row before working here.

> **SYNC-LOG HOOK (doc 18, ACCEPTED 2026-07-30).** At session end, with
> the handoff update, append a line to planning `tools/sync_log.json`
> for every cross-repo event this session caused (pack delivered or
> intaken, ask opened/resolved, incident, pin change). No event, no
> entry. Protocol: planning `docs/18-AGENT_SYNC_PROTOCOL.md`.

## 0. State right now

**The first arc F0–F9 is COMPLETE and CLOSED (2026-07-29)** — freeze
review resolved, every visual verdict thread closed approved at behavior
12, committed and pushed to `tilok1234/world_filler`, branch **`main`**
(this line was promoted to `main` and made the GitHub default in the
2026-07-30 janitor session, designer-ruled Tier 1; the former
`claude/world-filler-repo-focus-9fmr60` name is retired — the parallel
`freeze-review-resolution-tf6bkf` line stays archive-tagged, and porting
its dual-verifier test battery onto this line is a recorded ask; the
old area-share banding verdict is SUPERSEDED by rounds 1–4).
**193 tests green** (`npm test`; count includes the ported archived-line
battery, sl-0012, the 2026-07-30 publish/format-3 additions, the
sl-0026 segmentation regressions, the b72 + b77 rung units, the round
2/4/5 units (watershed, settlement relief, macro-zones), and the two
local-pack parity lanes — the dual-verifier Godot lane runs REAL on
this machine).
**Behavior-77 walkability is ADOPTED (2026-08-01, per the planning
|| re-pin ruling on sl-0041; §1i)** — dust-hollow + tiny-temperate
re-pinned at WorldForge `1a20bd2` (fen-hollow deliberately frozen at
b72 — §1i), canonical world = the imported
`small-cold-coastal-pack-dusk@b65` release (untouched), the dusk
overworld `@b77` sits parity-green in `outputs/local-packs/`
(derived flood 46493 = manifest).
**Doc 18 items landed 2026-07-30 (§1f): export is now a publishing act**
(gate + manifest sourceCommit + GitHub-release transport, pack format
3), and the viewer adopted the refusing run decoder (designer ruling,
Tier 1).
Next milestone (planning docs/20 step 1, base re-pinned b72→b77 by the
|| ruling on sl-0041): **direct the dusk overworld** — a recipe pinned
to `wildshot-overworld-pack-dusk@b77` (generationIdentitySha256
`bd4b9317…`, in `outputs/local-packs/`), the design/verdict loop over
it, gated export; the game consumes that pack AS REFERENCE ONLY for the
hand-rehearsal, then the designer's feel verdict. The game-side
importer (§2, docs/IMPORTER_READINESS.md) follows that verdict at its
own planning session. Directing content is design work the user drives.
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

## 1. Visual verdict loop — CLOSED, all F2-F5 verdicts APPROVED

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

Versions after round 1: behavior 7, plan 2, placement 4.
Golden content pack re-recorded for the retuned recipe (kernel golden
byte-identical). The canonical 256² world regenerates ONLY from
WorldForge pinned commit `bb7832f` (behavior 47) — the checkout's HEAD
has moved to behaviors 49-50 and produces a DIFFERENT world that fails
parity; use `git -C <WorldForge> archive bb7832f | tar -x -C <scratch>`
and build there. Adopting the newer upstream base remains an explicit
user decision (not taken). **[SUPERSEDED 2026-07-30: the decision was
taken — behavior-72 adoption, §1h. The canonical is now the imported
`small-cold-coastal-pack-dusk@b65` release; this paragraph stands as
history of the behavior-47 era.]**

Round-2 verdicts (user): purple read as 2 places, not 3; endgame zones
too close together; some dungeon binds "right up to the cities";
territory band-coloring approved ("ye thats cool") with a wish to
spread territories out; **heatmaps APPROVED**. Round-2 changes
(behavior **8**, plan 3, territory 4):

- `danger.endgamePockets` (0 = off, else 2–8): the deepest band is
  reshaped into K separated pockets — seeds via farthest-point sampling
  over region anchors, restricted to substantial regions
  (>= budgets.minRegionCells reachable); a deep region keeps the band
  only when its second-nearest seed is >= 1.5x its nearest (watershed
  regions demote one band, opening gaps where pockets would merge).
  Canonical at K=3: corner grassland + snow highland + small road-end
  outpost, cleanly separated (the world has exactly 3 substantial far
  regions, so K>3 is a no-op there).
- `territoryRule.spacing` (Chebyshev halo, 0 = off): territories keep a
  clear gap; recipe uses 2 (fixtures keep all their content at 2;
  canonical goes 51→53 smaller, spread patches, failures 9→7).
- dungeonRule.minSettlementDistancePermille raised 250→320 in the
  recipe: the safe-zone-rim binds are gone; canonical now 10 dungeons +
  4 honest X's (two are the top-left ruins pair that previously bound
  right next to the outpost settlements).

Round-3 verdicts (user): pockets "didn't change at all — try 3";
**4 X's APPROVED** ("i think 4 is acceptable ye"); floated that boss and
dungeon placement should stay separate systems (they are — independent
rule blocks + floors; open question whether a boss-to-dungeon minimum
distance knob is wanted); asked for a fuller territories explanation.
Round-3 change (behavior **9**, plan 4): endgamePockets REWORKED from
demote-only watershed (which could not create a pocket where the
quantile put none — the canonical far side has only 2 substantial deep
regions) to island carving over the TWO deepest bands: K farthest-point
seeds (substantial regions only), every crescent region joins its
nearest seed's pocket in increasing anchor-distance order until the
pocket reaches its share of the original deep-band area; members take
the deep band (promoting near-band ground), the rest of the crescent
takes the second-deepest. Canonical K=3 now: mid-left island,
bottom-right island (NEW — opposite side of the map), top outpost
cluster. Placements render byte-identical v3->v4 (boss undisturbed);
territories recolor to match the new endgame geography.

Round-4 verdicts (user): **danger endgame islands APPROVED** ("ye that
works"); territories — user asked for a self-assessment first; the
boss-to-dungeon-distance question confused ("idk if that correct
image") and is DROPPED unless the user raises it again. User also asked
for SHORTER replies with fewer images — honor that.

Territory self-assessment (canonical, behavior 9): sizes 24/40/400
(min/median/max, one defensible big-wilds outlier at the maxCells cap);
coverage by band 22/22/29/25/34% (evenly spread, endgame slightly
denser — good progression shape); territory ground within 12 of a road:
26% vs 31% baseline (no hiding from travel routes); 7 zero-territory
budgeted regions = the 7 honest fragmentation failures. Verdict
recommended to user: approve as-is, no knob changes.

Round-5 (2026-07-29): the third image in the round-4 batch confused the
user ("boss map in another format") — it was the fen-hollow ×8
territories close-up for the explainer, not the placements map;
clarified. **Territories APPROVED.** With heatmaps, danger, placements
(X's), and territories all approved, the F2-F5 visual verdict loop is
CLOSED. The approved baseline is behavior 9 under
fixtures/recipes/basic-direction.json (golden pack pins it). Replacing
this baseline is a user-authority decision (AGENTS.md). **F8 is next.**

## 1b. F8 status (2026-07-29): COMPLETE — viewer approved

- `viewer/worldfiller-viewer.html`: single-file, no-build, read-only.
  Drop an exported content pack (+ optionally the world pack for the
  minimap backdrop and analysis renders for extra layers): layer
  toggles, pan/zoom, hover/click inspection (full scoreTerms +
  candidateFunnel + topCandidates per placement, roster/band per
  territory), audit gates, failures list, and in-browser sha256
  re-verification of the files table (honest fallback message when
  SubtleCrypto is unavailable). Proven headlessly (Playwright +
  container Chromium, scratch harness — NOT a committed dependency):
  both fixture exports load, 9 gates shown, hashes verified, pinning a
  placement shows its explanation. Demo artifact with embedded
  fen-hollow data: claude.ai/code/artifact/6e31a452-e643-4dca-967e-314034a8df14
- New verbs `wf-fill unlock <recipe> <placement-id>` and
  `wf-fill reroll <recipe> <region-id>`: read-only PRINT verbs (safe-
  write doctrine — the tool never edits a user recipe); tested.
- docs/WORKFLOW.md: the direct → review → lock → reroll → export loop
  + the stale-world (G7) workflow.
- Full cycle ran on the canonical world: place → lock boss → reroll
  region.grass.0 → re-place (lock byte-stable, region on reroll.1
  channels) → export → verify-pack OK (11 placements, 53 territories).
- Authoring aids added after approval (user asked how to place/move/
  remove content, then took the recommendation): copy-lock / copy-reroll
  buttons on cards, shift+drag paint-rect copy (noContent /
  preferContent) — clipboard only, still read-only; proven headlessly
  (copied lock round-trips the boss id + cell; rect [10,10,14,13]
  copies exactly). Demo artifact republished (same URL).
- 134 tests green. Viewer verdict: **APPROVED** ("looks cool"). User
  confirmed understanding that the inspection palette is not game art —
  real graphics come from TileForge tiles rendered by the Godot game;
  World Filler stays out of art by doctrine. **F8 complete. Next: the
  first-arc close-out per ROADMAP** (deferred list stays deferred).

## 1c. F9 (2026-07-29): encounter sites — pack format 2

User picked encounter sites over the game importer. Implemented:
`placeEncounters` (pass 3, after bosses — most flexible routes around
every claim): per-region whole-grid candidate scan (walkable, reachable,
outside safe zones and noContent), scoring road_near (encounters are
stumbled on — nearness scores UP) + clearance + preferred-zone bonus,
seeded top-6 window pick per slot on
`world/<region>/reroll.<n>/encounter/<slot>`, physical claim = the site
cell, buffer = encounterRule.exclusionRadius (default 3 — 5 starved
64² territory ground, probed both). Lockable (id tag `encounter`, no
anchor/arena); G4 accounts encounter budgets; territories grow around
encounter buffers automatically. New recipe section `encounterRule`
{exclusionRadius, roadNearPermille, clearancePermille}.

**Pack format 2**: placementsFormat 2 appends rule `encounter_site.v1`
(no shape changes). Format 1 stays valid: both verifiers accept formats
1-2 via PACK_FORMAT_PROFILE (version.ts), refuse encounter rules inside
format-1 packs, and `fixtures/golden/content-pack-fen-hollow-format1/`
(extracted from the behavior-9 golden) pins backward compat in the
suite + was verified in headless Godot. Versions: behavior 10; plan 4,
placement 5, validate 3; PLACEMENTS_FORMAT 2, CONTENT_PACK_FORMAT 2.
Canonical: 48 encounters, 52 territories (f8); all four worlds 9/9.
135 tests green. Encounter render: closed with the §1d approval (amber
markers were on every shared render since F9, no objection raised).

## 1d. Post-F9 verdict thread: yellow bands -> region subdivision (behavior 12) — CLOSED, APPROVED

User: "very little yellow danger" — real (band 2 held 1,677/~6,000 fair
share). Two-step fix, both landed:
1. Behavior 11: min-share rebalance for mid bands after the pocket pass
   (boundary-region moves, deficit-improvement criterion, deepest band
   never touched). Partial: +36% yellow, capped by region granularity.
2. Behavior 12 / **analysis 2**: MAX_REGION_CELLS=1024 — oversized biome
   patches subdivide (midline bisection + component re-flood, ids stay
   content-derived via each part's own anchor index). Canonical bands
   now 5148/5519/5714/4775 (essentially even). Region ids CHANGED on
   worlds that had monoliths (invalid locks get diagnosed — the designed
   migration). Knock-ons handled: boss budgets FALL BACK through other
   eligible regions with named failures when the allocated region has no
   site (placement 6); fixture recipe recalibrated because per-region
   caps bind less on fine regions (encounters 3/1000 cap 2, territories
   4/1000 cap 2, minCells 40 -> canonical B1/E41/T73/31%; the small
   fixtures are proportionally sparser than the old approved close-ups:
   fen now T5/E2 — flagged to the user).

User verdict "approved" (2026-07-29): the subdivision-era danger map —
essentially even bands, brightened unbanded geography — is the approved
baseline at behavior 12. The honest notes below were flagged before the
verdict and stand accepted as-is; the listed mechanisms (danger.overrides
for an authored endgame zone, watershed subdivision for organic seams)
remain optional polish, not scheduled work.

HONEST NOTES flagged to the user before the verdict (accepted):
- The approved bottom-right endgame island DISSOLVED: its depth was an
  artifact of the old monolith's single whole-region median; granular
  medians put bottom-right at bands 2-3. Endgame now concentrates on
  the true far side (left). danger.overrides is the designed mechanism
  if the user wants an authored endgame zone there anyway.
- Subdivision seams are straight (midline bisection) — the danger map
  reads blockier than the old organic biome edges. Possible polish:
  distance-watershed subdivision for organic seams (not built).

## 1e. Upstream-facing gap: walkable cliffs — SEGMENTATION HALF RESOLVED (sl-0026, §1g)

> The segmentation blindness recorded below was fixed 2026-07-30
> (designer-ruled sl-0026, executed via planning bundle sl-0037; §1g).
> The LADDER half (walkable moss-on-rock itself) remains adoption work,
> scoped in the sl-0037 report — not yet ratified.


The user says TileForge currently has 3 high-cliff tiles that ARE
walkable, and real game worlds will have little unwalkable mountain.
Consequences noted, no action taken yet:
- Walkability itself is read from each world pack's grid (parity-pinned),
  so walkable cliffs flow through banding/territories/encounters
  automatically once upstream worlds carry them — likely alongside an
  upstream walkability/behavior bump adopted via the documented fixture
  regeneration process.
- OUR gap: src/analysis/regions.ts VOID_MATERIALS treats terrain.rock
  (and water) as region-separating void BY MATERIAL. Walkable rock
  (cliff tops, and today's route-crossing ford cells) gets no region →
  the director is blind to that ground for bands/budgets/territories.
  When adopting cliff-walkable worlds, make segmentation
  walkability-aware (void = void-material AND unwalkable), which is an
  ANALYSIS_VERSION bump — coordinate it with the same adoption commit.

## 1f. Publish gate + releases + refusing viewer decoder (2026-07-30, doc 18 ratified)

Planning doc 18 (ratified 2026-07-30) landed here in full:

- **Publish gate (§4.1):** `wf-fill export` refuses a dirty tree or an
  unpushed HEAD by name before doing any work (src/publish/gate.ts).
  The dirty-tree refusal was exercised for real (19-file dirty tree,
  exit 1, nothing written). Dev bypass for local iteration and the test
  suite: `WORLD_FILLER_DEV_EXPORT=1` (no gate, no provenance, no
  release; the suite exports through it).
- **Manifest provenance (§4.2) = pack format 3:** format 2 is frozen,
  and appends land as a new format number (format doc doctrine), so the
  gated export's `manifest.sourceCommit` (40-hex, the proved pushed
  commit) is format 3 — format 2 plus exactly that one OPTIONAL append,
  payloads unchanged (placementsFormat stays 2). Dev-bypass builds omit
  the field, which keeps the golden byte-pin commit-independent. Both
  reference verifiers accept formats {1,2,3}, refuse sourceCommit
  inside frozen formats 1-2, and refuse malformed values in format 3 —
  proven refusal-for-refusal in the dual battery (now 23 cases, real
  Godot lane). NOTE: the designer brief said "manifest carries
  sourceCommit"; the format-number bump is this repo's doctrine-
  compliant execution of that (flagged in the session report).
- **Releases as transport (§4.4, ADOPTED NOW):** a gated export zips
  the pack deterministically (src/publish/zip.ts — fixed DOS epoch,
  sorted entries, byte-stable) and uploads it as a GitHub release
  tagged with the artifact id `<world>-content-<sha256(manifest)[..12]>`,
  targeting the proved commit; notes carry sourceCommit + zip SHA-256 +
  manifest SHA-256. An existing tag REFUSES (never overwritten). gh
  verified authenticated (tilok1234, repo scope) and the repo reachable;
  release list is empty — prior packs grandfathered, NO release was
  created this session (no delivery has happened; the create path is
  unit-tested via an injected runner).
- **Refusing viewer decoder (designer ruling 2026-07-30, Tier 1,
  closing the sl-0012 flag):** the viewer now decodes territory runs
  with the reference reader rules — non-integer triples, out-of-grid
  and row-crossing runs, and lying cellCounts refuse the whole
  territories payload with an on-page error naming territory id, run
  index, and defect; nothing renders permissively. Pinned in
  viewer.test.ts and exercised live through the real file-intake path
  (all three cases: two refusals named on-page, honest pack clean).

Versions after this session: export rule pack **3**, CONTENT_PACK_FORMAT
**3** (readers accept {1,2,3}); behavior stays 12 — no generation
semantics changed, placement bytes identical.

## 1g. sl-0037 bundle (2026-07-30): sl-0026 executed + dusk@b71 intake finding + b72 adoption scoped

- **sl-0026 EXECUTED (behavior 13, analysis 3):** region segmentation is
  walkability-aware — void = void-material AND unwalkable (both the seed
  scan and the flood join; same-material blocked river cells never join a
  wadeable patch). Route/street fords, wadeable shallows, and piers now
  form regions of their own material and enter adjacency (fen: 15 water
  regions, 147 plan regions total). Regression tests: synthetic
  ford-bridges-banks + fixture-wide walkable-void property
  (tests/analysis.test.ts). Fixture knock-on, reviewed and re-recorded
  via updateGolden (kernel byte-identical): fen-hollow no longer places
  a dungeon binding — all four anchors sit in zero-budget regions
  (named region_zero_budget per anchor); golden counts moved
  4/5/2/3 -> 3 placements / 6 territories / 4 failures / 4 unbound. The
  binding-dependent tests (dual battery, verifier battery, G2,
  distance-floors) moved to dust-hollow, which still binds 3-5 dungeons;
  fen stays the beyond-battery positive + frozen format-1 world. NOTE:
  canonical-world impact of behavior 13 is UNVERIFIED here (needs the
  bb7832f scratch regen); the fixture layout change is flagged, not
  design-approved — reopen the verdict loop if canonical content moves.
- **dusk@b71 intake finding (user request, verified end-to-end):**
  WorldForge release wildshot-overworld-pack-dusk@b71 (sourceCommit
  63632716, zip+manifest+all-8-file hashes verified, GitHub digest
  agrees) FAILS walkability parity against our b47-era ladder: 306
  cells, flood 45184 claimed vs 45247 derived. Fully accounted: 172
  cells = 14 new blocking props (lamp, table_chairs, barrels, topiary,
  laundry_line, noticeboard, bench, baskets, workbench, anvil, sundial,
  fishingboat, bollard, cookfire) our BLOCKING_PROPS predates; 134 cells
  = upstream WYSIWYG-era walkability we don't transcribe yet — ALL
  walkable-rock disagreements are moss-on-rock apron cells (108/108,
  raw elev 599-662, terrace-RELATIVE level 0 — NOT walkable cliff tops;
  sl-0036 frame confirmed), plus 10 walkable swamp and 20 walkable
  structure cells (footbridge/pass-cell stamps). The pack stays in
  scratchpad — NOT in outputs/local-packs (the parity lane would
  honestly refuse it) until adoption.
- **b72 adoption SCOPED, NOT adopted (designer ratifies after the
  sl-0037 report):** base candidate wildshot-overworld-pack-dusk@b72,
  sourceCommit bbc10cdb0..., behavior 72, flood 45202, same spawn/
  tileforge package. Format question resolved WITH EVIDENCE, no WF ask:
  WorldForge's GAME_INTEGRATION_PLAN.md §3.3 (verified present at BOTH
  release commits) defines walkability.json as the consumer's runtime
  authority ("must not re-derive walkability from tile art") with the
  grid "computed by the same ladder the TypeScript loader exposes" plus
  exactly two recorded adjustments (WYSIWYG art-outline stamp; the
  2026-07-28 moss-walks ruling: bare moss on LEVEL-0 apron rock walks,
  moss stays solid up terraced peaks) — semantics ride
  generatorBehaviorVersion + doc-recorded rulings, walkabilityFormat
  governs shape/encoding and stayed legitimately at 1. Adoption work:
  transcribe b72 loader tables (blocking props, moss-on-rock walk class
  = new appended rung, structure pass/stamp tables), regen the three 64²
  fixtures + provenance at bbc10cdb, re-record expected-coverage +
  golden, decide the canonical successor (a released
  small-cold-coastal-pack-dusk@b65 exists — import vs regen is a
  designer choice), then dusk imports to outputs/local-packs and content
  over dusk unblocks.

## 1h. b72 adoption EXECUTED (2026-07-30, designer-ratified on the sl-0039 report)

- **Ladder tables transcribed @ `bbc10cdb`** (src/world/model.ts,
  behavior **14**): 16 new blocking props; dock (b60) + city_gate (b62)
  pass cells; `trailAt` is any nonzero path band (behavior 57 — the
  b47 transcription pinned value 1; b72's country-road band-2 lanes
  over swamp caught it, 28 cells); new appended rungs `moss_rock_walk`
  (moss carpet on adapter-level-0 rock walks — keyed on the pack's
  `resolved/tileforge-map-data.json` elev grid, now read by
  readGamePack and threaded into WorldModel) and
  `structure_stamp_block` (WYSIWYG art-outline stamp: record-backed
  footprints minus pass cells seal cells the ladder would walk).
  Pre-b72 packs and synthetic worlds carry no adapter elev — the moss
  rung then never fires, reproducing their pre-ruling grids.
- **Parity: bit-identical on all five b72-era packs** — the three
  regenerated fixtures, the imported b65 canonical (flood 34641, 626
  moss cells = the upstream ruling's recorded count), and dusk@b72
  (flood 45202). The b65 canonical import proved SOUND — no regen was
  needed.
- **Fixtures regenerated at `bbc10cdb`** (scratch archive build,
  `--allow-dirty` dev export): new identities in
  fixtures/provenance/, expected-coverage re-recorded (moss exercised
  4/5/18 across dust/fen/tiny; documented gaps now
  crossing_route_walk + structure_stamp_block — the stamp rung fires in
  no shipped world, painted tiles block first; synthetic units cover
  both). Golden re-recorded via updateGolden (kernel byte-identical);
  the frozen format-1 compat pack was re-extracted from the behavior-14
  golden over the new fen world (1 placement — fen still binds no
  dungeon at b72; same manifest key shape, packFormat 1).
- **outputs/local-packs/** now holds `small-cold-coastal` (b65) and
  `wildshot-overworld-pack-dusk` (b72), both release-digest-verified
  and parity-asserted by the suite every run. Content over the dusk
  overworld is UNBLOCKED (a recipe for it wants a
  `base.generationIdentitySha256` pin + a design pass — not started).

## 1i. b77 adoption EXECUTED (2026-08-01, the sl-0041 || base re-pin ruling)

- **Why:** the sl-0041 rehearsal ask (written pre-b75) pinned dusk@b72;
  WorldForge then shipped b75 (every route re-planned, street band,
  no-diagonal ruling), b76 (road joints, render-only) and b77 (prop
  walkability classes). The game intook b76 then b77 (sl-0064,
  sl-0067). Planning re-pinned the rehearsal base to b77 — directing
  over b72 would rehearse dead geometry and double-pay the designer's
  rounds. This session concurred and executed the sl-0040-shape
  adoption.
- **Ladder (behavior 15):** upstream PROP_WALKABILITY (transcribed @
  `1a20bd2`, upstream ruling sl-0063) — the four carpet-debris species
  (stump, fallen_log, bone_pile, loot_pile) leave the blocking set on
  worlds recorded at `generatorBehaviorVersion >= 77`; earlier-era
  worlds reproduce their reference grids bit-for-bit (era-keyed
  blocking set, membership-only reads). CANOPY is contract-not-code:
  crowns live on a render-only overlay and never appear in the artifact
  prop grid; trunks keep blocking. The moss rung is untouched — ANY
  prop, carpet included, keeps moss solid (upstream buildWalkability is
  byte-unchanged 72→77; verified in the b77 commit). Four new synthetic
  units pin walk-at-77/block-at-72, carpet-never-forces-walking, solid +
  canopy-trunk blocking, and the moss any-prop rule.
- **Release verified per doc 18** before any use: zipSha256
  `c9083012…` ✓, manifestSha256 `5166341a…` ✓, all 8 per-file hashes ✓,
  tag targets sourceCommit `1a20bd22…` ✓, behavior 77, flood 46493,
  spawn (109, 182), tileforge pin `dusk-9b8b2a2-seed103991` (the same
  package the game bundles).
- **Fixtures:** dust-hollow + tiny-temperate regenerated at `1a20bd2`
  (scratch archive build; WorldForge checkout verified clean after).
  **fen-hollow CANNOT re-pin and stays at b72/`bbc10cdb`:** the b75
  route re-plan left its landmark gate at (11, 12) unreachable and
  upstream's own export refuses the world ("generation FAILED");
  fen-hollow is no longer in WorldForge's regen-verified fixture set
  (only small-cold-coastal + tiny-temperate are). The mixed-era roster
  is deliberate — fen is the frozen format-1 world and the pre-carpet
  regression pin (fixtures/README.md has the full note). Coverage
  re-recorded after review (dust prop_block 495→436 = exactly its 59
  debris cells; trail_walk 120→86 = the b75 re-plan; moss unchanged).
  Golden re-recorded via updateGolden — kernel.json byte-identical, all
  payload diffs are exactly `directorBehaviorVersion` 14→15 (fen's
  world bytes unchanged, so placements/territories are stable).
  `prop.loot_pile` occurs in no committed fixture (1 cell in the whole
  overworld) — synthetic units cover it.
- **outputs/local-packs/**: `wildshot-overworld-pack-dusk` replaced
  b72→b77 (derived flood 46493 = manifest, 101 moss cells, 3 crossing
  cells); `small-cold-coastal` (b65) UNTOUCHED and still parity-green —
  the era gate is what keeps both true at once.
- **Parallel note (planning):** the designer's b77 navigation walk
  (sl-0067) runs independently; if it fires another conversion round it
  lands as its own small follow-up adoption — the rehearsal is NOT
  serialized behind it.

## 1j. Dusk rehearsal rounds 1–5 (2026-08-01, LIVE — sl-0041 + sl-0073; the dusk map IS the game's test slice, designer-confirmed in-round)

Recipe: `recipes/dusk-overworld-direction.json` (the new committed home
for real direction recipes), pinned to dusk@b77 identity `bd4b9317…`,
seed 109182. Every round: 9/9 gates PASS; export NOT run (gated on the
designer's approval; publishes a release when it happens).

- **Round 1** (draft): quantile bands, 3 endgame pockets, floors
  s320/r300/d320, worldBossCount 3 → 3/3 bosses, 10 dungeons, 57
  encounters, 88 territories. Designer asked for a settlement overlay
  (renders don't draw cities) and legend PDFs (produced in-session,
  scratch only).
- **Round 2** ("so very square"): watershed subdivision replaces
  midline bisection (behavior 16, analysis 4 — organic seams, the
  recorded b12 polish); recipe bandCount 5→7. Version-stamp split
  (ANALYSIS_VERSION left at 3) caught and fixed in-session — the
  constant now derives from RULE_PACK_VERSIONS (`404822c`).
- **Round 3** ("doesn't follow the zones"): diagnosed with numbers — a
  third of walkable ground is band 0 and 15/20 of its wilderness
  borders jumped ≥3 bands; band 0 now renders pale neutral (town land,
  not a ramp rung). The model question went to planning.
- **Round 4** (sl-0073 ruling: safety radiates from EVERY settlement):
  behavior 17, plan 6 — opt-in danger.settlementRelief{Reach,Depth}
  Permille subtract tier-scaled (recorded-radius-scaled) linear-fade
  belts from the spawn-distance field before bands rank; overlaps take
  max never sum; both-0 fallback byte-identical (tested). Dusk at
  3000/250.
- **Round 5** (designer sketch: "4 zones depending on the geography"):
  behavior 18, plan 7 — opt-in zones.count clusters fine regions into
  K geography-following macro-zones (heaviest same-biome-family
  components of the region graph seed cores; graph-BFS join; honest
  zone_shortfall waiver). Dusk at 4: green country 30.9k / wetlands
  10.1k / dry SW 9.7k / snow country 8.0k. **Designer: "something like
  this will be easier to work out from"** — zones are the working
  frame. New zones.png render; fine regions stay the solver unit.

- **Round 6** ("this doesn't fit with our new zones at all"): behavior
  19, plan 8 — danger.assignment "zonal": the spawn's zone is always
  chapter one (a wilderness median mismeasures the safe-eaten home
  zone — caught live when Green Country ranked 5-6), remaining zones
  rank by weighted-median distance, bands split into contiguous
  per-zone windows, each zone runs its own quantile ramp. Dusk at
  bandCount 9: Green [1,2] → Dry Reach [3,4] → Wetlands [5,6] → Snow
  Country [7,8].
- **Round 7** ("reduce the safe zones on towns where we can"):
  behavior 20 — safety.{city,town,outpost}RadiusPermille scale
  sanctuaries, floored at each settlement's built-up radius; the
  effective mask feeds every recipe-bearing phase + G1/G3 via one cli
  helper (rule packs plan 9 / placement 7 / territory 5 / validate 4);
  relief belts stay on recorded radius. Dusk at 800/600/500: band-0
  22.6k → 17.2k cells, encounters 62, territories 94.

Round 7 verdict (designer, 2026-08-01): **"ye this works"** — the
sanctuary reduction and the round-7 danger + placements state are
APPROVED. OPEN when resuming: the SNOW COUNTRY boss question (the
endgame chapter has no boss — road floor; per-zone allocation or an
eased floor are the candidate fixes; the designer has not ruled);
territories carry no explicit verdict but no objection either; then
any lock rounds the designer wants; then the gated export (a release
pinning b77). The game consumes that pack AS REFERENCE ONLY (docs/20
step 1) — it is the test slice's authoring reference, not an import.

## 2. Then: the game-side importer (PREPARED 2026-07-29, awaiting the user's plan)

F8 shipped (§1b) and the first arc is closed, so the next milestone is
`worldfiller_importer`. Read **docs/IMPORTER_READINESS.md** — it carries
the full prep: the game CODE repo is `tilok1234/Wildshot-Adventures`
(Godot 4.6.2 pinned — the exact engine our GDScript proof runs on; the
`Wildshot_adventures_pmanning` repo in this session is only the
read-only planning/design authority), the game's own forge-integration
pattern and its prep-half/consumption-half sequencing precedent, the
proposed addon shape, and the decision points the user will rule on.
User instruction (2026-07-29): "dont do any changes to wildshot repo
yet... tell me when you are ready for it and i will plan it out from
there" — readiness was announced; make NO game-repo changes until the
user's planning session scopes and schedules them.

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

## 3b. Resuming from a fresh environment (phone / cloud / another machine)

Everything needed to continue lives in this repo + GitHub releases —
machine-local assistant memory is NOT required (this file is the
tiebreaker over it, per line 3):

1. Clone `tilok1234/world_filler`, branch `main`. Node >= 24.15.
2. `npm install && npm test` — expect **191 green** on a clean clone
   (the two local-pack parity lanes only run when `outputs/local-packs/`
   exists; the Godot lane self-skips without a binary; both are
   optional).
3. To restore the full-scale lanes (optional): download releases
   `small-cold-coastal-pack-dusk@b65` and
   `wildshot-overworld-pack-dusk@b77` from `tilok1234/WorldForge`,
   verify each zip's sha256 against its release notes, unzip into
   `outputs/local-packs/small-cold-coastal` and
   `outputs/local-packs/wildshot-overworld-pack-dusk` (fixtures/README
   has the exact steps) — then `npm test` runs 193.
4. `gh` auth (repo scope) is needed only for release downloads and for
   publish-gated `wf-fill export`; neither is needed to build, test, or
   direct content locally (`WORLD_FILLER_DEV_EXPORT=1` for dev export).
5. Cross-repo duties (sync-log append at session end) need the planning
   repo `Wildshot_adventure_final_planning` on disk; if it is absent in
   your environment, record the pending entry in the handoff instead
   and flag it — do not skip it silently.

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
  WorldForge commit `bbc10cdb`, behavior 72 since the sl-0039 adoption —
  provenance sidecars in fixtures/provenance/). The canonical 256²
  `small-cold-coastal` pack is NOT committed (31 MB): IMPORT the
  released `small-cold-coastal-pack-dusk@b65` per `fixtures/README.md`
  into `outputs/local-packs/` (parity tests auto-pick it up; regen from
  the release's sourceCommit only if an import fails parity, and record
  why).
- Official Godot 4.6.2 Linux zip downloads and runs headless in this
  container (godotengine GitHub releases) — used for the GDScript
  consumption proof and the freeze-review refusal battery.
- Upstream behavior bumps move walkable cells (flood history
  33845→33893; dusk pack 45202→46493 at b77). The parity suite + pinned
  `fixtures/expected-coverage.json` are the tripwires; adopting a new
  upstream base = regenerate fixtures + re-record coverage + note it in
  the commit, an explicit logged decision. The ladder is era-keyed on
  each world's recorded generatorBehaviorVersion, so multi-era packs
  coexist (b65 canonical + b77 fixtures both parity-green).

## 5. Standing user preferences (confirmed in-session)

- world_filler is a separate isolated repo; WorldForge is read-only
  reference. Never mix. (Re-confirmed this session: "we are only gonna
  work in the repo world_filler, the two others are only for
  reference".)
- Standing permission to commit and push to world_filler (this branch).
- Ultracode swarms: user opts in per-turn, wants them for hard
  review/audit milestones, **max 8 agents concurrent**. (The freeze
  review resolution ran solo — no opt-in was given this session.)
- Verdict loop: send upscaled renders for visual approval — structural
  success ≠ design approval (AGENTS.md). All verdict threads through
  behavior 12 are CLOSED APPROVED (§1, §1b, §1d); new design changes
  reopen the loop.
- Reply style: short and relevant, minimal images ("this is pretty
  heavy material and images for me").

## 6. Versions

director behavior **18** · rule packs: analysis 4, plan 7, placement 6,
territory 4, validate 3, export 3 · recipe format 1 · plan/report
formats 1, placements format 2 · content pack format 3 current
(format 2 + optional manifest sourceCommit from gated exports),
formats 1–2 **frozen** (1 FINAL), readers accept {1, 2, 3} · supported
upstream: artifact format 8, game pack 1, walkability 1 (ladder tables
transcribed @ behavior 77, commit `1a20bd2` — sl-0041 re-pin adoption;
era-keyed so behavior-65/72 worlds reproduce their grids).
Bump doctrine in `src/core/version.ts` + AGENTS.md (append-only
vocabularies; sequential bumps; stamp everything).

## 7. Commands

    export PATH=/opt/nvm/versions/node/v24.18.0/bin:$PATH
    npm test            # build + 193 tests (191 on a clean clone — §3b)
    node dist/src/cli.js help                  # all verbs
    node dist/src/cli.js validate fixtures/packs/fen-hollow fixtures/recipes/basic-direction.json
    node dist/src/cli.js export   fixtures/packs/fen-hollow fixtures/recipes/basic-direction.json
    node dist/src/cli.js verify-pack fixtures/packs/fen-hollow outputs/export/fen-hollow-basic-direction-content
    godot --headless --script consumers/godot-proof/verify_content_pack.gd -- <world-pack> <content-pack>
