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
import type { RegionalPlan } from "../plan/plan.js";
import type { ValidationReportDoc } from "../validate/validate.js";
import {
  CONTENT_PACK_FORMAT,
  PLACEMENTS_FORMAT,
  PLAN_FORMAT,
  REPORT_FORMAT,
  TERRITORIES_FORMAT,
} from "../core/version.js";

/**
 * The consumption proof: everything a game-side importer must check,
 * implemented from nothing but the two packs on disk — the world game
 * pack and the worldfiller content pack. No solver internals, no
 * analysis bundle; walkability comes from the world pack's reference
 * bitgrid, exactly as a game runtime would read it.
 *
 * This module IS the specification-by-example for the future
 * worldfiller_importer addon (docs/CONTENT_PACK_FORMAT.md). The blessed
 * checks, in order: manifest identity and format pins; the exact
 * four-name files table hash-verified (payloads are parsed from the
 * same bytes that were hashed); report.json reportFormat 1 and ok true;
 * base pairing against the world pack; manifest self-consistency
 * against the hashed payloads (identity fields and counts); closed
 * format-1 enums refused when unknown; every placement and territory
 * cell re-checked against reference walkability.
 */

export class VerifyError extends Error {}

export interface VerifySummary {
  readonly world: string;
  readonly recipeName: string;
  readonly placements: number;
  readonly territories: number;
  readonly territoryCells: number;
}

/** The exact files table of a format-1 content pack — no more, no fewer. */
const REQUIRED_FILES = ["content-plan.json", "placements.json", "report.json", "territories.json"] as const;

const PLACEMENT_RULES = new Set(["world_boss.v1", "dungeon_binding.v1"]);
const RESPAWN_PRESSURES = new Set(["low", "medium", "high"]);

function parseJson(name: string, bytes: Buffer): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new VerifyError(`verify: ${name} is not valid JSON`);
  }
}

export function verifyContentPack(worldPackDir: string, contentPackDir: string): VerifySummary {
  let manifestBytes: Buffer;
  try {
    manifestBytes = readFileSync(join(contentPackDir, "manifest.json"));
  } catch {
    throw new VerifyError(`verify: required file manifest.json is missing in ${contentPackDir} (not a content pack)`);
  }
  const manifest = parseJson("manifest.json", manifestBytes) as Partial<ContentPackManifest>;
  if (manifest.pack !== "worldfiller-content-pack") {
    throw new VerifyError(`verify: manifest.pack is ${String(manifest.pack)}; expected worldfiller-content-pack`);
  }
  if (manifest.packFormat !== CONTENT_PACK_FORMAT) {
    throw new VerifyError(
      `verify: unsupported packFormat ${String(manifest.packFormat)}; this build reads format ${CONTENT_PACK_FORMAT}`,
    );
  }

  // The files table must list exactly the four payload files — a pruned
  // table would make hash verification vacuous, an extended one smuggles
  // unspecified payload. Keys are bare file names, so nothing can escape
  // the pack directory. Payloads are parsed from the same bytes that were
  // hash-verified.
  const files = manifest.files;
  if (files === undefined || files === null || typeof files !== "object") {
    throw new VerifyError("verify: manifest.files table is missing");
  }
  const listed = Object.keys(files).sort();
  if (listed.join(",") !== REQUIRED_FILES.join(",")) {
    throw new VerifyError(
      `verify: manifest.files must list exactly ${REQUIRED_FILES.join(", ")} (got: ${listed.join(", ") || "nothing"})`,
    );
  }
  const payloadBytes = new Map<string, Buffer>();
  for (const name of REQUIRED_FILES) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(contentPackDir, name));
    } catch {
      throw new VerifyError(`verify: payload file ${name} listed in manifest.files is missing`);
    }
    const actual = sha256Hex(bytes);
    const expected = files[name];
    if (actual !== expected) {
      throw new VerifyError(`verify: payload file ${name} hash mismatch (expected ${String(expected)}, got ${actual})`);
    }
    payloadBytes.set(name, bytes);
  }

  // Payload format pins: packFormat 1 fixes every payload format at 1;
  // an unknown payload format is a refusal, never a best-effort read.
  const plan = parseJson("content-plan.json", payloadBytes.get("content-plan.json") as Buffer) as RegionalPlan;
  const placements = parseJson("placements.json", payloadBytes.get("placements.json") as Buffer) as PlacementsDoc;
  const territories = parseJson("territories.json", payloadBytes.get("territories.json") as Buffer) as TerritoriesDoc;
  const report = parseJson("report.json", payloadBytes.get("report.json") as Buffer) as ValidationReportDoc;
  if (plan.planFormat !== PLAN_FORMAT) {
    throw new VerifyError(`verify: content-plan.json planFormat ${String(plan.planFormat)}; format 1 packs carry ${PLAN_FORMAT}`);
  }
  if (placements.placementsFormat !== PLACEMENTS_FORMAT) {
    throw new VerifyError(
      `verify: placements.json placementsFormat ${String(placements.placementsFormat)}; format 1 packs carry ${PLACEMENTS_FORMAT}`,
    );
  }
  if (territories.territoriesFormat !== TERRITORIES_FORMAT) {
    throw new VerifyError(
      `verify: territories.json territoriesFormat ${String(territories.territoriesFormat)}; format 1 packs carry ${TERRITORIES_FORMAT}`,
    );
  }
  if (report.reportFormat !== REPORT_FORMAT) {
    throw new VerifyError(`verify: report.json reportFormat ${String(report.reportFormat)}; format 1 packs carry ${REPORT_FORMAT}`);
  }

  // The audit that authorized this pack: a hand-built pack without a
  // passing report is not a valid pack.
  if (report.ok !== true) {
    throw new VerifyError("verify: report.json .ok is not true — the pack carries a failing (or tampered) audit");
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

  // Manifest self-consistency: the manifest is the one unhashed file, so
  // every identity field it duplicates must agree with the hashed payloads,
  // and its counts must equal the actual array lengths.
  for (const [name, doc] of [
    ["content-plan.json", plan],
    ["placements.json", placements],
    ["territories.json", territories],
    ["report.json", report],
  ] as const) {
    if (doc.directorRecipeSha256 !== manifest.directorRecipeSha256) {
      throw new VerifyError(`verify: manifest.directorRecipeSha256 does not match ${name}`);
    }
    if (doc.directorBehaviorVersion !== manifest.directorBehaviorVersion) {
      throw new VerifyError(`verify: manifest.directorBehaviorVersion does not match ${name}`);
    }
    if (doc.recipeName !== manifest.recipeName) {
      throw new VerifyError(`verify: manifest.recipeName does not match ${name}`);
    }
    if (doc.base.generationIdentitySha256 !== base.generationIdentitySha256) {
      throw new VerifyError(`verify: manifest.base.generationIdentitySha256 does not match ${name}`);
    }
    if (doc.analysisVersion !== manifest.analysisVersion) {
      throw new VerifyError(`verify: manifest.analysisVersion does not match ${name}`);
    }
    if (
      JSON.stringify(Object.entries(doc.rulePacks ?? {}).sort()) !==
      JSON.stringify(Object.entries(manifest.rulePacks ?? {}).sort())
    ) {
      throw new VerifyError(`verify: manifest.rulePacks do not match ${name}`);
    }
  }
  for (const [name, doc] of [
    ["content-plan.json", plan],
    ["placements.json", placements],
    ["territories.json", territories],
  ] as const) {
    if (doc.directorSeed !== manifest.directorSeed) {
      throw new VerifyError(`verify: manifest.directorSeed does not match ${name}`);
    }
  }
  const counts = manifest.counts;
  if (counts === undefined) throw new VerifyError("verify: manifest.counts is missing");
  if (
    counts.placements !== placements.placements.length ||
    counts.territories !== territories.territories.length ||
    counts.placementFailures !== placements.failures.length ||
    counts.territoryFailures !== territories.failures.length ||
    counts.unboundAnchors !== placements.unboundAnchors.length
  ) {
    throw new VerifyError("verify: manifest.counts disagree with the payload documents");
  }

  // Ground truth from the world pack's REFERENCE walkability bitgrid — the
  // same data a game runtime consumes; the solver is not in the loop.
  const { width, height } = model.dimensions;
  const grid = decodeBase64Grid(worldPack.walkability.grid, width * height);
  const walkable = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && unpackBit(grid, y * width + x);

  for (const placement of placements.placements) {
    // Closed format-1 enum: an unknown placement rule is an error, never
    // a default — a future rule vocabulary means a new pack format.
    if (!PLACEMENT_RULES.has(placement.rule)) {
      throw new VerifyError(`verify: ${placement.id} carries unknown placement rule ${String(placement.rule)}`);
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

  let territoryCells = 0;
  for (const territory of territories.territories) {
    if (territory.cells.encoding !== "runs") {
      throw new VerifyError(`verify: ${territory.id} carries unknown cell encoding ${String(territory.cells.encoding)}`);
    }
    if (!RESPAWN_PRESSURES.has(territory.respawnPressure)) {
      throw new VerifyError(`verify: ${territory.id} carries unknown respawnPressure ${String(territory.respawnPressure)}`);
    }
    let cells: Set<number>;
    try {
      cells = decodeRuns(territory.cells.runs, width);
    } catch (error) {
      throw new VerifyError(`verify: ${territory.id} ${error instanceof Error ? error.message : String(error)}`);
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

  return {
    world: manifest.world ?? "",
    recipeName: manifest.recipeName ?? "",
    placements: placements.placements.length,
    territories: territories.territories.length,
    territoryCells,
  };
}
