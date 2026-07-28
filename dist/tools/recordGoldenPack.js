import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readGamePack } from "../src/pack/readPack.js";
import { WorldModel } from "../src/world/model.js";
import { normalizeRecipe } from "../src/recipe/schema.js";
import { analyzeWorld } from "../src/analysis/analyze.js";
import { compilePlan } from "../src/plan/plan.js";
import { solvePlacements } from "../src/place/solver.js";
import { growTerritories } from "../src/territory/territory.js";
import { runGates } from "../src/validate/validate.js";
import { buildContentPack } from "../src/export/export.js";
import { canonicalJson } from "../src/core/canonicalJson.js";
import { repoRoot } from "../src/core/guard.js";
/**
 * Re-record the golden content pack: the byte-exact frozen serialization
 * of pack format 1 over fen-hollow + basic-direction. Running this is an
 * explicit, logged decision — it redefines what "the format did not
 * drift" means for every future build. Commit messages must say why.
 */
const root = repoRoot();
const pack = readGamePack(join(root, "fixtures", "packs", "fen-hollow"));
const model = new WorldModel(pack.artifact);
const recipe = normalizeRecipe(JSON.parse(readFileSync(join(root, "fixtures", "recipes", "basic-direction.json"), "utf8")));
const bundle = analyzeWorld(model);
const plan = compilePlan(model, bundle, recipe);
const placements = solvePlacements(model, bundle, plan, recipe);
const territories = growTerritories(model, bundle, plan, placements, recipe);
const report = runGates({
    model, bundle, plan, placements, territories, recipe, strict: false,
    resolveAgain: () => {
        const placementsAgain = solvePlacements(model, bundle, plan, recipe);
        return { placements: placementsAgain, territories: growTerritories(model, bundle, plan, placementsAgain, recipe) };
    },
});
const built = buildContentPack({
    model,
    worldName: "fen-hollow",
    baseArtifactSha256: pack.manifest.baseArtifactSha256,
    recipe,
    plan,
    placements,
    territories,
    report,
});
const goldenDir = join(root, "fixtures", "golden", "content-pack");
mkdirSync(goldenDir, { recursive: true });
for (const [name, bytes] of built.files) {
    writeFileSync(join(goldenDir, name), bytes);
}
writeFileSync(join(goldenDir, "manifest.json"), canonicalJson(built.manifest));
console.log(`recorded ${goldenDir} (fen-hollow + basic-direction, 5 files)`);
