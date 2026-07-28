import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "../src/core/guard.js";

/**
 * CLI-level proof of the F4 exit criteria: wf-fill place writes
 * byte-deterministic placements.json, and wf-fill explain retrieves a
 * human-readable explanation for every placement id.
 */

const CLI = join(repoRoot(), "dist", "src", "cli.js");
const PACK = join(repoRoot(), "fixtures", "packs", "fen-hollow");
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

describe("wf-fill place and explain", () => {
  it("place is byte-deterministic on disk and explain resolves every id", () => {
    const base = mkdtempSync(join(tmpdir(), "wf-cli-"));
    try {
      const outA = join(base, "a");
      const outB = join(base, "b");
      const runA = runCli(["place", PACK, RECIPE, outA], base);
      assert.equal(runA.status, 0, runA.stderr);
      const runB = runCli(["place", PACK, RECIPE, outB], base);
      assert.equal(runB.status, 0, runB.stderr);

      const bytesA = readFileSync(join(outA, "placements.json"), "utf8");
      const bytesB = readFileSync(join(outB, "placements.json"), "utf8");
      assert.equal(bytesA, bytesB, "two runs produce byte-identical placements.json");

      const doc = JSON.parse(bytesA) as { placements: Array<{ id: string }> };
      assert.ok(doc.placements.length >= 1);
      for (const placement of doc.placements) {
        const explain = runCli(["explain", join(outA, "placements.json"), placement.id], base);
        assert.equal(explain.status, 0, explain.stderr);
        assert.match(explain.stdout, /candidate funnel:/);
        assert.match(explain.stdout, /score \d+ =/);
        assert.match(explain.stdout, /seed channel: world\//);
      }

      const missing = runCli(["explain", join(outA, "placements.json"), "placement.nope"], base);
      assert.equal(missing.status, 1);
      assert.match(missing.stderr, /no placement placement\.nope/);

      const foreign = join(base, "foreign.json");
      writeFileSync(foreign, JSON.stringify({ hello: 1 }));
      const bad = runCli(["explain", foreign, "placement.x"], base);
      assert.equal(bad.status, 1);
      assert.match(bad.stderr, /not a supported placements file/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
