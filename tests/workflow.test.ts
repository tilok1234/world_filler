import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "../src/core/guard.js";
import type { PlacementsDoc } from "../src/place/solver.js";

/**
 * F8 director UX loop at the CLI boundary: the full
 * direct -> review -> lock -> reroll -> export cycle runs end to end
 * through documented commands, the iteration verbs print (never write)
 * recipe edits, and locks survive rerolls byte-stably.
 */

const ROOT = repoRoot();
const CLI = join(ROOT, "dist", "src", "cli.js");
const FEN = join(ROOT, "fixtures", "packs", "fen-hollow");
const RECIPE = join(ROOT, "fixtures", "recipes", "basic-direction.json");

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

/** Extract the JSON block a print-pattern verb emitted (object or array). */
function printedJson(stdout: string, open: string, close: string): unknown {
  const start = stdout.indexOf(open);
  const end = stdout.lastIndexOf(close);
  assert.ok(start >= 0 && end > start, `no ${open}…${close} block in: ${stdout}`);
  return JSON.parse(stdout.slice(start, end + 1));
}

describe("iteration verbs", () => {
  it("reroll prints the bumped entry and never edits the recipe", () => {
    const before = readFileSync(RECIPE, "utf8");
    const first = runCli(["reroll", RECIPE, "region.mud.1245"], tmpdir());
    assert.equal(first.status, 0, first.stderr);
    assert.deepEqual(printedJson(first.stdout, "{", "}"), { iteration: 1, regionId: "region.mud.1245" });
    assert.equal(readFileSync(RECIPE, "utf8"), before, "recipe file untouched");

    const base = mkdtempSync(join(tmpdir(), "wf-reroll-"));
    try {
      const recipePath = join(base, "recipe.json");
      const raw = JSON.parse(before) as Record<string, unknown>;
      writeFileSync(recipePath, JSON.stringify({ ...raw, rerolls: [{ regionId: "region.mud.1245", iteration: 3 }] }));
      const bumped = runCli(["reroll", recipePath, "region.mud.1245"], base);
      assert.equal(bumped.status, 0, bumped.stderr);
      assert.deepEqual(printedJson(bumped.stdout, "{", "}"), { iteration: 4, regionId: "region.mud.1245" });
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("unlock prints the remaining locks and refuses unknown ids", () => {
    const base = mkdtempSync(join(tmpdir(), "wf-unlock-"));
    try {
      const raw = JSON.parse(readFileSync(RECIPE, "utf8")) as Record<string, unknown>;
      const lock = {
        id: "placement.world_boss.region.mud.1245.0",
        rule: "world_boss.v1",
        regionId: "region.mud.1245",
        cell: [10, 10],
        exclusionRadius: 8,
        arenaOrigin: [8, 8],
        arenaSide: 5,
      };
      const recipePath = join(base, "recipe.json");
      writeFileSync(recipePath, JSON.stringify({ ...raw, locks: { placements: [lock] } }));

      const released = runCli(["unlock", recipePath, lock.id], base);
      assert.equal(released.status, 0, released.stderr);
      assert.deepEqual(printedJson(released.stdout, "[", "]"), []);

      const unknown = runCli(["unlock", recipePath, "placement.world_boss.region.mud.1245.9"], base);
      assert.notEqual(unknown.status, 0);
      assert.match(unknown.stderr, /no lock placement\.world_boss\.region\.mud\.1245\.9/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("the full direct -> lock -> reroll -> export cycle", () => {
  it("runs end to end through documented commands; the lock survives the reroll byte-stably", () => {
    const base = mkdtempSync(join(tmpdir(), "wf-loop-"));
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
      const lockEntry = printedJson(locked.stdout, "{", "}") as Record<string, unknown>;
      assert.equal(lockEntry["id"], boss.id);

      // Reroll a DIFFERENT region than the locked boss's.
      const other = doc.placements.find((entry) => entry.regionId !== boss.regionId) ??
        { regionId: doc.placements[0]?.regionId ?? boss.regionId };
      const raw = JSON.parse(readFileSync(RECIPE, "utf8")) as Record<string, unknown>;
      const recipe2 = join(base, "directed.json");
      const rerollProbe = runCli(["reroll", RECIPE, other.regionId], base);
      assert.equal(rerollProbe.status, 0, rerollProbe.stderr);
      const rerollEntry = printedJson(rerollProbe.stdout, "{", "}");
      writeFileSync(recipe2, JSON.stringify({
        ...raw,
        locks: { placements: [lockEntry] },
        rerolls: [rerollEntry],
      }));

      // Export the directed recipe strictly: locks must hold as hard gates.
      const packOut = join(base, "content");
      const exported = runCli(["export", FEN, recipe2, packOut, "--strict"], base);
      assert.equal(exported.status, 0, exported.stderr);

      const after = JSON.parse(readFileSync(join(packOut, "placements.json"), "utf8")) as PlacementsDoc;
      const heldBoss = after.placements.find((entry) => entry.id === boss.id);
      assert.ok(heldBoss !== undefined, "locked boss still present after reroll");
      assert.equal(heldBoss.locked, true);
      assert.deepEqual(heldBoss.cell, boss.cell, "locked boss byte-stable across the reroll");
      assert.deepEqual(heldBoss.arenaOrigin, boss.arenaOrigin);
      const lockReport = after.lockReport.find((entry) => entry.id === boss.id);
      assert.equal(lockReport?.status, "held");

      // The pack verifies in the reference lane.
      const verified = runCli(["verify-pack", FEN, packOut], base);
      assert.equal(verified.status, 0, verified.stderr);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
