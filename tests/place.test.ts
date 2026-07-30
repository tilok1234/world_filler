import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { join } from "node:path";
import { readGamePack } from "../src/pack/readPack.js";
import { WorldModel } from "../src/world/model.js";
import { analyzeWorld } from "../src/analysis/analyze.js";
import { normalizeRecipe } from "../src/recipe/schema.js";
import { compilePlan } from "../src/plan/plan.js";
import { solvePlacements, PlacementError, type PlacementsDoc } from "../src/place/solver.js";
import { UNREACHABLE } from "../src/analysis/fields.js";
import { canonicalJson } from "../src/core/canonicalJson.js";
import { repoRoot } from "../src/core/guard.js";
import { makeArtifact, setMaterial } from "./helpers/syntheticWorld.js";

const MINIMAL = { recipeFormat: 1, name: "basic-direction", directorSeed: 103991 };

function solveFor(packName: string, recipeRaw: unknown): { doc: PlacementsDoc; model: WorldModel; bundle: ReturnType<typeof analyzeWorld> } {
  const pack = readGamePack(join(repoRoot(), "fixtures", "packs", packName));
  const model = new WorldModel(pack.artifact, pack.adapterElev);
  const bundle = analyzeWorld(model);
  const recipe = normalizeRecipe(recipeRaw);
  const plan = compilePlan(model, bundle, recipe);
  return { doc: solvePlacements(model, bundle, plan, recipe), model, bundle };
}

describe("placement solver", () => {
  it("is deterministic: identical inputs give byte-identical placements", () => {
    const first = solveFor("fen-hollow", MINIMAL).doc;
    const second = solveFor("fen-hollow", MINIMAL).doc;
    assert.equal(canonicalJson(first), canonicalJson(second));
  });

  it("places every fixture budget or explains the failure", () => {
    for (const packName of ["fen-hollow", "dust-hollow", "tiny-temperate"]) {
      const pack = readGamePack(join(repoRoot(), "fixtures", "packs", packName));
      const model = new WorldModel(pack.artifact, pack.adapterElev);
      const bundle = analyzeWorld(model);
      const recipe = normalizeRecipe({ ...MINIMAL, name: "fixture-sweep" });
      const plan = compilePlan(model, bundle, recipe);
      const doc = solvePlacements(model, bundle, plan, recipe);

      const bossBudget = plan.regions.reduce((sum, region) => sum + region.budgets.worldBosses, 0);
      const dungeonBudget = plan.regions.reduce((sum, region) => sum + region.budgets.dungeonBindings, 0);
      const bosses = doc.placements.filter((placement) => placement.rule === "world_boss.v1").length;
      const dungeons = doc.placements.filter((placement) => placement.rule === "dungeon_binding.v1").length;
      const bossFailures = doc.failures.filter((failure) => failure.rule === "world_boss.v1").length;
      const dungeonFailures = doc.failures.filter((failure) => failure.rule === "dungeon_binding.v1").length;

      assert.equal(bosses + bossFailures, bossBudget, `${packName}: every boss budget places or explains`);
      assert.ok(dungeons <= dungeonBudget, `${packName}: dungeons within budget`);
      assert.ok(dungeonFailures >= 0);
      for (const region of plan.regions) {
        if (region.budgets.dungeonBindings <= 0) continue;
        const placedHere = doc.placements.filter(
          (placement) => placement.rule === "dungeon_binding.v1" && placement.regionId === region.id,
        ).length;
        const failedHere = doc.failures.some(
          (failure) => failure.rule === "dungeon_binding.v1" && failure.regionId === region.id,
        );
        assert.ok(
          placedHere === region.budgets.dungeonBindings || failedHere,
          `${packName}/${region.id}: dungeon budget places fully or explains`,
        );
      }
      for (const failure of doc.failures) {
        assert.ok(failure.message.length > 20, "failure carries a real message");
        assert.ok(failure.candidateFunnel.length > 0, "failure carries its funnel");
      }
    }
  });

  it("never places on unwalkable or spawn-unreachable cells, and reservations respect invariants", () => {
    const { doc, model, bundle } = solveFor("fen-hollow", MINIMAL);
    const { width } = model.dimensions;
    const claimed = new Uint8Array(bundle.bits.length);

    for (const placement of doc.placements) {
      const accessIndex = placement.accessCell[1] * width + placement.accessCell[0];
      assert.equal(bundle.bits[accessIndex], 1, `${placement.id} access cell walkable`);
      assert.notEqual(bundle.distanceFromSpawn[accessIndex], UNREACHABLE, `${placement.id} access cell reachable`);

      if (placement.rule === "world_boss.v1") {
        const cellIndex = placement.cell[1] * width + placement.cell[0];
        assert.equal(bundle.bits[cellIndex], 1, `${placement.id} boss cell walkable`);
        assert.notEqual(bundle.distanceFromSpawn[cellIndex], UNREACHABLE, `${placement.id} boss cell reachable`);
        const side = placement.arenaSide as number;
        const [ox, oy] = placement.arenaOrigin as readonly [number, number];
        const centerOffset = Math.floor((side - 1) / 2);
        assert.deepEqual(placement.cell, [ox + centerOffset, oy + centerOffset], `${placement.id} cell is the arena center`);
        for (let y = oy; y < oy + side; y += 1) {
          for (let x = ox; x < ox + side; x += 1) {
            const index = y * width + x;
            assert.equal(bundle.bits[index], 1, `${placement.id} arena cell (${x}, ${y}) walkable`);
            assert.equal(bundle.safeZone[index], 0, `${placement.id} arena cell (${x}, ${y}) outside safe zones`);
            assert.equal(claimed[index], 0, `${placement.id} arena cell (${x}, ${y}) not doubly claimed`);
            claimed[index] = 1;
          }
        }
      }
    }

    // Symmetric exclusion: no placement's physical cells may sit inside
    // any other placement's exclusion disc.
    for (const a of doc.placements) {
      for (const b of doc.placements) {
        if (a.id === b.id) continue;
        const physical: Array<readonly [number, number]> = [];
        if (a.rule === "world_boss.v1") {
          const [ox, oy] = a.arenaOrigin as readonly [number, number];
          for (let y = oy; y < oy + (a.arenaSide as number); y += 1) {
            for (let x = ox; x < ox + (a.arenaSide as number); x += 1) physical.push([x, y]);
          }
        } else {
          physical.push(a.cell);
        }
        const r2 = b.exclusionRadius * b.exclusionRadius;
        for (const [px, py] of physical) {
          const dx = px - b.cell[0];
          const dy = py - b.cell[1];
          assert.ok(
            dx * dx + dy * dy > r2,
            `${a.id} physical cell (${px}, ${py}) sits inside the exclusion disc of ${b.id}`,
          );
        }
      }
    }
  });

  /**
   * The reroll contract adopted after adversarial review: rerolling a
   * region re-seeds only that region's channels; SPATIALLY UNCOUPLED
   * regions are byte-identical; coupled regions (buffers crossing borders,
   * peer distance) re-solve deterministically. This test builds two grass
   * regions far apart with no cross-region constraints, so the strong
   * byte-identity claim must hold.
   */
  function twoRegionWorld(): { model: WorldModel; bundle: ReturnType<typeof analyzeWorld> } {
    const artifact = makeArtifact(24);
    for (let y = 0; y < 24; y += 1) {
      for (let x = 10; x < 14; x += 1) setMaterial(artifact, x, y, "terrain.mud");
    }
    const model = new WorldModel(artifact);
    return { model, bundle: analyzeWorld(model) };
  }

  const TWO_BOSS_RECIPE = {
    recipeFormat: 1,
    name: "two-region-scoping",
    directorSeed: 7,
    budgets: { minRegionCells: 32, majorRegionCells: 4096, worldBossCount: 2, minWorldBossBand: 0 },
    worldBossRule: { minClearance: 3, minSettlementPathDistance: 0, minPeerPathDistance: 0, exclusionRadius: 2 },
  };

  it("places two bosses in separate regions and keeps peer/reservation invariants", () => {
    const { model, bundle } = twoRegionWorld();
    const recipe = normalizeRecipe(TWO_BOSS_RECIPE);
    const plan = compilePlan(model, bundle, recipe);
    const doc = solvePlacements(model, bundle, plan, recipe);
    const bosses = doc.placements.filter((placement) => placement.rule === "world_boss.v1");
    assert.equal(bosses.length, 2, "both grass regions receive a boss");
    const regions = new Set(bosses.map((boss) => boss.regionId));
    assert.equal(regions.size, 2, "bosses land in distinct regions");
  });

  it("rerolling one uncoupled region leaves the other region byte-identical", () => {
    const { model, bundle } = twoRegionWorld();
    const base = solvePlacements(model, bundle, compilePlan(model, bundle, normalizeRecipe(TWO_BOSS_RECIPE)), normalizeRecipe(TWO_BOSS_RECIPE));
    const bosses = base.placements.filter((placement) => placement.rule === "world_boss.v1");
    assert.equal(bosses.length, 2);
    const [first, second] = bosses as [PlacementsDoc["placements"][number], PlacementsDoc["placements"][number]];

    const rerolledRecipe = normalizeRecipe({ ...TWO_BOSS_RECIPE, rerolls: [{ regionId: first.regionId, iteration: 3 }] });
    const rerolled = solvePlacements(model, bundle, compilePlan(model, bundle, rerolledRecipe), rerolledRecipe);

    const firstAfter = rerolled.placements.find((placement) => placement.id === first.id);
    const secondAfter = rerolled.placements.find((placement) => placement.id === second.id);
    assert.ok(firstAfter !== undefined && secondAfter !== undefined);
    assert.notEqual(firstAfter.channel, first.channel, "rerolled region draws from a new channel subtree");
    assert.ok(firstAfter.channel.includes("reroll.3"));
    assert.equal(
      canonicalJson(secondAfter),
      canonicalJson(second),
      "the uncoupled region's placement must be byte-identical across the reroll",
    );
  });

  it("tags dungeons whose access cell lies inside a safe zone", () => {
    const artifact = makeArtifact();
    artifact.settlements.push({
      id: 0,
      kind: "outpost",
      purpose: "waypoint",
      anchor: [2, 2],
      radius: 2,
      structures: [],
    });
    artifact.pois.push({
      id: 0,
      type: "poi.cave",
      cell: [3, 3],
      structure: { type: "structure.cave_mouth", x: 3, y: 3, w: 2, h: 1 },
    });
    artifact.destinations.push({ id: 1, kind: "landmark_candidate", cell: [7, 7] });
    const model = new WorldModel(artifact);
    const bundle = analyzeWorld(model);
    const recipe = normalizeRecipe({
      recipeFormat: 1,
      name: "safe-dungeon",
      directorSeed: 1,
      budgets: { minRegionCells: 4, worldBossCount: 0 },
    });
    const plan = compilePlan(model, bundle, recipe);
    const doc = solvePlacements(model, bundle, plan, recipe);
    const dungeon = doc.placements.find((placement) => placement.rule === "dungeon_binding.v1");
    assert.ok(dungeon !== undefined, "the cave binds");
    assert.equal(dungeon.inSafeZone, true, "access inside the settlement disc is tagged");
  });

  it("reports anchors in zero-budget regions instead of dropping them", () => {
    const artifact = makeArtifact();
    // Region too small for any budget (minRegionCells default 64 > 8x8 patches).
    for (let y = 0; y < 8; y += 1) {
      for (let x = 4; x < 8; x += 1) setMaterial(artifact, x, y, "terrain.mud");
    }
    artifact.pois.push({
      id: 0,
      type: "poi.cave",
      cell: [6, 6],
      structure: { type: "structure.cave_mouth", x: 6, y: 6, w: 2, h: 1 },
    });
    const model = new WorldModel(artifact);
    const bundle = analyzeWorld(model);
    const recipe = normalizeRecipe({ recipeFormat: 1, name: "zero-budget", directorSeed: 1, budgets: { worldBossCount: 0 } });
    const plan = compilePlan(model, bundle, recipe);
    const doc = solvePlacements(model, bundle, plan, recipe);
    assert.equal(doc.placements.length, 0);
    const anchor = doc.unboundAnchors.find((entry) => entry.poiId === 0);
    assert.ok(anchor !== undefined, "the anchor appears in the report");
    assert.equal(anchor.reason, "region_zero_budget");
  });

  it("explanations carry channel, funnel, score terms, and the chosen candidate", () => {
    const { doc } = solveFor("fen-hollow", MINIMAL);
    for (const placement of doc.placements) {
      assert.ok(placement.channel.startsWith("world/"), "channel path recorded");
      assert.ok(placement.candidateFunnel.length >= 3, "funnel recorded");
      assert.ok(placement.scoreTerms.length >= 1, "score terms recorded");
      assert.equal(
        placement.score,
        placement.scoreTerms.reduce((sum, term) => sum + term.contribution, 0),
        "score equals the sum of its terms",
      );
      assert.ok(
        placement.topCandidates.some((candidate) => candidate.cell[0] === placement.cell[0] && candidate.cell[1] === placement.cell[1]),
        "chosen cell appears in the top-candidate window",
      );
    }
  });

  it("fails with a named, located error when a region cannot host its boss", () => {
    const artifact = makeArtifact();
    // Grass world, but no 6-clearance square exists once rocks pepper it.
    for (let y = 0; y < 8; y += 2) {
      for (let x = 0; x < 8; x += 2) setMaterial(artifact, x, y, "terrain.rock");
    }
    const model = new WorldModel(artifact);
    const bundle = analyzeWorld(model);
    const recipe = normalizeRecipe({
      recipeFormat: 1,
      name: "impossible-boss",
      directorSeed: 1,
      budgets: { minRegionCells: 4, minWorldBossBand: 0, worldBossCount: 1 },
    });
    const plan = compilePlan(model, bundle, recipe);
    assert.ok(plan.worldBudget.worldBosses.allocated === 1, "plan allocates the boss so the solver must explain");
    const doc = solvePlacements(model, bundle, plan, recipe);
    assert.equal(doc.placements.filter((placement) => placement.rule === "world_boss.v1").length, 0);
    assert.equal(doc.failures.length, 1);
    const failure = doc.failures[0] as PlacementsDoc["failures"][number];
    assert.equal(failure.rule, "world_boss.v1");
    assert.match(failure.message, /no valid world-boss site in region\./);
    assert.ok(failure.candidateFunnel.some((step) => step.stage === "clearance_anchor_in_region"));
  });

  it("distance floors are scale-free and explained: floored anchors are named, boss funnels carry the road stage", () => {
    // Near-maximal floors: every reachable anchor sits below the
    // settlement floor and is unbound by name, never silently skipped.
    // dust-hollow, not fen: at behavior 13 fen's dungeon anchors all sit
    // in zero-budget regions, so no fen anchor ever reaches the floor.
    const floored = solveFor("dust-hollow", {
      ...MINIMAL,
      name: "floored",
      dungeonRule: { minSettlementDistancePermille: 990 },
      worldBossRule: { minRoadDistancePermille: 995 },
    }).doc;
    assert.ok(
      floored.unboundAnchors.some((anchor) => anchor.reason === "below_distance_floor"),
      "anchors below the settlement floor carry the below_distance_floor reason",
    );
    const funnels = [
      ...floored.placements.map((placement) => placement.candidateFunnel),
      ...floored.failures.map((failure) => failure.candidateFunnel),
    ];
    assert.ok(
      funnels.some((funnel) => funnel.some((step) => step.stage === "road_distance")),
      "boss funnels record the road_distance stage",
    );
    // Zero floors (the defaults) leave the solve byte-identical to a
    // recipe that never mentions them.
    const zeroFloors = solveFor("fen-hollow", {
      ...MINIMAL,
      worldBossRule: { minSettlementDistancePermille: 0, minRoadDistancePermille: 0 },
      dungeonRule: { minSettlementDistancePermille: 0 },
    }).doc;
    const defaults = solveFor("fen-hollow", MINIMAL).doc;
    assert.equal(canonicalJson(zeroFloors), canonicalJson(defaults));
  });

  it("rejects rerolls referencing unknown regions", () => {
    const pack = readGamePack(join(repoRoot(), "fixtures", "packs", "fen-hollow"));
    const model = new WorldModel(pack.artifact, pack.adapterElev);
    const bundle = analyzeWorld(model);
    const recipe = normalizeRecipe({ ...MINIMAL, rerolls: [{ regionId: "region.grass.9999", iteration: 1 }] });
    const plan = compilePlan(model, bundle, recipe);
    assert.throws(() => solvePlacements(model, bundle, plan, recipe), (error: unknown) => {
      assert.ok(error instanceof PlacementError);
      assert.match(error.message, /unknown region region\.grass\.9999/);
      return true;
    });
  });
});
