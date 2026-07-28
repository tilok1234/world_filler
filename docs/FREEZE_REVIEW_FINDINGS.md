# F7 freeze review — RESOLVED (2026-07-28)

Status: **RESOLVED.** Every finding was verified empirically (tamper
experiments against both reference verifiers — 17 module-level cases, 7
Godot-lane cases — plus code inspection for the doc-shape claims), every
fix landed, and the missing fifth lens (importer buildability) ran against
the rewritten doc. **All 38 findings CONFIRMED, zero refuted** — the
interrupted review's claims were accurate without exception. Content pack
format 1 is now FINAL.

## Resolution summary (by deduplicated cluster)

The 38 findings collapse into 13 distinct defects; every one confirmed and
fixed. A pack exported by the pre-fix build is byte-identical to one from
the post-fix build (verified by direct comparison), so the freeze needed no
version bump: every fix is refusal-side, verifier-side, or documentation.

- **A. report.json .ok never checked** (1, 2, 8, 20 — the critical
  cluster): confirmed — an ok:false pack passed both verifiers. Both now
  parse report.json from hash-verified bytes and refuse unless
  reportFormat 1 and ok true. Tests: `tests/freezeReview.test.ts`.
- **B. files table completeness unspecified/unchecked** (2, 3, 4, 10):
  confirmed — `"files": {}` with tampered payload verified; a
  `../outside.json` key was followed out of the pack. Both verifiers now
  require exactly the four payload names and parse the same bytes they
  hashed; the doc states the exact-four rule normatively.
- **C. Row-crossing runs: TS wrapped, GD refused** (5, 15, 19, 24):
  confirmed — identical bytes passed TS and failed Godot. `decodeRuns` now
  throws on x<0, y<0, length<1, x+length>width; both verifiers refuse by
  name; the doc makes the reader rule normative.
- **D. GDScript verifier gaps + crash/hang paths** (6, 15, 19, 21, 22, 23,
  25): all confirmed — no anchor check, no cellCount check, no base
  dims/format check, packFormat int() coercion accepted 1.9, and a null
  arenaOrigin hung the process forever (timeout, no exit code). The
  GDScript was rewritten as a full check-for-check mirror: every malformed
  input is a named refusal through a single `_verify() -> String` path
  that always exits; base64 grid length validated.
- **E. Obligation-5 enums unenforced** (7, 9, 26, 34, 37): confirmed —
  unknown rule/encoding/payload-format values all passed. Both verifiers
  now refuse unknown placement.rule, cells.encoding, respawnPressure, and
  non-1 payload format numbers.
- **F. Doc shape elisions and ambiguities** (11, 12, 14, 29, 33, 38):
  confirmed by inspection. The doc now enumerates the shapes of
  failures[], unboundAnchors[], lockReport[], coverage, content-plan.json,
  and report.json; declares the closed-enum set vs open vocabularies;
  marks explanation data inspection-only; declares ids opaque with the
  guaranteed prefix/suffix structure; states manifest.json is canonical
  JSON; documents locked-placement sentinels and inSafeZone semantics.
- **G. Lock ids bypass the frozen id scheme** (13, 28): confirmed —
  `"placement.myboss"` shipped in a fully audited strict export.
  `normalizeRecipe` now requires lock ids to match
  `placement.<rule-tag>.<regionId>.<slot>` with rule/regionId agreement;
  fresh boss slots consult held lock ids (dungeon-pass symmetry).
- **H. buildContentPack trusted a caller-supplied report** (16): confirmed
  — a passing report auditing a different recipe authorized an export.
  buildContentPack now refuses unless recipe hash, base identity, behavior
  version, analysis version, and rule packs agree across all five inputs.
- **I. Non-atomic in-place export writes** (17): confirmed by code
  structure. writeContentPack now stages into `<outDir>/.staging` and
  commits by rename with manifest.json strictly last; the doc states the
  manifest-is-the-commit-record rule.
- **J. Non-strict export accepted stale pins** (18, 27, 36): confirmed —
  default export shipped a pack from a recipe pinned to a different world
  while plan/place/territories refused it. export and validate now perform
  the same unconditional pre-flight pin refusal; the doc documents which
  gates are strict-only.
- **K. coverage totals exclude zero-budget regions** (31): confirmed —
  fen-hollow: 130 plan regions (1960 hostile cells) vs 6 coverage rows
  (1649). Resolved as documentation: coverage is normatively
  budgeted-regions-only; world denominators come from content-plan.json.
- **L. No golden pack fixture** (32): confirmed. `fixtures/golden/
  content-pack/` now pins the full five-file frozen serialization,
  byte-asserted in tests; re-record via `node dist/tools/recordGoldenPack.js`
  (an explicit, logged decision).
- **M. Guard gaps + flag typos become out-dirs** (35): confirmed — the
  experiment literally created a `--stric/` report directory in the repo
  root. consumers/, dist/, node_modules/ are now protected; unknown flags
  are refusals.

Fifth lens (importer buildability, run 2026-07-28 against the rewritten
doc): three residual gaps found and folded in — `world`/`adapter` declared
advisory provenance (the only un-cross-checked manifest fields), and
`seedCell`/`packSize` glossed. The doc + verifiers now answer every
question a second implementer needs; the sufficiency claim in the doc
header is re-asserted with the verifiers actually agreeing.

Post-fix evidence: 134 tests green (was 114); a 20-case cross-verifier
battery confirms both lanes pass the honest pack and refuse all 19 tamper
classes with aligned named refusals and no hangs; the strict dual
consumption proof (TS + headless Godot 4.6.2) is green on fen-hollow and
dust-hollow.

---

The original raw findings follow, unedited, as the review record.
Findings: 38 raw, sorted by claimed severity.

## 1. [critical] Neither reference verifier enforces importer obligation 4: report.json .ok == true

- file: /home/user/world_filler/src/consume/verifyPack.ts  (lens: unknown-lens)
- claim: docs/CONTENT_PACK_FORMAT.md lines 67-81 says an importer MUST (step 4) 'Require report.json .ok == true (the pack was audited; a hand-built pack without a passing report is not a valid pack)', and the doc's header claims the two reference verifiers are sufficient to build an importer. Neither verifier ever opens report.json: verifyPack.ts reads only manifest.json, placements.json, and territories.json (grep for 'report' or '.ok' in src/consume returns nothing), and verify_content_pack.gd likewise never touches report.json. The 'wf-fill verify-pack' verb therefore prints OK for a pack whose report says "ok": false — or whose report.json is entirely absent (see the files-completeness finding). Every doc guarantee beyond per-cell walkability — territory disjointness, safe-zone and exclusion-radius avoidance (doc lines 146-150), budget accounting — is established only by that audit, so both blessed reference implementations silently drop all of them for hand-built packs, and any importer written by copying them (the doc's stated intent) inherits the hole permanently.
- evidence: verifyPack.ts lines 13-22 docstring: 'everything a game-side importer must check' — yet the function body (lines 48-152) contains no reference to report.json or ok. verify_content_pack.gd reads manifest.json, world manifest, walkability.json, placements.json, territories.json only. tests/export.test.ts tampers placements.json bytes and mismatched worlds but never a false report. Contrast: the project's own world-pack reader src/pack/readPack.ts lines 133-136 DOES enforce the mirrored upstream rule (validation-report.json status == "pass", per /home/user/WorldForge/docs/GAME_INTEGRATION_PLAN.md section 3.3a), proving the pattern was known and omitted only on the content-pack side.
- suggested fix: In verifyContentPack: read report.json (after hash verification), require reportFormat == 1 and ok === true, refusing otherwise; add the same ~5 lines to verify_content_pack.gd; add a test that flips ok to false (and one that deletes report.json) and asserts both verifiers refuse. This is a verifier-side addition, not a format change, so it is still legal post-freeze — but it must land before external importers copy the reference.

## 2. [critical] Reference verifiers never perform blessed check #4 (report.json .ok) and do not pin the files table, so hand-built or failing-audit packs pass the consumption proof

- file: src/consume/verifyPack.ts  (lens: unknown-lens)
- claim: docs/CONTENT_PACK_FORMAT.md 'Importer obligations' #4 says an importer MUST require report.json .ok == true ('a hand-built pack without a passing report is not a valid pack'), and the doc claims the two reference verifiers plus the doc are sufficient to build an importer. Neither reference verifier ever opens report.json, and neither requires the files table to contain the four payload files. A pack whose report.json has ok:false — or that omits report.json and content-plan.json entirely, or ships "files": {} for zero hash coverage — passes verifyContentPack and `wf-fill verify-pack` prints OK.
- evidence: grep for 'report' in src/consume/verifyPack.ts and consumers/godot-proof/verify_content_pack.gd returns zero matches. verifyPack.ts:58-71 hash-checks only Object.entries(manifest.files) (an empty {} table passes trivially; only files===undefined throws), then reads placements.json (line 100) and territories.json (line 128) directly by name without requiring they be listed/hashed; report.json and content-plan.json are never read. Contrast the world-pack side: src/pack/readPack.ts:133-136 refuses a world pack whose validation-report status is not 'pass'. tests/export.test.ts:59-63 pins the exact four-name table on the EXPORTER side only; no test covers the verifier accepting a short table. So 
- suggested fix: In both verifiers (verifyPack.ts and verify_content_pack.gd): (1) require manifest.files to contain exactly {content-plan.json, placements.json, report.json, territories.json}; (2) after hash verification, parse report.json and refuse unless reportFormat == 1 and ok === true. Add adversarial tests (ok:false report; missing report.json; empty files table). This is verifier-side tightening — freeze-safe, but it must land before importers are written from the current permissive references.

## 3. [critical] manifest.files completeness is unspecified and unchecked; verifier consumes unlisted payloads unverified

- file: /home/user/world_filler/src/consume/verifyPack.ts  (lens: unknown-lens)
- claim: Neither the frozen spec nor either reference verifier requires manifest.files to list the four payload files, so hash verification is vacuous against a pruned table, and verifyPack.ts then reads placements.json and territories.json regardless of whether they were listed — consuming unverified bytes.
- evidence: Confirmed empirically: a copy of a real export with manifest.files set to {} and a whitespace-tampered placements.json passes verifyContentPack() and returns a normal summary. verifyPack.ts:60-71 iterates only Object.entries(files), then lines 100 and 128 readJson placements.json/territories.json unconditionally. verify_content_pack.gd:52-54 has the same shape (iterates listed names, then reads placements/territories at lines 71 and 88 regardless). docs/CONTENT_PACK_FORMAT.md obligation 2 says only 'Hash-verify every entry in files' — it never requires the entries to exist, so a second implementer hard-coding the four names (as the layout section implies) and the reference implementation (dy
- suggested fix: Before the freeze, add to the spec: 'files MUST contain exactly content-plan.json, placements.json, report.json, territories.json' (importer refuses missing or extra names), and make both verifiers refuse a files table missing any of the four. In verifyPack.ts, verify the hash of the same bytes that are subsequently parsed (or refuse payloads not present in the table). Add a tripping test for the empty-table case.

## 4. [major] manifest.files completeness never required: empty or truncated files table passes, and verifyPack trusts unhashed payload

- file: /home/user/world_filler/src/consume/verifyPack.ts  (lens: unknown-lens)
- claim: Obligation 2 ('Hash-verify every entry in files against the payload bytes') is vacuously satisfiable. Neither the doc nor either verifier requires the files table to contain the four payload names the layout mandates (content-plan.json, placements.json, report.json, territories.json). verifyPack.ts lines 58-71 iterates only over whatever entries exist; lines 100 and 128 then readJson placements.json and territories.json directly from disk regardless of whether they appeared in the table. A hand-edited pack with "files": {} (or with placements.json removed from the table and its bytes altered) passes hash verification and has its unverified placements/territories content fully trusted; content-plan.json and report.json can be deleted outright and nothing notices. verify_content_pack.gd has the same hole. Second implementers will resolve this differently (some pinning the four names, some not), and the upstream doctrine being mirrored explicitly pins its list ('manifest.files lists the 8 payload files', GAME_INTEGRATION_PLAN.md section 3.3a) while the content-pack doc has no equivalent normative sentence.
- evidence: verifyPack.ts line 60: for (const [name, expected] of Object.entries(files)) — no required-name set; line 100: const placements = readJson(contentPackDir, "placements.json") — unconditional read decoupled from the hash loop. tests/export.test.ts lines 59-63 asserts the exporter EMITS exactly the four names but no test feeds the verifier a truncated table. docs/CONTENT_PACK_FORMAT.md lines 22-30 lists the four files, lines 74-75 states obligation 2, but no sentence says the table MUST list them.
- suggested fix: Add a normative sentence to the doc ('manifest.files MUST contain exactly content-plan.json, placements.json, report.json, territories.json') and make both verifiers refuse when any of the four names is missing from the table; have verifyPack parse placements/territories from the same bytes it hashed.

## 5. [major] Reference verifiers return opposite verdicts on a row-crossing territory run; the 'never crossing rows' invariant is unenforced

- file: /home/user/world_filler/src/territory/territory.ts  (lens: unknown-lens)
- claim: docs/CONTENT_PACK_FORMAT.md line 134 freezes runs as '[x, y, length], never crossing rows', but neither verifier checks x + length <= width, and the two blessed implementations disagree on what a violating pack means. TS decodeRuns (territory.ts lines 106-112) computes cells.add(y * width + x + i), so a run past the row end silently WRAPS into row y+1; verifyPack.ts then walkability-checks the wrapped cells and accepts the pack if they happen to be walkable (cellCount also matches since it counts the wrapped set). The GDScript (verify_content_pack.gd lines 91-96) instead computes x = int(run[0]) + i, hits the x >= width bounds guard in _walkable, and REFUSES with 'territory cell is not walkable'. Identical bytes: PASS under one reference verifier, FAIL under the other. That is exactly the contract ambiguity a second implementer resolves arbitrarily, frozen into format 1.
- evidence: decodeRuns: 'for (let i = 0; i < length; i += 1) cells.add(y * width + x + i)' — no row-end clamp or error. verifyPack.ts line 131 feeds its output straight to walkability checks. verify_content_pack.gd line 93: _walkable(grid, width, height, int(run[0]) + i, int(run[1])) with the x >= width branch returning false (line 105-106). The exporter's encodeRuns (territory.ts lines 86-104) never emits such runs, so only hand-built/tampered packs hit the divergence — precisely the packs verifiers exist for.
- suggested fix: Declare row-crossing runs invalid in the doc as a named refusal, make decodeRuns (or verifyPack) throw when x + length > width, and keep the GDScript's refusal — aligning both verifiers on refuse.

## 6. [major] GDScript verifier omits checks the TS verifier performs despite claiming to mirror it

- file: /home/user/world_filler/consumers/godot-proof/verify_content_pack.gd  (lens: unknown-lens)
- claim: The script header (lines 6-11) claims it 'Mirrors src/consume/verifyPack.ts', and the doc (lines 5-8, 84-86) presents both verifiers as equivalent references sufficient for an importer. The GDScript omits: (1) the dungeon_binding.v1 anchor-POI cross-check — verifyPack.ts lines 117-125 refuses when the bound poi id does not exist in the world pack or its cell moved; the GDScript has no dungeon branch at all, so 'The reference verifiers re-check every placement ... against it' is false for dungeon placements; (2) the territory cellCount-vs-decoded-runs check (verifyPack.ts lines 131-134); (3) the base.artifactFormat/width/height cross-check against the world pack (verifyPack.ts lines 88-91). It also has crash-not-refusal paths a clean importer must not copy: a world_boss placement with null arenaOrigin/arenaSide triggers a typed-assignment script error (line 79) instead of the TS verifier's named 'carries no arena' refusal, a top-level JSON array or null-typed manifest crashes at line 48, and int(manifest.get("packFormat", -1)) at line 49 coerces malformed values ('1', 1.9) to 1 where the TS strict-equality refuses.
- evidence: verify_content_pack.gd lines 71-96: only accessCell walkability and the world_boss arena loop; no poi lookup, no cellCount comparison, no dims/format check. verifyPack.ts performs all three. A pack whose dungeon placement binds a nonexistent anchorPoiId, or whose cellCount lies, passes the Godot proof and fails the TS one — a second cross-implementation divergence in the frozen references.
- suggested fix: Port the three missing checks into the GDScript (world.json pois are already on disk beside walkability.json), replace the crash paths with _fail refusals, and compare packFormat without lossy int() coercion (reject non-integral values).

## 7. [major] Importer obligation 5 (unknown ids/enum values are errors, never defaults) has no reference implementation

- file: /home/user/world_filler/src/consume/verifyPack.ts  (lens: unknown-lens)
- claim: docs/CONTENT_PACK_FORMAT.md line 81 mandates: 'Treat unknown ids and enum values as errors, never as defaults.' Both reference verifiers do the opposite — they skip. verifyPack.ts lines 105 and 117 gate the arena and anchor checks on rule === "world_boss.v1" / "dungeon_binding.v1"; a placement with rule "anything_else.v9" is silently accepted after only an accessCell check. Both verifiers decode territory.cells.runs without ever reading cells.encoding (verifyPack.ts line 131, .gd line 91), so an unknown encoding value is silently misinterpreted as runs rather than refused; respawnPressure is likewise never validated against low|medium|high. Since the doc says importers should be built from these verifiers without reading other worldfiller source, implementers will copy the tolerant behavior and ship exactly the default-accepting importers the frozen spec forbids — defeating the append-only versioning story that obligation 5 exists to protect.
- evidence: verifyPack.ts loop lines 101-126: no else-branch refusing an unrecognized placement.rule; line 131: decodeRuns(territory.cells.runs, width) with cells.encoding unread. verify_content_pack.gd line 78: if placement["rule"] == "world_boss.v1" with no other branch; line 91 reads ["cells"]["runs"] directly. No test exercises an unknown rule or encoding through either verifier.
- suggested fix: Add explicit refusals to both verifiers: unknown placement.rule -> error; cells.encoding !== "runs" -> error; optionally respawnPressure outside the enum -> error. Add doc wording that these are the format-1 closed enums.

## 8. [major] Neither reference verifier performs importer obligation 4: report.json .ok is never checked (nor is report.json required to exist)

- file: /home/user/world_filler/src/consume/verifyPack.ts  (lens: unknown-lens)
- claim: docs/CONTENT_PACK_FORMAT.md line 79-81 makes 'Require report.json .ok == true' a MUST, explicitly to reject hand-built packs, and verifyPack.ts's header (lines 14-22) claims to implement 'everything a game-side importer must check'. Neither verifyPack.ts nor consumers/godot-proof/verify_content_pack.gd ever opens report.json: grep for 'report' in verifyPack.ts returns zero hits; the .gd reads only manifest.json, walkability.json, placements.json, territories.json. A pack whose report.json says ok:false — or a hand-built pack with no report.json at all, if the manifest.files table omits it — passes both reference verifiers and the CLI verify-pack verb.
- evidence: verifyPack.ts readJson calls are only at lines 49 (manifest.json), 100 (placements.json), 128 (territories.json). verify_content_pack.gd _read_json calls at lines 48, 57, 66, 71, 88 cover the same set. tests/export.test.ts has no ok:false verifier case. The doc (lines 3-8) states the doc plus these two verifiers 'are sufficient to build a game-side importer' — so the game addon will be cloned from implementations missing the doc's own anti-hand-built defense.
- suggested fix: In both verifiers: readJson('report.json'), require it hash-listed and ok === true, refuse otherwise. Add a tamper test (flip ok to false, rebuild manifest hash, expect refusal).

## 9. [major] Obligation 5 (unknown ids/enum values are errors, never defaults) is implemented by neither reference verifier: unknown placement.rule and cells.encoding are silently tolerated, payload format numbers unchecked

- file: /home/user/world_filler/src/consume/verifyPack.ts  (lens: unknown-lens)
- claim: The doc mandates 'Treat unknown ids and enum values as errors, never as defaults' (line 81), but verifyPack.ts lines 105 and 117 are independent if-blocks — a placement with rule 'miniboss.v1' gets only an access-cell walkability check and is counted as verified. territory.cells.encoding is never compared to 'runs' (line 131 decodes runs unconditionally; a different encoding crashes with a raw TypeError instead of a named VerifyError). placementsFormat/territoriesFormat inside the hashed payloads are never checked either (the CLI explain/lock verbs check placementsFormat, the reference importer does not). verify_content_pack.gd has the identical fallthrough (line 78 checks only world_boss.v1).
- evidence: This is precisely the freeze-hostile failure mode for the named future milestones: when miniboss/encounter-site/landmark-binding rules land, packs carrying new rule values will be reported 'verified OK' by these format-1 reference verifiers, while a spec-faithful importer refuses — the two blessed sources of truth (doc obligations vs reference code) resolve the closed-world question in opposite directions.
- suggested fix: In both verifiers: refuse any placement.rule outside the format-1 set, require cells.encoding === 'runs', and require placementsFormat === 1 / territoriesFormat === 1 before iterating.

## 10. [major] manifest.files completeness is unenforced and unspecified: payloads are loaded and trusted even when absent from the hash table

- file: /home/user/world_filler/src/consume/verifyPack.ts  (lens: unknown-lens)
- claim: verifyPack.ts lines 60-71 hash-verify only the entries the manifest chooses to list, then lines 100/128 read placements.json and territories.json unconditionally. A hand-built manifest whose files table lists only content-plan.json produces a pack whose placements and territories are consumed completely unhashed (and report.json untouched — compounding the .ok gap) yet 'verifies'. The doc's obligation 2 ('Hash-verify every entry in files') is satisfied vacuously; the required key set of files is conveyed only by example (lines 58-63), so a second implementer must guess whether fewer/extra entries are legal. Nothing constrains keys to bare payload names either — a files entry like '../outside.json' is followed out of the pack directory by join() in both verifiers.
- evidence: tests/export.test.ts line 59-63 asserts the four keys for a freshly built pack, but no verifier-side check exists; verify_content_pack.gd lines 52-54 and 71/88 have the same structure. The manifest example plus 'Hash-verify every entry' is a contract two implementers will read differently (exact-four-required vs verify-what's-listed).
- suggested fix: Doc: state that files MUST contain exactly content-plan.json, placements.json, report.json, territories.json in format 1 (later formats may append names) and that keys are bare file names. Verifiers: require those four names present before hashing and reject path separators in keys.

## 11. [major] The frozen spec elides the shape of a large fraction of the hashed payload and never states whether importers may rely on explanation data

- file: /home/user/world_filler/docs/CONTENT_PACK_FORMAT.md  (lens: unknown-lens)
- claim: CONTENT_PACK_FORMAT.md line 112 shows scoreTerms/candidateFunnel/topCandidates as '[...]  // explanation data' and lines 90-91/122-124 name failures[], unboundAnchors[], lockReport[], coverage, and the payload 'version identity'/'base' blocks without defining a single field of them; content-plan.json and report.json get prose only (lines 152-159). These are all hashed payload whose 'field names never change shape' per the freeze header, so by default the solver-internal explanation model (ScoreTerm {term, value, weightPermille, contribution}, CandidateFunnel {stage, remaining}, topCandidates {cell, score} — solver.ts lines 46-77) is frozen into the consumer contract: a future non-linear scoring model cannot change what 'contribution'/'weightPermille' mean without repurposing. Simultaneously, the F7 exit criterion (ROADMAP: 'pack format v1 documented well enough that the future game-side importer can be written from the doc alone') is unmet for these fields — a second implementer cannot even know the top-level key set of placements.json from the doc.
- evidence: Doc line 3-8 claims doc+verifiers suffice without reading other source, yet the shapes live only in src/place/solver.ts, src/territory/territory.ts (RegionCoverage lines 53-60), src/plan/plan.ts (RegionPlan lines 21-41), src/validate/validate.ts (GateResult lines 23-28). The verifiers never touch these fields, so they carry no shape information either.
- suggested fix: Before freezing, either (a) enumerate every serialized field of all four payloads in the doc, or (b) add an explicit reliance clause: 'scoreTerms, candidateFunnel, topCandidates, failures[].message and other explanation/diagnostic members are inspection data; importers MUST NOT depend on their contents or element shapes' — option (b) also keeps the explanation model evolvable, answering whether it was wise to freeze it at all.

## 12. [major] Obligation 5's enum scope is undefined: diagnostic vocabularies grow with behavior versions inside packFormat 1, yet the blanket rule orders importers to hard-error on unknown values

- file: /home/user/world_filler/docs/CONTENT_PACK_FORMAT.md  (lens: unknown-lens)
- claim: The doc never says which fields are the closed enums obligation 5 refers to. candidateFunnel stage strings, failures[].reason, unboundAnchors[].reason, lockReport reasons, and plan waiver strings are behavior-versioned vocabularies that legitimately gain values under a DIRECTOR_BEHAVIOR_VERSION bump while packFormat stays 1 — the repo already demonstrates this: the checked-in behavior-2 output outputs/place/fen-hollow-basic-direction/placements.json has a 6-stage boss funnel with no 'paint_no_content' stage, while current behavior-5 code (solver.ts lines 483-491) emits 7 stages. A spec-faithful importer applying obligation 5 to those fields refuses a newer-behavior format-1 pack; a lax importer accepts it. Two implementers are guaranteed to resolve this differently, and after the freeze the wording cannot be tightened without breaking someone.
- evidence: unboundAnchors reason set already has 6 values (solver.ts lines 108-114) and every named future milestone (landmark bindings, encounter sites, minibosses) adds reasons/stages; none of those should force a packFormat bump since they are values, not field shapes.
- suggested fix: Enumerate the closed, format-frozen enums (placement.rule, cells.encoding, respawnPressure, report gate status, lockReport status) and declare all other string vocabularies (stages, reasons, waivers, enemyId, anchorPoiType) open/behavior-versioned, exempt from obligation 5's refusal rule.

## 13. [major] Recipe lock ids bypass the frozen placement id scheme and are emitted verbatim into the pack

- file: /home/user/world_filler/src/recipe/schema.ts  (lens: unknown-lens)
- claim: normalizeRecipe validates a lock id only as startsWith('placement.') (schema.ts lines 434-436); solvePlacements emits it unchanged (solver.ts line 696 'id: lock.id'). No gate checks id grammar (G1 checks only duplicates and geometry). So a format-1 pack can ship ids like 'placement.myboss' or an id whose embedded rule/region/slot contradict the row's actual rule/regionId fields (e.g. id 'placement.world_boss.R.0' with rule 'dungeon_binding.v1') — violating the documented id scheme 'placement.world_boss.<regionId>.<slot>' the freeze declares immutable. Collisions are only backstopped late: fresh dungeon ids consult heldIds (solver.ts line 309) but fresh boss ids never do (line 514), so a dungeon-rule lock whose id happens to be 'placement.world_boss.<R>.0' collides with the fresh boss and surfaces as a confusing G1 duplicate-id export refusal rather than a recipe error.
- evidence: The doc says a game keys its runtime deltas by placement id (lines 116-119); once a scheme-violating id ships in someone's pack and save files, it is permanent.
- suggested fix: At normalization, require lock ids to match the full grammar and to agree with the lock's rule and regionId; add the boss-side taken-id consult for symmetry.

## 14. [major] Placement/territory id grammar is ambiguous to parse (regionId embeds dots) and the region id scheme is documented nowhere in the frozen spec

- file: /home/user/world_filler/docs/CONTENT_PACK_FORMAT.md  (lens: unknown-lens)
- claim: Ids like 'placement.dungeon.region.mud.1245.0' interleave a dotted regionId ('region.mud.1245') into a dot-delimited scheme. The regionId grammar region.<biome-short>.<anchorIndex> exists only in src/analysis/regions.ts (line 115), not in the frozen doc, and <biome-short> is derived from the upstream material vocabulary by stripping one 'terrain.'/'water.' prefix — worldfiller does not control whether future upstream material names contain further dots. The doc freezes 'id schemes' without defining them and never tells importers that ids are opaque and that regionId/slot must be read from the explicit fields, so a second implementer writing split('.') parsing (natural for slot extraction or delta keying) builds a parser that the id scheme cannot guarantee.
- evidence: Doc line 98 shows the id with placeholder 'placement.dungeon.<regionId>.<slot>' but no statement of regionId's own shape, dot-count, or an opacity rule; the parseable-only-with-extra-knowledge structure (rule tag is dot-free, slot is the final decimal segment) is nowhere written down.
- suggested fix: Add to the doc: ids are opaque unique keys; guaranteed structure is exactly the prefix 'placement.<world_boss|dungeon>.' and a trailing '.<decimal slot>'; regionId MUST be taken from the regionId field, never parsed out of the id; document the region.<short>.<anchorIndex> scheme as informative.

## 15. [major] The two blessed reference verifiers disagree: the GDScript proof omits checks the TS verifier performs, and they return opposite verdicts on row-crossing runs

- file: /home/user/world_filler/consumers/godot-proof/verify_content_pack.gd  (lens: unknown-lens)
- claim: verify_content_pack.gd's header (lines 6-11) claims it 'Mirrors src/consume/verifyPack.ts', but it omits: the dungeon anchor-poi existence/moved check (verifyPack.ts lines 117-125 — the one check that catches the doc's named regenerated-world failure mode), the cellCount-vs-runs consistency check (TS lines 131-134), and the base artifactFormat/width/height cross-check (TS lines 89-91). Separately, on a run violating the documented 'never crossing rows' invariant (doc line 134), TS decodeRuns (territory.ts lines 106-112) computes y*width+x+i so the run silently wraps into the next row and can be ACCEPTED after checking the wrong cells, while the GDScript check _walkable(run[0]+i, run[1]) sees x >= width and REFUSES. Two reference implementations giving different answers on the same bytes means every future importer author picks a different behavior.
- evidence: Doc lines 3-8 bless both files equally as sufficient references; a malformed hand-built pack (reachable because report.ok is unchecked, finding 1) verifies in TS and fails in Godot.
- suggested fix: Enforce x+length <= width (and length >= 1) in TS decodeRuns or in verifyPack; port the anchor, cellCount, and base-dimension checks to the .gd; state in the doc which checks are mandatory.

## 16. [major] buildContentPack trusts a caller-supplied report with no cross-document identity check — a stale/unrelated report can authorize an export, and nothing downstream can detect it

- file: src/export/export.ts  (lens: unknown-lens)
- claim: buildContentPack (export.ts:88-93) checks only report.ok. The module API takes plan/placements/territories/report as independent inputs, so a caller can pass a passing report that audited a different recipe, world, solution, or strictness; the resulting pack satisfies importer obligation #4 and both verifiers. Every payload doc embeds directorRecipeSha256, directorBehaviorVersion, base.generationIdentitySha256 (and the report embeds strict), so the mismatch is cheaply detectable — but neither buildContentPack, the verifiers, nor the doc enforce or even state the 'report must be the audit of exactly these inputs' invariant. manifest.counts is likewise never checked against the actual arrays by anyone (the manifest is not covered by any hash).
- evidence: export.ts:90 `if (!report.ok)` is the only report check; no comparison of report.directorRecipeSha256 vs recipeSha256(recipe), report.base.generationIdentitySha256 vs model.generator.generationIdentitySha256, or report identity vs placements.directorRecipeSha256 (fields exist: validate.ts:30-44, solver.ts:117-135, territory.ts:62-83). verifyPack.ts checks only manifest.pack/packFormat/files/base — never that manifest.recipeName/directorRecipeSha256/counts agree with the payload documents' embedded identity. The CLI happens to thread one pipeline's outputs (cli.ts:420-437), but the doc's docstring claim 'An export happens only when the gate battery passed' is only true for the CLI path, not t
- suggested fix: In buildContentPack, refuse unless directorRecipeSha256, directorBehaviorVersion, rulePacks, analysisVersion, and base.generationIdentitySha256 agree across recipe/plan/placements/territories/report (all fields already exist), and derive counts only after that. Optionally have verifiers cross-check manifest identity/counts against the hashed payload docs (append-only, freeze-safe). At minimum, document the invariant in CONTENT_PACK_FORMAT.md and the export.ts docstring.

## 17. [major] Export writes non-atomically in place, violating the mirrored upstream 'no partial packs / temp-directory staging' doctrine; the manifest-last ordering is the only mitigation and is undocumented and untested

- file: src/export/export.ts  (lens: unknown-lens)
- claim: writeContentPack (export.ts:138-144) does mkdirSync(recursive) then writeFileSync of the four payload files followed by manifest.json, directly into the destination. A throw midway (ENOSPC, permissions, kill) leaves a partial pack: in a fresh dir, payload files with no manifest; when re-exporting into an existing pack dir (mkdirSync succeeds, files overwritten in place), it leaves the OLD manifest beside a mix of old/new payload — hash verification will flag it, but the previously valid pack has been destroyed with no recovery. The upstream convention this repo explicitly mirrors (WorldForge GAME_INTEGRATION_PLAN.md section 3.4) requires 'all hard failures, no partial packs' with 'temp-directory staging ... existing safe write rules'; CONTENT_PACK_FORMAT.md promises only gate-refusal-before-write and is silent on torn-write/overwrite semantics, so a second implementer cannot know that 'directory without manifest.json != pack' is the intended commit rule.
- evidence: export.ts:140-143 — payload loop then `writeFileSync(join(outDir, "manifest.json"), ...)` last; no temp dir, no rename, no fsync. /home/user/WorldForge/docs/GAME_INTEGRATION_PLAN.md section 3.4: 'Refuses to export when (all hard failures, no partial packs): ... Publish-after-validation and temp-directory staging follow the existing safe write rules.' The gate-refusal-before-any-write ordering itself is correct (cli.ts:428 buildContentPack throws before assertOutputRoot/writeContentPack at 439-442) and tested (tests/export.test.ts:116 asserts ENOENT on gate refusal), but no test pins manifest-written-last or covers failure mid-write / re-export over an existing pack.
- suggested fix: Stage into a sibling temp directory and rename over (or into) the destination, matching the upstream safe-write rule; failing that, document in CONTENT_PACK_FORMAT.md that manifest.json is the commit record written last and that importers must treat a manifest-less directory as not-a-pack, and add a test pinning the write order.

## 18. [major] Default (non-strict) export accepts stale base pins and invalid locks that plan/place/territories refuse unconditionally — the refusal ladder is inverted at the most consequential verb

- file: src/cli.ts  (lens: unknown-lens)
- claim: runPlan (cli.ts:168-175), runPlace (226-229), and runTerritories (310-313) hard-refuse when recipe.base.generationIdentitySha256 mismatches the world pack ('stale base; re-pin deliberately'). runExport (408-437) has no such check; staleness is delegated to gate G7, which is a hard gate only under --strict (validate.ts:217 — otherwise a warning), as is G6 invalid locks (validate.ts:207). So plain `wf-fill export` ships a frozen content pack from a recipe pinned to a different world, with invalid locks silently dropped, while the intermediate verbs refuse the identical input. CONTENT_PACK_FORMAT.md says export 'refuses to write anything unless the nine-gate audit passed' without stating that two gates only bite under --strict, so a second implementer (or CI author) cannot tell from the frozen doc which refusals are mode-dependent.
- evidence: cli.ts:408-419: runExport goes parity -> normalizeRecipe -> analyze/plan/place/territories/runGates with no pin comparison; validate.ts:207 `strict ? hardGate("G6"...) : gate("G6"..., false)` and :217 same for G7 — gate() with failed=false yields status 'warn', and ok = every gate !== 'fail' (validate.ts:255). tests/export.test.ts:99-120 covers only the --strict G7 refusal; there is no test that non-strict export of a stale pin succeeds (it does), so the behavior is an untested accident rather than a documented choice.
- suggested fix: Make runExport refuse a stale pin unconditionally (same pre-check as plan/place/territories), independent of --strict; or, if warn-and-export is intended, state in CONTENT_PACK_FORMAT.md exactly which gates are strict-only and that a stale-pinned pack is exportable by default, and add a test pinning whichever behavior is chosen.

## 19. [major] The two frozen reference verifiers disagree on what a valid pack is: GDScript omits four TS checks, and row-crossing territory runs are accepted by TS but refused by GDScript

- file: consumers/godot-proof/verify_content_pack.gd  (lens: unknown-lens)
- claim: The .gd header claims it 'Mirrors src/consume/verifyPack.ts', and the doc blesses both as sufficient references, but their acceptance sets differ. GDScript omits: the dungeon_binding anchor-poi existence/cell-match check (verifyPack.ts:117-125), the cellCount-vs-runs check (verifyPack.ts:130-134), the base.artifactFormat/width/height cross-check (verifyPack.ts:89-91), and the named missing-payload-file refusal (a missing files-table key crashes GDScript on manifest["files"] or hashes empty bytes as a 'mismatch'). Worse, a run violating the doc's 'never crossing rows' rule verifies differently: TS decodeRuns wraps into the next row and passes when those wrapped cells are walkable, while GDScript treats x+i >= width as out-of-bounds and refuses. Two reference implementations disagreeing on validity is the worst kind of ambiguity to freeze — a game importer built from either reference accepts/rejects different packs.
- evidence: territory.ts:106-112 decodeRuns: `cells.add(y * width + x + i)` with no x+i<width guard — run [62,5,4] at width 64 yields cells (62,5),(63,5),(0,6),(1,6), and verifyPack.ts:135-141 checks walkability of the wrapped cells (may pass); verify_content_pack.gd:91-96 checks (int(run[0])+i, run[1]) so x=64 fails _walkable's bounds check (lines 104-108) and refuses. verify_content_pack.gd:71-96 contains no anchorPoiId lookup and no cellCount comparison; lines 57-64 check only the two base hashes, never artifactFormat/width/height. The exporter never emits crossing runs (encodeRuns splits at row boundaries, territory.ts:93-97), so this divergence bites exactly the hand-built/tampered packs verifiers 
- suggested fix: Make the TS verifier reject runs where x < 0, length < 1, or x+length > width (doc rule 'never crossing rows'), and bring the GDScript verifier up to parity: anchor-poi check, cellCount check, base format/dimension check, named missing-file refusal. Add a cross-verifier fixture test (malformed packs must be refused by BOTH).

## 20. [major] Importer obligation 4 (report.json .ok == true) is enforced by neither reference verifier

- file: /home/user/world_filler/src/consume/verifyPack.ts  (lens: unknown-lens)
- claim: The frozen spec's blessed check #4 requires importers to refuse packs whose report.json has ok != true, but neither verifyPack.ts nor verify_content_pack.gd ever opens report.json, so a hand-built pack carrying a failing audit verifies cleanly in both lanes.
- evidence: Confirmed empirically: a pack whose report.json was rewritten to ok:false with every gate status 'fail' (files hash updated) passes verifyContentPack() and `wf-fill verify-pack` exits 0. grep for 'report' in verifyPack.ts matches nothing; the GDScript reads only manifest.json, placements.json, territories.json, and the world pack's manifest.json/walkability.json. docs/CONTENT_PACK_FORMAT.md:79-81 states the obligation, and lines 3-8 bless both verifiers as sufficient implementation references — importers cloned from them will skip the check.
- suggested fix: Add to both verifiers: read report.json (after hash verification), refuse unless ok === true (and reportFormat is the supported value). Add a tripping test mirroring the export-side refusal test.

## 21. [major] GDScript verifier performs no dungeon-anchor check at all (never reads world.json)

- file: /home/user/world_filler/consumers/godot-proof/verify_content_pack.gd  (lens: unknown-lens)
- claim: verify_content_pack.gd claims to mirror verifyPack.ts but has no branch for rule == 'dungeon_binding.v1' and never opens the world pack's world.json, so it cannot check anchor POI existence or that the anchor cell still matches — packs that TS refuses print 'verify-content-pack: OK' in Godot.
- evidence: The GDScript's placement loop (lines 73-86) checks only accessCell walkability and the world_boss arena; the only world-pack files it reads are manifest.json (line 57) and walkability.json (line 66). TS refuses both tamper cases — confirmed empirically: setting a dungeon placement's anchorPoiId to 999 (hashes updated) is refused by verifyPack.ts:117-125 with 'binds anchor poi #999 which does not exist in the world pack', and a moved anchor triggers 'anchor poi moved'. The same pack contains nothing the GDScript would reject. The file header (lines 6-8) claims 'Mirrors src/consume/verifyPack.ts'.
- suggested fix: In the GDScript, parse world.json's pois array, and for each dungeon_binding.v1 placement refuse when anchorPoiId is absent from pois or when the poi's cell differs from placement.cell — matching verifyPack.ts refusal-for-refusal.

## 22. [major] GDScript verifier ignores territory cellCount (no cellCount-vs-runs equality check)

- file: /home/user/world_filler/consumers/godot-proof/verify_content_pack.gd  (lens: unknown-lens)
- claim: The GDScript walks territory runs (lines 90-96) but never reads territory.cellCount, so a pack whose cellCount disagrees with its runs — or whose runs overlap (duplicates) — verifies in Godot while TS refuses it.
- evidence: Confirmed on the TS side: adding 7 to one territory's cellCount (hashes updated) is refused by verifyPack.ts:130-134 with 'cellCount 35 does not match its runs (28)'. The GDScript source contains no occurrence of cellCount; it also counts run cells without dedup, so overlapping runs are double-counted in its printed total rather than detected. TS's Set-based decodeRuns additionally collapses duplicate cells, which the cellCount equality then catches — none of that exists in the Godot lane.
- suggested fix: Decode runs into a deduplicating structure (e.g. a Dictionary keyed by index) in the GDScript and refuse when its size differs from cellCount, matching verifyPack.ts.

## 23. [major] GDScript malformed-input paths hang forever instead of exiting 1; base64 grid length never validated

- file: /home/user/world_filler/consumers/godot-proof/verify_content_pack.gd  (lens: unknown-lens)
- claim: Any GDScript runtime error aborts _init() before quit() is called, after which the headless SceneTree main loop runs forever — the verifier hangs (CI timeout) instead of delivering the documented 'Exit 0 on success, 1 on any refusal'. Reachable cases: manifest/placements/territories JSON parsing to a non-Dictionary (typed-assignment from Variant fails), missing keys like manifest['files'] or placement['accessCell'] (invalid-index error), a world_boss with arenaOrigin null (line 79 assigns Nil to a typed Array; TS refuses this cleanly as 'carries no arena'), and an invalid or truncated walkability grid: Marshalls.base64_to_raw's output length is never validated, so grid[index >> 3] at line 108 reads out of bounds and errors.
- evidence: verify_content_pack.gd has no shape validation before typed access: lines 48, 57, 66, 71, 88 assign _read_json's Variant to typed Dictionary; line 79 'var origin: Array = placement["arenaOrigin"]'; line 69 decodes base64 with no length check, while the TS lane validates exact byte length in decodeBase64Grid (src/world/bitgrid.ts:21-27, throws on mismatch) and reaches walkability only through readGamePack's gate battery. In Godot 4, these runtime errors unwind the script function without setting an exit code, and a SceneTree with no quit() scheduled idles indefinitely under --headless. (quit(1) itself inside _init is reliable on 4.x — the exit code is stored synchronously and the loop stops a
- suggested fix: Validate before typed access (check typeof/has for every key used), refuse world_boss placements with null arenaOrigin/arenaSide (parity with TS 'carries no arena'), and refuse when base64_to_raw's size != (width*height + 7) / 8. Ensure every abnormal path reaches _fail/quit(1); consider running the GDScript in CI so hangs surface.

## 24. [major] Row-crossing territory runs: TS silently wraps to the next row, GDScript refuses — the two blessed references disagree

- file: /home/user/world_filler/src/territory/territory.ts  (lens: unknown-lens)
- claim: The spec says runs are '[x, y, length], never crossing rows' but mandates no reader behavior for a violating run. decodeRuns (territory.ts:106-112) computes y*width+x+i, so a run with x+length > width silently wraps into row y+1 and verifyPack.ts then validates those wrapped (wrong) cells, while the GDScript walks (x+i, y), hits x >= width, and refuses. The same bytes can verify in one reference verifier and refuse in the other.
- evidence: Confirmed at the contract level: decodeRuns([[62,10,5]], 64) yields cells (62,10),(63,10),(0,11),(1,11),(2,11). verifyPack.ts:131 and validate.ts's G3/G9 gates all consume this wrapped interpretation, so a hand-built pack whose crossing run wraps onto walkable next-row cells (with cellCount matching the deduped set) passes the TS lane end-to-end; verify_content_pack.gd:91-95 refuses any crossing run unconditionally via _walkable's x >= width bound. The exporter's encodeRuns (territory.ts:93-99) never emits crossing runs, so only hand-built/tampered packs are affected — but the freeze is about what readers must do, and the two references already resolve it oppositely.
- suggested fix: Make the spec sentence normative for readers ('importers MUST refuse a run where x + length > width'), make decodeRuns throw on it (also refusing negative x/y/length), and add a tripping test. This aligns TS with the GDScript's existing refusal.

## 25. [major] GDScript skips the base artifactFormat/width/height cross-check and trusts unvalidated world-pack inputs

- file: /home/user/world_filler/consumers/godot-proof/verify_content_pack.gd  (lens: unknown-lens)
- claim: TS refuses when manifest.base.artifactFormat/width/height disagree with the world pack (verifyPack.ts:89-91) and takes walkability ground truth only after readGamePack's full battery (file hashes, validation-report status 'pass', encoding pin, dims-vs-manifest agreement). The GDScript checks none of this: base.width/height/artifactFormat are never compared to anything, grid dimensions are taken from walkability.json itself with no hash, no encoding-string check, and no cross-check against either manifest — so a content pack lying about its base dimensions, or a corrupted/substituted walkability.json, goes undetected in the Godot lane while the TS lane refuses.
- evidence: verify_content_pack.gd:57-69 reads world manifest.json only for the two pairing hashes, then reads walkability.json raw (width/height/grid straight from the file); there is no reference to base['width'], base['height'], base['artifactFormat'], 'encoding', or the world manifest's files/dimensions/validation report. Contrast readPack.ts:92-171 (hash-verifies every listed world file, requires status 'pass', pins encoding 'base64-bitpacked-row-major-lsb-first', checks walkability dims against manifest.dimensions) plus verifyPack.ts:88-91.
- suggested fix: In the GDScript: compare base.artifactFormat with the world manifest's artifactFormat, and base.width/height with both manifest.dimensions and walkability.json's width/height; pin walkability.encoding to the frozen string. (Full world-pack hash verification can be documented as the game importer's separate duty, but the dimension/encoding pins are cheap and are checks the TS reference performs.)

## 26. [major] Obligation 5 (unknown ids/enum values are errors) is neither implemented by the references nor implementable from the doc

- file: /home/user/world_filler/docs/CONTENT_PACK_FORMAT.md  (lens: unknown-lens)
- claim: The frozen spec orders importers to 'treat unknown ids and enum values as errors, never as defaults', but both reference verifiers silently accept an unknown placement rule, and the doc never says which string fields are closed enums versus open vocabularies — so second implementers will inevitably diverge on what to refuse.
- evidence: Confirmed empirically: setting placements[0].rule to 'meteor_shrine.v9' (hashes updated) passes verifyContentPack() — verifyPack.ts:105/117 only if-matches the two known rules, so an unknown rule gets nothing but the accessCell check; the GDScript behaves the same (line 78). Meanwhile the doc marks enemyId as game-owned open vocabulary but is silent on rule, cells.encoding, respawnPressure, failures[].reason, unboundAnchors[].reason, lockReport[].status, scoreTerms[].term, and candidateFunnel[].stage — an importer that takes obligation 5 literally would hard-fail when a future behavior version appends a new funnel stage name, while one cloned from the references refuses nothing.
- suggested fix: Enumerate the closed enums in the spec (rule, cells.encoding, respawnPressure, failure/unbound reasons, lock status) and explicitly exempt open vocabularies and explanation data from obligation 5. Make both verifiers refuse unknown rule and cells.encoding values, with tripping tests.

## 27. [minor] Export CLI accepts a stale recipe base pin in default (non-strict) mode while every intermediate verb refuses it

- file: /home/user/world_filler/src/cli.ts  (lens: unknown-lens)
- claim: runPlan (lines 168-175), runPlace (lines 226-229), and runTerritories (lines 310-314) hard-refuse when recipe.base.generationIdentitySha256 is non-null and differs from the world's identity ('stale base; re-pin deliberately'). runExport (lines 408-456) and runValidate perform no such check; staleness is delegated to gate G7 (validate.ts lines 211-218), which is a WARN unless --strict, so report.ok stays true and the pack exports. Net effect: a recipe explicitly pinned to world A cannot even produce a plan against world B, yet 'wf-fill export B recipe.json out' — the highest-stakes verb — succeeds by default, silently directing the wrong world. The doc's Versioning section (lines 161-169) treats the pin as the pack's identity anchor; tests cover only the --strict path (export.test.ts lines 99-120), so the default-mode hole is untested. Not freeze-permanent (behavior, not shape), but a genuine refusal-path inconsistency.
- evidence: cli.ts runExport builds recipe via normalizeRecipe then goes straight to analyzeWorld/compilePlan with no pin comparison; validate.ts G7: gates.push(strict ? hardGate(...) : gate(..., false)) — warn-only by default. The resulting manifest records the actual world's identity, so the mismatch is invisible at import time; only report.json's warn text records it.
- suggested fix: Either make G7 a hard gate regardless of strict (a pin exists to be honored), or add the same explicit pre-flight refusal to runExport/runValidate that plan/place/territories already perform.

## 28. [minor] Recipe locks can inject placement ids that violate the frozen id scheme

- file: /home/user/world_filler/src/recipe/schema.ts  (lens: unknown-lens)
- claim: The doc freezes id schemes ('id schemes never change shape', line 3) and documents exactly two: placement.world_boss.<regionId>.<slot> and placement.dungeon.<regionId>.<slot> (lines 97-98). But schema.ts lines 434-436 validates lock ids only as typeof string && id.startsWith("placement."), and solver.ts line 696 emits the lock id verbatim into placements.json (id: lock.id). A hand-authored lock id like "placement.my-boss" ships in a fully audited, exportable pack (G1 checks only duplicates), so consumers that parse ids per the documented scheme — the doc invites keying runtime deltas by id and gives no opaque-id caveat — break on any locked placement. The doc never mentions that locked placements may carry recipe-authored ids of looser shape; a second implementer would not anticipate them.
- evidence: schema.ts: if (typeof id !== "string" || !id.startsWith("placement.")) throw — no scheme regex, no rule/regionId consistency with the id. solver.ts pass 0 pushes { id: lock.id, ... } straight into placements. The blessed 'wf-fill lock' verb (cli.ts lines 382-406) copies conforming ids, but nothing stops hand-edited recipes. The doc's placements section shows only scheme-conforming examples.
- suggested fix: Either tighten lock-id validation to the documented scheme (placement.(world_boss|dungeon).<regionId>.<slot> with rule/regionId agreement), or add one doc sentence declaring placement ids opaque keys whose scheme is informative only — before importers start parsing them.

## 29. [minor] Doc never states manifest.json itself is canonical JSON, though pack byte-stability depends on it

- file: /home/user/world_filler/docs/CONTENT_PACK_FORMAT.md  (lens: unknown-lens)
- claim: Line 32 says 'All payload files are canonical JSON: keys sorted (UTF-16 code-unit order), two-space indent, LF, one trailing newline, UTF-8, safe integers only' — but the doc consistently defines manifest.json as NOT payload ('never listed in its own files table', line 25; renders are 'never payload', line 29; export.ts's BuiltContentPack.files excludes it). writeContentPack (export.ts line 143) does write the manifest via canonicalJson, and the exporter's byte-stability promise (doc line 33 'No timestamps... identity is hashes'; tests/export.test.ts lines 45-51 asserts manifest.json byte-identical across exports) silently depends on that. A second exporter implementation built from the frozen doc alone could legitimately emit a non-canonical manifest, breaking byte-for-byte reproducibility of packs while satisfying every written rule.
- evidence: docs/CONTENT_PACK_FORMAT.md lines 22-34 (layout + canonical-JSON sentence scoped to 'payload files'); export.ts line 143: writeFileSync(join(outDir, "manifest.json"), canonicalJson(pack.manifest)).
- suggested fix: One doc sentence: 'manifest.json is written with the same canonical-JSON rules as payload files; entire packs are byte-stable, manifest included.'

## 30. [minor] Manifest self-consistency is never verified: counts and duplicated identity fields are unhashed, uncross-checked redundancy

- file: /home/user/world_filler/src/consume/verifyPack.ts  (lens: unknown-lens)
- claim: manifest.json is the only file no hash covers, and its counts.{placements,territories,placementFailures,territoryFailures,unboundAnchors}, directorRecipeSha256, directorBehaviorVersion, rulePacks, recipeName, and directorSeed all duplicate values inside the hashed payloads — yet no verifier or gate cross-checks any of them (verifyPack.ts checks only pack, packFormat, files hashes, and base pairing). A hand-edited manifest claiming different counts or a different directorRecipeSha256 than placements.json still 'verifies', even though the doc's versioning section (lines 161-169) tells consumers to pin packs by manifest.directorRecipeSha256. The doc never says whether importers may trust counts or must re-derive them.
- evidence: buildContentPack (export.ts lines 106-132) writes the duplicates from one source so legitimate exports agree; only tampering/hand-building diverges, which is exactly the case the verifier exists for.
- suggested fix: Add blessed cross-checks: manifest.directorRecipeSha256/behaviorVersion/rulePacks/recipeName/directorSeed equal the payload copies, counts equal the array lengths; or document counts as advisory.

## 31. [minor] coverage.totalHostileWalkable and coverage.regions silently exclude zero-budget regions — a frozen field name promising a world total it does not contain

- file: /home/user/world_filler/src/territory/territory.ts  (lens: unknown-lens)
- claim: growTerritories skips regions with territories budget <= 0 before pushing any coverage entry (line 170-171 'if (budget <= 0) continue;', push at lines 339-346), and the totals (lines 366-368) sum only those entries. So 'totalHostileWalkable' is really 'hostile walkable in territory-budgeted regions', and coverage.regions is not the region universe. Once frozen, correcting the semantic to match the name would be repurposing; a consumer computing world-coverage ratios from these fields silently under-counts the denominator.
- evidence: plan.regions (content-plan.json) contains hostileWalkableCells for every region including zero-budget ones, so the discrepancy is observable inside a single pack.
- suggested fix: Before freeze: either emit a coverage row for every plan region (budget 0, emitted 0) or rename/document the fields as budgeted-regions-only in CONTENT_PACK_FORMAT.md.

## 32. [minor] No golden content-pack fixture pins the frozen serialization — the export test only compares the current build against itself

- file: /home/user/world_filler/tests/export.test.ts  (lens: unknown-lens)
- claim: The freeze's only automated defense is export-A-vs-export-B of the same build (export.test.ts lines 40-51) plus a hardcoded four-name files check. fixtures/golden contains only kernel.json (F1 kernel vectors). An accidental field rename, removal, or type change in any payload document — the exact class of mistake format 1 declares permanent — passes the entire suite, because both exports drift together.
- evidence: The repo already treats byte-golden fixtures as the tripwire pattern for frozen identities (tools/updateGolden.ts: re-recording is 'an explicit, logged decision'); the frozen pack format has no equivalent.
- suggested fix: Commit a golden exported content pack for a fixture world (or at minimum a JSON-schema/key-path snapshot of all five files) and assert byte/shape equality in the test suite, with an updateGolden-style explicit re-record path.

## 33. [minor] inSafeZone is documented for dungeons only but serialized for every placement, and locked placements carry undocumented placeholder explanation values

- file: /home/user/world_filler/docs/CONTENT_PACK_FORMAT.md  (lens: unknown-lens)
- claim: Doc line 104 annotates inSafeZone as 'dungeons: access cell inside a settlement safe zone', but the field is emitted on world_boss rows too (always false for fresh bosses, solver.ts line 521; computed from the lock cell for locked bosses, line 703), leaving its boss-row meaning unspecified for a second implementer. Locked placements additionally serialize channel 'locked' (doc line 109 covers this) plus draw 0, score 0, scoreTerms [], candidateFunnel [{stage:'locked', remaining:1}], topCandidates [] (solver.ts lines 708-713) — placeholder semantics the doc never mentions, so tooling reading draw/score cannot know these are sentinels rather than data.
- evidence: Any later attempt to give boss inSafeZone or locked-row draw/score real meaning would be repurposing under the freeze; the semantics must be pinned in the doc now.
- suggested fix: One doc sentence each: inSafeZone is defined for all placements as 'accessCell inside a safe zone' (bosses are false by construction in format 1); locked rows carry channel 'locked' and zero/empty explanation placeholders that importers must ignore.

## 34. [minor] Importer obligation #5 (unknown ids and enum values are errors, never defaults) is not demonstrated by either reference verifier — unknown rule/encoding/nested-format values pass silently

- file: src/consume/verifyPack.ts  (lens: unknown-lens)
- claim: CONTENT_PACK_FORMAT.md obligation #5 requires importers to treat unknown ids and enum values as errors, and the doc positions the verifiers as specification-by-example. But a placement with rule 'encounter_site.v9' skips both rule branches in both verifiers and passes with only its accessCell checked; territory cells.encoding is never compared to 'runs'; placements.json placementsFormat / territories.json territoriesFormat / report.json reportFormat inside a packFormat-1 pack are never checked (obligation #1's 'no best-effort reads of unknown formats' is enforced only for the outer packFormat). Importer authors copying the reference will inherit the permissive behavior the doc forbids.
- evidence: verifyPack.ts:105 and :117 — `if (placement.rule === "world_boss.v1")` / `=== "dungeon_binding.v1"` with no else-refusal for other values (same structure in verify_content_pack.gd:78); verifyPack.ts:131 reads territory.cells.runs without checking territory.cells.encoding; no reference to placementsFormat/territoriesFormat anywhere in verifyPack.ts (contrast cli.ts runExplain:264 which does check placementsFormat before reading).
- suggested fix: In both verifiers: refuse unknown placement.rule values, require cells.encoding == 'runs', and require placementsFormat == 1, territoriesFormat == 1 (and reportFormat == 1 once report.json is read per the critical finding). All are verifier-side tightening within format 1 — freeze-safe.

## 35. [minor] Out-dir guard leaves consumers/ (home of the frozen GDScript reference verifier), dist/, and node_modules/ writable, and any mistyped flag silently becomes an out-dir created in the repo root

- file: src/core/guard.ts  (lens: unknown-lens)
- claim: guard.ts's stated purpose is refusing writes into 'this repository's source/fixture/doc trees', but PROTECTED_SUBDIRS (line 13) omits consumers/, dist/, and node_modules/ (while listing schemas/ and vendor/, which do not exist in the repo). `wf-fill export <pack> <recipe> consumers/godot-proof` passes assertOutputRoot and writes a content pack into the directory holding the frozen reference verifier. Compounding it, cli.ts:469-470 filters only the exact string '--strict', so any typo ('--stric', '-strict', '--Strict') is passed through as the positional out-dir argument; from the repo root that creates a directory literally named '--stric' as a content pack under the repo root, which the guard permits (first path segment is not in PROTECTED_SUBDIRS).
- evidence: guard.ts:13 `PROTECTED_SUBDIRS = ["src", "tests", "tools", "docs", "fixtures", "schemas", ".git", "vendor"]` vs actual repo root entries consumers/, dist/, node_modules/; guard.ts:83-90 allows any in-repo path whose first segment is unlisted. cli.ts:469-471 `const strict = argv.includes("--strict"); const positional = argv.filter((entry) => entry !== "--strict");` — no rejection of unrecognized dash-prefixed arguments before they are consumed as out-dir. tests/guard.test.ts:14-16 tests only the listed trees.
- suggested fix: Add consumers, dist, and node_modules to PROTECTED_SUBDIRS (drop or keep the nonexistent ones), and have the CLI refuse any positional argument beginning with '-' that is not exactly '--strict' (unknown-flag refusal) before treating it as an output directory.

## 36. [minor] Non-strict export accepts a stale recipe pin that plan/place/territories unconditionally refuse

- file: /home/user/world_filler/src/cli.ts  (lens: unknown-lens)
- claim: wf-fill plan, place, and territories hard-refuse when recipe.base.generationIdentitySha256 mismatches the world pack (cli.ts:169-175, 227-229, 310-313), but wf-fill export and validate never perform that check and rely on gate G7, which fails only under --strict (validate.ts:213-217) — so the shipping verb is the most permissive one and default export writes a pack directed by a recipe pinned to a different world.
- evidence: Confirmed empirically: exporting fen-hollow with a recipe pinning base '000…0' and no --strict exits 0 and writes a full content pack (G7 status warn, report.ok true); the same recipe is refused outright by the intermediate verbs. tests/export.test.ts:99-120 covers only the --strict refusal, so the lenient path is untested and undocumented.
- suggested fix: Pick one semantics before workflows freeze around it: either add the same pin refusal to runExport/runValidate (recommended — 're-pin deliberately' stays meaningful), or demote the plan/place/territories refusals to warnings so all verbs agree, and document strictness in CONTENT_PACK_FORMAT.md's versioning section.

## 37. [minor] Payload format fields (placementsFormat/territoriesFormat/planFormat/reportFormat) are pinned by nothing; relation to packFormat unspecified

- file: /home/user/world_filler/docs/CONTENT_PACK_FORMAT.md  (lens: unknown-lens)
- claim: The doc lists per-payload format fields and says 'packFormat gates structural shape', but never states that packFormat 1 implies each payload format is 1, and neither verifier reads any of the payload format fields — a pack with territoriesFormat 9 inside packFormat 1 verifies in both lanes, so importers keying on packFormat versus payload formats will disagree about what a future in-place payload bump means.
- evidence: verifyPack.ts and verify_content_pack.gd contain no reference to placementsFormat/territoriesFormat/planFormat/reportFormat (only manifest.packFormat, verifyPack.ts:53-57, gd line 49). The only consumers pinning a payload format are the standalone wf-fill explain/lock verbs (cli.ts:264, 384), which read placements.json outside any pack context — evidence the fields are meant to be load-bearing for standalone readers, yet the frozen pack contract ignores them.
- suggested fix: Append one sentence to the spec: 'packFormat 1 fixes content-plan/placements/territories/report formats at 1; importers MUST refuse any other value', and check those four fields in both verifiers after hash verification.

## 38. [minor] Frozen doc claims sufficiency but omits the shapes of failures[], unboundAnchors[], lockReport[], coverage, and the explanation arrays

- file: /home/user/world_filler/docs/CONTENT_PACK_FORMAT.md  (lens: unknown-lens)
- claim: The doc asserts it plus the two verifiers are 'sufficient to build a game-side importer without reading any other worldfiller source', but the entry shapes of placements failures[], unboundAnchors[], lockReport[], territories coverage, and scoreTerms/candidateFunnel/topCandidates ('[...] explanation data') exist only as TypeScript types in solver.ts/territory.ts — after the freeze these field names are permanently fixed yet undiscoverable from the frozen artifact set, and tooling built on the doc alone (e.g. anything consuming lockReport, which the Versioning section explicitly points to for invalid locks) must reverse-engineer them from pack bytes.
- evidence: docs/CONTENT_PACK_FORMAT.md:89-91 and 123-124 name the arrays without any field documentation; line 112 elides the explanation entries entirely; line 169 directs users to lockReport. The actual shapes live in src/place/solver.ts (PlacementFailure, UnboundAnchor with six reason values, LockReportEntry) and src/territory/territory.ts (TerritoryFailure, RegionCoverage) — 'other worldfiller source' by the doc's own definition.
- suggested fix: Append the field lists (with the reason/status vocabularies) for those arrays to the doc, or explicitly declare them opaque diagnostic data that importers must ignore and that is exempt from obligation 5.

