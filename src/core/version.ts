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
export const DIRECTOR_BEHAVIOR_VERSION = 7;

export const RULE_PACK_VERSIONS = {
  analysis: 1,
  plan: 2,
  placement: 4,
  territory: 3,
  validate: 2,
  export: 2,
} as const;

export const RECIPE_FORMAT = 1;
export const PLAN_FORMAT = 1;
export const PLACEMENTS_FORMAT = 1;
export const TERRITORIES_FORMAT = 1;
export const REPORT_FORMAT = 1;
export const CONTENT_PACK_FORMAT = 1;
