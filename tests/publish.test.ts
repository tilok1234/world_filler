import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { assertPublishable, PublishGateError } from "../src/publish/gate.js";
import { crc32, zipDirectory } from "../src/publish/zip.js";
import { packArtifactId, publishRelease, releaseNotes, type ReleaseInputs } from "../src/publish/release.js";
import { sha256Hex } from "../src/core/sha256.js";
import { repoRoot } from "../src/core/guard.js";

/**
 * The publish layer (planning doc 18 §4): the gate that refuses
 * dirty/unpushed source, the deterministic zip the release uploads, and
 * the artifact id + notes the release is tagged and described with.
 * Gate scenarios run against throwaway git repositories; "pushed" is
 * simulated with a hand-written remote-tracking ref, exactly the state
 * `git branch -r --contains HEAD` reads — no network anywhere. The
 * actual `gh release create` call is exercised end-to-end against
 * GitHub outside the suite (a real publishing act, not a test).
 */

function git(dir: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", dir, ...args], {
    encoding: "utf8",
    stdio: "pipe",
    // Isolated identity: never depend on (or touch) the user's config.
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "publish-test", GIT_AUTHOR_EMAIL: "publish@test",
      GIT_COMMITTER_NAME: "publish-test", GIT_COMMITTER_EMAIL: "publish@test",
      GIT_CONFIG_GLOBAL: join(dir, ".no-global-config"),
      GIT_CONFIG_SYSTEM: join(dir, ".no-system-config"),
    },
  });
}

function scratchRepo(base: string): string {
  const dir = join(base, "repo");
  mkdirSync(dir, { recursive: true });
  git(dir, ["init", "-b", "main"]);
  writeFileSync(join(dir, "file.txt"), "committed\n");
  git(dir, ["add", "."]);
  git(dir, ["commit", "-m", "seed"]);
  return dir;
}

describe("publish gate", () => {
  it("refuses a directory that is not a git checkout", () => {
    const base = mkdtempSync(join(tmpdir(), "wf-gate-"));
    try {
      assert.throws(
        () => assertPublishable(join(base, "nowhere")),
        (error: unknown) => {
          assert.ok(error instanceof PublishGateError);
          assert.match(error.message, /not a git checkout/);
          assert.match(error.remedy, /pushed commit/);
          return true;
        },
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("refuses uncommitted changes by name (tracked edits and untracked files)", () => {
    const base = mkdtempSync(join(tmpdir(), "wf-gate-"));
    try {
      const dir = scratchRepo(base);
      writeFileSync(join(dir, "file.txt"), "edited but not committed\n");
      assert.throws(() => assertPublishable(dir), /uncommitted change.*file\.txt/);
      git(dir, ["checkout", "--", "file.txt"]);
      writeFileSync(join(dir, "stray.txt"), "untracked\n");
      assert.throws(() => assertPublishable(dir), /uncommitted change.*stray\.txt/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("refuses a clean tree whose HEAD is on no remote branch", () => {
    const base = mkdtempSync(join(tmpdir(), "wf-gate-"));
    try {
      const dir = scratchRepo(base);
      assert.throws(
        () => assertPublishable(dir),
        (error: unknown) => {
          assert.ok(error instanceof PublishGateError);
          assert.match(error.message, /not on any pushed branch/);
          assert.match(error.remedy, /push first/);
          return true;
        },
      );
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });

  it("passes a clean, pushed tree and reports the source commit; new commits refuse again", () => {
    const base = mkdtempSync(join(tmpdir(), "wf-gate-"));
    try {
      const dir = scratchRepo(base);
      const head = git(dir, ["rev-parse", "HEAD"]).trim();
      // The exact state a real push leaves behind: a remote-tracking
      // ref containing HEAD.
      git(dir, ["update-ref", "refs/remotes/origin/main", head]);
      const provenance = assertPublishable(dir);
      assert.equal(provenance.sourceCommit, head);
      assert.deepEqual(provenance.remoteBranches, ["origin/main"]);

      writeFileSync(join(dir, "file.txt"), "next iteration\n");
      git(dir, ["add", "."]);
      git(dir, ["commit", "-m", "unpushed"]);
      assert.throws(() => assertPublishable(dir), /not on any pushed branch/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("deterministic pack zip", () => {
  it("crc32 matches the reference vectors", () => {
    assert.equal(crc32(new Uint8Array(0)), 0);
    assert.equal(crc32(new TextEncoder().encode("123456789")), 0xcbf43926);
  });

  it("same directory -> byte-identical archive; entries sorted, round-trip exact", () => {
    const base = mkdtempSync(join(tmpdir(), "wf-zip-"));
    try {
      const dir = join(base, "pack");
      mkdirSync(join(dir, "renders"), { recursive: true });
      const files: Record<string, string> = {
        "manifest.json": '{"pack":"worldfiller-content-pack"}\n',
        "placements.json": '{"placements":[]}\n',
        "renders/danger.png": "not-really-a-png but bytes are bytes",
      };
      for (const [name, content] of Object.entries(files)) writeFileSync(join(dir, name), content);

      const first = zipDirectory(dir);
      const second = zipDirectory(dir);
      assert.ok(first.equals(second), "two archives of the same tree are byte-identical");

      // End-of-central-directory: entry count where the format says.
      const eocd = first.length - 22;
      assert.equal(first.readUInt32LE(eocd), 0x06054b50);
      assert.equal(first.readUInt16LE(eocd + 10), 3);

      // Walk local headers: names sorted, payload round-trips exactly.
      const seen: string[] = [];
      let offset = 0;
      while (first.readUInt32LE(offset) === 0x04034b50) {
        const compressedSize = first.readUInt32LE(offset + 18);
        const nameLength = first.readUInt16LE(offset + 26);
        const name = first.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
        const data = first.subarray(offset + 30 + nameLength, offset + 30 + nameLength + compressedSize);
        assert.equal(inflateRawSync(data).toString("utf8"), files[name], `${name} round-trips`);
        seen.push(name);
        offset += 30 + nameLength + compressedSize;
      }
      assert.deepEqual(seen, Object.keys(files).sort());
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});

describe("artifact id and release notes", () => {
  it("artifact id is the world name plus the manifest hash prefix", () => {
    const manifestBytes = '{"pack":"worldfiller-content-pack","packFormat":3}';
    assert.equal(
      packArtifactId("fen-hollow", manifestBytes),
      `fen-hollow-content-${sha256Hex(manifestBytes).slice(0, 12)}`,
    );
  });

  it("notes carry the source commit and both hashes (fetchable + hash-checkable)", () => {
    const manifest = {
      pack: "worldfiller-content-pack", packFormat: 3, world: "fen-hollow",
      recipeName: "basic-direction", directorRecipeSha256: "ab".repeat(32), directorSeed: 7,
      directorBehaviorVersion: 12,
      base: { generationIdentitySha256: "cd".repeat(32), artifactSha256: "ef".repeat(32), artifactFormat: 8, width: 64, height: 64 },
      counts: { placements: 4, placementFailures: 0, unboundAnchors: 0, territories: 5, territoryFailures: 0 },
    };
    const notes = releaseNotes({
      repoDir: repoRoot(),
      artifactId: "fen-hollow-content-0123456789ab",
      zipPath: "x.zip",
      zipSha256: "11".repeat(32),
      manifestSha256: "22".repeat(32),
      sourceCommit: "33".repeat(20),
      manifest: manifest as never,
    });
    for (const needle of [
      "fen-hollow-content-0123456789ab",
      `source commit: \`${"33".repeat(20)}\``,
      `zip sha256: \`${"11".repeat(32)}\``,
      `manifest.json sha256: \`${"22".repeat(32)}\``,
      "verify-pack",
    ]) {
      assert.ok(notes.includes(needle), `notes must carry: ${needle}`);
    }
  });
});

describe("release upload semantics", () => {
  const inputs: ReleaseInputs = {
    repoDir: repoRoot(),
    artifactId: "fen-hollow-content-0123456789ab",
    zipPath: "pack.zip",
    zipSha256: "11".repeat(32),
    manifestSha256: "22".repeat(32),
    sourceCommit: "33".repeat(20),
    manifest: {
      pack: "worldfiller-content-pack", packFormat: 3, world: "fen-hollow",
      recipeName: "basic-direction", directorRecipeSha256: "ab".repeat(32), directorSeed: 7,
      directorBehaviorVersion: 12,
      base: { generationIdentitySha256: "cd".repeat(32), artifactSha256: "ef".repeat(32), artifactFormat: 8, width: 64, height: 64 },
      counts: { placements: 4, placementFailures: 0, unboundAnchors: 0, territories: 5, territoryFailures: 0 },
    } as never,
  };

  it("refuses an existing tag — releases are never overwritten", () => {
    const calls: string[][] = [];
    assert.throws(
      () => publishRelease(inputs, (args) => { calls.push([...args]); return '{"tagName":"fen-hollow-content-0123456789ab"}'; }),
      /already exists — refusing: releases are never overwritten/,
    );
    assert.equal(calls.length, 1, "nothing runs after the existing tag is seen");
    assert.deepEqual(calls[0]?.slice(0, 2), ["release", "view"]);
  });

  it("creates the release only when the tag is free, targeting the gated commit", () => {
    const calls: string[][] = [];
    publishRelease(inputs, (args) => {
      calls.push([...args]);
      if (args[1] === "view") throw new Error("release not found");
      return "";
    });
    assert.equal(calls.length, 2);
    const create = calls[1] as string[];
    assert.deepEqual(create.slice(0, 3), ["release", "create", inputs.artifactId]);
    assert.ok(create.includes("pack.zip"), "the zip is the uploaded asset");
    assert.equal(create[create.indexOf("--target") + 1], inputs.sourceCommit, "the tag targets the proved source commit");
    const notes = create[create.indexOf("--notes") + 1] as string;
    assert.ok(notes.includes(`zip sha256: \`${inputs.zipSha256}\``), "notes pin the zip hash");
    assert.ok(notes.includes(`source commit: \`${inputs.sourceCommit}\``), "notes pin the source commit");
  });
});

describe("export through the development bypass", () => {
  it("writes the pack but no zip and no publish output", () => {
    const base = mkdtempSync(join(tmpdir(), "wf-devexport-"));
    try {
      const out = join(base, "pack");
      const stdout = execFileSync(
        process.execPath,
        [
          join(repoRoot(), "dist", "src", "cli.js"),
          "export",
          join(repoRoot(), "fixtures", "packs", "fen-hollow"),
          join(repoRoot(), "fixtures", "recipes", "basic-direction.json"),
          out,
        ],
        {
          encoding: "utf8",
          env: { ...process.env, WORLD_FILLER_EXTRA_OUT_ROOTS: base, WORLD_FILLER_DEV_EXPORT: "1" },
        },
      );
      assert.ok(existsSync(join(out, "manifest.json")));
      assert.ok(!stdout.includes("release:"), "dev export must not upload");
      assert.deepEqual(
        readdirSync(base).filter((name) => name.endsWith(".zip")),
        [],
        "dev export must not leave a zip",
      );
      // The published artifact id is still derivable from the written
      // pack: the id hashes manifest.json's exact bytes.
      const manifestBytes = readFileSync(join(out, "manifest.json"), "utf8");
      assert.match(packArtifactId("fen-hollow", manifestBytes), /^fen-hollow-content-[0-9a-f]{12}$/);
    } finally {
      rmSync(base, { recursive: true, force: true });
    }
  });
});
