import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "../src/core/guard.js";
import type { PlacementsDoc } from "../src/place/solver.js";

/**
 * The F8 director loop at the CLI boundary, ported from the archived
 * parallel line (tag archive/claude/freeze-review-resolution-tf6bkf):
 * the full direct -> review -> lock -> reroll -> export cycle runs end
 * to end through documented commands, and a held lock survives a reroll
 * of its own region byte-stably. The `wf-fill lock` verb has no other
 * test on this line. Region and placement ids are derived from the
 * solved placements doc, never hardcoded — this line's analysis
 * subdivides regions differently than the archived line did.
 */

const ROOT = repoRoot();
const CLI = join(ROOT, "dist", "src", "cli.js");
const FEN = join(ROOT, "fixtures", "packs", "fen-hollow");
const RECIPE = join(ROOT, "fixtures", "recipes", "basic-direction.json");

function runCli(args: readonly string[], extraRoots: string): { status: number; stdout: string; stderr: string } {
  try {
    const stdout = execFileSync(process.execPath, [CLI, ...args], {
      encoding: "utf8",
      // Development bypass: the cycle's strict export must not hit the
      // publish gate or upload a release from a test run.
      env: { ...process.env, WORLD_FILLER_EXTRA_OUT_ROOTS: extraRoots, WORLD_FILLER_DEV_EXPORT: "1" },
    });
    return { status: 0, stdout, stderr: "" };
  } catch (error) {
    const failure = error as { status?: number; stdout?: string; stderr?: string };
    return { status: failure.status ?? -1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
  }
}

/** Extract the JSON block a print-pattern verb emitted (object or array). */
function printedJson(stdout: string, open: string, close: string): unknown {
  const start = stdout.indexOf(open);
  const end = stdout.lastIndexOf(close);
  assert.ok(start >= 0 && end > start, `no ${open}…${close} block in: ${stdout}`);
  return JSON.parse(stdout.slice(start, end + 1));
}

describe("the full direct -> lock -> reroll -> export cycle", () => {
  it("runs end to end through documented commands; the lock survives the reroll byte-stably", () => {
    const base = mkdtempSync(join(tmpdir(), "wf-loop-"));
    const recipeBytesBefore = readFileSync(RECIPE, "utf8");
    try {
      // Direct: solve placements.
      const placeOut = join(base, "place");
      const placed = runCli(["place", FEN, RECIPE, placeOut], base);
      assert.equal(placed.status, 0, placed.stderr);
      const doc = JSON.parse(readFileSync(join(placeOut, "placements.json"), "utf8")) as PlacementsDoc;
      const boss = doc.placements.find((entry) => entry.rule === "world_boss.v1");
      assert.ok(boss !== undefined, "the fixture direction places a world boss");

      // Review -> lock: the printed lock entry goes into the recipe.
      const locked = runCli(["lock", join(placeOut, "placements.json"), boss.id], base);
      assert.equal(locked.status, 0, locked.stderr);
      assert.match(locked.stdout, /add to the recipe under locks\.placements:/);
      const lockEntry = printedJson(locked.stdout, "{", "}") as Record<string, unknown>;
      assert.equal(lockEntry["id"], boss.id);
      assert.equal(lockEntry["regionId"], boss.regionId);

      // Reroll the locked boss's OWN region — the hardest case for the
      // lock: everything around the boss redraws, the held lock may not.
      const rerollProbe = runCli(["reroll", RECIPE, boss.regionId], base);
      assert.equal(rerollProbe.status, 0, rerollProbe.stderr);
      const rerollEntry = printedJson(rerollProbe.stdout, "{", "}") as Record<string, unknown>;
      assert.equal(rerollEntry["regionId"], boss.regionId);
      assert.equal(rerollEntry["iteration"], 1);

      // Neither print-pattern verb may ever edit the recipe file.
      assert.equal(readFileSync(RECIPE, "utf8"), recipeBytesBefore, "recipe file untouched");

      // Export the directed recipe strictly: locks must hold as hard gates.
      const raw = JSON.parse(recipeBytesBefore) as Record<string, unknown>;
      const directedRecipe = join(base, "directed.json");
      writeFileSync(directedRecipe, JSON.stringify({
        ...raw,
        locks: { placements: [lockEntry] },
        rerolls: [rerollEntry],
      }));
      const packOut = join(base, "content");
      const exported = runCli(["export", FEN, directedRecipe, packOut, "--strict"], base);
      assert.equal(exported.status, 0, exported.stderr);

      const after = JSON.parse(readFileSync(join(packOut, "placements.json"), "utf8")) as PlacementsDoc;
      const heldBoss = after.placements.find((entry) => entry.id === boss.id);
      assert.ok(heldBoss !== undefined, "locked boss still present after the reroll");
      assert.equal(heldBoss.locked, true);
      assert.deepEqual(heldBoss.cell, boss.cell, "locked boss byte-stable across the reroll");
      assert.deepEqual(heldBoss.arenaOrigin, boss.arenaOrigin);
      const lockReport = after.lockReport.find((entry) => entry.id === boss.id);
      assert.equal(lockReport?.status, "held");

      // The directed pack verifies in the reference lane.
      const verified = runCli(["verify-pack", FEN, packOut], base);
      assert.equal(verified.status, 0, verified.stderr);
      assert.match(verified.stdout, /verify-pack: OK/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
