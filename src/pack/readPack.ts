import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "../core/sha256.js";
import { SUPPORTED_ARTIFACT_FORMAT } from "../world/model.js";
import type { ArtifactDimensions, Cell, RawArtifact } from "../world/types.js";

/** The game pack format this consumer reads; anything else is a refusal. */
export const SUPPORTED_PACK_FORMAT = 1;
export const SUPPORTED_WALKABILITY_FORMAT = 1;
const WALKABILITY_ENCODING = "base64-bitpacked-row-major-lsb-first";

export class PackError extends Error {}

export interface PackManifest {
  readonly pack: string;
  readonly packFormat: number;
  readonly world: string;
  readonly artifactFormat: number;
  readonly baseArtifactSha256: string;
  readonly adapter: { readonly tileforge: number };
  readonly generator: {
    readonly name: string;
    readonly version: string;
    readonly seed: number;
    readonly behaviorVersion: number;
    readonly recipeCompilerVersion: number;
    readonly recipeSha256: string;
    readonly resolvedConfigSha256: string;
    readonly generationIdentitySha256: string;
  };
  readonly tileforge: {
    readonly packageId: string;
    readonly theme: string;
    readonly packageSha256: string;
    readonly manifestSha256: string;
  };
  readonly dimensions: ArtifactDimensions;
  readonly walkability: {
    readonly format: number;
    readonly floodCount: number;
    readonly spawnCell: Cell;
  };
  readonly files: Readonly<Record<string, string>>;
}

export interface WalkabilityFile {
  readonly walkabilityFormat: number;
  readonly width: number;
  readonly height: number;
  readonly encoding: string;
  readonly grid: string;
  readonly floodCount: number;
  readonly spawnCell: Cell;
}

export interface ValidationReport {
  readonly status: string;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export interface LoadedPack {
  readonly dir: string;
  readonly manifest: PackManifest;
  readonly artifact: RawArtifact;
  readonly walkability: WalkabilityFile;
  readonly report: ValidationReport;
  /**
   * The TileForge adapter's resolved elevation grid
   * (resolved/tileforge-map-data.json, hash-verified with the files
   * table) — the behavior-72 moss-walks ruling keys on it. Null for
   * pre-b72 packs that do not ship the file.
   */
  readonly adapterElev: readonly number[] | null;
}

function readJson(dir: string, name: string): unknown {
  let bytes: Buffer;
  try {
    bytes = readFileSync(join(dir, name));
  } catch {
    throw new PackError(`pack: required file ${name} is missing or unreadable in ${dir}`);
  }
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new PackError(`pack: ${name} is not valid JSON`);
  }
}

/**
 * Read and verify a WorldForge game pack directory. Every gate here is a
 * named refusal; a pack that fails any of them is never partially loaded.
 * Gates mirror the blessed game-side importer checks: pack/format ids,
 * per-file sha256 verification, baseArtifactSha256 == files["world.json"],
 * world.formatVersion == manifest.artifactFormat, validation-report status
 * "pass" (warnings are legal), and walkability file/manifest agreement.
 */
export function readGamePack(dir: string): LoadedPack {
  const manifest = readJson(dir, "manifest.json") as Partial<PackManifest>;

  if (manifest.pack !== "worldforge-game-pack") {
    throw new PackError(`pack: manifest.pack is ${String(manifest.pack)}; expected worldforge-game-pack`);
  }
  if (manifest.packFormat !== SUPPORTED_PACK_FORMAT) {
    throw new PackError(
      `pack: unsupported packFormat ${String(manifest.packFormat)}; this reader supports format ${SUPPORTED_PACK_FORMAT}`,
    );
  }
  if (manifest.artifactFormat !== SUPPORTED_ARTIFACT_FORMAT) {
    throw new PackError(
      `pack: unsupported artifactFormat ${String(manifest.artifactFormat)}; this reader supports format ${SUPPORTED_ARTIFACT_FORMAT}`,
    );
  }
  const files = manifest.files;
  if (files === undefined || typeof files !== "object") {
    throw new PackError("pack: manifest.files table is missing");
  }

  for (const [name, expected] of Object.entries(files)) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(dir, name));
    } catch {
      throw new PackError(`pack: payload file ${name} listed in manifest.files is missing`);
    }
    const actual = sha256Hex(bytes);
    if (actual !== expected) {
      throw new PackError(`pack: payload file ${name} hash mismatch (expected ${expected}, got ${actual})`);
    }
  }

  const worldHash = files["world.json"];
  if (worldHash === undefined || manifest.baseArtifactSha256 !== worldHash) {
    throw new PackError(
      `pack: baseArtifactSha256 ${String(manifest.baseArtifactSha256)} does not equal files["world.json"] ${String(worldHash)}`,
    );
  }

  const report = readJson(dir, "validation-report.json") as Partial<ValidationReport>;
  if (report.status !== "pass") {
    throw new PackError(`pack: validation-report status is ${String(report.status)}; refusing anything but "pass"`);
  }

  const artifact = readJson(dir, "world.json") as { formatVersion?: unknown; generator?: { generationIdentitySha256?: unknown } };
  if (artifact.formatVersion !== manifest.artifactFormat) {
    throw new PackError(
      `pack: world.formatVersion ${String(artifact.formatVersion)} does not match manifest.artifactFormat ${manifest.artifactFormat}`,
    );
  }
  const manifestIdentity = manifest.generator?.generationIdentitySha256;
  const artifactIdentity = artifact.generator?.generationIdentitySha256;
  if (manifestIdentity === undefined || manifestIdentity !== artifactIdentity) {
    throw new PackError("pack: manifest and artifact disagree on generationIdentitySha256");
  }

  const walkability = readJson(dir, "walkability.json") as Partial<WalkabilityFile>;
  if (walkability.walkabilityFormat !== SUPPORTED_WALKABILITY_FORMAT) {
    throw new PackError(
      `pack: unsupported walkabilityFormat ${String(walkability.walkabilityFormat)}; this reader supports format ${SUPPORTED_WALKABILITY_FORMAT}`,
    );
  }
  if (walkability.encoding !== WALKABILITY_ENCODING) {
    throw new PackError(`pack: unsupported walkability encoding ${String(walkability.encoding)}`);
  }
  const dims = manifest.dimensions;
  if (dims === undefined || walkability.width !== dims.width || walkability.height !== dims.height) {
    throw new PackError("pack: walkability dimensions do not match manifest dimensions");
  }
  const summary = manifest.walkability;
  if (
    summary === undefined ||
    walkability.floodCount !== summary.floodCount ||
    walkability.spawnCell?.[0] !== summary.spawnCell[0] ||
    walkability.spawnCell?.[1] !== summary.spawnCell[1]
  ) {
    throw new PackError("pack: walkability.json and manifest.walkability disagree on floodCount or spawnCell");
  }

  let adapterElev: readonly number[] | null = null;
  if (files["resolved/tileforge-map-data.json"] !== undefined) {
    const mapData = readJson(dir, "resolved/tileforge-map-data.json") as { elev?: unknown };
    const elev = mapData.elev;
    if (
      !Array.isArray(elev) ||
      elev.length !== dims.width * dims.height ||
      !elev.every((value) => Number.isInteger(value))
    ) {
      throw new PackError("pack: resolved/tileforge-map-data.json elev grid is missing or malformed");
    }
    adapterElev = elev as number[];
  }

  return {
    dir,
    manifest: manifest as PackManifest,
    artifact: artifact as unknown as RawArtifact,
    walkability: walkability as WalkabilityFile,
    report: report as ValidationReport,
    adapterElev,
  };
}
