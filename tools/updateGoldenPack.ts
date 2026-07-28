import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../src/core/canonicalJson.js";
import { repoRoot } from "../src/core/guard.js";
import { readGamePack } from "../src/pack/readPack.js";
import { WorldModel } from "../src/world/model.js";
import { analyzeWorld } from "../src/analysis/analyze.js";
import { normalizeRecipe } from "../src/recipe/schema.js";
import { compilePlan } from "../src/plan/plan.js";
import { solvePlacements } from "../src/place/solver.js";
import { growTerritories } from "../src/territory/territory.js";
import { runGates } from "../src/validate/validate.js";
import { buildContentPack } from "../src/export/export.js";
import { readFileSync } from "node:fs";

/**
 * Re-record the golden content pack: the byte-level tripwire for the
 * FROZEN pack format 1 serialization (fen-hollow x basic-direction).
 * Running this is an explicit, logged decision — it redefines the frozen
 * reference bytes, so the commit message must say exactly why (a
 * deliberate behavior/rule-pack bump, never an accidental drift).
 */

const root = repoRoot();
const worldDir = join(root, "fixtures", "packs", "fen-hollow");
const recipePath = join(root, "fixtures", "recipes", "basic-direction.json");

const pack = readGamePack(worldDir);
const model = new WorldModel(pack.artifact);
const recipe = normalizeRecipe(JSON.parse(readFileSync(recipePath, "utf8")));
const bundle = analyzeWorld(model);
const plan = compilePlan(model, bundle, recipe);
const placements = solvePlacements(model, bundle, plan, recipe);
const territories = growTerritories(model, bundle, plan, placements, recipe);
const report = runGates({
  model, bundle, plan, placements, territories, recipe, strict: false,
  resolveAgain: () => {
    const again = solvePlacements(model, bundle, plan, recipe);
    return { placements: again, territories: growTerritories(model, bundle, plan, again, recipe) };
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

const goldenDir = join(root, "fixtures", "golden", "content-pack-fen-hollow-basic-direction");
rmSync(goldenDir, { recursive: true, force: true });
mkdirSync(goldenDir, { recursive: true });
for (const [name, bytes] of built.files) {
  writeFileSync(join(goldenDir, name), bytes);
}
writeFileSync(join(goldenDir, "manifest.json"), canonicalJson(built.manifest));
console.log(`recorded ${goldenDir}`);
