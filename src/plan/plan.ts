import type { WorldModel } from "../world/model.js";
import { clusterZones, type MacroZone, type ZoneClustering } from "./zones.js";
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
  /** Macro-zones — present only when the recipe's zones.count >= 2. */
  readonly zones?: readonly MacroZone[];
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

/**
 * Settlement-relief grid (sl-0073, dusk round 4): per cell, the single
 * strongest relief any settlement grants — belt reach scales with the
 * settlement's recorded radius (capital wide, outpost thin), relief
 * fades linearly from the walls to the belt edge, overlaps take max
 * (never sum), so belts cannot chain into corridors and far country is
 * untouched. Sources are walkable cells within Chebyshev 2 of the
 * settlement's structure footprints (the guards' reach starts at the
 * buildings), with the nudged anchor as fallback. Deterministic: fixed
 * settlement order, level-order BFS, max() is order-independent.
 */
function settlementReliefGrid(
  model: WorldModel,
  bits: Readonly<Uint8Array>,
  reachPermille: number,
  depthPermille: number,
): Int32Array {
  const { width, height } = model.dimensions;
  const relief = new Int32Array(width * height);
  for (const settlement of model.settlements) {
    const reach = Math.floor((settlement.radius * reachPermille) / 1000);
    if (reach <= 0) continue;
    const sources: number[] = [];
    const seen = new Uint8Array(width * height);
    for (const structure of settlement.structures) {
      const [sx, sy] = structure.cell;
      const [fw, fh] = structure.footprint;
      for (let y = sy - 2; y < sy + fh + 2; y += 1) {
        for (let x = sx - 2; x < sx + fw + 2; x += 1) {
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          const index = y * width + x;
          if (bits[index] === 1 && seen[index] === 0) {
            seen[index] = 1;
            sources.push(index);
          }
        }
      }
    }
    if (sources.length === 0) {
      const nudged = model.nudgeToWalkable(settlement.anchor[0], settlement.anchor[1], bits);
      if (nudged === null) continue;
      const index = nudged[1] * width + nudged[0];
      seen[index] = 1;
      sources.push(index);
    }
    sources.sort((a, b) => a - b);
    const queue: number[] = [...sources];
    const depth = new Int32Array(width * height);
    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head] as number;
      const d = depth[index] as number;
      const granted = Math.floor(((reach - d) * depthPermille) / 1000);
      if (granted > (relief[index] as number)) relief[index] = granted;
      if (d + 1 >= reach) continue;
      const x = index % width;
      const y = (index - x) / width;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (bits[next] !== 1 || seen[next] === 1) continue;
        seen[next] = 1;
        depth[next] = d + 1;
        queue.push(next);
      }
    }
  }
  return relief;
}

export function compilePlan(model: WorldModel, bundle: AnalysisBundle, recipe: DirectorRecipe): RegionalPlan {
  const { width, height } = model.dimensions;
  const regionCount = bundle.regions.length;
  const { danger, budgets } = recipe;

  // Settlement-relief blend (sl-0073): subtract each settlement's belt
  // from the spawn-distance field BEFORE bands are ranked, so both
  // assignment modes see the blended danger geography. Off (null) when
  // either knob is 0 — the pure spawn-distance fallback.
  const relief =
    danger.settlementReliefReachPermille > 0 && danger.settlementReliefDepthPermille > 0
      ? settlementReliefGrid(model, bundle.bits, danger.settlementReliefReachPermille, danger.settlementReliefDepthPermille)
      : null;

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
      const relieved = relief === null ? distance : Math.max(0, distance - (relief[index] as number));
      (distances[label] as number[]).push(relieved);
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

  // Macro-zones (round 5): reporting/creative geography over the fine
  // regions — and, under "zonal" assignment (round 6), the frame danger
  // itself follows. Computed before banding so both consumers share one
  // clustering; emitted only when the recipe asks, so zone-less plans
  // stay byte-identical to the pre-zone era.
  const zones: ZoneClustering | null =
    recipe.zones.count >= 2 ? clusterZones(bundle.regions, recipe.zones.count) : null;

  // Band assignment. "linear" splits the world's max spawn distance evenly,
  // so the deepest band exists only in the single farthest pocket;
  // "quantile" ranks wilderness regions by median spawn distance and gives
  // each band an equal share of reachable walkable ground, so every band
  // (including the deepest) covers meaningful territory wherever the
  // topology puts it. "zonal" (round 6) ranks each macro-zone by the
  // weighted median of its wilderness ground, splits the wilderness
  // bands into contiguous per-zone windows (deeper zones take the wider
  // windows when it does not divide evenly), and runs an independent
  // quantile ramp inside each window — danger fits the zones by
  // construction. Integer math throughout; ties break on region index.
  const bands = new Array<number | null>(regionCount).fill(null);
  const overridden = new Array<boolean>(regionCount).fill(false);
  const wilderness: Array<{ index: number; median: number; weight: number }> = [];
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
    if (danger.assignment === "quantile" || danger.assignment === "zonal") {
      wilderness.push({ index: i, median, weight: reachable.length });
      continue;
    }
    const band = 1 + Math.floor((median * (danger.bandCount - 1)) / (maxSpawnDistance + 1));
    bands[i] = Math.min(band, danger.bandCount - 1);
  }
  // Shared quantile machinery: rank entries by median and map each into
  // [lo..hi] with an equal-ground midpoint quantile.
  const quantileInto = (
    entries: Array<{ index: number; median: number; weight: number }>,
    lo: number,
    hi: number,
  ): void => {
    if (entries.length === 0) return;
    entries.sort((a, b) => (a.median !== b.median ? a.median - b.median : a.index - b.index));
    const totalWeight = entries.reduce((sum, entry) => sum + entry.weight, 0);
    const window = hi - lo + 1;
    let cumulative = 0;
    for (const entry of entries) {
      // Midpoint quantile in integer arithmetic: (cumulative + weight/2) / total.
      const band = lo + Math.floor(((2 * cumulative + entry.weight) * window) / (2 * totalWeight));
      bands[entry.index] = Math.min(band, hi);
      cumulative += entry.weight;
    }
  };
  if (danger.assignment === "zonal" && (zones === null || zones.zones.length === 0)) {
    // No zones to fit (unlisted-biome worlds): honest global fallback.
    quantileInto(wilderness, 1, danger.bandCount - 1);
  } else if (danger.assignment === "zonal" && zones !== null) {
    const zoneCount = zones.zones.length;
    const byZone: Array<Array<{ index: number; median: number; weight: number }>> = Array.from(
      { length: zoneCount },
      () => [],
    );
    for (const entry of wilderness) {
      const zone = zones.zoneOfRegion[entry.index] as number;
      if (zone >= 0) (byZone[zone] as (typeof wilderness)).push(entry);
      else bands[entry.index] = 1; // clustering assigns every region; defensive floor
    }
    // Rank zones by the weighted median of their wilderness ground.
    const zoneMedian = (entries: ReadonlyArray<{ median: number; weight: number; index: number }>): number => {
      if (entries.length === 0) return Number.MAX_SAFE_INTEGER;
      const sorted = [...entries].sort((a, b) => (a.median !== b.median ? a.median - b.median : a.index - b.index));
      const total = sorted.reduce((sum, entry) => sum + entry.weight, 0);
      let cumulative = 0;
      for (const entry of sorted) {
        cumulative += entry.weight;
        if (2 * cumulative >= total) return entry.median;
      }
      return (sorted[sorted.length - 1] as { median: number }).median;
    };
    // The spawn's zone is ALWAYS the first chapter — its near ground is
    // safe-zone-eaten, so a wilderness median would mismeasure the home
    // zone as far country. The rest rank by where their bulk lies.
    const [spawnX, spawnY] = bundle.summary.spawnCell;
    const spawnLabel = nearestRegionLabel(bundle.regionLabels, width, height, spawnX, spawnY);
    const spawnZone = spawnLabel === -1 ? -1 : (zones.zoneOfRegion[spawnLabel] as number);
    const ranked = byZone
      .map((entries, zone) => ({ zone, median: zone === spawnZone ? -1 : zoneMedian(entries) }))
      .sort((a, b) => (a.median !== b.median ? a.median - b.median : a.zone - b.zone));
    // Contiguous windows over bands 1..bandCount-1; the remainder widens
    // the DEEPEST zones.
    const wildBands = danger.bandCount - 1;
    const base = Math.floor(wildBands / zoneCount);
    const remainder = wildBands % zoneCount;
    let lo = 1;
    ranked.forEach(({ zone }, rank) => {
      const width = Math.max(1, base + (rank >= zoneCount - remainder ? 1 : 0));
      const hi = Math.min(danger.bandCount - 1, lo + width - 1);
      quantileInto(byZone[zone] as (typeof wilderness), lo, hi);
      lo = Math.min(danger.bandCount - 1, lo + width);
    });
  } else {
    quantileInto(wilderness, 1, danger.bandCount - 1);
  }

  // Endgame pockets: carve the deepest band into K compact islands
  // spread across the far crescent, so endgame zones read as distinct
  // destinations. Distance from spawn is radial — the far side of a
  // world is inherently one side, and merely demoting bridges cannot
  // create a pocket where the quantile put none — so this pass works on
  // the two deepest wilderness bands together: K seeds are chosen by
  // farthest-point sampling (substantial regions only, so a speck
  // cannot anchor an endgame zone), then every crescent region joins
  // its nearest seed's pocket in increasing anchor-distance order until
  // that pocket reaches its share of the original deep-band area.
  // Pocket members take the deepest band (promoting near-band ground
  // beside a seed); everything else in the crescent takes the
  // second-deepest band (demoting stray deep ground). Total deep area
  // stays roughly the quantile share; it just lands in K places.
  if (danger.endgamePockets >= 2 && danger.bandCount >= 3) {
    const deepBand = danger.bandCount - 1;
    const nearBand = deepBand - 1;
    interface CrescentEntry {
      readonly index: number;
      readonly median: number;
      readonly weight: number;
      readonly band: number;
    }
    const crescent: CrescentEntry[] = [];
    let deepWeight = 0;
    for (let i = 0; i < regionCount; i += 1) {
      if (overridden[i]) continue;
      const band = bands[i];
      if (band !== deepBand && band !== nearBand) continue;
      const reachable = distances[i] as number[];
      if (reachable.length === 0) continue;
      crescent.push({ index: i, median: medianOfSorted(reachable), weight: reachable.length, band });
      if (band === deepBand) deepWeight += reachable.length;
    }
    if (crescent.length > 1 && deepWeight > 0) {
      const anchorOf = (index: number): readonly [number, number] => {
        const anchor = (bundle.regions[index] as (typeof bundle.regions)[number]).anchorIndex;
        return [anchor % width, Math.floor(anchor / width)];
      };
      const d2 = (a: number, b: number): number => {
        const [ax, ay] = anchorOf(a);
        const [bx, by] = anchorOf(b);
        return (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
      };
      const substantial = crescent.filter((entry) => entry.weight >= recipe.budgets.minRegionCells);
      const seedPool = substantial.length > 0 ? substantial : crescent;
      const sortedPool = [...seedPool].sort((a, b) => (a.median !== b.median ? b.median - a.median : a.index - b.index));
      const seeds: number[] = [(sortedPool[0] as CrescentEntry).index];
      while (seeds.length < Math.min(danger.endgamePockets, sortedPool.length)) {
        let best = -1;
        let bestScore = -1;
        for (const entry of sortedPool) {
          if (seeds.includes(entry.index)) continue;
          const score = Math.min(...seeds.map((seed) => d2(entry.index, seed)));
          if (score > bestScore) {
            bestScore = score;
            best = entry.index;
          }
        }
        if (best === -1) break;
        seeds.push(best);
      }
      const target = Math.ceil(deepWeight / seeds.length);
      const pocketWeight = new Array<number>(seeds.length).fill(0);
      const assigned = crescent
        .map((entry) => {
          let seat = 0;
          let seatDistance = d2(entry.index, seeds[0] as number);
          for (let s = 1; s < seeds.length; s += 1) {
            const distance = d2(entry.index, seeds[s] as number);
            if (distance < seatDistance) {
              seatDistance = distance;
              seat = s;
            }
          }
          return { entry, seat, seatDistance };
        })
        .sort((a, b) => (a.seatDistance !== b.seatDistance ? a.seatDistance - b.seatDistance : a.entry.index - b.entry.index));
      for (const { entry, seat } of assigned) {
        if ((pocketWeight[seat] as number) < target) {
          pocketWeight[seat] = (pocketWeight[seat] as number) + entry.weight;
          bands[entry.index] = deepBand;
        } else {
          bands[entry.index] = nearBand;
        }
      }
    }
  }

  // Min-share rebalance (quantile assignment only): whole-region
  // quantiles can starve (or skip) a mid band when one huge region
  // swallows its window — a world's mid ring can be a single giant
  // region. After the endgame pockets settle the two deepest bands,
  // guarantee each MID band (2..bandCount-3... i.e. every wilderness
  // band except band 1 and the deepest) at least HALF its fair share of
  // walkable ground by pulling boundary regions from an adjacent band.
  // The deepest band is never a donor and never a recipient, so the
  // approved endgame geography is untouched; only boundary regions move
  // (deepest-from-below / shallowest-from-above), preserving the
  // monotone-in-median ordering. Donors never drop below the minimum
  // share themselves.
  if (danger.assignment === "quantile" && danger.bandCount >= 4 && wilderness.length > 0) {
    const wildBands = danger.bandCount - 1;
    const totalWeight = wilderness.reduce((sum, entry) => sum + entry.weight, 0);
    const minShare = Math.floor(totalWeight / wildBands / 2);
    const bandTotals = new Array<number>(danger.bandCount).fill(0);
    const sorted = [...wilderness].sort((a, b) => (a.median !== b.median ? a.median - b.median : a.index - b.index));
    for (const entry of sorted) {
      const band = bands[entry.index] as number;
      if (band >= 1 && band <= wildBands) bandTotals[band] = (bandTotals[band] as number) + entry.weight;
    }
    let guard = wilderness.length * danger.bandCount;
    for (let band = 2; band <= wildBands - 1; band += 1) {
      while ((bandTotals[band] as number) < minShare && guard > 0) {
        guard -= 1;
        // A move is legal when it strictly shrinks the pair's combined
        // below-minimum deficit — huge boundary regions may overshoot,
        // but only when the overshoot still leaves both bands closer to
        // their floors than before (strict improvement also rules out
        // oscillation).
        const deficit = (weight: number): number => Math.max(0, minShare - weight);
        const improves = (donorBand: number, weight: number): boolean => {
          const before = deficit(bandTotals[band] as number) + deficit(bandTotals[donorBand] as number);
          const after = deficit((bandTotals[band] as number) + weight) + deficit((bandTotals[donorBand] as number) - weight);
          return after < before;
        };
        const donors: Array<{ band: number; entry: (typeof wilderness)[number] }> = [];
        const below = sorted.filter((entry) => bands[entry.index] === band - 1);
        const fromBelow = below[below.length - 1];
        if (fromBelow !== undefined && improves(band - 1, fromBelow.weight)) {
          donors.push({ band: band - 1, entry: fromBelow });
        }
        if (band + 1 <= wildBands - 1) {
          const above = sorted.filter((entry) => bands[entry.index] === band + 1);
          const fromAbove = above[0];
          if (fromAbove !== undefined && improves(band + 1, fromAbove.weight)) {
            donors.push({ band: band + 1, entry: fromAbove });
          }
        }
        if (donors.length === 0) break;
        donors.sort((a, b) => {
          const weightA = bandTotals[a.band] as number;
          const weightB = bandTotals[b.band] as number;
          return weightA !== weightB ? weightB - weightA : a.band - b.band;
        });
        const move = donors[0] as (typeof donors)[number];
        bandTotals[move.band] = (bandTotals[move.band] as number) - move.entry.weight;
        bandTotals[band] = (bandTotals[band] as number) + move.entry.weight;
        bands[move.entry.index] = band;
      }
    }
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

  if (zones !== null && zones.shortfall > 0) {
    worldWaivers.push(
      `zone_shortfall: ${zones.zones.length} of ${recipe.zones.count} zones (family components available: ${zones.zones.length})`,
    );
  }

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
    ...(zones === null ? {} : { zones: zones.zones }),
    checks: { progressionWarnings, worldWaivers },
  };
}
