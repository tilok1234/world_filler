import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertOutputRoot, repoRoot } from "../src/core/guard.js";
import { canonicalJson } from "../src/core/canonicalJson.js";
import { sha256Hex } from "../src/core/sha256.js";
import { readGamePack } from "../src/pack/readPack.js";
import { WorldModel } from "../src/world/model.js";
import { normalizeRecipe, RecipeError } from "../src/recipe/schema.js";
import { analyzeWorld } from "../src/analysis/analyze.js";
import { compilePlan } from "../src/plan/plan.js";
import { solvePlacements } from "../src/place/solver.js";
import { decodeRuns, growTerritories } from "../src/territory/territory.js";
import { runGates, type ValidationReportDoc } from "../src/validate/validate.js";
import { buildContentPack, writeContentPack, ExportError } from "../src/export/export.js";
import { verifyContentPack, VerifyError } from "../src/consume/verifyPack.js";
import type { DirectorRecipe } from "../src/recipe/schema.js";

/**
 * The freeze-review resolution battery: every confirmed finding from
 * docs/FREEZE_REVIEW_FINDINGS.md gets a tripping test. Hand-built and
 * tampered packs — the packs verifiers exist for — must be refused by
 * name, and the frozen serialization is pinned by the golden fixture.
 */

const ROOT = repoRoot();
const FEN = join(ROOT, "fixtures", "packs", "fen-hollow");
const RECIPE_PATH = join(ROOT, "fixtures", "recipes", "basic-direction.json");
const CLI = join(ROOT, "dist", "src", "cli.js");

interface Pipeline {
  readonly model: WorldModel;
  readonly recipe: DirectorRecipe;
  readonly baseArtifactSha256: string;
  readonly plan: ReturnType<typeof compilePlan>;
  readonly placements: ReturnType<typeof solvePlacements>;
  readonly territories: ReturnType<typeof growTerritories>;
  readonly report: ValidationReportDoc;
}

function runPipeline(recipeOverride?: Record<string, unknown>): Pipeline {
  const pack = readGamePack(FEN);
  const model = new WorldModel(pack.artifact);
  const raw = JSON.parse(readFileSync(RECIPE_PATH, "utf8")) as Record<string, unknown>;
  const recipe = normalizeRecipe({ ...raw, ...recipeOverride });
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
  return { model, recipe, baseArtifactSha256: pack.manifest.baseArtifactSha256, plan, placements, territories, report };
}

const pipeline = runPipeline();
const built = buildContentPack({
  model: pipeline.model,
  worldName: "fen-hollow",
  baseArtifactSha256: pipeline.baseArtifactSha256,
  recipe: pipeline.recipe,
  plan: pipeline.plan,
  placements: pipeline.placements,
  territories: pipeline.territories,
  report: pipeline.report,
});

/** Write the honest pack, apply a tamper, and expect a named refusal. */
function expectRefusal(
  name: string,
  tamper: (dir: string) => void,
  messagePattern: RegExp,
): void {
  const base = mkdtempSync(join(tmpdir(), "wf-freeze-"));
  try {
    const dir = join(base, "pack");
    writeContentPack(built, dir);
    tamper(dir);
    assert.throws(
      () => verifyContentPack(FEN, dir),
      (error: unknown) => {
        assert.ok(error instanceof VerifyError, `${name}: expected VerifyError, got ${String(error)}`);
        assert.match(error.message, messagePattern, `${name}: wrong refusal message`);
        return true;
      },
    );
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
}

function rehash(dir: string, names: readonly string[]): void {
  const manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8")) as { files: Record<string, string> };
  for (const name of names) manifest.files[name] = sha256Hex(readFileSync(join(dir, name)));
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
}

function editJson(dir: string, name: string, edit: (doc: any) => void): void {
  const doc = JSON.parse(readFileSync(join(dir, name), "utf8"));
  edit(doc);
  writeFileSync(join(dir, name), JSON.stringify(doc, null, 2) + "\n");
  if (name !== "manifest.json") rehash(dir, [name]);
}

describe("freeze review: verifier refuses hand-built and tampered packs", () => {
  it("refuses a failing audit (report.ok false)", () => {
    expectRefusal("ok-false", (dir) => {
      editJson(dir, "report.json", (doc) => {
        doc.ok = false;
        for (const gate of doc.gates) gate.status = "fail";
      });
    }, /report\.json \.ok is not true/);
  });

  it("refuses a files table missing payload names", () => {
    expectRefusal("pruned-files", (dir) => {
      editJson(dir, "manifest.json", (doc) => {
        delete doc.files["report.json"];
      });
    }, /manifest\.files must list exactly/);
  });

  it("refuses an empty files table even with tampered payload", () => {
    expectRefusal("empty-files", (dir) => {
      const placements = readFileSync(join(dir, "placements.json"), "utf8");
      writeFileSync(join(dir, "placements.json"), placements.replace('"draw": ', '"draw":  '));
      editJson(dir, "manifest.json", (doc) => {
        doc.files = {};
      });
    }, /manifest\.files must list exactly/);
  });

  it("refuses extra files table entries (including path-separator keys)", () => {
    expectRefusal("traversal-key", (dir) => {
      editJson(dir, "manifest.json", (doc) => {
        doc.files["../outside.json"] = "0".repeat(64);
      });
    }, /manifest\.files must list exactly/);
  });

  it("refuses an unknown placement rule (closed enum)", () => {
    expectRefusal("unknown-rule", (dir) => {
      editJson(dir, "placements.json", (doc) => {
        doc.placements[0].rule = "meteor_shrine.v9";
      });
    }, /unknown placement rule meteor_shrine\.v9/);
  });

  it("refuses an unknown territory cell encoding (closed enum)", () => {
    expectRefusal("unknown-encoding", (dir) => {
      editJson(dir, "territories.json", (doc) => {
        doc.territories[0].cells.encoding = "hilbert-deltas";
      });
    }, /unknown cell encoding hilbert-deltas/);
  });

  it("refuses an unknown respawnPressure (closed enum)", () => {
    expectRefusal("unknown-pressure", (dir) => {
      editJson(dir, "territories.json", (doc) => {
        doc.territories[0].respawnPressure = "extreme";
      });
    }, /unknown respawnPressure extreme/);
  });

  it("refuses payload format numbers other than 1 inside packFormat 1", () => {
    expectRefusal("payload-format", (dir) => {
      editJson(dir, "placements.json", (doc) => {
        doc.placementsFormat = 9;
      });
    }, /placementsFormat 9/);
  });

  it("refuses a row-crossing territory run instead of wrapping it", () => {
    expectRefusal("crossing-run", (dir) => {
      editJson(dir, "territories.json", (doc) => {
        doc.territories[0].cells.runs = [[62, 1, 4]];
        doc.territories[0].cellCount = 4;
      });
    }, /malformed .*x \+ length <= width/);
  });

  it("refuses manifest counts that disagree with the payloads", () => {
    expectRefusal("counts-lie", (dir) => {
      editJson(dir, "manifest.json", (doc) => {
        doc.counts.placements += 1;
      });
    }, /manifest\.counts disagree/);
  });

  it("refuses a manifest identity that disagrees with the hashed payloads", () => {
    expectRefusal("identity-lie", (dir) => {
      editJson(dir, "manifest.json", (doc) => {
        doc.directorRecipeSha256 = "f".repeat(64);
      });
    }, /manifest\.directorRecipeSha256 does not match/);
  });

  it("refuses a directory without manifest.json as not-a-pack", () => {
    expectRefusal("no-manifest", (dir) => {
      rmSync(join(dir, "manifest.json"));
    }, /manifest\.json is missing .*not a content pack/);
  });
});

describe("freeze review: decodeRuns is a refusing reader", () => {
  it("throws on row-crossing, non-positive, and negative runs", () => {
    assert.throws(() => decodeRuns([[62, 10, 5]], 64), /malformed/);
    assert.throws(() => decodeRuns([[0, 0, 0]], 64), /malformed/);
    assert.throws(() => decodeRuns([[-1, 0, 2]], 64), /malformed/);
    assert.throws(() => decodeRuns([[0, -1, 2]], 64), /malformed/);
    assert.equal(decodeRuns([[62, 10, 2]], 64).size, 2);
  });
});

describe("freeze review: exporter cross-document identity", () => {
  it("refuses a passing report that audited a different recipe", () => {
    const other = runPipeline({ directorSeed: 42424242, name: "other" });
    assert.throws(
      () =>
        buildContentPack({
          model: pipeline.model,
          worldName: "fen-hollow",
          baseArtifactSha256: pipeline.baseArtifactSha256,
          recipe: pipeline.recipe,
          plan: pipeline.plan,
          placements: pipeline.placements,
          territories: pipeline.territories,
          report: other.report,
        }),
      (error: unknown) => {
        assert.ok(error instanceof ExportError);
        assert.match(error.message, /report was produced from a different recipe/);
        return true;
      },
    );
  });
});

describe("freeze review: staged pack writes", () => {
  it("replaces an existing pack completely and leaves no staging residue", () => {
    const base = mkdtempSync(join(tmpdir(), "wf-staged-"));
    try {
      const dir = join(base, "pack");
      writeContentPack(built, dir);
      // Poison the destination, re-write, and require a byte-perfect pack.
      writeFileSync(join(dir, "placements.json"), "poisoned\n");
      writeContentPack(built, dir);
      assert.ok(!existsSync(join(dir, ".staging")), "no staging directory left behind");
      const summary = verifyContentPack(FEN, dir);
      assert.ok(summary.placements >= 1);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("freeze review: recipe lock id grammar", () => {
  it("refuses lock ids that violate the frozen placement id scheme", () => {
    const raw = JSON.parse(readFileSync(RECIPE_PATH, "utf8")) as Record<string, unknown>;
    const boss = pipeline.placements.placements.find((entry) => entry.rule === "world_boss.v1");
    assert.ok(boss !== undefined);
    const lockBase = {
      rule: boss.rule,
      regionId: boss.regionId,
      cell: boss.cell,
      exclusionRadius: boss.exclusionRadius,
      arenaOrigin: boss.arenaOrigin,
      arenaSide: boss.arenaSide,
    };
    for (const id of [
      "placement.myboss",
      `placement.dungeon.${boss.regionId}.0`, // rule tag disagrees with lock.rule
      "placement.world_boss.other.region.0", // regionId disagrees
      `placement.world_boss.${boss.regionId}.007`, // non-canonical slot
      `placement.world_boss.${boss.regionId}.x`,
    ]) {
      assert.throws(
        () => normalizeRecipe({ ...raw, locks: { placements: [{ ...lockBase, id }] } }),
        (error: unknown) => {
          assert.ok(error instanceof RecipeError, `id ${id} should be refused`);
          assert.match(error.message, /must match placement\./);
          return true;
        },
      );
    }
    // The conforming id (as printed by `wf-fill lock`) still normalizes.
    const good = normalizeRecipe({ ...raw, locks: { placements: [{ ...lockBase, id: boss.id }] } });
    assert.equal(good.locks.placements.length, 1);
  });
});

describe("freeze review: output guard and CLI flags", () => {
  it("refuses consumers/, dist/, and node_modules/ as output roots", () => {
    for (const dir of ["consumers", "dist", "node_modules"]) {
      assert.throws(() => assertOutputRoot(join(ROOT, dir, "anything")), /protected repository tree/);
    }
  });

  it("refuses unknown flags instead of treating them as output directories", () => {
    try {
      execFileSync(process.execPath, [CLI, "validate", FEN, RECIPE_PATH, "--stric"], { encoding: "utf8" });
      assert.fail("expected a nonzero exit");
    } catch (error) {
      const failure = error as { status?: number; stderr?: string };
      assert.notEqual(failure.status, 0);
      assert.match(failure.stderr ?? "", /unknown flag: --stric/);
      assert.ok(!existsSync(join(ROOT, "--stric")), "no --stric directory created in the repo root");
    }
  });
});

describe("freeze review: stale pins refuse on every recipe-consuming verb", () => {
  it("non-strict export refuses a stale base pin (pre-flight, before any write)", () => {
    const base = mkdtempSync(join(tmpdir(), "wf-stale-"));
    try {
      const staleRecipe = join(base, "stale.json");
      writeFileSync(
        staleRecipe,
        JSON.stringify({
          recipeFormat: 1,
          name: "stale-pin",
          directorSeed: 1,
          base: { generationIdentitySha256: "0".repeat(64) },
        }),
      );
      const out = join(base, "pack");
      try {
        execFileSync(process.execPath, [CLI, "export", FEN, staleRecipe, out], {
          encoding: "utf8",
          env: { ...process.env, WORLD_FILLER_EXTRA_OUT_ROOTS: base },
        });
        assert.fail("expected a nonzero exit");
      } catch (error) {
        const failure = error as { status?: number; stderr?: string };
        assert.notEqual(failure.status, 0);
        assert.match(failure.stderr ?? "", /export: refusing — recipe pins base/);
      }
      assert.ok(!existsSync(out), "nothing written on refusal");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("freeze review: golden pack pins the frozen serialization", () => {
  it("a fresh build byte-matches fixtures/golden/content-pack", () => {
    const goldenDir = join(ROOT, "fixtures", "golden", "content-pack");
    for (const [name, bytes] of built.files) {
      assert.equal(
        bytes,
        readFileSync(join(goldenDir, name), "utf8"),
        `${name} must byte-match the golden fixture (re-record via node dist/tools/recordGoldenPack.js — an explicit, logged decision)`,
      );
    }
    assert.equal(
      canonicalJson(built.manifest),
      readFileSync(join(goldenDir, "manifest.json"), "utf8"),
      "manifest.json must byte-match the golden fixture",
    );
  });
});
