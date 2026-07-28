/**
 * World Filler version identity. Every derived output stamps these; a
 * behavior change bumps DIRECTOR_BEHAVIOR_VERSION plus the touched rule
 * packs, sequentially, mirroring the upstream versioning doctrine.
 */

export const DIRECTOR_BEHAVIOR_VERSION = 4;

export const RULE_PACK_VERSIONS = {
  analysis: 1,
  plan: 1,
  placement: 2,
  territory: 2,
  validate: 1,
} as const;

export const RECIPE_FORMAT = 1;
export const PLAN_FORMAT = 1;
export const PLACEMENTS_FORMAT = 1;
export const TERRITORIES_FORMAT = 1;
export const REPORT_FORMAT = 1;
