import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertOutputRoot, repoRoot } from "../src/core/guard.js";

describe("output path guard", () => {
  it("allows outputs/ under the repository", () => {
    const allowed = assertOutputRoot(join(repoRoot(), "outputs", "test-run"));
    assert.ok(allowed.endsWith(join("outputs", "test-run")));
  });

  it("refuses protected repository trees", () => {
    for (const tree of ["src", "fixtures", "docs", "tests"]) {
      assert.throws(() => assertOutputRoot(join(repoRoot(), tree, "x")), /protected repository tree/);
    }
    assert.throws(() => assertOutputRoot(repoRoot()), /repository root itself/);
  });

  it("refuses paths inside a WorldForge checkout", () => {
    const fake = mkdtempSync(join(tmpdir(), "wf-guard-"));
    try {
      writeFileSync(join(fake, "package.json"), JSON.stringify({ name: "worldforge" }));
      mkdirSync(join(fake, "outputs"), { recursive: true });
      assert.throws(() => assertOutputRoot(join(fake, "outputs", "gallery")), /WorldForge checkout/);
    } finally {
      rmSync(fake, { recursive: true, force: true });
    }
  });

  it("refuses roots outside owned paths unless whitelisted", () => {
    const outside = mkdtempSync(join(tmpdir(), "wf-outside-"));
    try {
      assert.throws(() => assertOutputRoot(join(outside, "run")), /outside world-filler-owned roots/);
      process.env["WORLD_FILLER_EXTRA_OUT_ROOTS"] = outside;
      try {
        const allowed = assertOutputRoot(join(outside, "run"));
        assert.ok(allowed.startsWith(outside));
      } finally {
        delete process.env["WORLD_FILLER_EXTRA_OUT_ROOTS"];
      }
    } finally {
      rmSync(outside, { recursive: true, force: true });
    }
  });
});
