import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { join } from "node:path";
import { readGamePack } from "../src/pack/readPack.js";
import { WorldModel } from "../src/world/model.js";
import { analyzeWorld } from "../src/analysis/analyze.js";
import { normalizeRecipe, recipeSha256, RecipeError } from "../src/recipe/schema.js";
import { compilePlan, PlanError } from "../src/plan/plan.js";
import { canonicalJson } from "../src/core/canonicalJson.js";
import { repoRoot } from "../src/core/guard.js";
import { makeArtifact, setMaterial } from "./helpers/syntheticWorld.js";

const MINIMAL = { recipeFormat: 1, name: "basic-direction", directorSeed: 103991 };

describe("DirectorRecipe normalization", () => {
  it("fills defaults and is idempotent on identity", () => {
    const sparse = normalizeRecipe(MINIMAL);
    const explicit = normalizeRecipe({
      ...MINIMAL,
      danger: { bandCount: 5, maxBandJump: 2, safeZoneShareForBand0Permille: 300, overrides: [] },
      budgets: {
        minRegionCells: 64,
        majorRegionCells: 800,
        territoriesPer1000Walkable: 12,
        territoryCapPerRegion: 4,
        encountersPer1000Walkable: 8,
        encounterCapPerRegion: 6,
        dungeonCapPerRegion: 2,
        worldBossCount: 1,
        minWorldBossBand: 2,
      },
    });
    assert.equal(recipeSha256(sparse), recipeSha256(explicit));
    assert.equal(sparse.danger.bandCount, 5);
    assert.equal(sparse.budgets.worldBossCount, 1);
    assert.ok(sparse.dungeonAnchors.poiTypes.includes("poi.cave"));
  });

  it("rejects unknown vocabulary with named errors", () => {
    assert.throws(() => normalizeRecipe({ ...MINIMAL, extra: 1 }), /unknown key \$\.extra/);
    assert.throws(() => normalizeRecipe({ ...MINIMAL, danger: { model: "noise" } }), /unknown key \$\.danger\.model/);
    assert.throws(() => normalizeRecipe({ ...MINIMAL, danger: { bandCount: 1 } }), /bandCount must be an integer in \[2, 16\]/);
    assert.throws(() => normalizeRecipe({ ...MINIMAL, recipeFormat: 2 }), /unsupported recipeFormat 2/);
    assert.throws(() => normalizeRecipe({ ...MINIMAL, name: "Bad Name" }), /lowercase-kebab/);
    assert.throws(() => normalizeRecipe({ ...MINIMAL, directorSeed: -1 }), /directorSeed/);
    assert.throws(
      () => normalizeRecipe({ ...MINIMAL, base: { generationIdentitySha256: "zz" } }),
      /64-hex sha256/,
    );
    assert.throws(
      () => normalizeRecipe({ ...MINIMAL, danger: { overrides: [{ regionId: "r", band: 9 }] } }),
      /band must be an integer in \[0, 4\]/,
    );
    assert.throws(
      () =>
        normalizeRecipe({
          ...MINIMAL,
          danger: { overrides: [{ regionId: "r", band: 1 }, { regionId: "r", band: 2 }] },
        }),
      /duplicate danger override/,
    );
    assert.throws(
      () => normalizeRecipe({ ...MINIMAL, dungeonAnchors: { poiTypes: ["prop.oak"] } }),
      /poi\.\* type names/,
    );
    assert.throws(
      () => normalizeRecipe({ ...MINIMAL, danger: { assignment: "noise" } }),
      /assignment must be linear or quantile/,
    );
  });
});

describe("regional content plan", () => {
  const pack = readGamePack(join(repoRoot(), "fixtures", "packs", "fen-hollow"));
  const model = new WorldModel(pack.artifact);
  const bundle = analyzeWorld(model);
  const recipe = normalizeRecipe(MINIMAL);

  it("is deterministic: identical inputs give byte-identical plans", () => {
    const first = compilePlan(model, bundle, recipe);
    const second = compilePlan(model, bundle, recipe);
    assert.equal(canonicalJson(first), canonicalJson(second));
  });

  it("quantile assignment fills every wilderness band, monotone in median distance, deterministically", () => {
    const quantileRecipe = normalizeRecipe({ ...MINIMAL, danger: { assignment: "quantile" } });
    const plan = compilePlan(model, bundle, quantileRecipe);
    assert.equal(canonicalJson(compilePlan(model, bundle, quantileRecipe)), canonicalJson(plan));

    const wilderness = plan.regions.filter(
      (region) => region.dangerBand !== null && region.dangerBand > 0 && !region.dangerOverridden && region.medianSpawnDistance !== null,
    );
    // Every wilderness band exists in meaningful quantity — the point of
    // quantile assignment (linear leaves the deepest band to one pocket).
    for (let band = 1; band < quantileRecipe.danger.bandCount; band += 1) {
      assert.ok(wilderness.some((region) => region.dangerBand === band), `band ${band} is populated`);
    }
    // Bands never decrease as median spawn distance grows.
    const sorted = [...wilderness].sort(
      (a, b) => (a.medianSpawnDistance as number) - (b.medianSpawnDistance as number),
    );
    for (let i = 1; i < sorted.length; i += 1) {
      const current = sorted[i] as (typeof sorted)[number];
      const previous = sorted[i - 1] as (typeof sorted)[number];
      assert.ok(
        (current.dangerBand as number) >= (previous.dangerBand as number),
        "quantile bands are monotone in median distance",
      );
    }
  });

  it("produces sane bands, budgets, and waivers on a real world", () => {
    const plan = compilePlan(model, bundle, recipe);
    assert.equal(plan.regions.length, bundle.regions.length);

    let band0 = 0;
    for (const region of plan.regions) {
      if (region.dangerBand !== null) {
        assert.ok(region.dangerBand >= 0 && region.dangerBand < recipe.danger.bandCount);
        if (region.dangerBand === 0) band0 += 1;
      } else {
        assert.ok(region.waivers.includes("unreachable_from_spawn"), `${region.id} unbanded without waiver`);
      }
      if (region.regionClass === "minor") {
        assert.deepEqual(
          region.budgets,
          { territories: 0, encounterSites: 0, dungeonBindings: 0, worldBosses: 0 },
          `${region.id} is minor but carries budget`,
        );
        assert.ok(region.waivers.includes("too_small"));
      }
      assert.ok(region.budgets.dungeonBindings <= region.dungeonAnchorCandidates);
    }
    assert.ok(band0 > 0, "settlement heartland should produce at least one band-0 region");

    const boss = plan.worldBudget.worldBosses;
    assert.ok(boss.allocated <= boss.target);
    if (boss.allocated < boss.target) {
      assert.ok(plan.checks.worldWaivers.some((waiver) => waiver.startsWith("world_boss_shortfall")));
    }
    assert.equal(plan.checks.progressionWarnings.length, 0, "fixture worlds must be progression-sane");
    assert.ok(plan.spawnRegionId.startsWith("region."));
  });

  it("flags progression traps created by overrides, and rejects unknown override regions", () => {
    const artifact = makeArtifact();
    for (let y = 0; y < 8; y += 1) {
      for (let x = 3; x < 5; x += 1) setMaterial(artifact, x, y, "terrain.mud");
    }
    const islandModel = new WorldModel(artifact);
    const islandBundle = analyzeWorld(islandModel);

    const trapped = normalizeRecipe({
      recipeFormat: 1,
      name: "trap-test",
      directorSeed: 1,
      danger: {
        overrides: [
          { regionId: "region.mud.3", band: 4 },
          { regionId: "region.grass.5", band: 1 },
        ],
      },
    });
    const plan = compilePlan(islandModel, islandBundle, trapped);
    assert.deepEqual(plan.checks.progressionWarnings, [
      { regionId: "region.grass.5", dangerBand: 1, chokeBand: 4 },
    ]);

    const unknown = normalizeRecipe({
      recipeFormat: 1,
      name: "unknown-region",
      directorSeed: 1,
      danger: { overrides: [{ regionId: "region.grass.999", band: 1 }] },
    });
    assert.throws(() => compilePlan(islandModel, islandBundle, unknown), (error: unknown) => {
      assert.ok(error instanceof PlanError);
      assert.match(error.message, /unknown region region\.grass\.999/);
      return true;
    });
  });

  it("waives unreachable regions off the spawn component", () => {
    const artifact = makeArtifact();
    for (let y = 0; y < 8; y += 1) {
      for (let x = 3; x < 5; x += 1) setMaterial(artifact, x, y, "water.deep");
    }
    const islandModel = new WorldModel(artifact);
    const islandBundle = analyzeWorld(islandModel);
    const plan = compilePlan(islandModel, islandBundle, normalizeRecipe({ ...MINIMAL, name: "islands" }));
    const right = plan.regions.find((region) => region.id === "region.grass.5");
    assert.ok(right !== undefined);
    assert.equal(right.dangerBand, null);
    assert.ok(right.waivers.includes("unreachable_from_spawn"));
    assert.deepEqual(right.budgets, { territories: 0, encounterSites: 0, dungeonBindings: 0, worldBosses: 0 });
  });
});
