import { strict as assert } from "node:assert";
import { before, after, describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "../src/core/guard.js";
import { canonicalJson } from "../src/core/canonicalJson.js";
import { sha256Hex } from "../src/core/sha256.js";
import { verifyContentPack, VerifyError } from "../src/consume/verifyPack.js";

/**
 * Freeze-review resolution battery: the reference verifier must refuse
 * every hand-built or tampered pack the frozen doc's importer
 * obligations forbid — a failing audit, a pruned or padded files table,
 * unknown enum values, row-crossing runs, lying counts, and a manifest
 * whose identity disagrees with the hashed payloads. Each case rebuilds
 * the payload hash so ONLY the targeted defense can catch it.
 */

const CLI = join(repoRoot(), "dist", "src", "cli.js");
const FEN = join(repoRoot(), "fixtures", "packs", "fen-hollow");
const RECIPE = join(repoRoot(), "fixtures", "recipes", "basic-direction.json");

let base = "";
let goodPack = "";

/** Mutate one payload doc and re-record its manifest hash (hashes stay valid). */
function tamperedCopy(name: string, payloadFile: string | null, mutate: (doc: Record<string, unknown>) => void): string {
  const dir = join(base, name);
  cpSync(goodPack, dir, { recursive: true });
  if (payloadFile === null) {
    const manifestPath = join(dir, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as Record<string, unknown>;
    mutate(manifest);
    writeFileSync(manifestPath, canonicalJson(manifest));
  } else {
    const payloadPath = join(dir, payloadFile);
    const doc = JSON.parse(readFileSync(payloadPath, "utf8")) as Record<string, unknown>;
    mutate(doc);
    const bytes = canonicalJson(doc);
    writeFileSync(payloadPath, bytes);
    const manifestPath = join(dir, "manifest.json");
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as { files: Record<string, string> };
    manifest.files[payloadFile] = sha256Hex(bytes);
    writeFileSync(manifestPath, canonicalJson(manifest as unknown as Record<string, unknown>));
  }
  return dir;
}

function assertRefused(dir: string, pattern: RegExp): void {
  assert.throws(() => verifyContentPack(FEN, dir), (error: unknown) => {
    assert.ok(error instanceof VerifyError, `expected VerifyError, got ${String(error)}`);
    assert.match(error.message, pattern);
    return true;
  });
}

describe("content pack verifier refusals (freeze-review battery)", () => {
  before(() => {
    base = mkdtempSync(join(tmpdir(), "wf-verify-"));
    goodPack = join(base, "good");
    execFileSync(process.execPath, [CLI, "export", FEN, RECIPE, goodPack], {
      env: { ...process.env, WORLD_FILLER_EXTRA_OUT_ROOTS: base },
    });
  });
  after(() => {
    rmSync(base, { recursive: true, force: true });
  });

  it("accepts the untampered export", () => {
    const summary = verifyContentPack(FEN, goodPack);
    assert.ok(summary.placements >= 1);
    assert.ok(summary.territories >= 1);
  });

  it("refuses a failing audit (report.ok false)", () => {
    const dir = tamperedCopy("ok-false", "report.json", (doc) => {
      doc["ok"] = false;
    });
    assertRefused(dir, /report\.json \.ok is not true/);
  });

  it("refuses an unsupported reportFormat", () => {
    const dir = tamperedCopy("report-format", "report.json", (doc) => {
      doc["reportFormat"] = 2;
    });
    assertRefused(dir, /reportFormat 2 is not 1/);
  });

  it("refuses a files table missing report.json (and the deleted file itself)", () => {
    const dir = tamperedCopy("pruned-table", null, (manifest) => {
      delete (manifest["files"] as Record<string, string>)["report.json"];
    });
    unlinkSync(join(dir, "report.json"));
    assertRefused(dir, /manifest\.files must list exactly/);
  });

  it("refuses an empty files table", () => {
    const dir = tamperedCopy("empty-table", null, (manifest) => {
      manifest["files"] = {};
    });
    assertRefused(dir, /manifest\.files must list exactly/);
  });

  it("refuses a padded files table (extra entry)", () => {
    const dir = tamperedCopy("padded-table", null, (manifest) => {
      (manifest["files"] as Record<string, string>)["extra.json"] = "0".repeat(64);
    });
    assertRefused(dir, /manifest\.files must list exactly/);
  });

  it("refuses an unknown placement rule (never a default)", () => {
    const dir = tamperedCopy("unknown-rule", "placements.json", (doc) => {
      const placements = doc["placements"] as Array<Record<string, unknown>>;
      placements[0]!["rule"] = "meteor_shrine.v9";
    });
    assertRefused(dir, /unknown rule meteor_shrine\.v9/);
  });

  it("refuses an unknown cells encoding", () => {
    const dir = tamperedCopy("unknown-encoding", "territories.json", (doc) => {
      const territories = doc["territories"] as Array<Record<string, unknown>>;
      (territories[0]!["cells"] as Record<string, unknown>)["encoding"] = "hex";
    });
    assertRefused(dir, /cells\.encoding hex is not "runs"/);
  });

  it("refuses an unknown respawnPressure", () => {
    const dir = tamperedCopy("unknown-pressure", "territories.json", (doc) => {
      const territories = doc["territories"] as Array<Record<string, unknown>>;
      territories[0]!["respawnPressure"] = "extreme";
    });
    assertRefused(dir, /respawnPressure extreme is not low\|medium\|high/);
  });

  it("refuses a row-crossing territory run", () => {
    const dir = tamperedCopy("crossing-run", "territories.json", (doc) => {
      const territories = doc["territories"] as Array<Record<string, unknown>>;
      (territories[0]!["cells"] as Record<string, unknown>)["runs"] = [[63, 1, 2]];
      territories[0]!["cellCount"] = 2;
    });
    assertRefused(dir, /runs never cross rows/);
  });

  it("refuses a lying cellCount", () => {
    const dir = tamperedCopy("cell-count", "territories.json", (doc) => {
      const territories = doc["territories"] as Array<Record<string, unknown>>;
      territories[0]!["cellCount"] = (territories[0]!["cellCount"] as number) + 7;
    });
    assertRefused(dir, /cellCount .* does not match its runs/);
  });

  it("refuses an unsupported placementsFormat", () => {
    const dir = tamperedCopy("placements-format", "placements.json", (doc) => {
      doc["placementsFormat"] = 9;
    });
    assertRefused(dir, /placementsFormat 9 is not 1/);
  });

  it("refuses a dungeon binding onto a nonexistent anchor poi", () => {
    const dir = tamperedCopy("bad-anchor", "placements.json", (doc) => {
      const placements = doc["placements"] as Array<Record<string, unknown>>;
      const dungeon = placements.find((entry) => entry["rule"] === "dungeon_binding.v1");
      if (dungeon !== undefined) dungeon["anchorPoiId"] = 9999;
    });
    // fen-hollow's basic direction binds at least one dungeon; if that
    // ever changes this test must be pointed at a fixture that does.
    assertRefused(dir, /binds anchor poi #9999 which does not exist/);
  });

  it("refuses manifest counts that disagree with the payloads", () => {
    const dir = tamperedCopy("bad-counts", null, (manifest) => {
      const counts = manifest["counts"] as Record<string, number>;
      counts["territories"] = (counts["territories"] ?? 0) + 1;
    });
    assertRefused(dir, /manifest\.counts disagree/);
  });

  it("refuses a manifest identity that disagrees with the hashed payloads", () => {
    const dir = tamperedCopy("bad-identity", null, (manifest) => {
      manifest["directorRecipeSha256"] = "f".repeat(64);
    });
    assertRefused(dir, /identity disagrees with manifest\.json on directorRecipeSha256/);
  });
});
