import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";
import { execFileSync } from "node:child_process";
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
 * The dual-verifier battery, ported from the archived parallel line
 * (tag archive/claude/freeze-review-resolution-tf6bkf): both reference
 * verifiers — src/consume/verifyPack.ts and the headless-Godot proof
 * consumers/godot-proof/verify_content_pack.gd — must agree
 * refusal-for-refusal across a 20-case battery (the honest pack plus 19
 * tamper classes), each refusal NAMED in both lanes and never a script
 * error. The TS lane always runs; the Godot lane runs when a Godot 4
 * binary is reachable (WORLD_FILLER_GODOT, or `godot` on PATH) and is
 * reported skipped otherwise, so clean checkouts without Godot stay
 * green while any machine with the binary proves both lanes.
 */

const ROOT = repoRoot();
const FEN = join(ROOT, "fixtures", "packs", "fen-hollow");
const DUST = join(ROOT, "fixtures", "packs", "dust-hollow");
const RECIPE = join(ROOT, "fixtures", "recipes", "basic-direction.json");
const GD_PROOF = join(ROOT, "consumers", "godot-proof", "verify_content_pack.gd");
const GODOT = process.env["WORLD_FILLER_GODOT"] ?? "godot";

/** Godot on Windows accepts forward slashes everywhere; normalize so the
 * invocation is identical on every platform. */
function slashes(path: string): string {
  return path.replaceAll("\\", "/");
}

let godotAvailable = false;
try {
  execFileSync(GODOT, ["--version"], { encoding: "utf8", timeout: 30_000, stdio: "pipe" });
  godotAvailable = true;
} catch {
  godotAvailable = false;
}

function runGodotVerifier(worldDir: string, contentDir: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(
      GODOT,
      ["--headless", "--script", slashes(GD_PROOF), "--", slashes(worldDir), slashes(contentDir)],
      { encoding: "utf8", timeout: 120_000, stdio: "pipe" },
    );
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? -1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

function exportPack(worldDir: string, worldName: string, destination: string): void {
  const pack = readGamePack(worldDir);
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
  writeContentPack(
    buildContentPack({
      model,
      worldName,
      baseArtifactSha256: pack.manifest.baseArtifactSha256,
      recipe,
      plan,
      placements,
      territories,
      report,
    }),
    destination,
  );
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

interface BatteryCase {
  readonly name: string;
  /** undefined = the honest pack: both lanes must ACCEPT. */
  readonly tamper?: (dir: string) => void;
  /** Named refusal each lane must produce (its own wording, same defect). */
  readonly ts?: RegExp;
  readonly gd?: RegExp;
}

// The 20-case battery: 1 honest accept + 19 tamper refusals. Every
// refusal expectation is main's actual wording — the implementation on
// this line is the approved source of truth, not the archived line's.
const BATTERY: ReadonlyArray<BatteryCase> = [
  { name: "honest pack accepted" },
  {
    name: "missing manifest.json (not a pack)",
    tamper: (dir) => rmSync(join(dir, "manifest.json")),
    ts: /required file manifest\.json is missing/,
    gd: /missing file/,
  },
  {
    name: "empty files table (even with a tampered payload)",
    tamper: (dir) => {
      const placements = readFileSync(join(dir, "placements.json"), "utf8");
      writeFileSync(join(dir, "placements.json"), placements.replace('"draw":', '"draw": '));
      rewriteManifest(dir, (m) => { m.files = {}; });
    },
    ts: /manifest\.files must list content-plan\.json/,
    gd: /manifest\.files must list content-plan\.json/,
  },
  {
    name: "files table missing report.json",
    tamper: (dir) => rewriteManifest(dir, (m) => { delete m.files["report.json"]; }),
    ts: /manifest\.files must list report\.json/,
    gd: /manifest\.files must list report\.json/,
  },
  {
    name: "files table smuggles a path-separator key",
    tamper: (dir) => rewriteManifest(dir, (m) => { m.files["../outside.json"] = "0".repeat(64); }),
    ts: /lists unknown payload/,
    gd: /lists unknown payload/,
  },
  {
    name: "payload byte tamper (hash mismatch)",
    tamper: (dir) => {
      const placements = readFileSync(join(dir, "placements.json"), "utf8");
      writeFileSync(join(dir, "placements.json"), placements.replace('"draw":', '"draw":  '));
    },
    ts: /payload file placements\.json hash mismatch/,
    gd: /payload hash mismatch for placements\.json/,
  },
  {
    name: "failing audit (report.ok false)",
    tamper: (dir) => rewritePayload(dir, "report.json", (r) => { r.ok = false; }),
    ts: /report\.json says ok is not true/,
    gd: /report\.json says ok is not true/,
  },
  {
    name: "planFormat pin",
    tamper: (dir) => rewritePayload(dir, "content-plan.json", (p) => { p.planFormat = 3; }),
    ts: /planFormat/,
    gd: /planFormat/,
  },
  {
    name: "placementsFormat pin",
    tamper: (dir) => rewritePayload(dir, "placements.json", (p) => { p.placementsFormat = 9; }),
    ts: /placementsFormat/,
    gd: /placementsFormat/,
  },
  {
    name: "territoriesFormat pin",
    tamper: (dir) => rewritePayload(dir, "territories.json", (t) => { t.territoriesFormat = 9; }),
    ts: /territoriesFormat/,
    gd: /territoriesFormat/,
  },
  {
    name: "reportFormat pin",
    tamper: (dir) => rewritePayload(dir, "report.json", (r) => { r.reportFormat = 2; }),
    ts: /reportFormat/,
    gd: /reportFormat/,
  },
  {
    name: "unknown placement rule (closed enum)",
    tamper: (dir) => rewritePayload(dir, "placements.json", (p) => { p.placements[0].rule = "meteor_shrine.v9"; }),
    ts: /unknown rule meteor_shrine\.v9/,
    gd: /unknown rule meteor_shrine\.v9/,
  },
  {
    name: "unknown territory cells encoding (closed enum)",
    tamper: (dir) => rewritePayload(dir, "territories.json", (t) => { t.territories[0].cells.encoding = "hilbert-deltas"; }),
    ts: /unknown cells encoding hilbert-deltas/,
    gd: /unknown cells encoding hilbert-deltas/,
  },
  {
    name: "unknown respawnPressure (closed enum)",
    tamper: (dir) => rewritePayload(dir, "territories.json", (t) => { t.territories[0].respawnPressure = "extreme"; }),
    ts: /unknown respawnPressure extreme/,
    gd: /unknown respawnPressure extreme/,
  },
  {
    name: "manifest.directorRecipeSha256 lie",
    tamper: (dir) => rewriteManifest(dir, (m) => { m.directorRecipeSha256 = "f".repeat(64); }),
    ts: /manifest\.directorRecipeSha256 disagrees/,
    gd: /manifest\.directorRecipeSha256 disagrees/,
  },
  {
    name: "manifest.directorSeed lie",
    tamper: (dir) => rewriteManifest(dir, (m) => { m.directorSeed += 1; }),
    ts: /manifest\.directorSeed disagrees/,
    gd: /manifest\.directorSeed disagrees/,
  },
  {
    name: "manifest.recipeName lie",
    tamper: (dir) => rewriteManifest(dir, (m) => { m.recipeName = "someone-elses-recipe"; }),
    ts: /manifest\.recipeName disagrees/,
    gd: /manifest\.recipeName disagrees/,
  },
  {
    name: "manifest.counts lie",
    tamper: (dir) => rewriteManifest(dir, (m) => { m.counts.placements += 1; }),
    ts: /manifest\.counts disagree/,
    gd: /manifest\.counts disagree/,
  },
  {
    name: "row-crossing territory run",
    tamper: (dir) => rewritePayload(dir, "territories.json", (t) => {
      t.territories[0].cells.runs[0] = [62, t.territories[0].cells.runs[0][1], 5];
    }),
    ts: /never cross rows/,
    gd: /runs never cross rows/,
  },
  {
    name: "dungeon binding to a nonexistent anchor",
    tamper: (dir) => rewritePayload(dir, "placements.json", (p) => {
      const dungeon = p.placements.find((entry: { rule: string }) => entry.rule === "dungeon_binding.v1");
      dungeon.anchorPoiId = 999;
    }),
    ts: /binds anchor poi #999 which does not exist/,
    gd: /binds anchor poi #999 which does not exist/,
  },
];

describe("dual-verifier battery: TS and headless Godot agree refusal-for-refusal", () => {
  let base = "";
  let honest = "";
  const caseDirs = new Map<string, string>();

  before(() => {
    base = mkdtempSync(join(tmpdir(), "wf-dual-"));
    honest = join(base, "honest");
    exportPack(FEN, "fen-hollow", honest);
    // Materialize every case up front; each it() then judges one case in
    // both lanes, so a lane disagreement names its case in the test tree.
    for (const [index, batteryCase] of BATTERY.entries()) {
      if (batteryCase.tamper === undefined) {
        caseDirs.set(batteryCase.name, honest);
        continue;
      }
      const dir = join(base, `case-${index}`);
      cpSync(honest, dir, { recursive: true });
      batteryCase.tamper(dir);
      caseDirs.set(batteryCase.name, dir);
    }
  });

  after(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("exercises the headless Godot lane when a Godot binary is available", (t) => {
    if (!godotAvailable) {
      t.skip(`no Godot binary (set WORLD_FILLER_GODOT or put godot on PATH) — TS lane still judges all ${BATTERY.length} cases`);
      return;
    }
    assert.ok(godotAvailable);
  });

  for (const batteryCase of BATTERY) {
    it(`${batteryCase.tamper === undefined ? "accepts" : "refuses"}: ${batteryCase.name}`, () => {
      const dir = caseDirs.get(batteryCase.name);
      assert.ok(dir !== undefined);

      // TS lane.
      if (batteryCase.ts === undefined) {
        const summary = verifyContentPack(FEN, dir);
        assert.ok(summary.placements >= 1);
      } else {
        assert.throws(
          () => verifyContentPack(FEN, dir),
          (error: unknown) => {
            assert.ok(error instanceof VerifyError, `TS lane: expected VerifyError, got ${String(error)}`);
            assert.match(error.message, batteryCase.ts as RegExp, "TS lane: wrong named refusal");
            return true;
          },
        );
      }

      // Godot lane: same pack bytes, same verdict, refusal named — and a
      // refusal is always a refusal, never a script error.
      if (!godotAvailable) return;
      const godot = runGodotVerifier(FEN, dir);
      assert.ok(!godot.stderr.includes("SCRIPT ERROR"), `Godot lane crashed instead of refusing:\n${godot.stderr}`);
      if (batteryCase.gd === undefined) {
        assert.equal(godot.status, 0, `Godot lane refused the honest pack:\n${godot.stderr}`);
        assert.match(godot.stdout, /verify-content-pack: OK/);
      } else {
        assert.notEqual(godot.status, 0, `Godot lane accepted a pack the TS lane refuses:\n${godot.stdout}`);
        assert.match(godot.stderr, /verify-content-pack: /, "Godot lane: refusal must be named");
        assert.match(godot.stderr, batteryCase.gd, "Godot lane: wrong named refusal");
      }
    });
  }
});

describe("dual consumption proof beyond the battery world", () => {
  it("both lanes accept a fresh dust-hollow export and the frozen format-1 golden pack", (t) => {
    const base = mkdtempSync(join(tmpdir(), "wf-dual-dust-"));
    try {
      const dust = join(base, "pack");
      exportPack(DUST, "dust-hollow", dust);
      assert.ok(verifyContentPack(DUST, dust).placements >= 1);

      const format1 = join(ROOT, "fixtures", "golden", "content-pack-fen-hollow-format1");
      assert.ok(verifyContentPack(FEN, format1).placements >= 1);

      if (!godotAvailable) {
        t.diagnostic("Godot lane skipped: no binary available");
        return;
      }
      for (const [world, pack] of [[DUST, dust], [FEN, format1]] as const) {
        const godot = runGodotVerifier(world, pack);
        assert.equal(godot.status, 0, godot.stderr);
        assert.match(godot.stdout, /verify-content-pack: OK/);
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
