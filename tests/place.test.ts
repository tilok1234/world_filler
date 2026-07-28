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
  const model = new WorldModel(pack.artifact);
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
      const model = new WorldModel(pack.artifact);
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
        const half = Math.floor(side / 2);
        for (let y = placement.cell[1] - half; y < placement.cell[1] - half + side; y += 1) {
          for (let x = placement.cell[0] - half; x < placement.cell[0] - half + side; x += 1) {
            const index = y * width + x;
            assert.equal(bundle.bits[index], 1, `${placement.id} arena cell (${x}, ${y}) walkable`);
            assert.equal(bundle.safeZone[index], 0, `${placement.id} arena cell (${x}, ${y}) outside safe zones`);
            assert.equal(claimed[index], 0, `${placement.id} arena cell (${x}, ${y}) not doubly claimed`);
            claimed[index] = 1;
          }
        }
      }
    }
  });

  it("reroll of one region changes only that region's placements", () => {
    const base = solveFor("fen-hollow", { ...MINIMAL, name: "reroll-base" }).doc;
    assert.ok(base.placements.length >= 2, "need at least two placements for a scoping proof");
    const targetRegion = (base.placements[0] as PlacementsDoc["placements"][number]).regionId;

    const rerolled = solveFor("fen-hollow", {
      ...MINIMAL,
      name: "reroll-base",
      rerolls: [{ regionId: targetRegion, iteration: 1 }],
    }).doc;

    const byId = new Map(rerolled.placements.map((placement) => [placement.id, placement]));
    for (const placement of base.placements) {
      const after = byId.get(placement.id);
      if (placement.regionId === targetRegion) {
        assert.ok(after === undefined || canonicalJson(after) !== canonicalJson(placement) || after.channel !== placement.channel,
          `${placement.id} in the rerolled region must draw from a different channel`);
        if (after !== undefined) {
          assert.notEqual(after.channel, placement.channel, `${placement.id} channel path must change on reroll`);
        }
      } else {
        assert.ok(after !== undefined, `${placement.id} outside the rerolled region must survive`);
        assert.equal(canonicalJson(after), canonicalJson(placement), `${placement.id} outside the rerolled region must be unchanged`);
      }
    }
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

  it("rejects rerolls referencing unknown regions", () => {
    const pack = readGamePack(join(repoRoot(), "fixtures", "packs", "fen-hollow"));
    const model = new WorldModel(pack.artifact);
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
