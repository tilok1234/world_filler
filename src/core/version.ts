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
export const DIRECTOR_BEHAVIOR_VERSION = 12;

export const RULE_PACK_VERSIONS = {
  analysis: 2,
  plan: 5,
  placement: 6,
  territory: 4,
  validate: 3,
  export: 2,
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
// Format-1 packs remain valid; readers accept both.
export const CONTENT_PACK_FORMAT = 2;
export const SUPPORTED_CONTENT_PACK_FORMATS: readonly number[] = [1, 2];
/** Per pack format: the placements format and legal placement rules. */
export const PACK_FORMAT_PROFILE: Readonly<Record<number, {
  readonly placementsFormat: number;
  readonly placementRules: readonly string[];
}>> = {
  1: { placementsFormat: 1, placementRules: ["world_boss.v1", "dungeon_binding.v1"] },
  2: { placementsFormat: 2, placementRules: ["world_boss.v1", "dungeon_binding.v1", "encounter_site.v1"] },
};
