import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { join } from "node:path";
import { readGamePack } from "../src/pack/readPack.js";
import { WorldModel } from "../src/world/model.js";
import { analyzeWorld } from "../src/analysis/analyze.js";
import { normalizeRecipe } from "../src/recipe/schema.js";
import { compilePlan } from "../src/plan/plan.js";
import { solvePlacements } from "../src/place/solver.js";
import { growTerritories } from "../src/territory/territory.js";
import { runGates } from "../src/validate/validate.js";
import { canonicalJson } from "../src/core/canonicalJson.js";
import { repoRoot } from "../src/core/guard.js";
import { makeArtifact, setMaterial } from "./helpers/syntheticWorld.js";
const MINIMAL = { recipeFormat: 1, name: "basic-direction", directorSeed: 103991 };
function pipelineFor(packName, recipeRaw) {
    const pack = readGamePack(join(repoRoot(), "fixtures", "packs", packName));
    const model = new WorldModel(pack.artifact);
    const bundle = analyzeWorld(model);
    const recipe = normalizeRecipe(recipeRaw);
    const plan = compilePlan(model, bundle, recipe);
    const placements = solvePlacements(model, bundle, plan, recipe);
    const territories = growTerritories(model, bundle, plan, placements, recipe);
    return { model, bundle, plan, placements, territories, recipe };
}
function inputsOf(pipeline, strict = false) {
    return {
        ...pipeline,
        strict,
        resolveAgain: () => {
            const placements = solvePlacements(pipeline.model, pipeline.bundle, pipeline.plan, pipeline.recipe);
            return { placements, territories: growTerritories(pipeline.model, pipeline.bundle, pipeline.plan, placements, pipeline.recipe) };
        },
    };
}
function gateStatus(report, id) {
    const entry = report.gates.find((g) => g.id === id);
    assert.ok(entry !== undefined, `gate ${id} present`);
    return entry.status;
}
describe("gate battery", () => {
    const clean = pipelineFor("fen-hollow", MINIMAL);
    it("passes end to end on a fixture world", () => {
        const report = runGates(inputsOf(clean));
        assert.equal(report.ok, true, JSON.stringify(report.gates.filter((g) => g.status !== "pass")));
        for (const id of ["G1", "G2", "G3", "G4", "G8", "G9"]) {
            assert.equal(gateStatus(report, id), "pass", id);
        }
    });
    function unwalkableCell() {
        const width = clean.model.dimensions.width;
        const index = clean.bundle.bits.findIndex((bit) => bit === 0);
        assert.ok(index >= 0, "fixture has unwalkable ground");
        return [index % width, Math.floor(index / width)];
    }
    it("G1 fails when a placement stands on invalid ground", () => {
        const [bx, by] = unwalkableCell();
        const tampered = structuredClone(clean.placements);
        const boss = tampered.placements.find((p) => p.rule === "world_boss.v1");
        boss.cell = [bx, by];
        boss.accessCell = [bx, by];
        boss.arenaOrigin = [bx, by];
        const report = runGates({ ...inputsOf(clean), placements: tampered });
        assert.equal(gateStatus(report, "G1"), "fail");
    });
    it("G2 fails on an exclusion-symmetry violation", () => {
        const tampered = structuredClone(clean.placements);
        const dungeon = tampered.placements.find((p) => p.rule === "dungeon_binding.v1");
        const boss = tampered.placements.find((p) => p.rule === "world_boss.v1");
        dungeon.cell = [boss.cell[0] + 1, boss.cell[1]];
        const report = runGates({ ...inputsOf(clean), placements: tampered });
        assert.equal(gateStatus(report, "G2"), "fail");
    });
    it("G3 fails when a territory cell breaks ground rules", () => {
        const [bx, by] = unwalkableCell();
        const tampered = structuredClone(clean.territories);
        const territory = tampered.territories[0];
        territory.cells.runs = [[bx, by, 1]];
        territory.cellCount = 1;
        const report = runGates({ ...inputsOf(clean), territories: tampered });
        assert.equal(gateStatus(report, "G3"), "fail");
    });
    it("G4 fails when a budget slot vanishes without a failure record", () => {
        const tampered = structuredClone(clean.placements);
        tampered.placements = tampered.placements.filter((p) => p.rule !== "world_boss.v1");
        const report = runGates({ ...inputsOf(clean), placements: tampered });
        assert.equal(gateStatus(report, "G4"), "fail");
    });
    it("G5 warns on progression traps", () => {
        const artifact = makeArtifact();
        for (let y = 0; y < 8; y += 1) {
            for (let x = 3; x < 5; x += 1)
                setMaterial(artifact, x, y, "terrain.mud");
        }
        const model = new WorldModel(artifact);
        const bundle = analyzeWorld(model);
        const recipe = normalizeRecipe({
            recipeFormat: 1,
            name: "trap",
            directorSeed: 1,
            budgets: { worldBossCount: 0 },
            danger: { overrides: [{ regionId: "region.mud.3", band: 4 }, { regionId: "region.grass.5", band: 1 }] },
        });
        const plan = compilePlan(model, bundle, recipe);
        const placements = solvePlacements(model, bundle, plan, recipe);
        const territories = growTerritories(model, bundle, plan, placements, recipe);
        const report = runGates({
            model, bundle, plan, placements, territories, recipe, strict: false,
            resolveAgain: () => ({ placements, territories }),
        });
        assert.equal(gateStatus(report, "G5"), "warn");
        assert.equal(report.ok, true, "warnings do not fail the audit");
    });
    it("G8 fails when a re-solve differs", () => {
        const report = runGates({
            ...inputsOf(clean),
            resolveAgain: () => {
                const placements = structuredClone(clean.placements);
                placements.placements[0].draw += 1;
                return { placements: placements, territories: clean.territories };
            },
        });
        assert.equal(gateStatus(report, "G8"), "fail");
    });
    it("G9 fails when content sits inside a painted no-content zone", () => {
        const boss = clean.placements.placements.find((p) => p.rule === "world_boss.v1");
        const recipe = normalizeRecipe({
            ...MINIMAL,
            paint: { noContent: [{ rect: [boss.cell[0], boss.cell[1], boss.cell[0], boss.cell[1]] }] },
        });
        // Same placements doc, new recipe: simulates content painted AFTER solving.
        const report = runGates({ ...inputsOf(clean), recipe });
        assert.equal(gateStatus(report, "G9"), "fail");
    });
});
describe("locks", () => {
    const base = pipelineFor("fen-hollow", MINIMAL);
    const boss = base.placements.placements.find((p) => p.rule === "world_boss.v1");
    const lockEntry = {
        id: boss.id,
        rule: boss.rule,
        regionId: boss.regionId,
        cell: [boss.cell[0], boss.cell[1]],
        exclusionRadius: boss.exclusionRadius,
        anchorPoiId: boss.anchorPoiId,
        arenaOrigin: boss.arenaOrigin === null ? null : [boss.arenaOrigin[0], boss.arenaOrigin[1]],
        arenaSide: boss.arenaSide,
    };
    it("holds a lock across regeneration with identical geometry, and is byte-stable", () => {
        const locked = pipelineFor("fen-hollow", { ...MINIMAL, name: "locked", locks: { placements: [lockEntry] } });
        const held = locked.placements.placements.find((p) => p.id === boss.id);
        assert.ok(held !== undefined);
        assert.equal(held.locked, true);
        assert.deepEqual(held.cell, boss.cell);
        assert.deepEqual(held.arenaOrigin, boss.arenaOrigin);
        assert.equal(held.channel, "locked");
        assert.deepEqual(locked.placements.lockReport, [{ id: boss.id, status: "held", reasons: [] }]);
        const again = pipelineFor("fen-hollow", { ...MINIMAL, name: "locked", locks: { placements: [lockEntry] } });
        assert.equal(canonicalJson(again.placements), canonicalJson(locked.placements));
        const report = runGates(inputsOf(locked));
        assert.equal(report.ok, true);
    });
    it("locks survive a reroll of their own region while fresh placements re-draw", () => {
        const locked = pipelineFor("fen-hollow", {
            ...MINIMAL,
            name: "locked-reroll",
            locks: { placements: [lockEntry] },
            rerolls: [{ regionId: boss.regionId, iteration: 5 }],
        });
        const held = locked.placements.placements.find((p) => p.id === boss.id);
        assert.ok(held !== undefined && held.locked);
        assert.deepEqual(held.cell, boss.cell, "locked geometry immune to rerolls");
    });
    it("diagnoses invalid locks against a mutated base", () => {
        // World A: open grass. Lock a boss there. World B: rock covers the arena.
        const artifactA = makeArtifact(16);
        const modelA = new WorldModel(artifactA);
        const bundleA = analyzeWorld(modelA);
        const recipeA = normalizeRecipe({
            recipeFormat: 1,
            name: "lock-base",
            directorSeed: 5,
            budgets: { minRegionCells: 16, worldBossCount: 1, minWorldBossBand: 0 },
            worldBossRule: { minClearance: 3, minSettlementPathDistance: 0, exclusionRadius: 2 },
        });
        const planA = compilePlan(modelA, bundleA, recipeA);
        const placementsA = solvePlacements(modelA, bundleA, planA, recipeA);
        const bossA = placementsA.placements.find((p) => p.rule === "world_boss.v1");
        const artifactB = makeArtifact(16);
        const [ox, oy] = bossA.arenaOrigin;
        for (let y = oy; y < oy + bossA.arenaSide; y += 1) {
            for (let x = ox; x < ox + bossA.arenaSide; x += 1) {
                setMaterial(artifactB, x, y, "terrain.rock");
            }
        }
        const modelB = new WorldModel(artifactB);
        const bundleB = analyzeWorld(modelB);
        const recipeB = normalizeRecipe({
            recipeFormat: 1,
            name: "lock-stale",
            directorSeed: 5,
            budgets: { minRegionCells: 16, worldBossCount: 1, minWorldBossBand: 0 },
            worldBossRule: { minClearance: 3, minSettlementPathDistance: 0, exclusionRadius: 2 },
            locks: {
                placements: [{
                        id: bossA.id,
                        rule: bossA.rule,
                        regionId: bossA.regionId,
                        cell: [bossA.cell[0], bossA.cell[1]],
                        exclusionRadius: bossA.exclusionRadius,
                        anchorPoiId: null,
                        arenaOrigin: [ox, oy],
                        arenaSide: bossA.arenaSide,
                    }],
            },
        });
        const planB = compilePlan(modelB, bundleB, recipeB);
        const placementsB = solvePlacements(modelB, bundleB, planB, recipeB);
        const entry = placementsB.lockReport.find((r) => r.id === bossA.id);
        assert.ok(entry !== undefined);
        assert.equal(entry.status, "invalid");
        assert.ok(entry.reasons.includes("cell_not_walkable") || entry.reasons.includes("region_missing"), entry.reasons.join(","));
        const territoriesB = growTerritories(modelB, bundleB, planB, placementsB, recipeB);
        const strictReport = runGates({
            model: modelB, bundle: bundleB, plan: planB, placements: placementsB, territories: territoriesB,
            recipe: recipeB, strict: true,
            resolveAgain: () => ({ placements: placementsB, territories: territoriesB }),
        });
        assert.equal(gateStatus(strictReport, "G6"), "fail");
        const lenientReport = runGates({
            model: modelB, bundle: bundleB, plan: planB, placements: placementsB, territories: territoriesB,
            recipe: recipeB, strict: false,
            resolveAgain: () => ({ placements: placementsB, territories: territoriesB }),
        });
        assert.equal(gateStatus(lenientReport, "G6"), "warn");
    });
    it("rejects malformed locks in the recipe", () => {
        assert.throws(() => normalizeRecipe({ ...MINIMAL, locks: { placements: [{ id: "x", rule: "world_boss.v1", regionId: "r", cell: [0, 0], exclusionRadius: 4, arenaOrigin: [0, 0], arenaSide: 3 }] } }), /id must match placement\.world_boss\.r\.<slot>/);
        assert.throws(() => normalizeRecipe({ ...MINIMAL, locks: { placements: [{ id: "placement.world_boss.r.0", rule: "world_boss.v1", regionId: "r", cell: [0, 0], exclusionRadius: 4 }] } }), /world_boss locks require arenaOrigin and arenaSide/);
        assert.throws(() => normalizeRecipe({ ...MINIMAL, locks: { placements: [{ id: "placement.dungeon.r.0", rule: "dungeon_binding.v1", regionId: "r", cell: [0, 0], exclusionRadius: 4 }] } }), /dungeon locks require anchorPoiId/);
    });
});
describe("painted zones", () => {
    it("no-content zones exclude boss sites and surface in the funnel", () => {
        const artifact = makeArtifact(16);
        const model = new WorldModel(artifact);
        const bundle = analyzeWorld(model);
        const recipe = normalizeRecipe({
            recipeFormat: 1,
            name: "paint-no-content",
            directorSeed: 3,
            budgets: { minRegionCells: 16, worldBossCount: 1, minWorldBossBand: 0 },
            worldBossRule: { minClearance: 3, minSettlementPathDistance: 0, exclusionRadius: 2 },
            paint: { noContent: [{ rect: [0, 0, 15, 10] }] },
        });
        const plan = compilePlan(model, bundle, recipe);
        const placements = solvePlacements(model, bundle, plan, recipe);
        const boss = placements.placements.find((p) => p.rule === "world_boss.v1");
        assert.ok(boss !== undefined, "boss still places in the unpainted strip");
        assert.ok(boss.cell[1] > 10, `boss row ${boss.cell[1]} outside the painted zone`);
        assert.ok(boss.candidateFunnel.some((step) => step.stage === "paint_no_content"));
        const territories = growTerritories(model, bundle, plan, placements, recipe);
        const report = runGates({
            model, bundle, plan, placements, territories, recipe, strict: false,
            resolveAgain: () => ({ placements, territories }),
        });
        assert.equal(gateStatus(report, "G9"), "pass");
    });
    it("preferred zones steer the pick", () => {
        const artifact = makeArtifact(24);
        const model = new WorldModel(artifact);
        const bundle = analyzeWorld(model);
        const recipe = normalizeRecipe({
            recipeFormat: 1,
            name: "paint-prefer",
            directorSeed: 3,
            budgets: { minRegionCells: 16, worldBossCount: 1, minWorldBossBand: 0 },
            worldBossRule: { minClearance: 3, minSettlementPathDistance: 0, exclusionRadius: 2 },
            paint: { preferContent: [{ rect: [16, 16, 23, 23], bonusPermille: 1000 }] },
        });
        const plan = compilePlan(model, bundle, recipe);
        const placements = solvePlacements(model, bundle, plan, recipe);
        const boss = placements.placements.find((p) => p.rule === "world_boss.v1");
        assert.ok(boss !== undefined);
        assert.ok(boss.cell[0] >= 16 && boss.cell[1] >= 16, `boss (${boss.cell[0]}, ${boss.cell[1]}) inside the preferred rect`);
        assert.ok(boss.scoreTerms.some((term) => term.term === "preferred_zone"));
    });
    it("rejects malformed paint", () => {
        assert.throws(() => normalizeRecipe({ ...MINIMAL, paint: { noContent: [{ rect: [5, 5, 2, 5] }] } }), /x0 <= x1/);
        assert.throws(() => normalizeRecipe({ ...MINIMAL, paint: { preferContent: [{ rect: [0, 0, 1, 1], bonusPermille: 0 }] } }), /bonusPermille/);
    });
});
