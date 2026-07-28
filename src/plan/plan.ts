import type { WorldModel } from "../world/model.js";
import type { AnalysisBundle } from "../analysis/analyze.js";
import { UNREACHABLE } from "../analysis/fields.js";
import type { DirectorRecipe } from "../recipe/schema.js";
import { recipeSha256 } from "../recipe/schema.js";
import { ANALYSIS_VERSION } from "../analysis/analyze.js";
import { DIRECTOR_BEHAVIOR_VERSION, PLAN_FORMAT, RULE_PACK_VERSIONS } from "../core/version.js";

/**
 * The regional content plan: the abstract "what does each region contain"
 * document, compiled before any coordinate is chosen. Danger bands derive
 * from per-region median path-distance from spawn; budgets scale with
 * walkable area under recipe knobs; everything impossible carries a named
 * waiver instead of silently vanishing.
 */

export class PlanError extends Error {}

export type RegionClass = "minor" | "standard" | "major";

export interface RegionPlan {
  readonly id: string;
  readonly biome: string;
  readonly cellCount: number;
  readonly walkableCells: number;
  readonly hostileWalkableCells: number;
  readonly reachableCells: number;
  readonly safeSharePermille: number;
  readonly medianSpawnDistance: number | null;
  readonly dangerBand: number | null;
  readonly dangerOverridden: boolean;
  readonly regionClass: RegionClass;
  readonly budgets: {
    readonly territories: number;
    readonly encounterSites: number;
    readonly dungeonBindings: number;
    readonly worldBosses: number;
  };
  readonly dungeonAnchorCandidates: number;
  readonly waivers: readonly string[];
}

export interface RegionalPlan {
  readonly planFormat: number;
  readonly directorBehaviorVersion: number;
  readonly rulePacks: typeof RULE_PACK_VERSIONS;
  readonly analysisVersion: number;
  readonly recipeName: string;
  readonly directorSeed: number;
  readonly directorRecipeSha256: string;
  readonly base: {
    readonly generationIdentitySha256: string;
    readonly artifactFormat: number;
    readonly width: number;
    readonly height: number;
  };
  readonly spawnRegionId: string;
  readonly regions: readonly RegionPlan[];
  readonly worldBudget: {
    readonly worldBosses: { readonly target: number; readonly allocated: number };
    readonly territories: number;
    readonly encounterSites: number;
    readonly dungeonBindings: number;
  };
  readonly unassignedDungeonAnchors: number;
  readonly checks: {
    readonly progressionWarnings: readonly {
      readonly regionId: string;
      readonly dangerBand: number;
      readonly chokeBand: number;
    }[];
    readonly worldWaivers: readonly string[];
  };
}

/** Median of a sorted-ascending integer array (lower middle on even length). */
function medianOfSorted(values: readonly number[]): number {
  return values[Math.floor((values.length - 1) / 2)] as number;
}

function nearestRegionLabel(
  labels: Readonly<Int32Array>,
  width: number,
  height: number,
  cx: number,
  cy: number,
): number {
  for (let radius = 0; radius < 5; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= width || y >= height) continue;
        const label = labels[y * width + x] as number;
        if (label !== -1) return label;
      }
    }
  }
  return -1;
}

export function compilePlan(model: WorldModel, bundle: AnalysisBundle, recipe: DirectorRecipe): RegionalPlan {
  const { width, height } = model.dimensions;
  const regionCount = bundle.regions.length;
  const { danger, budgets } = recipe;

  // Per-region walkability, reachability, safety, and spawn-distance stats.
  const walkableCells = new Array<number>(regionCount).fill(0);
  const hostileWalkableCells = new Array<number>(regionCount).fill(0);
  const reachableCells = new Array<number>(regionCount).fill(0);
  const safeCells = new Array<number>(regionCount).fill(0);
  const distances: number[][] = Array.from({ length: regionCount }, () => []);
  for (let index = 0; index < width * height; index += 1) {
    const label = bundle.regionLabels[index] as number;
    if (label === -1) continue;
    if (bundle.safeZone[index] === 1) safeCells[label] = (safeCells[label] as number) + 1;
    if (bundle.bits[index] !== 1) continue;
    walkableCells[label] = (walkableCells[label] as number) + 1;
    if (bundle.safeZone[index] !== 1) hostileWalkableCells[label] = (hostileWalkableCells[label] as number) + 1;
    const distance = bundle.distanceFromSpawn[index] as number;
    if (distance !== UNREACHABLE) {
      reachableCells[label] = (reachableCells[label] as number) + 1;
      (distances[label] as number[]).push(distance);
    }
  }

  for (const list of distances) list.sort((a, b) => a - b);

  const maxSpawnDistance = Math.max(1, bundle.summary.fieldStats["distanceFromSpawn"]?.max ?? 1);

  // Danger override lookup; unknown region ids are named errors.
  const regionIds = new Set(bundle.regions.map((region) => region.id));
  const overrideByRegion = new Map<string, number>();
  for (const override of danger.overrides) {
    if (!regionIds.has(override.regionId)) {
      throw new PlanError(`plan: danger override references unknown region ${override.regionId}`);
    }
    overrideByRegion.set(override.regionId, override.band);
  }

  // Dungeon anchor candidates per region (structure-bearing POIs of the
  // recipe's anchor types; POIs on void cells snap to the nearest region).
  const anchorTypes = new Set(recipe.dungeonAnchors.poiTypes);
  const anchorCandidates = new Array<number>(regionCount).fill(0);
  let unassignedDungeonAnchors = 0;
  for (const poi of model.pois) {
    if (!anchorTypes.has(poi.type) || poi.structure === undefined) continue;
    const label = nearestRegionLabel(bundle.regionLabels, width, height, poi.cell[0], poi.cell[1]);
    if (label === -1) unassignedDungeonAnchors += 1;
    else anchorCandidates[label] = (anchorCandidates[label] as number) + 1;
  }

  // Band assignment.
  const bands = new Array<number | null>(regionCount).fill(null);
  const overridden = new Array<boolean>(regionCount).fill(false);
  for (let i = 0; i < regionCount; i += 1) {
    const region = bundle.regions[i] as (typeof bundle.regions)[number];
    const override = overrideByRegion.get(region.id);
    if (override !== undefined) {
      bands[i] = override;
      overridden[i] = true;
      continue;
    }
    const reachable = distances[i] as number[];
    if (reachable.length === 0) continue;
    const safeShare = Math.floor(((safeCells[i] as number) * 1000) / region.cellCount);
    if (safeShare >= danger.safeZoneShareForBand0Permille) {
      bands[i] = 0;
      continue;
    }
    const median = medianOfSorted(reachable);
    const band = 1 + Math.floor((median * (danger.bandCount - 1)) / (maxSpawnDistance + 1));
    bands[i] = Math.min(band, danger.bandCount - 1);
  }

  // Spawn region.
  const [sx, sy] = bundle.summary.spawnCell;
  const spawnLabel = nearestRegionLabel(bundle.regionLabels, width, height, sx, sy);
  if (spawnLabel === -1) throw new PlanError("plan: spawn cell has no region within radius 4");
  const spawnRegionId = (bundle.regions[spawnLabel] as (typeof bundle.regions)[number]).id;

  // Minimax choke band over the region adjacency graph: the smallest
  // possible "worst band en route" from the spawn region to each region.
  const indexById = new Map(bundle.regions.map((region, i) => [region.id, i]));
  const chokeBands = new Array<number | null>(regionCount).fill(null);
  if (bands[spawnLabel] !== null) {
    chokeBands[spawnLabel] = bands[spawnLabel] as number;
    const settled = new Array<boolean>(regionCount).fill(false);
    while (true) {
      let best = -1;
      for (let i = 0; i < regionCount; i += 1) {
        if (settled[i] || chokeBands[i] === null) continue;
        if (best === -1 || (chokeBands[i] as number) < (chokeBands[best] as number)) best = i;
      }
      if (best === -1) break;
      settled[best] = true;
      const region = bundle.regions[best] as (typeof bundle.regions)[number];
      for (const neighborId of region.neighborIds) {
        const neighbor = indexById.get(neighborId) as number;
        if (bands[neighbor] === null) continue;
        const through = Math.max(chokeBands[best] as number, bands[neighbor] as number);
        if (chokeBands[neighbor] === null || through < (chokeBands[neighbor] as number)) {
          chokeBands[neighbor] = through;
        }
      }
    }
  }

  // Budgets and waivers.
  const regionPlans: RegionPlan[] = [];
  const bossEligible: number[] = [];
  for (let i = 0; i < regionCount; i += 1) {
    const region = bundle.regions[i] as (typeof bundle.regions)[number];
    const waivers: string[] = [];
    const band = bands[i] ?? null;
    const walkable = walkableCells[i] as number;
    const reachable = reachableCells[i] as number;
    const regionClass: RegionClass =
      region.cellCount < budgets.minRegionCells ? "minor" : region.cellCount >= budgets.majorRegionCells ? "major" : "standard";

    if (reachable === 0) waivers.push("unreachable_from_spawn");
    if (regionClass === "minor") waivers.push("too_small");

    // Territory and encounter budgets count hostile-walkable ground only —
    // safe zones can never host them, so budgeting against them would
    // promise counts F5 cannot place.
    const hostile = hostileWalkableCells[i] as number;
    const eligible = regionClass !== "minor" && reachable > 0;
    const territories =
      eligible && hostile > 0
        ? Math.min(budgets.territoryCapPerRegion, Math.max(1, Math.floor((hostile * budgets.territoriesPer1000Walkable) / 1000)))
        : 0;
    const encounterSites =
      eligible && hostile > 0
        ? Math.min(budgets.encounterCapPerRegion, Math.floor((hostile * budgets.encountersPer1000Walkable) / 1000))
        : 0;
    if (eligible && hostile === 0) waivers.push("fully_safe");
    const dungeonBindings = eligible ? Math.min(budgets.dungeonCapPerRegion, anchorCandidates[i] as number) : 0;
    if (eligible && (anchorCandidates[i] as number) === 0) waivers.push("no_dungeon_anchors");

    if (eligible && band !== null && band >= budgets.minWorldBossBand) bossEligible.push(i);

    regionPlans.push({
      id: region.id,
      biome: region.biome,
      cellCount: region.cellCount,
      walkableCells: walkable,
      hostileWalkableCells: hostile,
      reachableCells: reachable,
      safeSharePermille: Math.floor(((safeCells[i] as number) * 1000) / region.cellCount),
      medianSpawnDistance: (distances[i] as number[]).length === 0 ? null : medianOfSorted(distances[i] as number[]),
      dangerBand: band,
      dangerOverridden: overridden[i] as boolean,
      regionClass,
      budgets: { territories, encounterSites, dungeonBindings, worldBosses: 0 },
      dungeonAnchorCandidates: anchorCandidates[i] as number,
      waivers,
    });
  }

  // World-boss allocation: one per region, largest eligible regions first.
  bossEligible.sort((a, b) => {
    const regionA = bundle.regions[a] as (typeof bundle.regions)[number];
    const regionB = bundle.regions[b] as (typeof bundle.regions)[number];
    if (regionA.cellCount !== regionB.cellCount) return regionB.cellCount - regionA.cellCount;
    return regionA.anchorIndex - regionB.anchorIndex;
  });
  const allocatedBosses = Math.min(budgets.worldBossCount, bossEligible.length);
  for (let n = 0; n < allocatedBosses; n += 1) {
    const index = bossEligible[n] as number;
    const plan = regionPlans[index] as RegionPlan;
    regionPlans[index] = { ...plan, budgets: { ...plan.budgets, worldBosses: 1 } };
  }
  const worldWaivers: string[] = [];
  if (allocatedBosses < budgets.worldBossCount) {
    worldWaivers.push(
      `world_boss_shortfall: ${allocatedBosses} of ${budgets.worldBossCount} allocated (eligible regions: ${bossEligible.length})`,
    );
  }

  // Progression traps: wilderness regions whose unavoidable route crosses
  // a band more than maxBandJump above their own.
  const progressionWarnings: Array<{ regionId: string; dangerBand: number; chokeBand: number }> = [];
  for (let i = 0; i < regionCount; i += 1) {
    const band = bands[i] ?? null;
    const choke = chokeBands[i] ?? null;
    if (band === null || band === 0 || choke === null) continue;
    if (choke > band + danger.maxBandJump) {
      progressionWarnings.push({
        regionId: (bundle.regions[i] as (typeof bundle.regions)[number]).id,
        dangerBand: band,
        chokeBand: choke,
      });
    }
  }
  progressionWarnings.sort((a, b) => (a.regionId < b.regionId ? -1 : 1));

  const sortedRegions = [...regionPlans].sort((a, b) => (a.id < b.id ? -1 : 1));

  return {
    planFormat: PLAN_FORMAT,
    directorBehaviorVersion: DIRECTOR_BEHAVIOR_VERSION,
    rulePacks: RULE_PACK_VERSIONS,
    analysisVersion: ANALYSIS_VERSION,
    recipeName: recipe.name,
    directorSeed: recipe.directorSeed,
    directorRecipeSha256: recipeSha256(recipe),
    base: {
      generationIdentitySha256: model.generator.generationIdentitySha256,
      artifactFormat: model.raw.formatVersion,
      width,
      height,
    },
    spawnRegionId,
    regions: sortedRegions,
    worldBudget: {
      worldBosses: { target: budgets.worldBossCount, allocated: allocatedBosses },
      territories: regionPlans.reduce((sum, region) => sum + region.budgets.territories, 0),
      encounterSites: regionPlans.reduce((sum, region) => sum + region.budgets.encounterSites, 0),
      dungeonBindings: regionPlans.reduce((sum, region) => sum + region.budgets.dungeonBindings, 0),
    },
    unassignedDungeonAnchors,
    checks: { progressionWarnings, worldWaivers },
  };
}
