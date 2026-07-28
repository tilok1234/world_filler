import { Channel } from "../core/channel.js";
import { recipeSha256, type DirectorRecipe } from "../recipe/schema.js";
import type { WorldModel } from "../world/model.js";
import type { AnalysisBundle } from "../analysis/analyze.js";
import type { RegionalPlan } from "../plan/plan.js";
import { distanceField, UNREACHABLE } from "../analysis/fields.js";
import { ANALYSIS_VERSION } from "../analysis/analyze.js";
import { DIRECTOR_BEHAVIOR_VERSION, PLACEMENTS_FORMAT, RULE_PACK_VERSIONS } from "../core/version.js";

/**
 * The F4 placement solver: candidates -> hard filters -> integer soft
 * scoring -> seeded top-K selection -> reservations -> explanations.
 *
 * Determinism contract: regions are processed in sorted-id order; every
 * random decision draws from `world/<regionId>/reroll.<n>/<system>/<slot>`
 * so rerolling one region cannot move another region's placements. All
 * scoring is integer arithmetic. Nothing here mutates the world — the
 * solver assigns meaning to existing walkable geography and records why.
 */

export class PlacementError extends Error {}

const BOSS_PICK_WINDOW = 8;
const DUNGEON_PICK_WINDOW = 4;
const ANCHOR_ACCESS_RADIUS = 4;

export interface CandidateFunnel {
  readonly stage: string;
  readonly remaining: number;
}

export interface ScoreTerm {
  readonly term: string;
  readonly value: number;
  readonly weightPermille: number;
  readonly contribution: number;
}

export interface Placement {
  readonly id: string;
  readonly rule: "world_boss.v1" | "dungeon_binding.v1";
  readonly regionId: string;
  readonly cell: readonly [number, number];
  readonly accessCell: readonly [number, number];
  readonly anchorPoiId: number | null;
  readonly anchorPoiType: string | null;
  readonly inSafeZone: boolean;
  readonly arenaSide: number | null;
  readonly exclusionRadius: number;
  readonly channel: string;
  readonly draw: number;
  readonly score: number;
  readonly scoreTerms: readonly ScoreTerm[];
  readonly candidateFunnel: readonly CandidateFunnel[];
  readonly topCandidates: readonly { readonly cell: readonly [number, number]; readonly score: number }[];
}

export interface PlacementFailure {
  readonly regionId: string;
  readonly rule: string;
  readonly slot: number;
  readonly candidateFunnel: readonly CandidateFunnel[];
  readonly message: string;
}

export interface UnboundAnchor {
  readonly poiId: number;
  readonly poiType: string;
  readonly cell: readonly [number, number];
  readonly regionId: string | null;
  readonly reason: "not_selected_budget" | "unreachable_anchor" | "spacing_blocked" | "no_region";
}

export interface PlacementsDoc {
  readonly placementsFormat: number;
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
  readonly placements: readonly Placement[];
  readonly failures: readonly PlacementFailure[];
  readonly unboundAnchors: readonly UnboundAnchor[];
}

interface SolverState {
  readonly model: WorldModel;
  readonly bundle: AnalysisBundle;
  readonly recipe: DirectorRecipe;
  readonly width: number;
  readonly height: number;
  /** Cells claimed by arenas and exclusion discs; new claims must not intersect. */
  readonly reservationMask: Uint8Array;
  readonly placements: Placement[];
  readonly failures: PlacementFailure[];
  readonly unboundAnchors: UnboundAnchor[];
  readonly rerollByRegion: ReadonlyMap<string, number>;
  readonly labelById: ReadonlyMap<string, number>;
}

function regionChannel(state: SolverState, regionId: string): Channel {
  const iteration = state.rerollByRegion.get(regionId) ?? 0;
  return Channel.root(state.recipe.directorSeed).child(regionId).child(`reroll.${iteration}`);
}

/** Claim a disc; returns the claimed indexes (all inside bounds). */
function discCells(state: SolverState, cx: number, cy: number, radius: number): number[] {
  const cells: number[] = [];
  const r2 = radius * radius;
  for (let y = Math.max(0, cy - radius); y <= Math.min(state.height - 1, cy + radius); y += 1) {
    for (let x = Math.max(0, cx - radius); x <= Math.min(state.width - 1, cx + radius); x += 1) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy <= r2) cells.push(y * state.width + x);
    }
  }
  return cells;
}

function squareCells(state: SolverState, centerX: number, centerY: number, side: number): number[] | null {
  const half = Math.floor(side / 2);
  const x0 = centerX - half;
  const y0 = centerY - half;
  const x1 = x0 + side - 1;
  const y1 = y0 + side - 1;
  if (x0 < 0 || y0 < 0 || x1 >= state.width || y1 >= state.height) return null;
  const cells: number[] = [];
  for (let y = y0; y <= y1; y += 1) {
    for (let x = x0; x <= x1; x += 1) cells.push(y * state.width + x);
  }
  return cells;
}

function anyReserved(state: SolverState, cells: readonly number[]): boolean {
  for (const index of cells) {
    if (state.reservationMask[index] === 1) return true;
  }
  return false;
}

function anySafe(state: SolverState, cells: readonly number[]): boolean {
  for (const index of cells) {
    if (state.bundle.safeZone[index] === 1) return true;
  }
  return false;
}

function claim(state: SolverState, cells: readonly number[]): void {
  for (const index of cells) state.reservationMask[index] = 1;
}

/**
 * Nearest walkable, spawn-reachable cell within a small radius of a target
 * (expanding square scan, dy outer / dx inner — the codebase's one nudge
 * order). Used for dungeon anchor access cells.
 */
function accessCellNear(state: SolverState, cx: number, cy: number): readonly [number, number] | null {
  for (let radius = 0; radius <= ANCHOR_ACCESS_RADIUS; radius += 1) {
    for (let dy = -radius; dy <= radius; dy += 1) {
      for (let dx = -radius; dx <= radius; dx += 1) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= state.width || y >= state.height) continue;
        const index = y * state.width + x;
        if (state.bundle.bits[index] === 1 && (state.bundle.distanceFromSpawn[index] as number) !== UNREACHABLE) {
          return [x, y];
        }
      }
    }
  }
  return null;
}

function permilleOf(value: number, max: number): number {
  if (max <= 0) return 0;
  return Math.min(1000, Math.floor((value * 1000) / max));
}

/** Place dungeon bindings for one region. Anchors are fixed; selection is which anchors become live dungeons. */
function placeDungeons(state: SolverState, regionId: string, budget: number, anchorPois: readonly { poiId: number; poiType: string; cell: readonly [number, number] }[]): void {
  const { recipe, bundle } = state;
  const settlementMax = Math.max(1, bundle.summary.fieldStats["distanceFromSettlements"]?.max ?? 1);

  interface DungeonCandidate {
    readonly poiId: number;
    readonly poiType: string;
    readonly cell: readonly [number, number];
    readonly accessCell: readonly [number, number];
    readonly score: number;
    readonly scoreTerms: readonly ScoreTerm[];
  }

  const reachable: DungeonCandidate[] = [];
  for (const anchor of anchorPois) {
    const access = accessCellNear(state, anchor.cell[0], anchor.cell[1]);
    if (access === null) {
      state.unboundAnchors.push({ poiId: anchor.poiId, poiType: anchor.poiType, cell: anchor.cell, regionId, reason: "unreachable_anchor" });
      continue;
    }
    const settlementDistance = bundle.distanceFromSettlements[access[1] * state.width + access[0]] as number;
    const value = settlementDistance === UNREACHABLE ? 1000 : permilleOf(settlementDistance, settlementMax);
    const contribution = Math.floor((value * recipe.dungeonRule.settlementFarPermille) / 1000);
    reachable.push({
      poiId: anchor.poiId,
      poiType: anchor.poiType,
      cell: anchor.cell,
      accessCell: access,
      score: contribution,
      scoreTerms: [
        { term: "settlement_far", value, weightPermille: recipe.dungeonRule.settlementFarPermille, contribution },
      ],
    });
  }
  reachable.sort((a, b) => (a.score !== b.score ? b.score - a.score : a.poiId - b.poiId));

  const channel = regionChannel(state, regionId).child("dungeon");
  const remaining = [...reachable];
  let placedInRegion = 0;
  for (let slot = 0; slot < budget; slot += 1) {
    // Drop candidates whose exclusion disc would intersect existing claims.
    const viable: DungeonCandidate[] = [];
    for (const candidate of remaining) {
      const disc = discCells(state, candidate.cell[0], candidate.cell[1], recipe.dungeonRule.exclusionRadius);
      if (!anyReserved(state, disc)) viable.push(candidate);
    }
    const funnel: CandidateFunnel[] = [
      { stage: "anchors_in_region", remaining: anchorPois.length },
      { stage: "reachable", remaining: reachable.length },
      { stage: "spacing_clear", remaining: viable.length },
    ];
    if (viable.length === 0) {
      state.failures.push({
        regionId,
        rule: "dungeon_binding.v1",
        slot,
        candidateFunnel: funnel,
        message: `no viable dungeon anchor for ${regionId} slot ${slot}: ` +
          `${anchorPois.length} anchors, ${reachable.length} reachable, 0 clear of existing reservations`,
      });
      break;
    }
    const window = Math.min(DUNGEON_PICK_WINDOW, viable.length);
    const slotChannel = channel.child(String(slot));
    const pickIndex = slotChannel.int(0, window);
    const chosen = viable[pickIndex] as DungeonCandidate;

    const disc = discCells(state, chosen.cell[0], chosen.cell[1], recipe.dungeonRule.exclusionRadius);
    claim(state, disc);
    remaining.splice(remaining.findIndex((candidate) => candidate.poiId === chosen.poiId), 1);
    placedInRegion += 1;

    const accessIndex = chosen.accessCell[1] * state.width + chosen.accessCell[0];
    state.placements.push({
      id: `placement.dungeon.${regionId}.${slot}`,
      rule: "dungeon_binding.v1",
      regionId,
      cell: chosen.cell,
      accessCell: chosen.accessCell,
      anchorPoiId: chosen.poiId,
      anchorPoiType: chosen.poiType,
      inSafeZone: state.bundle.safeZone[accessIndex] === 1,
      arenaSide: null,
      exclusionRadius: recipe.dungeonRule.exclusionRadius,
      channel: slotChannel.path,
      draw: pickIndex,
      score: chosen.score,
      scoreTerms: chosen.scoreTerms,
      candidateFunnel: funnel,
      topCandidates: viable.slice(0, window).map((candidate) => ({ cell: candidate.cell, score: candidate.score })),
    });
  }

  // Anchors that stayed unbound because the budget ran out.
  const chosenIds = new Set(state.placements.filter((placement) => placement.regionId === regionId && placement.rule === "dungeon_binding.v1").map((placement) => placement.anchorPoiId));
  for (const candidate of reachable) {
    if (!chosenIds.has(candidate.poiId)) {
      state.unboundAnchors.push({
        poiId: candidate.poiId,
        poiType: candidate.poiType,
        cell: candidate.cell,
        regionId,
        reason: placedInRegion < budget ? "spacing_blocked" : "not_selected_budget",
      });
    }
  }
}

/** Place the world boss for one region. */
function placeBoss(state: SolverState, regionId: string, slot: number, peerFields: readonly Int32Array[]): Int32Array | null {
  const { recipe, bundle, model } = state;
  const rule = recipe.worldBossRule;
  const label = state.labelById.get(regionId) as number;
  const side = rule.minClearance;
  const half = Math.floor(side / 2);
  const settlementMax = Math.max(1, bundle.summary.fieldStats["distanceFromSettlements"]?.max ?? 1);
  const roadMax = Math.max(1, bundle.summary.fieldStats["distanceFromRoads"]?.max ?? 1);

  interface BossCandidate {
    readonly cellIndex: number;
    readonly x: number;
    readonly y: number;
    readonly score: number;
    readonly scoreTerms: readonly ScoreTerm[];
  }

  let inRegion = 0;
  let afterClearance = 0;
  let afterBounds = 0;
  let afterSafeAndReserved = 0;
  let afterSettlement = 0;
  const candidates: BossCandidate[] = [];

  for (let y = 0; y < state.height; y += 1) {
    for (let x = 0; x < state.width; x += 1) {
      const anchorIndex = y * state.width + x;
      // Clearance anchors a square at its bottom-right; the boss cell is
      // that square's center, and the center must belong to the region.
      if ((bundle.clearance[anchorIndex] as number) < side) continue;
      const centerX = x - half;
      const centerY = y - half;
      const centerIndex = centerY * state.width + centerX;
      if ((bundle.regionLabels[centerIndex] as number) !== label) continue;
      inRegion += 1;
      if ((bundle.distanceFromSpawn[centerIndex] as number) === UNREACHABLE) continue;
      afterClearance += 1;
      const square = squareCells(state, centerX, centerY, side);
      if (square === null) continue;
      afterBounds += 1;
      if (anySafe(state, square) || anyReserved(state, square)) continue;
      afterSafeAndReserved += 1;
      const settlementDistance = bundle.distanceFromSettlements[centerIndex] as number;
      const settlementValue = settlementDistance === UNREACHABLE ? 1000 : permilleOf(settlementDistance, settlementMax);
      if (settlementDistance !== UNREACHABLE && settlementDistance < rule.minSettlementPathDistance) continue;
      afterSettlement += 1;
      let peerOk = true;
      for (const field of peerFields) {
        const peerDistance = field[centerIndex] as number;
        if (peerDistance !== UNREACHABLE && peerDistance < rule.minPeerPathDistance) {
          peerOk = false;
          break;
        }
      }
      if (!peerOk) continue;

      const clearanceValue = permilleOf(Math.min(bundle.clearance[anchorIndex] as number, side * 2), side * 2);
      const roadDistance = bundle.distanceFromRoads[centerIndex] as number;
      const roadValue = roadDistance === UNREACHABLE ? 1000 : permilleOf(roadDistance, roadMax);
      const terms: ScoreTerm[] = [
        { term: "clearance", value: clearanceValue, weightPermille: rule.clearancePermille, contribution: Math.floor((clearanceValue * rule.clearancePermille) / 1000) },
        { term: "settlement_far", value: settlementValue, weightPermille: rule.settlementFarPermille, contribution: Math.floor((settlementValue * rule.settlementFarPermille) / 1000) },
        { term: "road_far", value: roadValue, weightPermille: rule.roadFarPermille, contribution: Math.floor((roadValue * rule.roadFarPermille) / 1000) },
      ];
      const score = terms.reduce((sum, term) => sum + term.contribution, 0);
      candidates.push({ cellIndex: centerIndex, x: centerX, y: centerY, score, scoreTerms: terms });
    }
  }

  const funnel: CandidateFunnel[] = [
    { stage: "clearance_anchor_in_region", remaining: inRegion },
    { stage: "reachable", remaining: afterClearance },
    { stage: "arena_in_bounds", remaining: afterBounds },
    { stage: "clear_of_safe_and_reserved", remaining: afterSafeAndReserved },
    { stage: "settlement_distance", remaining: afterSettlement },
    { stage: "peer_distance", remaining: candidates.length },
  ];

  if (candidates.length === 0) {
    state.failures.push({
      regionId,
      rule: "world_boss.v1",
      slot,
      candidateFunnel: funnel,
      message: `no valid world-boss site in ${regionId}: ${funnel.map((step) => `${step.stage}=${step.remaining}`).join(", ")}`,
    });
    return null;
  }

  candidates.sort((a, b) => (a.score !== b.score ? b.score - a.score : a.cellIndex - b.cellIndex));
  const window = Math.min(BOSS_PICK_WINDOW, candidates.length);
  const channel = regionChannel(state, regionId).child("boss").child(String(slot));
  const pickIndex = channel.int(0, window);
  const chosen = candidates[pickIndex] as BossCandidate;

  const square = squareCells(state, chosen.x, chosen.y, side) as number[];
  const disc = discCells(state, chosen.x, chosen.y, rule.exclusionRadius);
  claim(state, square);
  claim(state, disc);

  state.placements.push({
    id: `placement.world_boss.${regionId}.${slot}`,
    rule: "world_boss.v1",
    regionId,
    cell: [chosen.x, chosen.y],
    accessCell: [chosen.x, chosen.y],
    anchorPoiId: null,
    anchorPoiType: null,
    inSafeZone: false,
    arenaSide: side,
    exclusionRadius: rule.exclusionRadius,
    channel: channel.path,
    draw: pickIndex,
    score: chosen.score,
    scoreTerms: chosen.scoreTerms,
    candidateFunnel: funnel,
    topCandidates: candidates.slice(0, window).map((candidate) => ({ cell: [candidate.x, candidate.y], score: candidate.score })),
  });

  return distanceField(bundle.bits, state.width, state.height, [chosen.cellIndex]);
}

export function solvePlacements(model: WorldModel, bundle: AnalysisBundle, plan: RegionalPlan, recipe: DirectorRecipe): PlacementsDoc {
  const { width, height } = model.dimensions;
  const regionIds = new Set(plan.regions.map((region) => region.id));
  for (const reroll of recipe.rerolls) {
    if (!regionIds.has(reroll.regionId)) {
      throw new PlacementError(`placements: reroll references unknown region ${reroll.regionId}`);
    }
  }

  const state: SolverState = {
    model,
    bundle,
    recipe,
    width,
    height,
    reservationMask: new Uint8Array(width * height),
    placements: [],
    failures: [],
    unboundAnchors: [],
    rerollByRegion: new Map(recipe.rerolls.map((reroll) => [reroll.regionId, reroll.iteration])),
    labelById: new Map(bundle.regions.map((region, label) => [region.id, label])),
  };

  // Anchor POIs grouped per region (same nearest-region snap as the plan).
  const anchorTypes = new Set(recipe.dungeonAnchors.poiTypes);
  const anchorsByRegion = new Map<string, Array<{ poiId: number; poiType: string; cell: readonly [number, number] }>>();
  for (const poi of model.pois) {
    if (!anchorTypes.has(poi.type) || poi.structure === undefined) continue;
    let label = -1;
    outer: for (let radius = 0; radius < 5; radius += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const x = poi.cell[0] + dx;
          const y = poi.cell[1] + dy;
          if (x < 0 || y < 0 || x >= width || y >= height) continue;
          const candidate = bundle.regionLabels[y * width + x] as number;
          if (candidate !== -1) {
            label = candidate;
            break outer;
          }
        }
      }
    }
    if (label === -1) {
      state.unboundAnchors.push({ poiId: poi.id, poiType: poi.type, cell: poi.cell, regionId: null, reason: "no_region" });
      continue;
    }
    const regionId = (bundle.regions[label] as (typeof bundle.regions)[number]).id;
    const list = anchorsByRegion.get(regionId) ?? [];
    list.push({ poiId: poi.id, poiType: poi.type, cell: poi.cell });
    anchorsByRegion.set(regionId, list);
  }
  for (const list of anchorsByRegion.values()) list.sort((a, b) => a.poiId - b.poiId);

  // Pass 1 — dungeon bindings (fixed anchors claim ground first).
  for (const region of plan.regions) {
    if (region.budgets.dungeonBindings <= 0) continue;
    placeDungeons(state, region.id, region.budgets.dungeonBindings, anchorsByRegion.get(region.id) ?? []);
  }

  // Pass 2 — world bosses (flexible sites route around existing claims).
  const peerFields: Int32Array[] = [];
  for (const region of plan.regions) {
    if (region.budgets.worldBosses <= 0) continue;
    const field = placeBoss(state, region.id, 0, peerFields);
    if (field !== null) peerFields.push(field);
  }

  return {
    placementsFormat: PLACEMENTS_FORMAT,
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
    placements: state.placements,
    failures: state.failures,
    unboundAnchors: [...state.unboundAnchors].sort((a, b) => a.poiId - b.poiId),
  };
}
