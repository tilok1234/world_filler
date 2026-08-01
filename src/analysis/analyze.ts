import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../core/canonicalJson.js";
import { sha256Hex } from "../core/sha256.js";
import { RULE_PACK_VERSIONS } from "../core/version.js";
import type { WorldModel } from "../world/model.js";
import {
  cellsAdjacentTo,
  clearanceField,
  corridorCells,
  distanceField,
  walkableComponents,
  UNREACHABLE,
} from "./fields.js";
import { segmentRegions, type AnalysisRegion } from "./regions.js";
import { safeZoneMask } from "./safety.js";

/**
 * The F2 analysis bundle: every derived spatial dataset the director's
 * later phases consume, computed deterministically from the world model.
 * The bundle summary is canonical JSON whose sha256 is the analysis
 * identity; dense fields ride beside it as raw little-endian arrays.
 */

// 2: oversized biome patches subdivide (MAX_REGION_CELLS) so banding,
// budgets, and rerolls get workable granularity on monolithic biomes.
// 3: segmentation void is walkability-aware (sl-0026) — walkable ground
// on void materials (fords, wadeable shallows, piers, future walkable
// rock) forms regions and enters adjacency; unwalkable void keeps
// separating.
// 4: watershed subdivision — organic seams (behavior 16).
// Derived from the rule-pack table so the summary stamp, the cache key,
// and the report can never disagree again (the behavior-16 bump briefly
// left this constant at 3 while the rule pack said 4 — caught and fixed
// in the same rehearsal, before any export).
export const ANALYSIS_VERSION: number = RULE_PACK_VERSIONS.analysis;

const CORRIDOR_MATERIALS: ReadonlySet<string> = new Set(["terrain.packed_road", "terrain.cobble"]);
const WATER_MATERIALS: ReadonlySet<string> = new Set(["water.deep", "water.shallow"]);

export interface AnalysisBundle {
  readonly summary: AnalysisSummary;
  readonly bits: Uint8Array;
  readonly componentLabels: Int32Array;
  readonly distanceFromSpawn: Int32Array;
  readonly distanceFromSettlements: Int32Array;
  readonly distanceFromRoads: Int32Array;
  readonly distanceFromWater: Int32Array;
  readonly clearance: Int32Array;
  readonly corridor: Uint8Array;
  readonly safeZone: Uint8Array;
  readonly regionLabels: Int32Array;
  readonly regions: readonly AnalysisRegion[];
}

export interface AnalysisSummary {
  readonly analysisVersion: number;
  readonly base: {
    readonly generationIdentitySha256: string;
    readonly artifactFormat: number;
    readonly width: number;
    readonly height: number;
  };
  readonly components: {
    readonly count: number;
    readonly sizes: readonly number[];
    readonly spawnComponent: number;
  };
  readonly spawnCell: readonly [number, number];
  readonly fieldStats: Readonly<Record<string, { readonly max: number; readonly reachableCells: number }>>;
  readonly corridorCellCount: number;
  readonly safeZoneCellCount: number;
  readonly regionCount: number;
  readonly regions: readonly AnalysisRegion[];
  readonly fieldHashes: Readonly<Record<string, string>>;
}

function fieldStats(field: Readonly<Int32Array>): { max: number; reachableCells: number } {
  let max = 0;
  let reachable = 0;
  for (const value of field) {
    if (value === UNREACHABLE) continue;
    reachable += 1;
    if (value > max) max = value;
  }
  return { max, reachableCells: reachable };
}

function hashInt32(field: Readonly<Int32Array>): string {
  return sha256Hex(new Uint8Array(field.buffer, field.byteOffset, field.byteLength));
}

function hashBytes(field: Readonly<Uint8Array>): string {
  return sha256Hex(field as Uint8Array);
}

export function analyzeWorld(model: WorldModel): AnalysisBundle {
  const { width, height } = model.dimensions;
  const { bits } = model.deriveWalkability();

  const components = walkableComponents(bits, width, height);

  const first = model.destinations[0];
  if (first === undefined) throw new Error("analysis: world has no destinations; spawn is undefined");
  const spawn = model.nudgeToWalkable(first.cell[0], first.cell[1], bits);
  if (spawn === null) throw new Error("analysis: no walkable cell within 8 of destination 0");
  const spawnIndex = spawn[1] * width + spawn[0];

  const settlementSeeds: number[] = [];
  for (const settlement of model.settlements) {
    const nudged = model.nudgeToWalkable(settlement.anchor[0], settlement.anchor[1], bits);
    if (nudged !== null) settlementSeeds.push(nudged[1] * width + nudged[0]);
  }

  const roadSeeds = cellsAdjacentTo(bits, width, height, (index) => {
    const x = index % width;
    const y = (index - x) / width;
    return model.trailAt(x, y) || CORRIDOR_MATERIALS.has(model.materialAt(x, y));
  });

  const waterSeeds = cellsAdjacentTo(bits, width, height, (index) => {
    const x = index % width;
    const y = (index - x) / width;
    return WATER_MATERIALS.has(model.materialAt(x, y)) || model.riverTierAt(x, y) > 0;
  });

  const distanceFromSpawn = distanceField(bits, width, height, [spawnIndex]);
  const distanceFromSettlements = distanceField(bits, width, height, settlementSeeds);
  const distanceFromRoads = distanceField(bits, width, height, roadSeeds);
  const distanceFromWater = distanceField(bits, width, height, waterSeeds);
  const clearance = clearanceField(bits, width, height);
  const corridor = corridorCells(bits, width, height);
  const safeZone = safeZoneMask(model);
  const segmentation = segmentRegions(model);

  let corridorCellCount = 0;
  for (const value of corridor) corridorCellCount += value;
  let safeZoneCellCount = 0;
  for (const value of safeZone) safeZoneCellCount += value;

  const summary: AnalysisSummary = {
    analysisVersion: ANALYSIS_VERSION,
    base: {
      generationIdentitySha256: model.generator.generationIdentitySha256,
      artifactFormat: model.raw.formatVersion,
      width,
      height,
    },
    components: {
      count: components.sizes.length,
      sizes: components.sizes,
      spawnComponent: components.labels[spawnIndex] as number,
    },
    spawnCell: spawn,
    fieldStats: {
      distanceFromSpawn: fieldStats(distanceFromSpawn),
      distanceFromSettlements: fieldStats(distanceFromSettlements),
      distanceFromRoads: fieldStats(distanceFromRoads),
      distanceFromWater: fieldStats(distanceFromWater),
    },
    corridorCellCount,
    safeZoneCellCount,
    regionCount: segmentation.regions.length,
    regions: segmentation.regions,
    fieldHashes: {
      walkability: hashBytes(bits),
      componentLabels: hashInt32(components.labels),
      distanceFromSpawn: hashInt32(distanceFromSpawn),
      distanceFromSettlements: hashInt32(distanceFromSettlements),
      distanceFromRoads: hashInt32(distanceFromRoads),
      distanceFromWater: hashInt32(distanceFromWater),
      clearance: hashInt32(clearance),
      corridor: hashBytes(corridor),
      safeZone: hashBytes(safeZone),
      regionLabels: hashInt32(segmentation.labels),
    },
  };

  return {
    summary,
    bits,
    componentLabels: components.labels,
    distanceFromSpawn,
    distanceFromSettlements,
    distanceFromRoads,
    distanceFromWater,
    clearance,
    corridor,
    safeZone,
    regionLabels: segmentation.labels,
    regions: segmentation.regions,
  };
}

/**
 * Cache: outputs/analysis-cache/<identity>-v<version>/summary.json.
 * The summary (with its field hashes) is the identity; a cache hit is
 * only trusted when the stored summary hash-matches a fresh recompute's
 * field hashes at read time — so the cache can speed up tooling but can
 * never silently serve stale analysis for a changed world.
 */
export function analysisCacheDir(root: string, identity: string): string {
  return join(root, "analysis-cache", `${identity}-v${ANALYSIS_VERSION}`);
}

export function writeAnalysisSummary(dir: string, summary: AnalysisSummary): string {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "summary.json");
  writeFileSync(path, canonicalJson(summary));
  return path;
}

export function readAnalysisSummary(dir: string): AnalysisSummary | null {
  const path = join(dir, "summary.json");
  if (!existsSync(path)) return null;
  return JSON.parse(readFileSync(path, "utf8")) as AnalysisSummary;
}
