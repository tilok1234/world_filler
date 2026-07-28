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
    /**
     * How wilderness bands are assigned: "linear" splits the world's max
     * spawn distance evenly (the deepest band exists only in the single
     * farthest pocket); "quantile" gives each band an equal share of
     * reachable walkable ground, so deep bands exist in meaningful
     * quantity wherever the topology puts them.
     */
    readonly assignment: "linear" | "quantile";
    /**
     * 0 = off. With K >= 2: the deepest band is reshaped into K compact
     * pockets around mutually far-apart seed regions; deep regions
     * bridging the gaps demote one band, so endgame zones read as
     * separate destinations instead of one far crescent.
     */
    readonly endgamePockets: number;
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
    /** Scale-free floor: permille of the world's max settlement distance (0 = off). */
    readonly minSettlementDistancePermille: number;
    /** Scale-free floor: permille of the world's max road distance (0 = off). */
    readonly minRoadDistancePermille: number;
    readonly minPeerPathDistance: number;
    readonly exclusionRadius: number;
    readonly clearancePermille: number;
    readonly settlementFarPermille: number;
    readonly roadFarPermille: number;
  };
  readonly dungeonRule: {
    readonly exclusionRadius: number;
    readonly settlementFarPermille: number;
    /** Scale-free floor: anchors closer to settlements than this permille of the world max are not bound (0 = off). */
    readonly minSettlementDistancePermille: number;
  };
  readonly territoryRule: {
    readonly targetHostileCoveragePermille: number;
    /** Chebyshev gap kept clear between territories (0 = they may touch). */
    readonly spacing: number;
    readonly minCells: number;
    readonly maxCells: number;
    readonly packSizeMin: number;
    readonly packSizeMax: number;
    readonly maxActivePer100Cells: number;
    readonly elitePermille: number;
    readonly respawnPressure: "low" | "medium" | "high";
  };
  readonly contentLibrary: {
    readonly enemies: readonly EnemyDef[];
  };
  readonly rerolls: readonly RegionReroll[];
  readonly locks: {
    readonly placements: readonly PlacementLock[];
  };
  readonly paint: {
    readonly noContent: readonly PaintRect[];
    readonly preferContent: readonly PreferRect[];
  };
}

export interface PlacementLock {
  readonly id: string;
  readonly rule: "world_boss.v1" | "dungeon_binding.v1";
  readonly regionId: string;
  readonly cell: readonly [number, number];
  readonly exclusionRadius: number;
  readonly anchorPoiId: number | null;
  readonly arenaOrigin: readonly [number, number] | null;
  readonly arenaSide: number | null;
}

export interface PaintRect {
  readonly rect: readonly [number, number, number, number];
}

export interface PreferRect {
  readonly rect: readonly [number, number, number, number];
  readonly bonusPermille: number;
}

export interface EnemyDef {
  readonly id: string;
  readonly biomes: readonly string[];
  readonly minBand: number;
  readonly maxBand: number;
  readonly weightPercent: number;
  readonly nightOnly: boolean;
}

/**
 * Placeholder roster vocabulary so the pipeline demonstrates end-to-end on
 * fixture worlds. A real game supplies its own library; these ids are
 * deliberately generic and carry no upstream meaning.
 */
const DEFAULT_ENEMIES: readonly EnemyDef[] = [
  { id: "enemy.prowler", biomes: ["terrain.grass", "terrain.dry_grass"], minBand: 0, maxBand: 5, weightPercent: 40, nightOnly: false },
  { id: "enemy.mire_creeper", biomes: ["terrain.mud", "terrain.swamp"], minBand: 0, maxBand: 8, weightPercent: 35, nightOnly: false },
  { id: "enemy.gravel_lurker", biomes: ["terrain.gravel", "terrain.sand"], minBand: 0, maxBand: 8, weightPercent: 30, nightOnly: false },
  { id: "enemy.frost_wraith", biomes: ["terrain.snow"], minBand: 0, maxBand: 12, weightPercent: 30, nightOnly: false },
  {
    id: "enemy.marauder",
    biomes: [
      "terrain.grass", "terrain.dry_grass", "terrain.mud", "terrain.gravel",
      "terrain.snow", "terrain.sand", "terrain.cobble", "terrain.packed_road",
    ],
    minBand: 1,
    maxBand: 15,
    weightPercent: 20,
    nightOnly: false,
  },
  {
    id: "enemy.night_shade",
    biomes: ["terrain.grass", "terrain.dry_grass", "terrain.mud", "terrain.snow"],
    minBand: 2,
    maxBand: 15,
    weightPercent: 15,
    nightOnly: true,
  },
];

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
  endgamePockets: { min: 0, max: 8, fallback: 0 },
};

const WORLD_BOSS_RULE_FIELDS: Readonly<Record<string, FieldSpec>> = {
  minClearance: { min: 2, max: 21, fallback: 6 },
  minSettlementPathDistance: { min: 0, max: 10000, fallback: 20 },
  minSettlementDistancePermille: { min: 0, max: 1000, fallback: 0 },
  minRoadDistancePermille: { min: 0, max: 1000, fallback: 0 },
  minPeerPathDistance: { min: 0, max: 100000, fallback: 80 },
  exclusionRadius: { min: 1, max: 128, fallback: 16 },
  clearancePermille: { min: 0, max: 1000, fallback: 600 },
  settlementFarPermille: { min: 0, max: 1000, fallback: 800 },
  roadFarPermille: { min: 0, max: 1000, fallback: 500 },
};

const DUNGEON_RULE_FIELDS: Readonly<Record<string, FieldSpec>> = {
  exclusionRadius: { min: 1, max: 128, fallback: 8 },
  settlementFarPermille: { min: 0, max: 1000, fallback: 1000 },
  minSettlementDistancePermille: { min: 0, max: 1000, fallback: 0 },
};

const TERRITORY_RULE_FIELDS: Readonly<Record<string, FieldSpec>> = {
  targetHostileCoveragePermille: { min: 0, max: 1000, fallback: 350 },
  spacing: { min: 0, max: 32, fallback: 0 },
  minCells: { min: 1, max: 10000, fallback: 24 },
  maxCells: { min: 1, max: 100000, fallback: 400 },
  packSizeMin: { min: 1, max: 64, fallback: 2 },
  packSizeMax: { min: 1, max: 64, fallback: 6 },
  maxActivePer100Cells: { min: 1, max: 1000, fallback: 8 },
  elitePermille: { min: 0, max: 1000, fallback: 30 },
};

const RESPAWN_PRESSURES = ["low", "medium", "high"] as const;

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
    [
      "recipeFormat", "name", "directorSeed", "base", "danger", "budgets", "dungeonAnchors",
      "worldBossRule", "dungeonRule", "territoryRule", "contentLibrary", "rerolls", "locks", "paint",
    ],
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

  const danger = sectionOf(raw, "danger", DANGER_FIELDS, ["overrides", "assignment"]);
  const dangerRecord = raw["danger"] === undefined ? {} : requireObject(raw["danger"], "$.danger");
  const assignmentRaw = dangerRecord["assignment"] === undefined ? "linear" : dangerRecord["assignment"];
  if (assignmentRaw !== "linear" && assignmentRaw !== "quantile") {
    throw new RecipeError(`recipe: $.danger.assignment must be linear or quantile, got ${String(assignmentRaw)}`);
  }
  if (danger["endgamePockets"] === 1) {
    throw new RecipeError("recipe: $.danger.endgamePockets must be 0 (off) or an integer in [2, 8]");
  }
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

  const territoryRule = sectionOf(raw, "territoryRule", TERRITORY_RULE_FIELDS, ["respawnPressure"]);
  const territoryRecord = raw["territoryRule"] === undefined ? {} : requireObject(raw["territoryRule"], "$.territoryRule");
  const respawnRaw = territoryRecord["respawnPressure"] === undefined ? "medium" : territoryRecord["respawnPressure"];
  if (typeof respawnRaw !== "string" || !RESPAWN_PRESSURES.includes(respawnRaw as (typeof RESPAWN_PRESSURES)[number])) {
    throw new RecipeError(`recipe: $.territoryRule.respawnPressure must be one of ${RESPAWN_PRESSURES.join(", ")}`);
  }
  if ((territoryRule["packSizeMax"] as number) < (territoryRule["packSizeMin"] as number)) {
    throw new RecipeError("recipe: territoryRule.packSizeMax must be >= packSizeMin");
  }
  if ((territoryRule["maxCells"] as number) < (territoryRule["minCells"] as number)) {
    throw new RecipeError("recipe: territoryRule.maxCells must be >= minCells");
  }

  const libraryRecord = raw["contentLibrary"] === undefined ? {} : requireObject(raw["contentLibrary"], "$.contentLibrary");
  rejectUnknownKeys(libraryRecord, ["enemies"], "$.contentLibrary");
  const enemiesRaw = libraryRecord["enemies"] === undefined ? DEFAULT_ENEMIES : libraryRecord["enemies"];
  if (!Array.isArray(enemiesRaw) || enemiesRaw.length === 0) {
    throw new RecipeError("recipe: $.contentLibrary.enemies must be a non-empty array");
  }
  const enemies: EnemyDef[] = enemiesRaw.map((entry, i) => {
    const record = requireObject(entry, `$.contentLibrary.enemies[${i}]`);
    rejectUnknownKeys(record, ["id", "biomes", "minBand", "maxBand", "weightPercent", "nightOnly"], `$.contentLibrary.enemies[${i}]`);
    const id = record["id"];
    if (typeof id !== "string" || !/^enemy\.[a-z][a-z0-9_]*$/.test(id)) {
      throw new RecipeError(`recipe: $.contentLibrary.enemies[${i}].id must match enemy.<lower_snake>`);
    }
    const biomes = record["biomes"];
    if (!Array.isArray(biomes) || biomes.length === 0 || biomes.some((b) => typeof b !== "string" || !/^(terrain|water)\./.test(b))) {
      throw new RecipeError(`recipe: $.contentLibrary.enemies[${i}].biomes must be terrain.*/water.* names`);
    }
    const minBand = record["minBand"] ?? 0;
    const maxBand = record["maxBand"] ?? 15;
    if (!Number.isInteger(minBand) || !Number.isInteger(maxBand) || (minBand as number) < 0 || (maxBand as number) > 15 || (maxBand as number) < (minBand as number)) {
      throw new RecipeError(`recipe: $.contentLibrary.enemies[${i}] band range must satisfy 0 <= minBand <= maxBand <= 15`);
    }
    const weight = record["weightPercent"];
    if (!Number.isInteger(weight) || (weight as number) < 1 || (weight as number) > 100) {
      throw new RecipeError(`recipe: $.contentLibrary.enemies[${i}].weightPercent must be an integer in [1, 100]`);
    }
    const nightOnly = record["nightOnly"] ?? false;
    if (typeof nightOnly !== "boolean") {
      throw new RecipeError(`recipe: $.contentLibrary.enemies[${i}].nightOnly must be a boolean`);
    }
    return {
      id,
      biomes: [...new Set(biomes as string[])].sort(),
      minBand: minBand as number,
      maxBand: maxBand as number,
      weightPercent: weight as number,
      nightOnly,
    };
  });
  enemies.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let i = 1; i < enemies.length; i += 1) {
    if ((enemies[i] as EnemyDef).id === (enemies[i - 1] as EnemyDef).id) {
      throw new RecipeError(`recipe: duplicate enemy id ${(enemies[i] as EnemyDef).id}`);
    }
  }

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

  const parseCellPair = (value: unknown, path: string): readonly [number, number] => {
    if (!Array.isArray(value) || value.length !== 2 || !Number.isInteger(value[0]) || !Number.isInteger(value[1]) || (value[0] as number) < 0 || (value[1] as number) < 0) {
      throw new RecipeError(`recipe: ${path} must be a [x, y] pair of non-negative integers`);
    }
    return [value[0] as number, value[1] as number];
  };
  const parseRect = (value: unknown, path: string): readonly [number, number, number, number] => {
    if (
      !Array.isArray(value) || value.length !== 4 ||
      value.some((entry) => !Number.isInteger(entry) || (entry as number) < 0)
    ) {
      throw new RecipeError(`recipe: ${path} must be [x0, y0, x1, y1] non-negative integers`);
    }
    const [x0, y0, x1, y1] = value as [number, number, number, number];
    if (x1 < x0 || y1 < y0) throw new RecipeError(`recipe: ${path} must satisfy x0 <= x1 and y0 <= y1`);
    return [x0, y0, x1, y1];
  };

  const locksRecord = raw["locks"] === undefined ? {} : requireObject(raw["locks"], "$.locks");
  rejectUnknownKeys(locksRecord, ["placements"], "$.locks");
  const locksRaw = locksRecord["placements"] === undefined ? [] : locksRecord["placements"];
  if (!Array.isArray(locksRaw)) throw new RecipeError("recipe: $.locks.placements must be an array");
  const lockPlacements: PlacementLock[] = locksRaw.map((entry, i) => {
    const record = requireObject(entry, `$.locks.placements[${i}]`);
    rejectUnknownKeys(
      record,
      ["id", "rule", "regionId", "cell", "exclusionRadius", "anchorPoiId", "arenaOrigin", "arenaSide"],
      `$.locks.placements[${i}]`,
    );
    const id = record["id"];
    const rule = record["rule"];
    const regionId = record["regionId"];
    if (rule !== "world_boss.v1" && rule !== "dungeon_binding.v1") {
      throw new RecipeError(`recipe: $.locks.placements[${i}].rule must be world_boss.v1 or dungeon_binding.v1`);
    }
    if (typeof regionId !== "string" || regionId === "") {
      throw new RecipeError(`recipe: $.locks.placements[${i}].regionId must be a region id`);
    }
    // Lock ids must follow the frozen id scheme AND agree with the lock's
    // own rule and regionId — ids that lie about their rule or region would
    // otherwise ship verbatim in an audited pack (freeze-review finding).
    const ruleTag = rule === "world_boss.v1" ? "world_boss" : "dungeon";
    const idPrefix = `placement.${ruleTag}.${regionId}.`;
    if (typeof id !== "string" || !id.startsWith(idPrefix) || !/^(0|[1-9][0-9]*)$/.test(id.slice(idPrefix.length))) {
      throw new RecipeError(
        `recipe: $.locks.placements[${i}].id must be ${idPrefix}<slot> (the documented id scheme, ` +
          `matching this lock's rule and regionId)`,
      );
    }
    const cell = parseCellPair(record["cell"], `$.locks.placements[${i}].cell`);
    const exclusionRadius = record["exclusionRadius"];
    if (!Number.isInteger(exclusionRadius) || (exclusionRadius as number) < 1 || (exclusionRadius as number) > 128) {
      throw new RecipeError(`recipe: $.locks.placements[${i}].exclusionRadius must be an integer in [1, 128]`);
    }
    const anchorPoiId = record["anchorPoiId"] ?? null;
    if (anchorPoiId !== null && !Number.isInteger(anchorPoiId)) {
      throw new RecipeError(`recipe: $.locks.placements[${i}].anchorPoiId must be an integer or null`);
    }
    const arenaOriginRaw = record["arenaOrigin"] ?? null;
    const arenaOrigin = arenaOriginRaw === null ? null : parseCellPair(arenaOriginRaw, `$.locks.placements[${i}].arenaOrigin`);
    const arenaSide = record["arenaSide"] ?? null;
    if (arenaSide !== null && (!Number.isInteger(arenaSide) || (arenaSide as number) < 2 || (arenaSide as number) > 21)) {
      throw new RecipeError(`recipe: $.locks.placements[${i}].arenaSide must be an integer in [2, 21] or null`);
    }
    if (rule === "world_boss.v1" && (arenaOrigin === null || arenaSide === null)) {
      throw new RecipeError(`recipe: $.locks.placements[${i}]: world_boss locks require arenaOrigin and arenaSide`);
    }
    if (rule === "dungeon_binding.v1" && anchorPoiId === null) {
      throw new RecipeError(`recipe: $.locks.placements[${i}]: dungeon locks require anchorPoiId`);
    }
    return {
      id,
      rule: rule as PlacementLock["rule"],
      regionId,
      cell,
      exclusionRadius: exclusionRadius as number,
      anchorPoiId: anchorPoiId as number | null,
      arenaOrigin,
      arenaSide: arenaSide as number | null,
    };
  });
  lockPlacements.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (let i = 1; i < lockPlacements.length; i += 1) {
    if ((lockPlacements[i] as PlacementLock).id === (lockPlacements[i - 1] as PlacementLock).id) {
      throw new RecipeError(`recipe: duplicate lock for ${(lockPlacements[i] as PlacementLock).id}`);
    }
  }

  const paintRecord = raw["paint"] === undefined ? {} : requireObject(raw["paint"], "$.paint");
  rejectUnknownKeys(paintRecord, ["noContent", "preferContent"], "$.paint");
  const noContentRaw = paintRecord["noContent"] === undefined ? [] : paintRecord["noContent"];
  const preferRaw = paintRecord["preferContent"] === undefined ? [] : paintRecord["preferContent"];
  if (!Array.isArray(noContentRaw) || !Array.isArray(preferRaw)) {
    throw new RecipeError("recipe: $.paint.noContent and $.paint.preferContent must be arrays");
  }
  const noContent: PaintRect[] = noContentRaw.map((entry, i) => {
    const record = requireObject(entry, `$.paint.noContent[${i}]`);
    rejectUnknownKeys(record, ["rect"], `$.paint.noContent[${i}]`);
    return { rect: parseRect(record["rect"], `$.paint.noContent[${i}].rect`) };
  });
  const preferContent: PreferRect[] = preferRaw.map((entry, i) => {
    const record = requireObject(entry, `$.paint.preferContent[${i}]`);
    rejectUnknownKeys(record, ["rect", "bonusPermille"], `$.paint.preferContent[${i}]`);
    const bonus = record["bonusPermille"];
    if (!Number.isInteger(bonus) || (bonus as number) < 1 || (bonus as number) > 1000) {
      throw new RecipeError(`recipe: $.paint.preferContent[${i}].bonusPermille must be an integer in [1, 1000]`);
    }
    return { rect: parseRect(record["rect"], `$.paint.preferContent[${i}].rect`), bonusPermille: bonus as number };
  });

  return {
    recipeFormat: RECIPE_FORMAT,
    name,
    directorSeed: directorSeed as number,
    base: { generationIdentitySha256: pin === undefined ? null : (pin as string) },
    danger: {
      bandCount: danger["bandCount"] as number,
      maxBandJump: danger["maxBandJump"] as number,
      safeZoneShareForBand0Permille: danger["safeZoneShareForBand0Permille"] as number,
      assignment: assignmentRaw,
      endgamePockets: danger["endgamePockets"] as number,
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
      minSettlementDistancePermille: worldBossRule["minSettlementDistancePermille"] as number,
      minRoadDistancePermille: worldBossRule["minRoadDistancePermille"] as number,
      minPeerPathDistance: worldBossRule["minPeerPathDistance"] as number,
      exclusionRadius: worldBossRule["exclusionRadius"] as number,
      clearancePermille: worldBossRule["clearancePermille"] as number,
      settlementFarPermille: worldBossRule["settlementFarPermille"] as number,
      roadFarPermille: worldBossRule["roadFarPermille"] as number,
    },
    dungeonRule: {
      exclusionRadius: dungeonRule["exclusionRadius"] as number,
      settlementFarPermille: dungeonRule["settlementFarPermille"] as number,
      minSettlementDistancePermille: dungeonRule["minSettlementDistancePermille"] as number,
    },
    territoryRule: {
      targetHostileCoveragePermille: territoryRule["targetHostileCoveragePermille"] as number,
      spacing: territoryRule["spacing"] as number,
      minCells: territoryRule["minCells"] as number,
      maxCells: territoryRule["maxCells"] as number,
      packSizeMin: territoryRule["packSizeMin"] as number,
      packSizeMax: territoryRule["packSizeMax"] as number,
      maxActivePer100Cells: territoryRule["maxActivePer100Cells"] as number,
      elitePermille: territoryRule["elitePermille"] as number,
      respawnPressure: respawnRaw as "low" | "medium" | "high",
    },
    contentLibrary: { enemies },
    rerolls,
    locks: { placements: lockPlacements },
    paint: { noContent, preferContent },
  };
}

/** Identity of the normalized recipe: sha256 over canonical JSON bytes. */
export function recipeSha256(recipe: DirectorRecipe): string {
  return sha256Hex(canonicalJson(recipe));
}
