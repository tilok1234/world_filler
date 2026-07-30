import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { readGamePack } from "../src/pack/readPack.js";
import { WorldModel } from "../src/world/model.js";
import { analyzeWorld } from "../src/analysis/analyze.js";
import { normalizeRecipe } from "../src/recipe/schema.js";
import { compilePlan } from "../src/plan/plan.js";
import { solvePlacements } from "../src/place/solver.js";
import { growTerritories } from "../src/territory/territory.js";
import { runGates } from "../src/validate/validate.js";
import { buildContentPack } from "../src/export/export.js";
import { canonicalJson } from "../src/core/canonicalJson.js";
import { repoRoot } from "../src/core/guard.js";

/**
 * The frozen-serialization tripwire (freeze review): a fresh export of
 * the fixture world must reproduce the committed golden content pack
 * byte for byte. Export-A-vs-export-B alone cannot catch an accidental
 * field rename or type change — both exports drift together; this
 * golden cannot. Re-record ONLY via `node dist/tools/updateGolden.js`,
 * an explicit logged decision (deliberate behavior bumps re-record).
 */

describe("golden content pack", () => {
  it("reproduces the committed fen-hollow pack byte for byte", () => {
    const root = repoRoot();
    const goldenDir = join(root, "fixtures", "golden", "content-pack-fen-hollow");
    const fenDir = join(root, "fixtures", "packs", "fen-hollow");
    const pack = readGamePack(fenDir);
    const model = new WorldModel(pack.artifact, pack.adapterElev);
    const recipe = normalizeRecipe(
      JSON.parse(readFileSync(join(root, "fixtures", "recipes", "basic-direction.json"), "utf8")),
    );
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

    for (const [name, bytes] of built.files) {
      assert.equal(bytes, readFileSync(join(goldenDir, name), "utf8"), `${name} matches the golden pack`);
    }
    assert.equal(
      canonicalJson(built.manifest),
      readFileSync(join(goldenDir, "manifest.json"), "utf8"),
      "manifest.json matches the golden pack",
    );
  });
});
