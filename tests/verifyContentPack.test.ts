import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGamePack } from "../src/pack/readPack.js";
import { WorldModel } from "../src/world/model.js";
import { analyzeWorld } from "../src/analysis/analyze.js";
import { normalizeRecipe } from "../src/recipe/schema.js";
import { compilePlan } from "../src/plan/plan.js";
import { solvePlacements } from "../src/place/solver.js";
import { growTerritories } from "../src/territory/territory.js";
import { runGates } from "../src/validate/validate.js";
import { buildContentPack, writeContentPack } from "../src/export/export.js";
import { verifyContentPack, VerifyError } from "../src/consume/verifyPack.js";
import { sha256Hex } from "../src/core/sha256.js";
import { repoRoot } from "../src/core/guard.js";

/**
 * The freeze-review battery: every importer obligation the reference
 * verifier claims to implement, exercised with hand-tampered packs.
 * These are exactly the packs verifiers exist for — a legitimate export
 * never produces them.
 */

const FEN = join(repoRoot(), "fixtures", "packs", "fen-hollow");
const RECIPE = join(repoRoot(), "fixtures", "recipes", "basic-direction.json");

describe("content pack verifier — adversarial battery", () => {
  let base = "";
  let packDir = "";
  let caseNumber = 0;
  let inputs: Parameters<typeof buildContentPack>[0];

  before(() => {
    base = mkdtempSync(join(tmpdir(), "wf-verify-"));
    packDir = join(base, "pack");
    const pack = readGamePack(FEN);
    const model = new WorldModel(pack.artifact);
    const recipe = normalizeRecipe(JSON.parse(readFileSync(RECIPE, "utf8")));
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
    inputs = {
      model,
      worldName: "fen-hollow",
      baseArtifactSha256: pack.manifest.baseArtifactSha256,
      recipe,
      plan,
      placements,
      territories,
      report,
    };
    writeContentPack(buildContentPack(inputs), packDir);
  });

  after(() => {
    rmSync(base, { recursive: true, force: true });
  });

  function tamper(mutate: (dir: string) => void): string {
    caseNumber += 1;
    const dir = join(base, `case-${caseNumber}`);
    cpSync(packDir, dir, { recursive: true });
    mutate(dir);
    return dir;
  }

  /* eslint-disable @typescript-eslint/no-explicit-any */
  function rewritePayload(dir: string, name: string, mutate: (doc: any) => void): void {
    const doc = JSON.parse(readFileSync(join(dir, name), "utf8"));
    mutate(doc);
    const bytes = JSON.stringify(doc);
    writeFileSync(join(dir, name), bytes);
    rewriteManifest(dir, (manifest) => {
      manifest.files[name] = sha256Hex(Buffer.from(bytes));
    });
  }

  function rewriteManifest(dir: string, mutate: (doc: any) => void): void {
    const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
    mutate(manifest);
    writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
  }

  function refuses(dir: string, pattern: RegExp): void {
    assert.throws(
      () => verifyContentPack(FEN, dir),
      (error: unknown) => {
        assert.ok(error instanceof VerifyError, `expected VerifyError, got: ${String(error)}`);
        assert.match((error as Error).message, pattern);
        return true;
      },
    );
  }

  it("accepts the untampered pack", () => {
    const summary = verifyContentPack(FEN, packDir);
    assert.ok(summary.placements >= 1);
    assert.ok(summary.territories >= 1);
  });

  it("refuses an empty or truncated files table (nothing is consumed unhashed)", () => {
    refuses(
      tamper((dir) => rewriteManifest(dir, (m) => { m.files = {}; })),
      /manifest\.files must list content-plan\.json/,
    );
    refuses(
      tamper((dir) => rewriteManifest(dir, (m) => { delete m.files["report.json"]; })),
      /manifest\.files must list report\.json/,
    );
  });

  it("refuses unknown names in the files table", () => {
    refuses(
      tamper((dir) => rewriteManifest(dir, (m) => { m.files["../escape.json"] = "0".repeat(64); })),
      /unknown payload/,
    );
  });

  it("refuses a failing or missing audit (obligation 4)", () => {
    refuses(
      tamper((dir) => rewritePayload(dir, "report.json", (r) => { r.ok = false; })),
      /report\.json says ok is not true/,
    );
    refuses(
      tamper((dir) => {
        rmSync(join(dir, "report.json"));
        rewriteManifest(dir, (m) => { delete m.files["report.json"]; });
      }),
      /manifest\.files must list report\.json/,
    );
    refuses(
      tamper((dir) => { rmSync(join(dir, "report.json")); }),
      /payload file report\.json listed in manifest\.files is missing/,
    );
  });

  it("refuses payload format numbers other than 1 inside a format-1 pack", () => {
    refuses(tamper((dir) => rewritePayload(dir, "content-plan.json", (p) => { p.planFormat = 3; })), /planFormat/);
    refuses(tamper((dir) => rewritePayload(dir, "placements.json", (p) => { p.placementsFormat = 0; })), /placementsFormat/);
    refuses(tamper((dir) => rewritePayload(dir, "territories.json", (t) => { t.territoriesFormat = 9; })), /territoriesFormat/);
    refuses(tamper((dir) => rewritePayload(dir, "report.json", (r) => { r.reportFormat = 2; })), /reportFormat/);
  });

  it("refuses unknown closed-enum values instead of defaulting (obligation 5)", () => {
    refuses(
      tamper((dir) => rewritePayload(dir, "placements.json", (p) => { p.placements[0].rule = "meteor_shrine.v9"; })),
      /unknown rule meteor_shrine\.v9/,
    );
    refuses(
      tamper((dir) => rewritePayload(dir, "territories.json", (t) => { t.territories[0].cells.encoding = "hex"; })),
      /unknown cells encoding hex/,
    );
    refuses(
      tamper((dir) => rewritePayload(dir, "territories.json", (t) => { t.territories[0].respawnPressure = "extreme"; })),
      /unknown respawnPressure extreme/,
    );
  });

  it("refuses manifest identity and count disagreements with the hashed payloads (obligation 6)", () => {
    refuses(tamper((dir) => rewriteManifest(dir, (m) => { m.directorRecipeSha256 = "f".repeat(64); })), /directorRecipeSha256 disagrees/);
    refuses(tamper((dir) => rewriteManifest(dir, (m) => { m.directorSeed += 1; })), /directorSeed disagrees/);
    refuses(tamper((dir) => rewriteManifest(dir, (m) => { m.recipeName = "someone-elses-recipe"; })), /recipeName disagrees/);
    refuses(tamper((dir) => rewriteManifest(dir, (m) => { m.counts.territories += 1; })), /counts disagree/);
  });

  it("refuses row-crossing runs and lying cellCounts", () => {
    refuses(
      tamper((dir) => rewritePayload(dir, "territories.json", (t) => {
        t.territories[0].cells.runs[0] = [62, t.territories[0].cells.runs[0][1], 5];
      })),
      /never cross rows/,
    );
    refuses(
      tamper((dir) => rewritePayload(dir, "territories.json", (t) => { t.territories[0].cellCount += 7; })),
      /does not match its runs/,
    );
  });

  it("buildContentPack refuses a report (or payload doc) from a different pipeline run", () => {
    assert.throws(
      () => buildContentPack({ ...inputs, report: { ...inputs.report, directorRecipeSha256: "f".repeat(64) } }),
      /not one coherent pipeline run.*report\.json audits a different recipe/,
    );
    assert.throws(
      () => buildContentPack({
        ...inputs,
        report: { ...inputs.report, directorBehaviorVersion: inputs.report.directorBehaviorVersion - 1 },
      }),
      /not one coherent pipeline run.*director behavior/,
    );
    assert.throws(
      () => buildContentPack({
        ...inputs,
        territories: {
          ...inputs.territories,
          base: { ...inputs.territories.base, generationIdentitySha256: "0".repeat(64) },
        },
      }),
      /not one coherent pipeline run.*directed against a different base world/,
    );
  });

  it("refuses a dungeon binding whose anchor is gone", () => {
    const original = JSON.parse(readFileSync(join(packDir, "placements.json"), "utf8")) as {
      placements: ReadonlyArray<{ rule: string }>;
    };
    assert.ok(
      original.placements.some((entry) => entry.rule === "dungeon_binding.v1"),
      "fixture pack must contain a dungeon binding for this case",
    );
    refuses(
      tamper((dir) => rewritePayload(dir, "placements.json", (p) => {
        const dungeon = p.placements.find((entry: { rule: string }) => entry.rule === "dungeon_binding.v1");
        dungeon.anchorPoiId = 999;
      })),
      /binds anchor poi #999 which does not exist/,
    );
  });
});

describe("pack format compatibility", () => {
  it("still accepts the frozen format-1 fixture pack and refuses encounter rules inside format 1", () => {
    const format1 = join(repoRoot(), "fixtures", "golden", "content-pack-fen-hollow-format1");
    const summary = verifyContentPack(FEN, format1);
    assert.equal(summary.placements, 2, "the frozen format-1 pack verifies unchanged");

    // An encounter rule smuggled into a format-1 pack is an unknown enum
    // value there — format 2 exists precisely so readers can tell.
    const base = mkdtempSync(join(tmpdir(), "wf-fmt1-"));
    try {
      const dir = join(base, "pack");
      cpSync(format1, dir, { recursive: true });
      const doc = JSON.parse(readFileSync(join(dir, "placements.json"), "utf8"));
      doc.placements[0].rule = "encounter_site.v1";
      const bytes = JSON.stringify(doc);
      writeFileSync(join(dir, "placements.json"), bytes);
      const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
      manifest.files["placements.json"] = sha256Hex(Buffer.from(bytes));
      writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest));
      assert.throws(() => verifyContentPack(FEN, dir), /unknown rule encounter_site\.v1 \(format-1 rules/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
