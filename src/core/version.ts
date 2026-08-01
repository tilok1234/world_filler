/**
 * World Filler version identity. Every derived output stamps these; a
 * behavior change bumps DIRECTOR_BEHAVIOR_VERSION plus the touched rule
 * packs, sequentially, mirroring the upstream versioning doctrine.
 */

export const DIRECTOR_VERSION = "0.1.0";
// 6: freeze-review resolution — coverage rows for every plan region,
// boss slots skip held lock ids, malformed territory runs refuse by name,
// export refuses incoherent inputs and stale pins.
// 7: first visual-verdict round — quantile band assignment (opt-in),
// scale-free settlement/road distance floors for bosses and dungeon
// anchors (opt-in, new unbound reason below_distance_floor).
// 8: second round — endgame pockets (deepest band reshaped into K
// separated pockets, opt-in) and territory spacing halos (opt-in).
// 9: third round — endgame pockets carve K islands out of the two
// deepest bands (promote around seeds, capped by the deep area share)
// instead of only demoting bridges.
// 10: F9 encounter sites — the encounter budgets the plan has carried
// since F3 now place (rule encounter_site.v1, pack format 2).
// 11: quantile bands gain a min-share rebalance — every wilderness band
// keeps at least half its fair share of walkable ground (huge regions
// could starve or skip a band).
// 12: analysis 2 — oversized regions subdivide (region ids change on
// worlds that had monolithic biomes; invalid locks are diagnosed), and
// a boss budget whose allocated region has no valid site falls back
// through the other eligible regions with named failures.
// 13: analysis 3 — segmentation void is walkability-aware (sl-0026):
// void = void-material AND unwalkable, so route/street fords, wadeable
// shallows, piers, and (once a ladder supports them) walkable rock cells
// form regions of their own material and appear in adjacency; region
// ids and neighbor sets move on worlds with walkable water ground, and
// invalidated locks are diagnosed per the designed migration.
// 14: behavior-72 walkability adoption (ratified sl-0039): ladder tables
// transcribed @ bbc10cdb — 16 new blocking props, dock/city_gate pass
// cells, the moss-on-rock walk rung (keyed on the pack's adapter elev
// grid), and the WYSIWYG art-outline stamp. Fixtures re-pinned to
// behavior-72 packs; the canonical world is the imported
// small-cold-coastal-pack-dusk@b65 release.
// 15: behavior-77 prop walkability classes (sl-0041 || base re-pin
// ruling; upstream ruling sl-0063, transcribed @ 1a20bd2): the four
// carpet-debris species (stump, fallen_log, bone_pile, loot_pile) stop
// blocking on worlds recorded at behavior >= 77; earlier-era worlds
// reproduce their reference grids unchanged. Fixtures re-pinned to
// behavior-77 packs; the b65 canonical import is untouched.
// 16: analysis 4 — organic region seams (dusk rehearsal round-2 verdict
// "so very square"): oversized-patch subdivision moves from bounding-box
// midline bisection to a two-seed distance watershed (diameter-endpoint
// seeds, equidistance seam). Region geometry and ids move on every world
// with oversized patches; invalidated locks are diagnosed per the
// designed migration.
// 17: plan 6 — settlement-relief danger blend (sl-0073, dusk round 4):
// safety radiates from every settlement. Opt-in recipe knobs
// danger.settlementRelief{Reach,Depth}Permille subtract tier-scaled
// (recorded-radius-scaled) linear-fade belts from the spawn-distance
// field before bands rank; overlaps take max, never sum. Both 0 =
// pure spawn-distance danger, byte-identical to behavior 16. The
// normalized recipe gains the two fields, so recipe identity hashes
// move (golden re-recorded).
// 18: plan 7 — macro-zones (dusk round 5, the designer's sketch: "a
// small map like this should be like 4 zones depending on the
// geography"): opt-in zones.count clusters the fine regions into K
// geography-following zones (heaviest same-biome-family components of
// the region graph seed cores; the rest join by graph distance). A
// reporting/creative layer — solver units unchanged; zone-less plans
// byte-identical modulo the recipe-identity field.
// 19: plan 8 — zonal danger assignment (dusk round 6, "this doesn't
// fit with our new zones at all"): danger.assignment "zonal" makes the
// spawn's zone the first chapter always (its near ground is safe-eaten,
// so a wilderness median would mismeasure home as far country), ranks
// the remaining zones by weighted-median travel distance, splits the
// wilderness bands into contiguous per-zone windows (remainder widens
// the deepest zones), and runs an independent quantile ramp inside each
// window. Crossing a zone border = the next difficulty chapter.
// Requires zones.count >= 2 (named refusal); linear/quantile
// byte-identical.
// 20: sanctuary scaling (dusk round 7, "reduce the safe zones on towns
// where we can"): opt-in safety.{city,town,outpost}RadiusPermille
// scales each settlement's safe radius, floored at its built-up radius
// (farthest structure + 2) so buildings never leave sanctuary. The
// effective mask feeds EVERY recipe-bearing phase and gate of a run
// (plan bands, placement exclusion, territory growth, G1/G3) — the
// recipe-less analyze verb keeps the world's recorded safety. Danger
// relief belts stay on the recorded radius: content moves closer to
// town; town ground does not get deadlier. All knobs 1000 =
// byte-identical to behavior 19.
export const DIRECTOR_BEHAVIOR_VERSION = 20;

export const RULE_PACK_VERSIONS = {
  // 4: watershed subdivision — organic seams (behavior 16).
  analysis: 4,
  // 6: settlement-relief danger blend (behavior 17, sl-0073).
  // 7: macro-zones layer (behavior 18, dusk round 5).
  // 8: zonal danger assignment (behavior 19, dusk round 6).
  // 9: sanctuary scaling feeds banding (behavior 20, dusk round 7).
  plan: 9,
  // 7: sanctuary scaling feeds candidate exclusion (behavior 20).
  placement: 7,
  // 5: sanctuary scaling feeds hostile-ground growth (behavior 20).
  territory: 5,
  // 4: sanctuary scaling feeds G1/G3 ground checks (behavior 20).
  validate: 4,
  // 3: publish gate + releases (planning doc 18 §4, ratified 2026-07-30) —
  // export is a publishing act: it refuses dirty/unpushed source, embeds
  // the gated sourceCommit in the manifest (pack format 3), and uploads
  // the pack zip as a non-overwriting GitHub release.
  export: 3,
} as const;

export const RECIPE_FORMAT = 1;
export const PLAN_FORMAT = 1;
// Placements format 2 appends the encounter_site.v1 rule value; the
// field shapes are unchanged from format 1.
export const PLACEMENTS_FORMAT = 2;
export const SUPPORTED_PLACEMENTS_FORMATS: readonly number[] = [1, 2];
export const TERRITORIES_FORMAT = 1;
export const REPORT_FORMAT = 1;
// Pack format 2 = format 1 with placementsFormat 2 (encounter sites).
// Pack format 3 = format 2 plus exactly one append: the OPTIONAL manifest
// field sourceCommit (the pushed commit the publish gate proved, embedded
// by gated exports; development-bypass builds omit it). Formats 1-2 are
// frozen and do not carry the field; readers accept all three.
export const CONTENT_PACK_FORMAT = 3;
export const SUPPORTED_CONTENT_PACK_FORMATS: readonly number[] = [1, 2, 3];
/** Per pack format: placements format, legal rules, manifest provenance. */
export const PACK_FORMAT_PROFILE: Readonly<Record<number, {
  readonly placementsFormat: number;
  readonly placementRules: readonly string[];
  readonly manifestSourceCommit: "refused" | "optional";
}>> = {
  1: { placementsFormat: 1, placementRules: ["world_boss.v1", "dungeon_binding.v1"], manifestSourceCommit: "refused" },
  2: { placementsFormat: 2, placementRules: ["world_boss.v1", "dungeon_binding.v1", "encounter_site.v1"], manifestSourceCommit: "refused" },
  3: { placementsFormat: 2, placementRules: ["world_boss.v1", "dungeon_binding.v1", "encounter_site.v1"], manifestSourceCommit: "optional" },
};
