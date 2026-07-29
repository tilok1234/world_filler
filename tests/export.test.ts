import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "../src/core/guard.js";
import { verifyContentPack, VerifyError } from "../src/consume/verifyPack.js";

/**
 * F7 exit criteria at the CLI boundary: export twice -> byte-identical;
 * tampering any payload fails the verifier; mismatched world/content
 * pairs refuse; a failing gate refuses the export entirely.
 */

const CLI = join(repoRoot(), "dist", "src", "cli.js");
const FEN = join(repoRoot(), "fixtures", "packs", "fen-hollow");
const DUST = join(repoRoot(), "fixtures", "packs", "dust-hollow");
const RECIPE = join(repoRoot(), "fixtures", "recipes", "basic-direction.json");

function runCli(args: readonly string[], extraRoots: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      env: { ...process.env, WORLD_FILLER_EXTRA_OUT_ROOTS: extraRoots },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? -1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

describe("content pack export", () => {
  it("exports byte-identically, verifies, and survives the full consumption proof", () => {
    const base = mkdtempSync(join(tmpdir(), "wf-export-"));
    try {
      const outA = join(base, "a");
      const outB = join(base, "b");
      const runA = runCli(["export", FEN, RECIPE, outA], base);
      assert.equal(runA.status, 0, runA.stderr);
      const runB = runCli(["export", FEN, RECIPE, outB], base);
      assert.equal(runB.status, 0, runB.stderr);

      for (const name of ["manifest.json", "content-plan.json", "placements.json", "territories.json", "report.json"]) {
        assert.equal(
          readFileSync(join(outA, name), "utf8"),
          readFileSync(join(outB, name), "utf8"),
          `${name} byte-identical across exports`,
        );
      }

      const manifest = JSON.parse(readFileSync(join(outA, "manifest.json"), "utf8")) as {
        packFormat: number;
        files: Record<string, string>;
        base: { artifactSha256: string };
      };
      assert.equal(manifest.packFormat, 2);
      assert.deepEqual(
        Object.keys(manifest.files).sort(),
        ["content-plan.json", "placements.json", "report.json", "territories.json"],
        "manifest lists exactly the payload files, never itself or renders",
      );

      const summary = verifyContentPack(FEN, outA);
      assert.ok(summary.placements >= 1);
      assert.ok(summary.territories >= 1);

      const cliVerify = runCli(["verify-pack", FEN, outA], base);
      assert.equal(cliVerify.status, 0, cliVerify.stderr);
      assert.match(cliVerify.stdout, /verify-pack: OK/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("refuses tampered payloads and mismatched world/content pairs", () => {
    const base = mkdtempSync(join(tmpdir(), "wf-export-bad-"));
    try {
      const out = join(base, "pack");
      assert.equal(runCli(["export", FEN, RECIPE, out], base).status, 0);

      const tampered = join(base, "tampered");
      cpSync(out, tampered, { recursive: true });
      const placements = readFileSync(join(tampered, "placements.json"), "utf8");
      writeFileSync(join(tampered, "placements.json"), placements.replace('"draw": ', '"draw":  '));
      assert.throws(() => verifyContentPack(FEN, tampered), (error: unknown) => {
        assert.ok(error instanceof VerifyError);
        assert.match(error.message, /placements\.json hash mismatch/);
        return true;
      });

      assert.throws(() => verifyContentPack(DUST, out), /directed against base .* but the world pack is/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("refuses a stale base pin in every mode — the shipping verb honors pins unconditionally", () => {
    const base = mkdtempSync(join(tmpdir(), "wf-export-gate-"));
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
      for (const args of [["export", FEN, staleRecipe, out], ["export", FEN, staleRecipe, out, "--strict"]]) {
        const run = runCli(args, base);
        assert.notEqual(run.status, 0);
        assert.match(run.stderr, /export: refusing — recipe pins base/);
        assert.throws(() => readdirSync(out), /ENOENT/);
      }
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("refuses to export when a gate fails (strict invalid lock) but exports with the warn in default mode", () => {
    const base = mkdtempSync(join(tmpdir(), "wf-export-lock-"));
    try {
      // A lock naming a region that does not exist: G6 diagnoses it as
      // invalid — a warning by default, a failing gate under --strict.
      const badLockRecipe = join(base, "bad-lock.json");
      writeFileSync(
        badLockRecipe,
        JSON.stringify({
          recipeFormat: 1,
          name: "bad-lock",
          directorSeed: 1,
          locks: {
            placements: [{
              id: "placement.world_boss.region.ghost.999.0",
              rule: "world_boss.v1",
              regionId: "region.ghost.999",
              cell: [10, 10],
              exclusionRadius: 4,
              arenaOrigin: [8, 8],
              arenaSide: 3,
            }],
          },
        }),
      );
      const out = join(base, "pack");
      const strictRun = runCli(["export", FEN, badLockRecipe, out, "--strict"], base);
      assert.notEqual(strictRun.status, 0);
      assert.match(strictRun.stderr, /export: refusing — the audit failed: .*G6/);
      assert.throws(() => readdirSync(out), /ENOENT/);

      const lenientRun = runCli(["export", FEN, badLockRecipe, out], base);
      assert.equal(lenientRun.status, 0, lenientRun.stderr);
      const report = JSON.parse(readFileSync(join(out, "report.json"), "utf8")) as {
        gates: ReadonlyArray<{ id: string; status: string }>;
      };
      assert.equal(report.gates.find((gate) => gate.id === "G6")?.status, "warn");
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("re-export replaces the destination atomically via staging (no partial packs)", () => {
    const base = mkdtempSync(join(tmpdir(), "wf-export-stage-"));
    try {
      const out = join(base, "pack");
      assert.equal(runCli(["export", FEN, RECIPE, out], base).status, 0);

      // Corrupt the pack in place and plant a stray file: a re-export must
      // fully replace the directory (stale bytes gone) and leave no
      // staging directory behind.
      writeFileSync(join(out, "junk.txt"), "leftover");
      writeFileSync(join(out, "placements.json"), "corrupted");
      assert.equal(runCli(["export", FEN, RECIPE, out], base).status, 0);
      assert.ok(!readdirSync(out).includes("junk.txt"), "stray files are dropped on re-export");
      assert.ok(!readdirSync(base).includes("pack.staging"), "staging directory is renamed away");
      const summary = verifyContentPack(FEN, out);
      assert.ok(summary.placements >= 1);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("refuses unknown flags instead of treating them as output directories", () => {
    const base = mkdtempSync(join(tmpdir(), "wf-export-flag-"));
    try {
      const run = runCli(["export", FEN, RECIPE, join(base, "pack"), "--stric"], base);
      assert.notEqual(run.status, 0);
      assert.match(run.stderr, /unknown flag: --stric/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
