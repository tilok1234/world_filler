import { canonicalJson } from "../core/canonicalJson.js";
import { sha256Hex } from "../core/sha256.js";
import { RECIPE_FORMAT } from "../core/version.js";

/**
 * The DirectorRecipe: the single authored input. F3 vocabulary covers the
 * danger model and regional budgets; placement-rule and pin/lock
 * vocabulary arrives with the milestones that implement it (doctrine:
 * vocabulary is rejected until its solver exists). Unknown keys are named
 * errors, never ignored — a typo must fail loudly.
 */

export class RecipeError extends Error {}

export interface DangerOverride {
  readonly regionId: string;
  readonly band: number;
}

export interface RegionReroll {
  readonly regionId: string;
  readonly iteration: number;
}

export interface DirectorRecipe {
  readonly recipeFormat: number;
  readonly name: string;
  readonly directorSeed: number;
  readonly base: { readonly generationIdentitySha256: string | null };
  readonly danger: {
    readonly bandCount: number;
    readonly maxBandJump: number;
    readonly safeZoneShareForBand0Permille: number;
    readonly overrides: readonly DangerOverride[];
  };
  readonly budgets: {
    readonly minRegionCells: number;
    readonly majorRegionCells: number;
    readonly territoriesPer1000Walkable: number;
    readonly territoryCapPerRegion: number;
    readonly encountersPer1000Walkable: number;
    readonly encounterCapPerRegion: number;
    readonly dungeonCapPerRegion: number;
    readonly worldBossCount: number;
    readonly minWorldBossBand: number;
  };
  readonly dungeonAnchors: {
    readonly poiTypes: readonly string[];
  };
  readonly worldBossRule: {
    readonly minClearance: number;
    readonly minSettlementPathDistance: number;
    readonly minPeerPathDistance: number;
    readonly exclusionRadius: number;
    readonly clearancePermille: number;
    readonly settlementFarPermille: number;
    readonly roadFarPermille: number;
  };
  readonly dungeonRule: {
    readonly exclusionRadius: number;
    readonly settlementFarPermille: number;
  };
  readonly rerolls: readonly RegionReroll[];
}

const DEFAULT_DUNGEON_POI_TYPES = [
  "poi.cave",
  "poi.mine",
  "poi.crypt",
  "poi.ruin",
  "poi.city_ruin",
  "poi.beast_den",
  "poi.giant_skeleton",
];

interface FieldSpec {
  readonly min: number;
  readonly max: number;
  readonly fallback: number;
}

const DANGER_FIELDS: Readonly<Record<string, FieldSpec>> = {
  bandCount: { min: 2, max: 16, fallback: 5 },
  maxBandJump: { min: 1, max: 8, fallback: 2 },
  safeZoneShareForBand0Permille: { min: 0, max: 1000, fallback: 300 },
};

const WORLD_BOSS_RULE_FIELDS: Readonly<Record<string, FieldSpec>> = {
  minClearance: { min: 2, max: 21, fallback: 6 },
  minSettlementPathDistance: { min: 0, max: 10000, fallback: 20 },
  minPeerPathDistance: { min: 0, max: 100000, fallback: 80 },
  exclusionRadius: { min: 1, max: 128, fallback: 16 },
  clearancePermille: { min: 0, max: 1000, fallback: 600 },
  settlementFarPermille: { min: 0, max: 1000, fallback: 800 },
  roadFarPermille: { min: 0, max: 1000, fallback: 500 },
};

const DUNGEON_RULE_FIELDS: Readonly<Record<string, FieldSpec>> = {
  exclusionRadius: { min: 1, max: 128, fallback: 8 },
  settlementFarPermille: { min: 0, max: 1000, fallback: 1000 },
};

const BUDGET_FIELDS: Readonly<Record<string, FieldSpec>> = {
  minRegionCells: { min: 1, max: 1_000_000, fallback: 64 },
  majorRegionCells: { min: 1, max: 1_000_000, fallback: 800 },
  territoriesPer1000Walkable: { min: 0, max: 1000, fallback: 12 },
  territoryCapPerRegion: { min: 0, max: 64, fallback: 4 },
  encountersPer1000Walkable: { min: 0, max: 1000, fallback: 8 },
  encounterCapPerRegion: { min: 0, max: 64, fallback: 6 },
  dungeonCapPerRegion: { min: 0, max: 64, fallback: 2 },
  worldBossCount: { min: 0, max: 64, fallback: 1 },
  minWorldBossBand: { min: 0, max: 15, fallback: 2 },
};

function requireObject(value: unknown, path: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new RecipeError(`recipe: ${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function rejectUnknownKeys(record: Record<string, unknown>, allowed: readonly string[], path: string): void {
  for (const key of Object.keys(record)) {
    if (!allowed.includes(key)) {
      throw new RecipeError(`recipe: unknown key ${path}.${key} (supported: ${allowed.join(", ")})`);
    }
  }
}

function integerField(record: Record<string, unknown>, key: string, spec: FieldSpec, path: string): number {
  const value = record[key];
  if (value === undefined) return spec.fallback;
  if (!Number.isInteger(value) || (value as number) < spec.min || (value as number) > spec.max) {
    throw new RecipeError(`recipe: ${path}.${key} must be an integer in [${spec.min}, ${spec.max}], got ${String(value)}`);
  }
  return value as number;
}

function sectionOf(
  raw: Record<string, unknown>,
  section: string,
  fields: Readonly<Record<string, FieldSpec>>,
  extraAllowed: readonly string[] = [],
): Record<string, number> {
  const record = raw[section] === undefined ? {} : requireObject(raw[section], `$.${section}`);
  rejectUnknownKeys(record, [...Object.keys(fields), ...extraAllowed], `$.${section}`);
  const out: Record<string, number> = {};
  for (const [key, spec] of Object.entries(fields)) {
    out[key] = integerField(record, key, spec, `$.${section}`);
  }
  return out;
}

/** Validate and normalize a raw recipe object into explicit form. */
export function normalizeRecipe(input: unknown): DirectorRecipe {
  const raw = requireObject(input, "$");
  rejectUnknownKeys(
    raw,
    ["recipeFormat", "name", "directorSeed", "base", "danger", "budgets", "dungeonAnchors", "worldBossRule", "dungeonRule", "rerolls"],
    "$",
  );

  if (raw["recipeFormat"] !== RECIPE_FORMAT) {
    throw new RecipeError(
      `recipe: unsupported recipeFormat ${String(raw["recipeFormat"])}; this compiler supports format ${RECIPE_FORMAT}`,
    );
  }
  const name = raw["name"];
  if (typeof name !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
    throw new RecipeError("recipe: name must be a lowercase-kebab identifier");
  }
  const directorSeed = raw["directorSeed"];
  if (!Number.isSafeInteger(directorSeed) || (directorSeed as number) < 0) {
    throw new RecipeError("recipe: directorSeed must be a non-negative safe integer");
  }

  const baseRecord = raw["base"] === undefined ? {} : requireObject(raw["base"], "$.base");
  rejectUnknownKeys(baseRecord, ["generationIdentitySha256"], "$.base");
  const pin = baseRecord["generationIdentitySha256"];
  if (pin !== undefined && (typeof pin !== "string" || !/^[0-9a-f]{64}$/.test(pin))) {
    throw new RecipeError("recipe: base.generationIdentitySha256 must be a 64-hex sha256");
  }

  const danger = sectionOf(raw, "danger", DANGER_FIELDS, ["overrides"]);
  const dangerRecord = raw["danger"] === undefined ? {} : requireObject(raw["danger"], "$.danger");
  const overridesRaw = dangerRecord["overrides"] === undefined ? [] : dangerRecord["overrides"];
  if (!Array.isArray(overridesRaw)) throw new RecipeError("recipe: $.danger.overrides must be an array");
  const overrides: DangerOverride[] = overridesRaw.map((entry, i) => {
    const record = requireObject(entry, `$.danger.overrides[${i}]`);
    rejectUnknownKeys(record, ["regionId", "band"], `$.danger.overrides[${i}]`);
    const regionId = record["regionId"];
    const band = record["band"];
    if (typeof regionId !== "string" || regionId === "") {
      throw new RecipeError(`recipe: $.danger.overrides[${i}].regionId must be a region id`);
    }
    if (!Number.isInteger(band) || (band as number) < 0 || (band as number) >= (danger["bandCount"] as number)) {
      throw new RecipeError(
        `recipe: $.danger.overrides[${i}].band must be an integer in [0, ${(danger["bandCount"] as number) - 1}]`,
      );
    }
    return { regionId, band: band as number };
  });
  overrides.sort((a, b) => (a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0));
  for (let i = 1; i < overrides.length; i += 1) {
    if ((overrides[i] as DangerOverride).regionId === (overrides[i - 1] as DangerOverride).regionId) {
      throw new RecipeError(`recipe: duplicate danger override for ${(overrides[i] as DangerOverride).regionId}`);
    }
  }

  const budgets = sectionOf(raw, "budgets", BUDGET_FIELDS);
  if ((budgets["majorRegionCells"] as number) < (budgets["minRegionCells"] as number)) {
    throw new RecipeError("recipe: budgets.majorRegionCells must be >= budgets.minRegionCells");
  }

  const anchorsRecord = raw["dungeonAnchors"] === undefined ? {} : requireObject(raw["dungeonAnchors"], "$.dungeonAnchors");
  rejectUnknownKeys(anchorsRecord, ["poiTypes"], "$.dungeonAnchors");
  const poiTypesRaw = anchorsRecord["poiTypes"] === undefined ? DEFAULT_DUNGEON_POI_TYPES : anchorsRecord["poiTypes"];
  if (!Array.isArray(poiTypesRaw) || poiTypesRaw.some((entry) => typeof entry !== "string" || !entry.startsWith("poi."))) {
    throw new RecipeError("recipe: dungeonAnchors.poiTypes must be an array of poi.* type names");
  }
  const poiTypes = [...new Set(poiTypesRaw as string[])].sort();

  const worldBossRule = sectionOf(raw, "worldBossRule", WORLD_BOSS_RULE_FIELDS);
  const dungeonRule = sectionOf(raw, "dungeonRule", DUNGEON_RULE_FIELDS);

  const rerollsRaw = raw["rerolls"] === undefined ? [] : raw["rerolls"];
  if (!Array.isArray(rerollsRaw)) throw new RecipeError("recipe: $.rerolls must be an array");
  const rerolls: RegionReroll[] = rerollsRaw.map((entry, i) => {
    const record = requireObject(entry, `$.rerolls[${i}]`);
    rejectUnknownKeys(record, ["regionId", "iteration"], `$.rerolls[${i}]`);
    const regionId = record["regionId"];
    const iteration = record["iteration"];
    if (typeof regionId !== "string" || regionId === "") {
      throw new RecipeError(`recipe: $.rerolls[${i}].regionId must be a region id`);
    }
    if (!Number.isInteger(iteration) || (iteration as number) < 0 || (iteration as number) > 1000) {
      throw new RecipeError(`recipe: $.rerolls[${i}].iteration must be an integer in [0, 1000]`);
    }
    return { regionId, iteration: iteration as number };
  });
  rerolls.sort((a, b) => (a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0));
  for (let i = 1; i < rerolls.length; i += 1) {
    if ((rerolls[i] as RegionReroll).regionId === (rerolls[i - 1] as RegionReroll).regionId) {
      throw new RecipeError(`recipe: duplicate reroll for ${(rerolls[i] as RegionReroll).regionId}`);
    }
  }

  return {
    recipeFormat: RECIPE_FORMAT,
    name,
    directorSeed: directorSeed as number,
    base: { generationIdentitySha256: pin === undefined ? null : (pin as string) },
    danger: {
      bandCount: danger["bandCount"] as number,
      maxBandJump: danger["maxBandJump"] as number,
      safeZoneShareForBand0Permille: danger["safeZoneShareForBand0Permille"] as number,
      overrides,
    },
    budgets: {
      minRegionCells: budgets["minRegionCells"] as number,
      majorRegionCells: budgets["majorRegionCells"] as number,
      territoriesPer1000Walkable: budgets["territoriesPer1000Walkable"] as number,
      territoryCapPerRegion: budgets["territoryCapPerRegion"] as number,
      encountersPer1000Walkable: budgets["encountersPer1000Walkable"] as number,
      encounterCapPerRegion: budgets["encounterCapPerRegion"] as number,
      dungeonCapPerRegion: budgets["dungeonCapPerRegion"] as number,
      worldBossCount: budgets["worldBossCount"] as number,
      minWorldBossBand: budgets["minWorldBossBand"] as number,
    },
    dungeonAnchors: { poiTypes },
    worldBossRule: {
      minClearance: worldBossRule["minClearance"] as number,
      minSettlementPathDistance: worldBossRule["minSettlementPathDistance"] as number,
      minPeerPathDistance: worldBossRule["minPeerPathDistance"] as number,
      exclusionRadius: worldBossRule["exclusionRadius"] as number,
      clearancePermille: worldBossRule["clearancePermille"] as number,
      settlementFarPermille: worldBossRule["settlementFarPermille"] as number,
      roadFarPermille: worldBossRule["roadFarPermille"] as number,
    },
    dungeonRule: {
      exclusionRadius: dungeonRule["exclusionRadius"] as number,
      settlementFarPermille: dungeonRule["settlementFarPermille"] as number,
    },
    rerolls,
  };
}

/** Identity of the normalized recipe: sha256 over canonical JSON bytes. */
export function recipeSha256(recipe: DirectorRecipe): string {
  return sha256Hex(canonicalJson(recipe));
}
