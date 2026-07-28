# F7 freeze review — RESOLVED (2026-07-28)

Status: **Resolution complete.** The interrupted adversarial review's 38
raw findings (4 of 5 lenses) were verified one by one against the code
in the follow-up session — read the code, actively tried to refute —
and the missing fifth lens (importer-buildability of
docs/CONTENT_PACK_FORMAT.md) was run as a full read-through. Verdict:
**every distinct claim confirmed** (the 38 findings collapse into 15
distinct defects; several were reported by multiple lenses). All 15 are
fixed in this commit. Content pack **format 1 is now final**.

Evidence: 134 tests green including a new adversarial verifier battery
(tests/verifyPack.test.ts) and a committed golden content pack; the
rewritten GDScript verifier was run against 12 tampered packs in
headless Godot 4.6.2 — every case refuses with exit 1, and the TS
verifier refuses the identical packs refusal-for-refusal.

## The 15 distinct defects and their fixes

1. **report.json .ok never checked** (findings 1, 2, 8, 20 —
   claimed-critical). CONFIRMED empirically: an ok:false pack passed
   both verifiers. Fixed: both verifiers now require reportFormat 1 and
   ok === true.
2. **manifest.files completeness unspecified/unchecked; payloads
   consumed unhashed** (2, 3, 4, 10 — claimed-critical). CONFIRMED: an
   empty files table passed trivially and placements/territories were
   read regardless. Fixed: both verifiers require exactly the four
   payload names; the TS verifier parses payloads from the very bytes it
   hashed; doc states the rule normatively.
3. **Row-crossing runs: TS wrapped, GDScript refused** (5, 15, 19, 24 —
   claimed-critical divergence). CONFIRMED from decodeRuns. Fixed:
   decodeRuns throws on x<0 / y<0 / length<1 / x+length>width (named
   refusal through the verifier); GDScript refuses explicitly; doc made
   normative for readers. Both lanes now refuse.
4. **GDScript omitted TS checks** (6, 21, 22, 25). CONFIRMED: no dungeon
   anchor check, no cellCount check, no base format/dimension check, no
   walkability encoding/length pin. Fixed: full rewrite to
   check-for-check parity (anchor POIs from world.json, deduplicating
   run decode vs cellCount, dimension/encoding pins).
5. **GDScript crash/hang paths on malformed input** (23). CONFIRMED at
   the code level (typed assignments from Variant, unvalidated base64
   length, int() coercion of packFormat). Fixed: shape-validated access
   everywhere, exact-integer format gate, grid byte-length check; all 12
   tamper cases exit 1 in headless Godot 4.6.2.
6. **Obligation 5 had no reference implementation** (7, 9, 26, 34).
   CONFIRMED: unknown placement.rule and cells.encoding passed both
   verifiers. Fixed: both refuse unknown rule / encoding /
   respawnPressure and pin every payload format field to 1; the doc now
   separates closed enums from open behavior-versioned vocabularies.
7. **Doc shape gaps: explanation arrays, failures, lockReport, coverage,
   enum scope, id grammar, manifest canonicality** (11, 12, 14, 29, 33,
   37, 38 + fifth lens). CONFIRMED. Fixed in CONTENT_PACK_FORMAT.md:
   explanation/diagnostic data declared inspection-only (importers MUST
   NOT depend on it), lockReport's frozen shape given, closed-enum list
   added, ids declared opaque with guaranteed prefix/slot structure
   only, manifest canonical-JSON + commit-record semantics stated,
   version identity block documented for all payloads, report/plan
   load-bearing fields enumerated.
8. **Lock ids bypassed the frozen id scheme** (13, 28). CONFIRMED:
   validation was startsWith("placement.") only. Fixed: lock ids must
   match placement.<world_boss|dungeon>.<regionId>.<slot> and agree with
   the lock's rule and regionId; fresh boss ids now consult held ids
   (symmetric with dungeons) so collisions cannot occur.
9. **buildContentPack trusted a caller-supplied report** (16).
   CONFIRMED. Fixed: export refuses unless directorRecipeSha256,
   directorBehaviorVersion, rulePacks, analysisVersion, and
   base.generationIdentitySha256 agree across plan / placements /
   territories / report and the recipe+world being exported.
10. **Non-atomic in-place export writes** (17). CONFIRMED. Fixed:
    sibling temp-directory staging with manifest-last write order and a
    swap into place (upstream "no partial packs" rule); re-export over a
    corrupted pack and leftover-staging recovery are tested.
11. **Default-mode export accepted stale pins the intermediate verbs
    refuse** (18, 27, 36). CONFIRMED empirically. Fixed: export refuses
    a stale pin unconditionally; validate remains the diagnosis verb
    (G6/G7 warn by default, hard under --strict) per the architecture
    staleness contract, and the doc now states the split.
12. **Manifest self-consistency never verified** (30). CONFIRMED.
    Fixed: both verifiers cross-check the manifest's duplicated identity
    fields and counts against the hashed payloads (obligation 6).
13. **coverage fields silently excluded zero-budget regions** (31).
    CONFIRMED. Resolved doc-side: coverage is documented as
    budgeted-regions-only, with content-plan.json's per-region
    hostileWalkableCells as the world-total denominator. (Emitting rows
    for all regions would have changed output bytes for a diagnostic
    field — not worth a behavior bump.)
14. **No golden pack fixture pinned the frozen serialization** (32).
    CONFIRMED. Fixed: fixtures/golden/content-pack-fen-hollow-basic-
    direction is committed and byte-compared on every test run;
    re-record only via `node dist/tools/updateGoldenPack.js` as an
    explicit, logged decision.
15. **Guard gaps: consumers/, dist/, node_modules/ writable; mistyped
    flags became output dirs** (35). CONFIRMED. Fixed: all three added
    to PROTECTED_SUBDIRS; the CLI refuses any unknown dash-prefixed
    argument.

## Refuted claims

None refuted outright. Two partial corrections to reviewer claims:

- Finding 23's "quit(1) is unreliable in _init" side-claim was not
  reproduced — quit(1) from _init sets the exit code correctly in Godot
  4.6.2; the real defect was the crash paths that bypassed _fail.
- Findings 18/27/36 proposed making G7 unconditionally hard; the adopted
  fix keeps G7 warn-by-default under `validate` (the architecture doc's
  staleness contract requires a diagnosing mode) while `export` refuses
  stale pins pre-flight in every mode.

## Freeze-safety note

Every code fix is verifier/exporter-side tightening or refusal-path
work: no shipped field changed shape, no enum value was renamed, and the
golden pack recorded from the fixed build is byte-identical to what the
pre-fix exporter emitted for the same inputs (behavior version stays 5).
The only pack-visible change is that invalid packs which previously
slipped through are now refused.
