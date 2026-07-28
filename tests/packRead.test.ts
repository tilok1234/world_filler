import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { createHash } from "node:crypto";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGamePack, PackError } from "../src/pack/readPack.js";
import { WorldModel, ArtifactError } from "../src/world/model.js";
import { repoRoot } from "../src/core/guard.js";
import { makeArtifact } from "./helpers/syntheticWorld.js";

/**
 * Named-refusal tests: a pack that fails any gate is rejected with a
 * precise message, never partially loaded or silently repaired.
 */

const fixture = join(repoRoot(), "fixtures", "packs", "fen-hollow");

function withTamperedPack(mutate: (dir: string) => void, run: (dir: string) => void): void {
  const dir = mkdtempSync(join(tmpdir(), "wf-fill-pack-"));
  try {
    cpSync(fixture, dir, { recursive: true });
    mutate(dir);
    run(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function editJson(dir: string, name: string, edit: (value: Record<string, unknown>) => void): void {
  const path = join(dir, name);
  const value = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  edit(value);
  writeFileSync(path, JSON.stringify(value));
}

describe("pack reading refusals", () => {
  it("reads an untampered fixture pack", () => {
    const pack = readGamePack(fixture);
    assert.equal(pack.manifest.packFormat, 1);
    assert.equal(pack.report.status, "pass");
  });

  it("refuses a tampered payload file by hash", () => {
    withTamperedPack(
      (dir) => {
        const path = join(dir, "world.json");
        const bytes = readFileSync(path);
        bytes[bytes.length - 10] = bytes[bytes.length - 10] === 0x31 ? 0x32 : 0x31;
        writeFileSync(path, bytes);
      },
      (dir) => {
        assert.throws(() => readGamePack(dir), (error: unknown) => {
          assert.ok(error instanceof PackError);
          assert.match(error.message, /world\.json hash mismatch/);
          return true;
        });
      },
    );
  });

  it("refuses a missing payload file", () => {
    withTamperedPack(
      (dir) => rmSync(join(dir, "minimap.png")),
      (dir) => {
        assert.throws(() => readGamePack(dir), /minimap\.png listed in manifest\.files is missing/);
      },
    );
  });

  it("refuses an unknown packFormat", () => {
    withTamperedPack(
      (dir) => editJson(dir, "manifest.json", (manifest) => { manifest["packFormat"] = 2; }),
      (dir) => {
        assert.throws(() => readGamePack(dir), /unsupported packFormat 2/);
      },
    );
  });

  it("refuses an unknown artifactFormat", () => {
    withTamperedPack(
      (dir) => editJson(dir, "manifest.json", (manifest) => { manifest["artifactFormat"] = 7; }),
      (dir) => {
        assert.throws(() => readGamePack(dir), /unsupported artifactFormat 7/);
      },
    );
  });

  it("refuses when baseArtifactSha256 disagrees with the world.json hash", () => {
    withTamperedPack(
      (dir) => editJson(dir, "manifest.json", (manifest) => { manifest["baseArtifactSha256"] = "0".repeat(64); }),
      (dir) => {
        assert.throws(() => readGamePack(dir), /baseArtifactSha256 .* does not equal files\["world\.json"\]/);
      },
    );
  });

  it("refuses a failing validation report even when hashes agree", () => {
    withTamperedPack(
      (dir) => {
        const path = join(dir, "validation-report.json");
        const report = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
        report["status"] = "fail";
        const bytes = JSON.stringify(report);
        writeFileSync(path, bytes);
        editJson(dir, "manifest.json", (manifest) => {
          const files = manifest["files"] as Record<string, string>;
          files["validation-report.json"] = require_sha(bytes);
        });
      },
      (dir) => {
        assert.throws(() => readGamePack(dir), /validation-report status is fail/);
      },
    );
  });

  it("refuses walkability format or summary drift", () => {
    withTamperedPack(
      (dir) => {
        editJson(dir, "manifest.json", (manifest) => {
          const walkability = manifest["walkability"] as Record<string, unknown>;
          walkability["floodCount"] = (walkability["floodCount"] as number) + 1;
        });
      },
      (dir) => {
        assert.throws(() => readGamePack(dir), /disagree on floodCount or spawnCell/);
      },
    );
  });
});

describe("artifact gates", () => {
  it("refuses a wrong formatVersion", () => {
    const artifact = makeArtifact();
    artifact.formatVersion = 7;
    assert.throws(() => new WorldModel(artifact), (error: unknown) => {
      assert.ok(error instanceof ArtifactError);
      assert.match(error.message, /unsupported artifact format 7/);
      return true;
    });
  });

  it("refuses non-chunk-divisible dimensions", () => {
    const artifact = makeArtifact();
    artifact.dimensions.width = 9;
    assert.throws(() => new WorldModel(artifact), /chunk-divisible/);
  });

  it("refuses a missing chunk layer", () => {
    const artifact = makeArtifact();
    const chunk = artifact.chunks[0];
    assert.ok(chunk !== undefined);
    delete (chunk.layers as Record<string, unknown>)["river"];
    assert.throws(() => new WorldModel(artifact), /layer river is missing or misshapen/);
  });

  it("refuses a misshapen row", () => {
    const artifact = makeArtifact();
    const chunk = artifact.chunks[0];
    assert.ok(chunk !== undefined);
    (chunk.layers["material"] as number[][])[3] = [0, 0, 0];
    assert.throws(() => new WorldModel(artifact), /misshapen row/);
  });

  it("refuses wrong chunk counts", () => {
    const artifact = makeArtifact();
    artifact.chunks.push(JSON.parse(JSON.stringify(artifact.chunks[0])) as (typeof artifact.chunks)[0]);
    assert.throws(() => new WorldModel(artifact), /expected 1 chunks/);
  });
});

function require_sha(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}
