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
export class RecipeError extends Error {
}
/**
 * Placeholder roster vocabulary so the pipeline demonstrates end-to-end on
 * fixture worlds. A real game supplies its own library; these ids are
 * deliberately generic and carry no upstream meaning.
 */
const DEFAULT_ENEMIES = [
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
const DANGER_FIELDS = {
    bandCount: { min: 2, max: 16, fallback: 5 },
    maxBandJump: { min: 1, max: 8, fallback: 2 },
    safeZoneShareForBand0Permille: { min: 0, max: 1000, fallback: 300 },
};
const WORLD_BOSS_RULE_FIELDS = {
    minClearance: { min: 2, max: 21, fallback: 6 },
    minSettlementPathDistance: { min: 0, max: 10000, fallback: 20 },
    minPeerPathDistance: { min: 0, max: 100000, fallback: 80 },
    exclusionRadius: { min: 1, max: 128, fallback: 16 },
    clearancePermille: { min: 0, max: 1000, fallback: 600 },
    settlementFarPermille: { min: 0, max: 1000, fallback: 800 },
    roadFarPermille: { min: 0, max: 1000, fallback: 500 },
};
const DUNGEON_RULE_FIELDS = {
    exclusionRadius: { min: 1, max: 128, fallback: 8 },
    settlementFarPermille: { min: 0, max: 1000, fallback: 1000 },
};
const TERRITORY_RULE_FIELDS = {
    targetHostileCoveragePermille: { min: 0, max: 1000, fallback: 350 },
    minCells: { min: 1, max: 10000, fallback: 24 },
    maxCells: { min: 1, max: 100000, fallback: 400 },
    packSizeMin: { min: 1, max: 64, fallback: 2 },
    packSizeMax: { min: 1, max: 64, fallback: 6 },
    maxActivePer100Cells: { min: 1, max: 1000, fallback: 8 },
    elitePermille: { min: 0, max: 1000, fallback: 30 },
};
const RESPAWN_PRESSURES = ["low", "medium", "high"];
const BUDGET_FIELDS = {
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
function requireObject(value, path) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
        throw new RecipeError(`recipe: ${path} must be an object`);
    }
    return value;
}
function rejectUnknownKeys(record, allowed, path) {
    for (const key of Object.keys(record)) {
        if (!allowed.includes(key)) {
            throw new RecipeError(`recipe: unknown key ${path}.${key} (supported: ${allowed.join(", ")})`);
        }
    }
}
function integerField(record, key, spec, path) {
    const value = record[key];
    if (value === undefined)
        return spec.fallback;
    if (!Number.isInteger(value) || value < spec.min || value > spec.max) {
        throw new RecipeError(`recipe: ${path}.${key} must be an integer in [${spec.min}, ${spec.max}], got ${String(value)}`);
    }
    return value;
}
function sectionOf(raw, section, fields, extraAllowed = []) {
    const record = raw[section] === undefined ? {} : requireObject(raw[section], `$.${section}`);
    rejectUnknownKeys(record, [...Object.keys(fields), ...extraAllowed], `$.${section}`);
    const out = {};
    for (const [key, spec] of Object.entries(fields)) {
        out[key] = integerField(record, key, spec, `$.${section}`);
    }
    return out;
}
/** Validate and normalize a raw recipe object into explicit form. */
export function normalizeRecipe(input) {
    const raw = requireObject(input, "$");
    rejectUnknownKeys(raw, [
        "recipeFormat", "name", "directorSeed", "base", "danger", "budgets", "dungeonAnchors",
        "worldBossRule", "dungeonRule", "territoryRule", "contentLibrary", "rerolls", "locks", "paint",
    ], "$");
    if (raw["recipeFormat"] !== RECIPE_FORMAT) {
        throw new RecipeError(`recipe: unsupported recipeFormat ${String(raw["recipeFormat"])}; this compiler supports format ${RECIPE_FORMAT}`);
    }
    const name = raw["name"];
    if (typeof name !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(name)) {
        throw new RecipeError("recipe: name must be a lowercase-kebab identifier");
    }
    const directorSeed = raw["directorSeed"];
    if (!Number.isSafeInteger(directorSeed) || directorSeed < 0) {
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
    if (!Array.isArray(overridesRaw))
        throw new RecipeError("recipe: $.danger.overrides must be an array");
    const overrides = overridesRaw.map((entry, i) => {
        const record = requireObject(entry, `$.danger.overrides[${i}]`);
        rejectUnknownKeys(record, ["regionId", "band"], `$.danger.overrides[${i}]`);
        const regionId = record["regionId"];
        const band = record["band"];
        if (typeof regionId !== "string" || regionId === "") {
            throw new RecipeError(`recipe: $.danger.overrides[${i}].regionId must be a region id`);
        }
        if (!Number.isInteger(band) || band < 0 || band >= danger["bandCount"]) {
            throw new RecipeError(`recipe: $.danger.overrides[${i}].band must be an integer in [0, ${danger["bandCount"] - 1}]`);
        }
        return { regionId, band: band };
    });
    overrides.sort((a, b) => (a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0));
    for (let i = 1; i < overrides.length; i += 1) {
        if (overrides[i].regionId === overrides[i - 1].regionId) {
            throw new RecipeError(`recipe: duplicate danger override for ${overrides[i].regionId}`);
        }
    }
    const budgets = sectionOf(raw, "budgets", BUDGET_FIELDS);
    if (budgets["majorRegionCells"] < budgets["minRegionCells"]) {
        throw new RecipeError("recipe: budgets.majorRegionCells must be >= budgets.minRegionCells");
    }
    const anchorsRecord = raw["dungeonAnchors"] === undefined ? {} : requireObject(raw["dungeonAnchors"], "$.dungeonAnchors");
    rejectUnknownKeys(anchorsRecord, ["poiTypes"], "$.dungeonAnchors");
    const poiTypesRaw = anchorsRecord["poiTypes"] === undefined ? DEFAULT_DUNGEON_POI_TYPES : anchorsRecord["poiTypes"];
    if (!Array.isArray(poiTypesRaw) || poiTypesRaw.some((entry) => typeof entry !== "string" || !entry.startsWith("poi."))) {
        throw new RecipeError("recipe: dungeonAnchors.poiTypes must be an array of poi.* type names");
    }
    const poiTypes = [...new Set(poiTypesRaw)].sort();
    const worldBossRule = sectionOf(raw, "worldBossRule", WORLD_BOSS_RULE_FIELDS);
    const dungeonRule = sectionOf(raw, "dungeonRule", DUNGEON_RULE_FIELDS);
    const territoryRule = sectionOf(raw, "territoryRule", TERRITORY_RULE_FIELDS, ["respawnPressure"]);
    const territoryRecord = raw["territoryRule"] === undefined ? {} : requireObject(raw["territoryRule"], "$.territoryRule");
    const respawnRaw = territoryRecord["respawnPressure"] === undefined ? "medium" : territoryRecord["respawnPressure"];
    if (typeof respawnRaw !== "string" || !RESPAWN_PRESSURES.includes(respawnRaw)) {
        throw new RecipeError(`recipe: $.territoryRule.respawnPressure must be one of ${RESPAWN_PRESSURES.join(", ")}`);
    }
    if (territoryRule["packSizeMax"] < territoryRule["packSizeMin"]) {
        throw new RecipeError("recipe: territoryRule.packSizeMax must be >= packSizeMin");
    }
    if (territoryRule["maxCells"] < territoryRule["minCells"]) {
        throw new RecipeError("recipe: territoryRule.maxCells must be >= minCells");
    }
    const libraryRecord = raw["contentLibrary"] === undefined ? {} : requireObject(raw["contentLibrary"], "$.contentLibrary");
    rejectUnknownKeys(libraryRecord, ["enemies"], "$.contentLibrary");
    const enemiesRaw = libraryRecord["enemies"] === undefined ? DEFAULT_ENEMIES : libraryRecord["enemies"];
    if (!Array.isArray(enemiesRaw) || enemiesRaw.length === 0) {
        throw new RecipeError("recipe: $.contentLibrary.enemies must be a non-empty array");
    }
    const enemies = enemiesRaw.map((entry, i) => {
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
        if (!Number.isInteger(minBand) || !Number.isInteger(maxBand) || minBand < 0 || maxBand > 15 || maxBand < minBand) {
            throw new RecipeError(`recipe: $.contentLibrary.enemies[${i}] band range must satisfy 0 <= minBand <= maxBand <= 15`);
        }
        const weight = record["weightPercent"];
        if (!Number.isInteger(weight) || weight < 1 || weight > 100) {
            throw new RecipeError(`recipe: $.contentLibrary.enemies[${i}].weightPercent must be an integer in [1, 100]`);
        }
        const nightOnly = record["nightOnly"] ?? false;
        if (typeof nightOnly !== "boolean") {
            throw new RecipeError(`recipe: $.contentLibrary.enemies[${i}].nightOnly must be a boolean`);
        }
        return {
            id,
            biomes: [...new Set(biomes)].sort(),
            minBand: minBand,
            maxBand: maxBand,
            weightPercent: weight,
            nightOnly,
        };
    });
    enemies.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (let i = 1; i < enemies.length; i += 1) {
        if (enemies[i].id === enemies[i - 1].id) {
            throw new RecipeError(`recipe: duplicate enemy id ${enemies[i].id}`);
        }
    }
    const rerollsRaw = raw["rerolls"] === undefined ? [] : raw["rerolls"];
    if (!Array.isArray(rerollsRaw))
        throw new RecipeError("recipe: $.rerolls must be an array");
    const rerolls = rerollsRaw.map((entry, i) => {
        const record = requireObject(entry, `$.rerolls[${i}]`);
        rejectUnknownKeys(record, ["regionId", "iteration"], `$.rerolls[${i}]`);
        const regionId = record["regionId"];
        const iteration = record["iteration"];
        if (typeof regionId !== "string" || regionId === "") {
            throw new RecipeError(`recipe: $.rerolls[${i}].regionId must be a region id`);
        }
        if (!Number.isInteger(iteration) || iteration < 0 || iteration > 1000) {
            throw new RecipeError(`recipe: $.rerolls[${i}].iteration must be an integer in [0, 1000]`);
        }
        return { regionId, iteration: iteration };
    });
    rerolls.sort((a, b) => (a.regionId < b.regionId ? -1 : a.regionId > b.regionId ? 1 : 0));
    for (let i = 1; i < rerolls.length; i += 1) {
        if (rerolls[i].regionId === rerolls[i - 1].regionId) {
            throw new RecipeError(`recipe: duplicate reroll for ${rerolls[i].regionId}`);
        }
    }
    const parseCellPair = (value, path) => {
        if (!Array.isArray(value) || value.length !== 2 || !Number.isInteger(value[0]) || !Number.isInteger(value[1]) || value[0] < 0 || value[1] < 0) {
            throw new RecipeError(`recipe: ${path} must be a [x, y] pair of non-negative integers`);
        }
        return [value[0], value[1]];
    };
    const parseRect = (value, path) => {
        if (!Array.isArray(value) || value.length !== 4 ||
            value.some((entry) => !Number.isInteger(entry) || entry < 0)) {
            throw new RecipeError(`recipe: ${path} must be [x0, y0, x1, y1] non-negative integers`);
        }
        const [x0, y0, x1, y1] = value;
        if (x1 < x0 || y1 < y0)
            throw new RecipeError(`recipe: ${path} must satisfy x0 <= x1 and y0 <= y1`);
        return [x0, y0, x1, y1];
    };
    const locksRecord = raw["locks"] === undefined ? {} : requireObject(raw["locks"], "$.locks");
    rejectUnknownKeys(locksRecord, ["placements"], "$.locks");
    const locksRaw = locksRecord["placements"] === undefined ? [] : locksRecord["placements"];
    if (!Array.isArray(locksRaw))
        throw new RecipeError("recipe: $.locks.placements must be an array");
    const lockPlacements = locksRaw.map((entry, i) => {
        const record = requireObject(entry, `$.locks.placements[${i}]`);
        rejectUnknownKeys(record, ["id", "rule", "regionId", "cell", "exclusionRadius", "anchorPoiId", "arenaOrigin", "arenaSide"], `$.locks.placements[${i}]`);
        const id = record["id"];
        const rule = record["rule"];
        const regionId = record["regionId"];
        if (rule !== "world_boss.v1" && rule !== "dungeon_binding.v1") {
            throw new RecipeError(`recipe: $.locks.placements[${i}].rule must be world_boss.v1 or dungeon_binding.v1`);
        }
        if (typeof regionId !== "string" || regionId === "") {
            throw new RecipeError(`recipe: $.locks.placements[${i}].regionId must be a region id`);
        }
        // Lock ids must follow the frozen placement id scheme and agree with
        // the lock's own rule and regionId — locks re-emit their id verbatim
        // into the pack, so a looser id here would ship a scheme-violating
        // placement id in an otherwise audited export.
        const idPrefix = `placement.${rule === "world_boss.v1" ? "world_boss" : "dungeon"}.${regionId}.`;
        const slotPart = typeof id === "string" && id.startsWith(idPrefix) ? id.slice(idPrefix.length) : null;
        if (typeof id !== "string" || slotPart === null || !/^(0|[1-9][0-9]*)$/.test(slotPart)) {
            throw new RecipeError(`recipe: $.locks.placements[${i}].id must match ${idPrefix}<slot> (the placement id scheme for its rule and region)`);
        }
        const cell = parseCellPair(record["cell"], `$.locks.placements[${i}].cell`);
        const exclusionRadius = record["exclusionRadius"];
        if (!Number.isInteger(exclusionRadius) || exclusionRadius < 1 || exclusionRadius > 128) {
            throw new RecipeError(`recipe: $.locks.placements[${i}].exclusionRadius must be an integer in [1, 128]`);
        }
        const anchorPoiId = record["anchorPoiId"] ?? null;
        if (anchorPoiId !== null && !Number.isInteger(anchorPoiId)) {
            throw new RecipeError(`recipe: $.locks.placements[${i}].anchorPoiId must be an integer or null`);
        }
        const arenaOriginRaw = record["arenaOrigin"] ?? null;
        const arenaOrigin = arenaOriginRaw === null ? null : parseCellPair(arenaOriginRaw, `$.locks.placements[${i}].arenaOrigin`);
        const arenaSide = record["arenaSide"] ?? null;
        if (arenaSide !== null && (!Number.isInteger(arenaSide) || arenaSide < 2 || arenaSide > 21)) {
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
            rule: rule,
            regionId,
            cell,
            exclusionRadius: exclusionRadius,
            anchorPoiId: anchorPoiId,
            arenaOrigin,
            arenaSide: arenaSide,
        };
    });
    lockPlacements.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
    for (let i = 1; i < lockPlacements.length; i += 1) {
        if (lockPlacements[i].id === lockPlacements[i - 1].id) {
            throw new RecipeError(`recipe: duplicate lock for ${lockPlacements[i].id}`);
        }
    }
    const paintRecord = raw["paint"] === undefined ? {} : requireObject(raw["paint"], "$.paint");
    rejectUnknownKeys(paintRecord, ["noContent", "preferContent"], "$.paint");
    const noContentRaw = paintRecord["noContent"] === undefined ? [] : paintRecord["noContent"];
    const preferRaw = paintRecord["preferContent"] === undefined ? [] : paintRecord["preferContent"];
    if (!Array.isArray(noContentRaw) || !Array.isArray(preferRaw)) {
        throw new RecipeError("recipe: $.paint.noContent and $.paint.preferContent must be arrays");
    }
    const noContent = noContentRaw.map((entry, i) => {
        const record = requireObject(entry, `$.paint.noContent[${i}]`);
        rejectUnknownKeys(record, ["rect"], `$.paint.noContent[${i}]`);
        return { rect: parseRect(record["rect"], `$.paint.noContent[${i}].rect`) };
    });
    const preferContent = preferRaw.map((entry, i) => {
        const record = requireObject(entry, `$.paint.preferContent[${i}]`);
        rejectUnknownKeys(record, ["rect", "bonusPermille"], `$.paint.preferContent[${i}]`);
        const bonus = record["bonusPermille"];
        if (!Number.isInteger(bonus) || bonus < 1 || bonus > 1000) {
            throw new RecipeError(`recipe: $.paint.preferContent[${i}].bonusPermille must be an integer in [1, 1000]`);
        }
        return { rect: parseRect(record["rect"], `$.paint.preferContent[${i}].rect`), bonusPermille: bonus };
    });
    return {
        recipeFormat: RECIPE_FORMAT,
        name,
        directorSeed: directorSeed,
        base: { generationIdentitySha256: pin === undefined ? null : pin },
        danger: {
            bandCount: danger["bandCount"],
            maxBandJump: danger["maxBandJump"],
            safeZoneShareForBand0Permille: danger["safeZoneShareForBand0Permille"],
            overrides,
        },
        budgets: {
            minRegionCells: budgets["minRegionCells"],
            majorRegionCells: budgets["majorRegionCells"],
            territoriesPer1000Walkable: budgets["territoriesPer1000Walkable"],
            territoryCapPerRegion: budgets["territoryCapPerRegion"],
            encountersPer1000Walkable: budgets["encountersPer1000Walkable"],
            encounterCapPerRegion: budgets["encounterCapPerRegion"],
            dungeonCapPerRegion: budgets["dungeonCapPerRegion"],
            worldBossCount: budgets["worldBossCount"],
            minWorldBossBand: budgets["minWorldBossBand"],
        },
        dungeonAnchors: { poiTypes },
        worldBossRule: {
            minClearance: worldBossRule["minClearance"],
            minSettlementPathDistance: worldBossRule["minSettlementPathDistance"],
            minPeerPathDistance: worldBossRule["minPeerPathDistance"],
            exclusionRadius: worldBossRule["exclusionRadius"],
            clearancePermille: worldBossRule["clearancePermille"],
            settlementFarPermille: worldBossRule["settlementFarPermille"],
            roadFarPermille: worldBossRule["roadFarPermille"],
        },
        dungeonRule: {
            exclusionRadius: dungeonRule["exclusionRadius"],
            settlementFarPermille: dungeonRule["settlementFarPermille"],
        },
        territoryRule: {
            targetHostileCoveragePermille: territoryRule["targetHostileCoveragePermille"],
            minCells: territoryRule["minCells"],
            maxCells: territoryRule["maxCells"],
            packSizeMin: territoryRule["packSizeMin"],
            packSizeMax: territoryRule["packSizeMax"],
            maxActivePer100Cells: territoryRule["maxActivePer100Cells"],
            elitePermille: territoryRule["elitePermille"],
            respawnPressure: respawnRaw,
        },
        contentLibrary: { enemies },
        rerolls,
        locks: { placements: lockPlacements },
        paint: { noContent, preferContent },
    };
}
/** Identity of the normalized recipe: sha256 over canonical JSON bytes. */
export function recipeSha256(recipe) {
    return sha256Hex(canonicalJson(recipe));
}
