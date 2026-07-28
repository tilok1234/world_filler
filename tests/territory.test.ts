import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { join } from "node:path";
import { readGamePack } from "../src/pack/readPack.js";
import { WorldModel } from "../src/world/model.js";
import { analyzeWorld } from "../src/analysis/analyze.js";
import { normalizeRecipe } from "../src/recipe/schema.js";
import { compilePlan } from "../src/plan/plan.js";
import { solvePlacements } from "../src/place/solver.js";
import { growTerritories, encodeRuns, decodeRuns, type TerritoriesDoc } from "../src/territory/territory.js";
import { UNREACHABLE } from "../src/analysis/fields.js";
import { canonicalJson } from "../src/core/canonicalJson.js";
import { repoRoot } from "../src/core/guard.js";
import { makeArtifact, setMaterial } from "./helpers/syntheticWorld.js";

const MINIMAL = { recipeFormat: 1, name: "basic-direction", directorSeed: 103991 };

function territoriesFor(packName: string, recipeRaw: unknown): {
  doc: TerritoriesDoc;
  model: WorldModel;
  bundle: ReturnType<typeof analyzeWorld>;
  placements: ReturnType<typeof solvePlacements>;
} {
  const pack = readGamePack(join(repoRoot(), "fixtures", "packs", packName));
  const model = new WorldModel(pack.artifact);
  const bundle = analyzeWorld(model);
  const recipe = normalizeRecipe(recipeRaw);
  const plan = compilePlan(model, bundle, recipe);
  const placements = solvePlacements(model, bundle, plan, recipe);
  return { doc: growTerritories(model, bundle, plan, placements, recipe), model, bundle, placements };
}

describe("run encoding", () => {
  it("round-trips arbitrary cell sets", () => {
    const cells = new Set([0, 1, 2, 10, 12, 13, 27, 64, 65]);
    const runs = encodeRuns(cells, 8);
    assert.deepEqual(runs, [[0, 0, 3], [2, 1, 1], [4, 1, 2], [3, 3, 1], [0, 8, 2]]);
    assert.deepEqual([...decodeRuns(runs, 8, 16)].sort((a, b) => a - b), [...cells].sort((a, b) => a - b));
  });

  it("never merges runs across a row boundary", () => {
    const cells = new Set([7, 8]); // (7,0) and (0,1) are index-adjacent but different rows
    const runs = encodeRuns(cells, 8);
    assert.deepEqual(runs, [[7, 0, 1], [0, 1, 1]]);
  });

  it("spacing keeps a clear Chebyshev gap between every pair of territories", () => {
    const spacing = 4;
    const { doc, model } = territoriesFor("fen-hollow", { ...MINIMAL, name: "spaced", territoryRule: { spacing } });
    const { width, height } = model.dimensions;
    assert.ok(doc.territories.length >= 2, "needs at least two territories to measure gaps");
    const cellsOf = doc.territories.map((territory) => decodeRuns(territory.cells.runs, width, height));
    for (let a = 0; a < cellsOf.length; a += 1) {
      for (let b = a + 1; b < cellsOf.length; b += 1) {
        for (const cellA of cellsOf[a] as Set<number>) {
          const ax = cellA % width;
          const ay = (cellA - ax) / width;
          for (const cellB of cellsOf[b] as Set<number>) {
            const bx = cellB % width;
            const by = (cellB - bx) / width;
            const chebyshev = Math.max(Math.abs(ax - bx), Math.abs(ay - by));
            assert.ok(
              chebyshev > spacing,
              `territories ${a} and ${b} are ${chebyshev} apart at (${ax},${ay})/(${bx},${by}); spacing is ${spacing}`,
            );
          }
        }
      }
    }
  });

  it("refuses malformed runs by name instead of wrapping into the next row", () => {
    assert.throws(() => decodeRuns([[6, 0, 5]], 8, 8), /runs never cross rows/);
    assert.throws(() => decodeRuns([[-1, 0, 2]], 8, 8), /runs never cross rows/);
    assert.throws(() => decodeRuns([[0, -1, 1]], 8, 8), /runs never cross rows/);
    assert.throws(() => decodeRuns([[0, 8, 1]], 8, 8), /runs never cross rows/);
    assert.throws(() => decodeRuns([[0, 0, 0]], 8, 8), /runs never cross rows/);
    assert.throws(() => decodeRuns([[0.5, 0, 1]], 8, 8), /not integer/);
  });
});

describe("spawn territories", () => {
  it("is deterministic: identical inputs give byte-identical territories", () => {
    const first = territoriesFor("fen-hollow", MINIMAL).doc;
    const second = territoriesFor("fen-hollow", MINIMAL).doc;
    assert.equal(canonicalJson(first), canonicalJson(second));
  });

  it("holds every ground invariant on all fixtures", () => {
    for (const packName of ["fen-hollow", "dust-hollow", "tiny-temperate"]) {
      const { doc, model, bundle, placements } = territoriesFor(packName, { ...MINIMAL, name: "sweep" });
      const { width } = model.dimensions;
      const owned = new Int32Array(width * model.dimensions.height).fill(-1);
      const labelById = new Map(bundle.regions.map((region, label) => [region.id, label]));

      for (let t = 0; t < doc.territories.length; t += 1) {
        const territory = doc.territories[t] as TerritoriesDoc["territories"][number];
        const cells = decodeRuns(territory.cells.runs, width, model.dimensions.height);
        assert.equal(cells.size, territory.cellCount, `${territory.id} cellCount matches encoding`);
        const label = labelById.get(territory.regionId);
        for (const index of cells) {
          assert.equal(bundle.bits[index], 1, `${territory.id} cell walkable`);
          assert.notEqual(bundle.distanceFromSpawn[index], UNREACHABLE, `${territory.id} cell reachable`);
          assert.equal(bundle.safeZone[index], 0, `${territory.id} cell outside safe zones`);
          assert.equal(bundle.regionLabels[index], label, `${territory.id} cell in its own region`);
          assert.equal(owned[index], -1, `${territory.id} cell not claimed twice`);
          owned[index] = t;
        }
        // Never inside any placement's exclusion disc or arena.
        for (const placement of placements.placements) {
          const r2 = placement.exclusionRadius * placement.exclusionRadius;
          for (const index of cells) {
            const x = index % width;
            const y = (index - x) / width;
            const dx = x - placement.cell[0];
            const dy = y - placement.cell[1];
            assert.ok(dx * dx + dy * dy > r2, `${territory.id} cell (${x}, ${y}) inside ${placement.id} exclusion`);
          }
        }
      }
    }
  });

  it("meets coverage budgets or explains, and rosters resolve in the library", () => {
    const { doc } = territoriesFor("fen-hollow", MINIMAL);
    assert.ok(doc.territories.length > 0, "fen-hollow grows territories");
    const recipe = normalizeRecipe(MINIMAL);
    const enemyIds = new Set(recipe.contentLibrary.enemies.map((enemy) => enemy.id));
    for (const territory of doc.territories) {
      assert.ok(territory.roster.length >= 1, `${territory.id} has a roster`);
      for (const entry of territory.roster) {
        assert.ok(enemyIds.has(entry.enemyId), `${territory.id} roster ${entry.enemyId} resolves`);
      }
      assert.ok(territory.cellCount >= recipe.territoryRule.minCells);
      assert.ok(territory.cellCount <= recipe.territoryRule.maxCells);
      assert.ok(territory.maxActive >= 1);
    }
    for (const region of doc.coverage.regions) {
      assert.ok(
        region.emitted === region.budget ||
          doc.failures.some((failure) => failure.regionId === region.regionId),
        `${region.regionId}: budget met or failure recorded`,
      );
    }
  });

  it("rerolling one uncoupled region leaves the other region's territories byte-identical", () => {
    const artifact = makeArtifact(24);
    for (let y = 0; y < 24; y += 1) {
      for (let x = 10; x < 14; x += 1) setMaterial(artifact, x, y, "terrain.mud");
    }
    const model = new WorldModel(artifact);
    const bundle = analyzeWorld(model);
    const base = {
      recipeFormat: 1,
      name: "territory-scoping",
      directorSeed: 7,
      budgets: { minRegionCells: 32, majorRegionCells: 4096, worldBossCount: 0, territoriesPer1000Walkable: 30, territoryCapPerRegion: 2 },
      territoryRule: { minCells: 8, maxCells: 40 },
    };
    const solve = (raw: unknown): TerritoriesDoc => {
      const recipe = normalizeRecipe(raw);
      const plan = compilePlan(model, bundle, recipe);
      const placements = solvePlacements(model, bundle, plan, recipe);
      return growTerritories(model, bundle, plan, placements, recipe);
    };
    const before = solve(base);
    assert.ok(before.territories.length >= 2, "both regions grow territories");
    const regions = [...new Set(before.territories.map((territory) => territory.regionId))];
    assert.ok(regions.length >= 2);
    const target = regions[0] as string;

    const after = solve({ ...base, rerolls: [{ regionId: target, iteration: 2 }] });
    for (const territory of before.territories) {
      const match = after.territories.find((entry) => entry.id === territory.id);
      if (territory.regionId === target) {
        assert.ok(match === undefined || match.channel.includes("reroll.2"), "rerolled region re-draws");
      } else {
        assert.ok(match !== undefined, `${territory.id} outside the reroll survives`);
        assert.equal(canonicalJson(match), canonicalJson(territory), `${territory.id} byte-identical`);
      }
    }
  });

  it("fails with no_matching_roster when the library cannot cover a biome", () => {
    const artifact = makeArtifact(16);
    const model = new WorldModel(artifact);
    const bundle = analyzeWorld(model);
    const recipe = normalizeRecipe({
      recipeFormat: 1,
      name: "empty-library",
      directorSeed: 1,
      budgets: { minRegionCells: 16, worldBossCount: 0, territoriesPer1000Walkable: 20, territoryCapPerRegion: 1 },
      territoryRule: { minCells: 8 },
      contentLibrary: { enemies: [{ id: "enemy.fish", biomes: ["water.shallow"], minBand: 0, maxBand: 15, weightPercent: 50, nightOnly: false }] },
    });
    const plan = compilePlan(model, bundle, recipe);
    const placements = solvePlacements(model, bundle, plan, recipe);
    const doc = growTerritories(model, bundle, plan, placements, recipe);
    assert.equal(doc.territories.length, 0);
    assert.ok(doc.failures.length >= 1);
    assert.equal((doc.failures[0] as TerritoriesDoc["failures"][number]).reason, "no_matching_roster");
  });

  it("rejects invalid content libraries with named errors", () => {
    assert.throws(
      () => normalizeRecipe({ ...MINIMAL, contentLibrary: { enemies: [] } }),
      /non-empty array/,
    );
    assert.throws(
      () =>
        normalizeRecipe({
          ...MINIMAL,
          contentLibrary: { enemies: [{ id: "Bad", biomes: ["terrain.grass"], weightPercent: 10, nightOnly: false }] },
        }),
      /enemy\.<lower_snake>/,
    );
    assert.throws(
      () =>
        normalizeRecipe({
          ...MINIMAL,
          contentLibrary: {
            enemies: [
              { id: "enemy.a", biomes: ["terrain.grass"], weightPercent: 10, nightOnly: false },
              { id: "enemy.a", biomes: ["terrain.mud"], weightPercent: 10, nightOnly: false },
            ],
          },
        }),
      /duplicate enemy id/,
    );
    assert.throws(
      () => normalizeRecipe({ ...MINIMAL, territoryRule: { respawnPressure: "extreme" } }),
      /respawnPressure must be one of/,
    );
    assert.throws(
      () => normalizeRecipe({ ...MINIMAL, territoryRule: { minCells: 50, maxCells: 10 } }),
      /maxCells must be >= minCells/,
    );
  });
});
