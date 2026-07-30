import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { readGamePack } from "../src/pack/readPack.js";
import { WorldModel, ALL_LADDER_RUNGS, type LadderRung } from "../src/world/model.js";
import { checkParity } from "../src/parity.js";
import { repoRoot } from "../src/core/guard.js";

/**
 * The F0 exit gate: for every committed fixture pack (plus any regenerated
 * local packs under outputs/local-packs), the clean-room walkability grid
 * must match the pack's reference grid bit-for-bit, and the recomputed
 * spawn nudge and flood count must equal the pack's published values.
 * Rung coverage is pinned per fixture in fixtures/expected-coverage.json —
 * a change there means upstream behavior moved and must be reviewed, never
 * absorbed silently.
 */

const root = repoRoot();
const fixturePacksDir = join(root, "fixtures", "packs");
const localPacksDir = join(root, "outputs", "local-packs");

function packDirs(base: string): string[] {
  if (!existsSync(base)) return [];
  return readdirSync(base, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(base, entry.name))
    .sort();
}

describe("walkability parity", () => {
  const committed = packDirs(fixturePacksDir);
  it("has committed fixture packs", () => {
    assert.ok(committed.length >= 3, `expected at least 3 committed packs, found ${committed.length}`);
  });

  const expectedCoverage = JSON.parse(
    readFileSync(join(root, "fixtures", "expected-coverage.json"), "utf8"),
  ) as Record<string, Record<LadderRung, number>>;

  for (const dir of committed) {
    const name = basename(dir);
    it(`matches the reference grid bit-for-bit: ${name}`, () => {
      const pack = readGamePack(dir);
      const model = new WorldModel(pack.artifact, pack.adapterElev);
      const parity = checkParity(pack, model);
      assert.equal(parity.mismatchCount, 0, `grid mismatches: ${JSON.stringify(parity.mismatchSamples)}`);
      assert.deepEqual(parity.derivedSpawnCell, [parity.referenceSpawnCell[0], parity.referenceSpawnCell[1]]);
      assert.equal(parity.derivedFloodCount, parity.referenceFloodCount);
      const expected = expectedCoverage[name];
      assert.ok(expected !== undefined, `fixtures/expected-coverage.json has no entry for ${name}`);
      assert.deepEqual(
        parity.rungCounts,
        expected,
        `${name}: rung coverage moved — upstream behavior change? Review before re-recording.`,
      );
    });
  }

  it("exercises every ladder rung across committed fixtures, or documents the gap", () => {
    const documentedGaps = (JSON.parse(
      readFileSync(join(root, "fixtures", "expected-coverage.json"), "utf8"),
    ) as { __documentedGaps?: string[] }).__documentedGaps ?? [];
    const union = new Set<string>(documentedGaps);
    for (const dir of committed) {
      const name = basename(dir);
      const counts = expectedCoverage[name];
      if (counts === undefined) continue;
      for (const rung of ALL_LADDER_RUNGS) {
        if ((counts[rung] ?? 0) > 0) union.add(rung);
      }
    }
    const missing = ALL_LADDER_RUNGS.filter((rung) => !union.has(rung));
    assert.deepEqual(
      missing,
      [],
      `rungs neither exercised by a committed fixture nor listed in __documentedGaps: ${missing.join(", ")}`,
    );
  });

  for (const dir of packDirs(localPacksDir)) {
    const name = basename(dir);
    it(`local pack parity (regenerated, not committed): ${name}`, () => {
      const pack = readGamePack(dir);
      const model = new WorldModel(pack.artifact, pack.adapterElev);
      const parity = checkParity(pack, model);
      assert.equal(parity.mismatchCount, 0);
      assert.equal(parity.derivedFloodCount, parity.referenceFloodCount);
      assert.deepEqual(parity.derivedSpawnCell, [parity.referenceSpawnCell[0], parity.referenceSpawnCell[1]]);
    });
  }
});
