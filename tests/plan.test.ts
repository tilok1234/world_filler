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
    assert.throws(
      () => normalizeRecipe({ ...MINIMAL, danger: { endgamePockets: 1 } }),
      /endgamePockets must be 0 \(off\) or an integer in \[2, 8\]/,
    );
  });
});

describe("regional content plan", () => {
  const pack = readGamePack(join(repoRoot(), "fixtures", "packs", "fen-hollow"));
  const model = new WorldModel(pack.artifact, pack.adapterElev);
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

  it("endgame pockets reshape only the two deepest bands, keep the deep area share, and stay deterministic", () => {
    const base = normalizeRecipe({ ...MINIMAL, danger: { assignment: "quantile" } });
    const pocketed = normalizeRecipe({ ...MINIMAL, danger: { assignment: "quantile", endgamePockets: 2 } });
    const withoutPlan = compilePlan(model, bundle, base);
    const withPlan = compilePlan(model, bundle, pocketed);
    assert.equal(canonicalJson(compilePlan(model, bundle, pocketed)), canonicalJson(withPlan));

    const deepBand = base.danger.bandCount - 1;
    const nearBand = deepBand - 1;
    const withoutBands = new Map(withoutPlan.regions.map((region) => [region.id, region.dangerBand]));
    for (const region of withPlan.regions) {
      const before = withoutBands.get(region.id);
      if (region.dangerBand === before) continue;
      assert.ok(before === deepBand || before === nearBand, `${region.id} was in the far crescent before reshaping`);
      assert.ok(
        region.dangerBand === deepBand || region.dangerBand === nearBand,
        `${region.id} stays inside the far crescent after reshaping`,
      );
    }
    const deepWeight = (plan: typeof withPlan): number =>
      plan.regions.filter((region) => region.dangerBand === deepBand).reduce((sum, region) => sum + region.reachableCells, 0);
    const before = deepWeight(withoutPlan);
    const after = deepWeight(withPlan);
    assert.ok(after > 0, "the deep band survives the pocket pass");
    // Area is conserved up to region granularity: pockets stop admitting
    // once they reach their share, so the deep band cannot balloon.
    assert.ok(after <= before * 2, `deep area stays in the quantile's neighborhood (${before} -> ${after})`);
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

describe("settlement-relief danger blend (sl-0073, behavior 17)", () => {
  // 32x32, three vertical biome strips; spawn (0,0) in the west strip,
  // one radius-5 outpost deep in the east strip. Without relief the east
  // strip is the farthest wilderness; with relief its effective median
  // drops well below the middle strip's.
  const makeStripWorld = () => {
    const artifact = makeArtifact(32);
    for (let y = 0; y < 32; y += 1) {
      for (let x = 11; x < 21; x += 1) setMaterial(artifact, x, y, "terrain.mud");
    }
    artifact.settlements.push({
      id: 0,
      kind: "outpost",
      purpose: "waypoint",
      anchor: [30, 30],
      radius: 5,
      structures: [{ type: "structure.house", cell: [29, 30], footprint: [2, 1] }],
    });
    return artifact;
  };
  const planFor = (reach: number, depth: number, explicitOff = false) => {
    const model = new WorldModel(makeStripWorld());
    const bundle = analyzeWorld(model);
    const danger =
      explicitOff || reach > 0
        ? { danger: { settlementReliefReachPermille: reach, settlementReliefDepthPermille: depth } }
        : {};
    return compilePlan(model, bundle, normalizeRecipe({ ...MINIMAL, name: "relief-strips", ...danger }));
  };
  const bandOf = (plan: ReturnType<typeof compilePlan>, biome: string, xMin: number): number => {
    const region = plan.regions.find(
      (candidate) => candidate.biome === biome && (candidate as { id: string }).id !== undefined && candidate.dangerBand !== null,
    );
    assert.ok(region !== undefined, `no banded ${biome} region`);
    return region.dangerBand as number;
  };

  it("omitted knobs and explicit zeros produce byte-identical plans (the fallback contract)", () => {
    assert.equal(canonicalJson(planFor(0, 0)), canonicalJson(planFor(0, 0, true)));
  });

  it("relief pulls the settled far strip below the unsettled middle wilds, deterministically", () => {
    const off = planFor(0, 0);
    const on = planFor(8000, 1000);
    const eastOff = off.regions.find((region) => region.id.startsWith("region.grass.") && region.medianSpawnDistance !== null && region.medianSpawnDistance > 30);
    const eastOn = on.regions.find((region) => region.id === eastOff?.id);
    assert.ok(eastOff !== undefined && eastOn !== undefined, "east grass region exists in both runs");
    assert.ok(eastOff.dangerBand !== null && eastOn.dangerBand !== null);
    assert.ok(
      (eastOn.dangerBand as number) < (eastOff.dangerBand as number),
      `relief must lower the settled strip: off ${eastOff.dangerBand} -> on ${eastOn.dangerBand}`,
    );
    assert.equal(canonicalJson(on), canonicalJson(planFor(8000, 1000)));
  });
});

describe("macro-zones (dusk round 5, behavior 18)", () => {
  const stripWorld = () => {
    // Mud strip wider than either grass strip so the wet component
    // outweighs both green ones: cores = heaviest per the contract.
    const artifact = makeArtifact(32);
    for (let y = 0; y < 32; y += 1) {
      for (let x = 11; x < 23; x += 1) setMaterial(artifact, x, y, "terrain.mud");
    }
    return artifact;
  };
  const planWithZones = (count: number) => {
    const model = new WorldModel(stripWorld());
    return compilePlan(model, analyzeWorld(model), normalizeRecipe({ ...MINIMAL, name: "zoned-strips", zones: { count } }));
  };

  it("emits no zones key when off, K geography-following zones when on, deterministically", () => {
    assert.equal(planWithZones(0).zones, undefined);

    const plan = planWithZones(2);
    assert.ok(plan.zones !== undefined);
    assert.equal(plan.zones.length, 2);
    // Cores: the west grass strip (green, tie-break on smallest anchor)
    // and the mud strip (wet). The east grass strip is graph-adjacent
    // only to the mud strip, so it joins the wet zone.
    const families = plan.zones.map((zone) => zone.family).sort();
    assert.deepEqual(families, ["green", "wet"]);
    const allMembers = plan.zones.flatMap((zone) => [...zone.memberRegionIds]);
    assert.equal(new Set(allMembers).size, allMembers.length, "no region in two zones");
    const planRegionIds = plan.regions.map((region) => region.id).sort();
    assert.deepEqual([...allMembers].sort(), planRegionIds, "every region belongs to a zone");

    const again = planWithZones(2);
    assert.deepEqual(JSON.parse(canonicalJson(again)).zones, JSON.parse(canonicalJson(plan)).zones);
  });

  it("waives honestly when the geography offers fewer family components than requested", () => {
    const plan = planWithZones(4);
    assert.ok(plan.zones !== undefined);
    assert.equal(plan.zones.length, 3); // west grass, mud, east grass
    assert.ok(
      plan.checks.worldWaivers.some((waiver) => waiver.startsWith("zone_shortfall: 3 of 4")),
      `expected zone_shortfall waiver, got ${JSON.stringify(plan.checks.worldWaivers)}`,
    );
  });
});
