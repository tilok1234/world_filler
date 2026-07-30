import { execFileSync } from "node:child_process";
import { sha256Hex } from "../core/sha256.js";
import type { ContentPackManifest } from "../export/export.js";

/**
 * Release archival (planning doc 18 §4.4, releases-as-transport, ruled
 * ADOPTED NOW 2026-07-30): a successful gated export uploads the pack
 * zip as a GitHub release tagged with the artifact id, so the original
 * stays fetchable and hash-checkable forever. The tag targets the exact
 * source commit the publish gate proved pushed — the same commit the
 * exporter embedded as manifest.sourceCommit (doc 18 §4.2, pack
 * format 3), so artifact, manifest, and tag all name one provenance.
 *
 * Uploads never overwrite: an existing tag is a REFUSAL, not a
 * replacement (and not a silent skip). Because the artifact id hashes
 * the manifest bytes — which pin every payload byte via the files table
 * and the publishing commit via sourceCommit — hitting an existing tag
 * means that exact pack from that exact commit is already pinned.
 */

/** `<world>-content-<sha12>` where the hash is of manifest.json's bytes. */
export function packArtifactId(worldName: string, manifestBytes: string): string {
  return `${worldName}-content-${sha256Hex(manifestBytes).slice(0, 12)}`;
}

export interface ReleaseInputs {
  readonly repoDir: string;
  readonly artifactId: string;
  readonly zipPath: string;
  readonly zipSha256: string;
  readonly manifestSha256: string;
  readonly sourceCommit: string;
  readonly manifest: ContentPackManifest;
}

export function releaseNotes(inputs: ReleaseInputs): string {
  const { manifest } = inputs;
  return [
    "Deterministic worldfiller content pack, reproducible byte-for-byte from the pushed source commit.",
    "",
    `- artifact id: \`${inputs.artifactId}\``,
    `- source commit: \`${inputs.sourceCommit}\` (this tag points at it; also embedded as manifest.sourceCommit)`,
    `- world: \`${manifest.world}\` (base generation identity \`${manifest.base.generationIdentitySha256}\`)`,
    `- recipe: \`${manifest.recipeName}\` (sha256 \`${manifest.directorRecipeSha256}\`, seed ${manifest.directorSeed})`,
    `- pack format ${manifest.packFormat} · director behavior ${manifest.directorBehaviorVersion}`,
    `- counts: ${manifest.counts.placements} placements, ${manifest.counts.territories} territories`,
    `- manifest.json sha256: \`${inputs.manifestSha256}\``,
    `- zip sha256: \`${inputs.zipSha256}\``,
    "",
    "Verify: unzip, then `wf-fill verify-pack <world-pack-dir> <unzipped-pack-dir>` — the manifest's files table pins every payload byte.",
  ].join("\n");
}

/** Runs one gh invocation and returns stdout; throws with gh's stderr. */
export type GhRunner = (args: readonly string[]) => string;

function realGh(repoDir: string): GhRunner {
  return (args) => {
    try {
      return execFileSync("gh", args, { cwd: repoDir, encoding: "utf8", stdio: "pipe" });
    } catch (error) {
      const failure = error as NodeJS.ErrnoException & { stderr?: string };
      if (failure.code === "ENOENT") {
        throw new Error("the GitHub CLI (gh) is not installed — install it and run `gh auth login`");
      }
      const stderr = (failure.stderr ?? "").trim();
      throw new Error(stderr.length > 0 ? stderr : failure.message);
    }
  };
}

/**
 * Upload the zip as a release tagged with the artifact id. An existing
 * tag refuses (non-overwriting transport). `run` is injectable for
 * tests; the real runner shells out to gh, whose failures (no network,
 * no auth) surface loudly from the create call.
 */
export function publishRelease(inputs: ReleaseInputs, run?: GhRunner): void {
  const gh = run ?? realGh(inputs.repoDir);
  let tagExists = false;
  try {
    gh(["release", "view", inputs.artifactId, "--json", "tagName"]);
    tagExists = true;
  } catch {
    // No such release — or gh/network trouble, which create() reports.
  }
  if (tagExists) {
    throw new Error(
      `release ${inputs.artifactId} already exists — refusing: releases are never overwritten (doc 18 §4.4). ` +
        "The id hashes the manifest (payload bytes + source commit), so that exact pack is already pinned.",
    );
  }
  gh([
    "release", "create", inputs.artifactId,
    inputs.zipPath,
    "--target", inputs.sourceCommit,
    "--title", `content pack: ${inputs.manifest.world} / ${inputs.manifest.recipeName} @ ${inputs.artifactId.slice(-12)}`,
    "--notes", releaseNotes(inputs),
  ]);
}
