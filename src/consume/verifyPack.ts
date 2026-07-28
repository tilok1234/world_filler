import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "../core/sha256.js";
import { readGamePack } from "../pack/readPack.js";
import { WorldModel } from "../world/model.js";
import { decodeBase64Grid, unpackBit } from "../world/bitgrid.js";
import { decodeRuns } from "../territory/territory.js";
import type { ContentPackManifest } from "../export/export.js";
import type { PlacementsDoc } from "../place/solver.js";
import type { TerritoriesDoc } from "../territory/territory.js";
import { CONTENT_PACK_FORMAT } from "../core/version.js";

/**
 * The consumption proof: everything a game-side importer must check,
 * implemented from nothing but the two packs on disk — the world game
 * pack and the worldfiller content pack. No solver internals, no
 * analysis bundle; walkability comes from the world pack's reference
 * bitgrid, exactly as a game runtime would read it.
 *
 * This module IS the specification-by-example for the future
 * worldfiller_importer addon (docs/CONTENT_PACK_FORMAT.md). Its checks
 * are the blessed importer obligations, in order: format gate, exact
 * files table + hash verification, base pairing, report.ok, closed
 * enums (unknown values are errors, never defaults), and per-cell
 * walkability agreement.
 */

export class VerifyError extends Error {}

export interface VerifySummary {
  readonly world: string;
  readonly recipeName: string;
  readonly placements: number;
  readonly territories: number;
  readonly territoryCells: number;
}

/** Format 1 pins its payload set exactly; missing or extra names refuse. */
const PAYLOAD_FILES = ["content-plan.json", "placements.json", "report.json", "territories.json"] as const;

const PLACEMENT_RULES = new Set(["world_boss.v1", "dungeon_binding.v1"]);
const RESPAWN_PRESSURES = new Set(["low", "medium", "high"]);

function readBytes(dir: string, name: string): Buffer {
  try {
    return readFileSync(join(dir, name));
  } catch {
    throw new VerifyError(`verify: required file ${name} is missing in ${dir}`);
  }
}

function parseJson(name: string, bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new VerifyError(`verify: ${name} is not valid JSON`);
  }
}

interface IdentityStamp {
  readonly directorBehaviorVersion: number;
  readonly rulePacks: unknown;
  readonly analysisVersion: number;
  readonly recipeName: string;
  /** report.json carries no seed field; the seed is inside the hashed recipe identity. */
  readonly directorSeed?: number;
  readonly directorRecipeSha256: string;
  readonly base: { readonly generationIdentitySha256: string };
}

function requireIdentityAgreement(manifest: ContentPackManifest, name: string, doc: IdentityStamp): void {
  const mismatches: string[] = [];
  if (doc.directorRecipeSha256 !== manifest.directorRecipeSha256) mismatches.push("directorRecipeSha256");
  if (doc.directorBehaviorVersion !== manifest.directorBehaviorVersion) mismatches.push("directorBehaviorVersion");
  if (JSON.stringify(doc.rulePacks) !== JSON.stringify(manifest.rulePacks)) mismatches.push("rulePacks");
  if (doc.analysisVersion !== manifest.analysisVersion) mismatches.push("analysisVersion");
  if (doc.recipeName !== manifest.recipeName) mismatches.push("recipeName");
  if (doc.directorSeed !== undefined && doc.directorSeed !== manifest.directorSeed) mismatches.push("directorSeed");
  if (doc.base.generationIdentitySha256 !== manifest.base.generationIdentitySha256) {
    mismatches.push("base.generationIdentitySha256");
  }
  if (mismatches.length > 0) {
    throw new VerifyError(`verify: ${name} identity disagrees with manifest.json on ${mismatches.join(", ")}`);
  }
}

export function verifyContentPack(worldPackDir: string, contentPackDir: string): VerifySummary {
  const manifestRaw = parseJson("manifest.json", readBytes(contentPackDir, "manifest.json"));
  const manifest = manifestRaw as ContentPackManifest;
  if (manifest === null || typeof manifest !== "object" || Array.isArray(manifest)) {
    throw new VerifyError("verify: manifest.json is not a JSON object");
  }
  if (manifest.pack !== "worldfiller-content-pack") {
    throw new VerifyError(`verify: manifest.pack is ${String(manifest.pack)}; expected worldfiller-content-pack`);
  }
  if (manifest.packFormat !== CONTENT_PACK_FORMAT) {
    throw new VerifyError(
      `verify: unsupported packFormat ${JSON.stringify(manifest.packFormat)}; this build reads format ${CONTENT_PACK_FORMAT}`,
    );
  }

  // The files table MUST list exactly the four payload files: a pruned
  // table would make hash verification vacuous, an extended one is a
  // different format. Payloads are parsed from the very bytes hashed.
  const files = manifest.files;
  if (files === undefined || files === null || typeof files !== "object") {
    throw new VerifyError("verify: manifest.files table is missing");
  }
  const listed = Object.keys(files).sort();
  if (listed.join(",") !== PAYLOAD_FILES.join(",")) {
    throw new VerifyError(
      `verify: manifest.files must list exactly ${PAYLOAD_FILES.join(", ")}; got ${listed.join(", ") || "(empty)"}`,
    );
  }
  const payloadBytes = new Map<string, Buffer>();
  for (const name of PAYLOAD_FILES) {
    const bytes = readBytes(contentPackDir, name);
    const actual = sha256Hex(bytes);
    const expected = files[name];
    if (actual !== expected) {
      throw new VerifyError(`verify: payload file ${name} hash mismatch (expected ${expected}, got ${actual})`);
    }
    payloadBytes.set(name, bytes);
  }

  // Base identity cross-check against the world pack: BOTH the generation
  // identity and the world.json byte hash must match — the blessed pairing
  // rule. A mismatched pair refuses at import, not at play time.
  const worldPack = readGamePack(worldPackDir);
  const base = manifest.base;
  if (base === undefined) throw new VerifyError("verify: manifest.base is missing");
  if (base.generationIdentitySha256 !== worldPack.manifest.generator.generationIdentitySha256) {
    throw new VerifyError(
      `verify: content pack was directed against base ${base.generationIdentitySha256} but the world pack is ` +
        `${worldPack.manifest.generator.generationIdentitySha256} — regenerate or re-pin`,
    );
  }
  if (base.artifactSha256 !== worldPack.manifest.baseArtifactSha256) {
    throw new VerifyError("verify: manifest.base.artifactSha256 does not match the world pack's baseArtifactSha256");
  }
  const model = new WorldModel(worldPack.artifact);
  if (base.artifactFormat !== model.raw.formatVersion || base.width !== model.dimensions.width || base.height !== model.dimensions.height) {
    throw new VerifyError("verify: manifest.base format/dimensions disagree with the world pack");
  }

  // The audit that authorized this export: a pack without a passing
  // report is not a valid pack (importer obligation 4).
  const report = parseJson("report.json", payloadBytes.get("report.json") as Buffer) as {
    reportFormat?: unknown;
    ok?: unknown;
  } & IdentityStamp;
  if (report.reportFormat !== 1) {
    throw new VerifyError(`verify: report.json reportFormat ${String(report.reportFormat)} is not 1`);
  }
  if (report.ok !== true) {
    throw new VerifyError("verify: report.json .ok is not true — this pack was not authorized by a passing audit");
  }

  const plan = parseJson("content-plan.json", payloadBytes.get("content-plan.json") as Buffer) as {
    planFormat?: unknown;
  } & IdentityStamp;
  if (plan.planFormat !== 1) {
    throw new VerifyError(`verify: content-plan.json planFormat ${String(plan.planFormat)} is not 1`);
  }

  // Ground truth from the world pack's REFERENCE walkability bitgrid — the
  // same data a game runtime consumes; the solver is not in the loop.
  const { width, height } = model.dimensions;
  const grid = decodeBase64Grid(worldPack.walkability.grid, width * height);
  const walkable = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && unpackBit(grid, y * width + x);

  const placements = parseJson("placements.json", payloadBytes.get("placements.json") as Buffer) as PlacementsDoc;
  if (placements.placementsFormat !== 1) {
    throw new VerifyError(`verify: placements.json placementsFormat ${String(placements.placementsFormat)} is not 1`);
  }
  for (const placement of placements.placements) {
    if (!PLACEMENT_RULES.has(placement.rule)) {
      throw new VerifyError(
        `verify: ${placement.id} carries unknown rule ${String(placement.rule)} — unknown enum values are errors, never defaults`,
      );
    }
    if (!walkable(placement.accessCell[0], placement.accessCell[1])) {
      throw new VerifyError(`verify: ${placement.id} access cell (${placement.accessCell[0]}, ${placement.accessCell[1]}) is not walkable in the world pack`);
    }
    if (placement.rule === "world_boss.v1") {
      if (placement.arenaOrigin === null || placement.arenaSide === null) {
        throw new VerifyError(`verify: ${placement.id} carries no arena`);
      }
      for (let y = placement.arenaOrigin[1]; y < placement.arenaOrigin[1] + placement.arenaSide; y += 1) {
        for (let x = placement.arenaOrigin[0]; x < placement.arenaOrigin[0] + placement.arenaSide; x += 1) {
          if (!walkable(x, y)) {
            throw new VerifyError(`verify: ${placement.id} arena cell (${x}, ${y}) is not walkable in the world pack`);
          }
        }
      }
    }
    if (placement.rule === "dungeon_binding.v1") {
      const poi = model.pois.find((entry) => entry.id === placement.anchorPoiId);
      if (poi === undefined) {
        throw new VerifyError(`verify: ${placement.id} binds anchor poi #${placement.anchorPoiId} which does not exist in the world pack`);
      }
      if (poi.cell[0] !== placement.cell[0] || poi.cell[1] !== placement.cell[1]) {
        throw new VerifyError(`verify: ${placement.id} anchor poi #${poi.id} moved`);
      }
    }
  }

  const territories = parseJson("territories.json", payloadBytes.get("territories.json") as Buffer) as TerritoriesDoc;
  if (territories.territoriesFormat !== 1) {
    throw new VerifyError(`verify: territories.json territoriesFormat ${String(territories.territoriesFormat)} is not 1`);
  }
  let territoryCells = 0;
  for (const territory of territories.territories) {
    if (territory.cells.encoding !== "runs") {
      throw new VerifyError(
        `verify: ${territory.id} cells.encoding ${String(territory.cells.encoding)} is not "runs" — unknown enum values are errors`,
      );
    }
    if (!RESPAWN_PRESSURES.has(territory.respawnPressure)) {
      throw new VerifyError(`verify: ${territory.id} respawnPressure ${String(territory.respawnPressure)} is not low|medium|high`);
    }
    let cells: Set<number>;
    try {
      cells = decodeRuns(territory.cells.runs, width);
    } catch (error) {
      throw new VerifyError(`verify: ${territory.id} ${(error as Error).message}`);
    }
    if (cells.size !== territory.cellCount) {
      throw new VerifyError(`verify: ${territory.id} cellCount ${territory.cellCount} does not match its runs (${cells.size})`);
    }
    for (const index of cells) {
      const x = index % width;
      const y = (index - x) / width;
      if (!walkable(x, y)) {
        throw new VerifyError(`verify: ${territory.id} cell (${x}, ${y}) is not walkable in the world pack`);
      }
    }
    territoryCells += cells.size;
  }

  // Manifest self-consistency: the manifest is the one unhashed file, so
  // its duplicated identity fields and counts must agree with the hashed
  // payload documents — a hand-edited manifest must not survive.
  requireIdentityAgreement(manifest, "content-plan.json", plan);
  requireIdentityAgreement(manifest, "placements.json", placements as unknown as IdentityStamp);
  requireIdentityAgreement(manifest, "territories.json", territories as unknown as IdentityStamp);
  requireIdentityAgreement(manifest, "report.json", report);
  const counts = manifest.counts;
  if (
    counts === undefined ||
    counts.placements !== placements.placements.length ||
    counts.territories !== territories.territories.length ||
    counts.placementFailures !== placements.failures.length ||
    counts.territoryFailures !== territories.failures.length ||
    counts.unboundAnchors !== placements.unboundAnchors.length
  ) {
    throw new VerifyError("verify: manifest.counts disagree with the payload documents");
  }

  return {
    world: manifest.world ?? "",
    recipeName: manifest.recipeName ?? "",
    placements: placements.placements.length,
    territories: territories.territories.length,
    territoryCells,
  };
}
