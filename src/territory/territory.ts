import { Channel } from "../core/channel.js";
import { recipeSha256, type DirectorRecipe } from "../recipe/schema.js";
import type { WorldModel } from "../world/model.js";
import type { AnalysisBundle } from "../analysis/analyze.js";
import type { RegionalPlan } from "../plan/plan.js";
import type { PlacementsDoc } from "../place/solver.js";
import { UNREACHABLE } from "../analysis/fields.js";
import { ANALYSIS_VERSION } from "../analysis/analyze.js";
import { DIRECTOR_BEHAVIOR_VERSION, RULE_PACK_VERSIONS, TERRITORIES_FORMAT } from "../core/version.js";

/**
 * F5 spawn territories: grown, non-overlapping cell sets over hostile
 * walkable ground — never inside safe zones, F4 physical claims, or F4
 * exclusion buffers — rostered from the recipe's content library by
 * biome and danger band. Territories are permanent structure; the game
 * runtime owns actual spawning against their budgets.
 *
 * Determinism follows the F4 contract: sorted-region order, channels
 * `world/<regionId>/reroll.<n>/territory/<slot>`, and integer math only.
 * Growth is confined to the owning region, so cross-region coupling can
 * enter only through F4 buffers crossing a border (same honest contract).
 */

export interface TerritoryRoster {
  readonly enemyId: string;
  readonly weightPercent: number;
  readonly nightOnly: boolean;
}

export interface Territory {
  readonly id: string;
  readonly regionId: string;
  readonly dangerBand: number;
  readonly seedCell: readonly [number, number];
  readonly cells: { readonly encoding: "runs"; readonly runs: readonly (readonly [number, number, number])[] };
  readonly cellCount: number;
  readonly roster: readonly TerritoryRoster[];
  readonly packSize: readonly [number, number];
  readonly maxActive: number;
  readonly respawnPressure: "low" | "medium" | "high";
  readonly elitePermille: number;
  readonly channel: string;
  readonly draw: number;
}

export interface TerritoryFailure {
  readonly regionId: string;
  readonly slot: number;
  readonly reason: "insufficient_hostile_ground" | "fragmented_hostile_ground" | "no_matching_roster";
  readonly message: string;
}

export interface RegionCoverage {
  readonly regionId: string;
  readonly hostileWalkable: number;
  readonly covered: number;
  readonly coveragePermille: number;
  readonly budget: number;
  readonly emitted: number;
}

export interface TerritoriesDoc {
  readonly territoriesFormat: number;
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
  readonly territories: readonly Territory[];
  readonly failures: readonly TerritoryFailure[];
  readonly coverage: {
    readonly regions: readonly RegionCoverage[];
    readonly totalHostileWalkable: number;
    readonly totalCovered: number;
  };
}

/** Encode a cell-index set as sorted horizontal runs [x, y, length]. */
export function encodeRuns(cells: ReadonlySet<number>, width: number): Array<[number, number, number]> {
  const sorted = [...cells].sort((a, b) => a - b);
  const runs: Array<[number, number, number]> = [];
  for (let i = 0; i < sorted.length; ) {
    const start = sorted[i] as number;
    const y = Math.floor(start / width);
    let length = 1;
    while (
      i + length < sorted.length &&
      (sorted[i + length] as number) === start + length &&
      Math.floor((start + length) / width) === y
    ) {
      length += 1;
    }
    runs.push([start % width, y, length]);
    i += length;
  }
  return runs;
}

export class TerritoryRunError extends Error {}

/**
 * Decode [x, y, length] runs into a cell-index set. Runs never cross
 * rows — the frozen format 1 reader rule (docs/CONTENT_PACK_FORMAT.md):
 * a run with x < 0, y < 0, length < 1, x + length > width, or
 * y >= height is refused with a named error, never silently wrapped
 * into the next row.
 */
export function decodeRuns(
  runs: readonly (readonly [number, number, number])[],
  width: number,
  height: number,
): Set<number> {
  const cells = new Set<number>();
  for (const run of runs) {
    const [x, y, length] = run;
    if (!Number.isInteger(x) || !Number.isInteger(y) || !Number.isInteger(length)) {
      throw new TerritoryRunError(`territory run [${String(x)}, ${String(y)}, ${String(length)}] is not integer [x, y, length]`);
    }
    if (x < 0 || y < 0 || length < 1 || y >= height || x + length > width) {
      throw new TerritoryRunError(
        `territory run [${x}, ${y}, ${length}] leaves the ${width}x${height} grid (runs never cross rows)`,
      );
    }
    for (let i = 0; i < length; i += 1) cells.add(y * width + x + i);
  }
  return cells;
}

function rosterFor(recipe: DirectorRecipe, biome: string, band: number): TerritoryRoster[] {
  const matches: TerritoryRoster[] = [];
  for (const enemy of recipe.contentLibrary.enemies) {
    if (band < enemy.minBand || band > enemy.maxBand) continue;
    if (!enemy.biomes.includes(biome)) continue;
    matches.push({ enemyId: enemy.id, weightPercent: enemy.weightPercent, nightOnly: enemy.nightOnly });
  }
  return matches;
}

export function growTerritories(
  model: WorldModel,
  bundle: AnalysisBundle,
  plan: RegionalPlan,
  placements: PlacementsDoc,
  recipe: DirectorRecipe,
): TerritoriesDoc {
  const { width, height } = model.dimensions;
  const rule = recipe.territoryRule;
  const rerollByRegion = new Map(recipe.rerolls.map((reroll) => [reroll.regionId, reroll.iteration]));
  const labelById = new Map(bundle.regions.map((region, label) => [region.id, label]));

  // Ground already spoken for: safe zones plus every F4 claim (physical
  // cells and exclusion buffers), reconstructed from the placements doc so
  // this stage depends only on documented outputs, not solver internals.
  const blocked = new Uint8Array(width * height);
  for (let i = 0; i < width * height; i += 1) {
    if (bundle.safeZone[i] === 1) blocked[i] = 1;
  }
  const markDisc = (cx: number, cy: number, radius: number): void => {
    const r2 = radius * radius;
    for (let y = Math.max(0, cy - radius); y <= Math.min(height - 1, cy + radius); y += 1) {
      for (let x = Math.max(0, cx - radius); x <= Math.min(width - 1, cx + radius); x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy <= r2) blocked[y * width + x] = 1;
      }
    }
  };
  for (const placement of placements.placements) {
    markDisc(placement.cell[0], placement.cell[1], placement.exclusionRadius);
    if (placement.arenaOrigin !== null && placement.arenaSide !== null) {
      for (let y = placement.arenaOrigin[1]; y < placement.arenaOrigin[1] + placement.arenaSide; y += 1) {
        for (let x = placement.arenaOrigin[0]; x < placement.arenaOrigin[0] + placement.arenaSide; x += 1) {
          blocked[y * width + x] = 1;
        }
      }
    }
  }

  const territories: Territory[] = [];
  const failures: TerritoryFailure[] = [];
  const coverage: RegionCoverage[] = [];
  const claimed = new Uint8Array(width * height);
  // Spacing halo: ground within rule.spacing (Chebyshev) of any grown
  // territory, kept clear so territories read as separate hunting
  // grounds instead of merged blobs.
  const spaced = new Uint8Array(width * height);

  for (const region of plan.regions) {
    const budget = region.budgets.territories;
    if (budget <= 0) {
      // Zero-budget regions still appear in coverage so the totals are
      // world totals, not budgeted-regions-only totals.
      coverage.push({
        regionId: region.id,
        hostileWalkable: region.hostileWalkableCells,
        covered: 0,
        coveragePermille: 0,
        budget,
        emitted: 0,
      });
      continue;
    }
    const label = labelById.get(region.id) as number;
    const band = region.dangerBand ?? 0;

    // Eligible ground for this region (painted no-content zones excluded).
    const eligible = new Uint8Array(width * height);
    let eligibleCount = 0;
    for (let i = 0; i < width * height; i += 1) {
      if ((bundle.regionLabels[i] as number) !== label) continue;
      if (bundle.bits[i] !== 1) continue;
      if ((bundle.distanceFromSpawn[i] as number) === UNREACHABLE) continue;
      if (blocked[i] === 1 || claimed[i] === 1 || spaced[i] === 1) continue;
      const x = i % width;
      const y = (i - x) / width;
      if (recipe.paint.noContent.some((zone) => x >= zone.rect[0] && x <= zone.rect[2] && y >= zone.rect[1] && y <= zone.rect[3])) continue;
      eligible[i] = 1;
      eligibleCount += 1;
    }

    const roster = rosterFor(recipe, region.biome, band);
    const targetSize = Math.max(
      rule.minCells,
      Math.min(rule.maxCells, Math.floor((region.hostileWalkableCells * rule.targetHostileCoveragePermille) / 1000 / budget)),
    );

    const channel = Channel.root(recipe.directorSeed)
      .child(region.id)
      .child(`reroll.${rerollByRegion.get(region.id) ?? 0}`)
      .child("territory");

    let covered = 0;
    let emitted = 0;
    for (let slot = 0; slot < budget; slot += 1) {
      if (roster.length === 0) {
        failures.push({
          regionId: region.id,
          slot,
          reason: "no_matching_roster",
          message: `no enemy in the content library matches biome ${region.biome} at band ${band}`,
        });
        break;
      }
      if (eligibleCount < rule.minCells) {
        failures.push({
          regionId: region.id,
          slot,
          reason: "insufficient_hostile_ground",
          message: `${eligibleCount} eligible cells remain in ${region.id}; territories need at least ${rule.minCells}`,
        });
        break;
      }

      // Pocket labeling: seeds are drawn only from connected eligible
      // pockets large enough to host a territory, so fragmented ground
      // fails once per region instead of once per fragment.
      const pocketOf = new Int32Array(width * height).fill(-1);
      const pocketSizes: number[] = [];
      for (let start = 0; start < width * height; start += 1) {
        if (eligible[start] !== 1 || pocketOf[start] !== -1) continue;
        const pocket = pocketSizes.length;
        pocketOf[start] = pocket;
        const flood: number[] = [start];
        let size = 0;
        for (let head = 0; head < flood.length; head += 1) {
          const index = flood[head] as number;
          size += 1;
          const x = index % width;
          const y = (index - x) / width;
          for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
            const next = ny * width + nx;
            if (eligible[next] === 1 && pocketOf[next] === -1) {
              pocketOf[next] = pocket;
              flood.push(next);
            }
          }
        }
        pocketSizes.push(size);
      }

      // Seed selection: prefer wilderness far from settlements; seeded
      // pick from the top window, viable pockets only.
      const seeds: Array<{ index: number; distance: number }> = [];
      for (let i = 0; i < width * height; i += 1) {
        if (eligible[i] !== 1) continue;
        if ((pocketSizes[pocketOf[i] as number] as number) < rule.minCells) continue;
        const distance = bundle.distanceFromSettlements[i] as number;
        seeds.push({ index: i, distance: distance === UNREACHABLE ? 1 << 20 : distance });
      }
      if (seeds.length === 0) {
        failures.push({
          regionId: region.id,
          slot,
          reason: "fragmented_hostile_ground",
          message: `${eligibleCount} eligible cells remain in ${region.id} but no connected pocket reaches ` +
            `${rule.minCells} cells (largest: ${pocketSizes.length > 0 ? Math.max(...pocketSizes) : 0})`,
        });
        break;
      }
      seeds.sort((a, b) => (a.distance !== b.distance ? b.distance - a.distance : a.index - b.index));
      const window = Math.min(8, seeds.length);
      const slotChannel = channel.child(String(slot));
      const draw = slotChannel.int(0, window);
      const seedIndex = (seeds[draw] as { index: number }).index;

      // Deterministic BFS growth confined to eligible cells.
      const cells = new Set<number>([seedIndex]);
      const queue: number[] = [seedIndex];
      for (let head = 0; head < queue.length && cells.size < targetSize; head += 1) {
        const index = queue[head] as number;
        const x = index % width;
        const y = (index - x) / width;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (eligible[next] !== 1 || cells.has(next)) continue;
          cells.add(next);
          queue.push(next);
          if (cells.size >= targetSize) break;
        }
      }

      if (cells.size < rule.minCells) {
        // The pocket around this seed is too small; retire it so the next
        // slot cannot loop onto the same fragment.
        for (const index of cells) {
          eligible[index] = 0;
          eligibleCount -= 1;
        }
        failures.push({
          regionId: region.id,
          slot,
          reason: "fragmented_hostile_ground",
          message: `seed (${seedIndex % width}, ${Math.floor(seedIndex / width)}) in ${region.id} reaches only ` +
            `${cells.size} connected eligible cells; territories need at least ${rule.minCells}`,
        });
        continue;
      }

      for (const index of cells) {
        claimed[index] = 1;
        eligible[index] = 0;
        eligibleCount -= 1;
      }
      if (rule.spacing > 0) {
        for (const index of cells) {
          const cx = index % width;
          const cy = (index - cx) / width;
          for (let y = Math.max(0, cy - rule.spacing); y <= Math.min(height - 1, cy + rule.spacing); y += 1) {
            for (let x = Math.max(0, cx - rule.spacing); x <= Math.min(width - 1, cx + rule.spacing); x += 1) {
              const halo = y * width + x;
              if (spaced[halo] === 1) continue;
              spaced[halo] = 1;
              if (eligible[halo] === 1) {
                eligible[halo] = 0;
                eligibleCount -= 1;
              }
            }
          }
        }
      }
      covered += cells.size;
      const territory: Territory = {
        id: `territory.${region.id}.${slot}`,
        regionId: region.id,
        dangerBand: band,
        seedCell: [seedIndex % width, Math.floor(seedIndex / width)],
        cells: { encoding: "runs", runs: encodeRuns(cells, width) },
        cellCount: cells.size,
        roster,
        packSize: [rule.packSizeMin, rule.packSizeMax],
        maxActive: Math.max(1, Math.floor((cells.size * rule.maxActivePer100Cells) / 100)),
        respawnPressure: rule.respawnPressure,
        elitePermille: rule.elitePermille,
        channel: slotChannel.path,
        draw,
      };
      territories.push(territory);
      emitted += 1;
    }

    coverage.push({
      regionId: region.id,
      hostileWalkable: region.hostileWalkableCells,
      covered,
      coveragePermille: region.hostileWalkableCells > 0 ? Math.floor((covered * 1000) / region.hostileWalkableCells) : 0,
      budget,
      emitted,
    });
  }

  return {
    territoriesFormat: TERRITORIES_FORMAT,
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
    territories,
    failures,
    coverage: {
      regions: coverage,
      totalHostileWalkable: coverage.reduce((sum, entry) => sum + entry.hostileWalkable, 0),
      totalCovered: coverage.reduce((sum, entry) => sum + entry.covered, 0),
    },
  };
}
