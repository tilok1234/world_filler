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
  PACK_FORMAT_PROFILE,
  PLAN_FORMAT,
  REPORT_FORMAT,
  SUPPORTED_CONTENT_PACK_FORMATS,
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
 * worldfiller_importer addon (docs/CONTENT_PACK_FORMAT.md). It
 * implements every numbered importer obligation, including the ones
 * that exist to reject hand-built packs: the files table must list
 * exactly the four payload files (verified bytes are the ones parsed),
 * report.json must say ok, unknown enum values are errors, and the
 * manifest must agree with the hashed payload documents it fronts.
 */

export class VerifyError extends Error {}

export interface VerifySummary {
  readonly world: string;
  readonly recipeName: string;
  readonly placements: number;
  readonly territories: number;
  readonly territoryCells: number;
}

/** The exact payload set of content pack format 1 — no more, no less. */
const REQUIRED_PAYLOAD_FILES = ["content-plan.json", "placements.json", "report.json", "territories.json"] as const;

const RESPAWN_PRESSURES = new Set(["low", "medium", "high"]);

function readJson(dir: string, name: string): unknown {
  let bytes: Buffer;
  try {
    bytes = readFileSync(join(dir, name));
  } catch {
    throw new VerifyError(`verify: required file ${name} is missing in ${dir}`);
  }
  return parseJson(bytes, name);
}

function parseJson(bytes: Buffer, name: string): unknown {
  try {
    return JSON.parse(bytes.toString("utf8"));
  } catch {
    throw new VerifyError(`verify: ${name} is not valid JSON`);
  }
}

export function verifyContentPack(worldPackDir: string, contentPackDir: string): VerifySummary {
  const manifest = readJson(contentPackDir, "manifest.json") as Partial<ContentPackManifest>;
  if (manifest.pack !== "worldfiller-content-pack") {
    throw new VerifyError(`verify: manifest.pack is ${String(manifest.pack)}; expected worldfiller-content-pack`);
  }
  if (typeof manifest.packFormat !== "number" || !SUPPORTED_CONTENT_PACK_FORMATS.includes(manifest.packFormat)) {
    throw new VerifyError(
      `verify: unsupported packFormat ${String(manifest.packFormat)}; this build reads formats ${SUPPORTED_CONTENT_PACK_FORMATS.join(", ")}`,
    );
  }
  const profile = PACK_FORMAT_PROFILE[manifest.packFormat] as (typeof PACK_FORMAT_PROFILE)[number];
  const placementRules = new Set(profile.placementRules);

  // The files table must list exactly the four format-1 payload files —
  // a shorter table would leave consumed bytes unhashed, a longer one is
  // an unknown name (obligation 5). Payloads are parsed from the very
  // bytes that were hash-verified.
  const files = manifest.files;
  if (files === undefined || files === null || typeof files !== "object" || Array.isArray(files)) {
    throw new VerifyError("verify: manifest.files table is missing or malformed");
  }
  const listed = Object.keys(files).sort();
  for (const name of REQUIRED_PAYLOAD_FILES) {
    if (!listed.includes(name)) {
      throw new VerifyError(`verify: manifest.files must list ${name} (format 1 packs carry exactly ${REQUIRED_PAYLOAD_FILES.join(", ")})`);
    }
  }
  for (const name of listed) {
    if (!(REQUIRED_PAYLOAD_FILES as readonly string[]).includes(name)) {
      throw new VerifyError(`verify: manifest.files lists unknown payload ${name}; format 1 packs carry exactly ${REQUIRED_PAYLOAD_FILES.join(", ")}`);
    }
  }
  const payloadBytes = new Map<string, Buffer>();
  for (const name of REQUIRED_PAYLOAD_FILES) {
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

  const plan = parseJson(payloadBytes.get("content-plan.json") as Buffer, "content-plan.json") as RegionalPlan;
  const placements = parseJson(payloadBytes.get("placements.json") as Buffer, "placements.json") as PlacementsDoc;
  const territories = parseJson(payloadBytes.get("territories.json") as Buffer, "territories.json") as TerritoriesDoc;
  const report = parseJson(payloadBytes.get("report.json") as Buffer, "report.json") as ValidationReportDoc;

  // packFormat 1 fixes every payload format at 1 (no best-effort reads).
  if (plan.planFormat !== PLAN_FORMAT) {
    throw new VerifyError(`verify: content-plan.json planFormat ${String(plan.planFormat)}; format-1 packs carry planFormat ${PLAN_FORMAT}`);
  }
  if (placements.placementsFormat !== profile.placementsFormat) {
    throw new VerifyError(
      `verify: placements.json placementsFormat ${String(placements.placementsFormat)}; format-${manifest.packFormat} packs carry placementsFormat ${profile.placementsFormat}`,
    );
  }
  if (territories.territoriesFormat !== TERRITORIES_FORMAT) {
    throw new VerifyError(
      `verify: territories.json territoriesFormat ${String(territories.territoriesFormat)}; format-1 packs carry territoriesFormat ${TERRITORIES_FORMAT}`,
    );
  }
  if (report.reportFormat !== REPORT_FORMAT) {
    throw new VerifyError(`verify: report.json reportFormat ${String(report.reportFormat)}; format-1 packs carry reportFormat ${REPORT_FORMAT}`);
  }

  // Importer obligation 4: the pack was audited. A hand-built pack
  // without a passing report is not a valid pack.
  if (report.ok !== true) {
    throw new VerifyError("verify: report.json says ok is not true — the pack carries a failing (or tampered) audit");
  }

  // The manifest is the only unhashed file, so every identity field and
  // count it duplicates must agree with the hashed payload documents.
  const identityDocs = [
    ["content-plan.json", plan],
    ["placements.json", placements],
    ["territories.json", territories],
    ["report.json", report],
  ] as const;
  for (const [name, doc] of identityDocs) {
    if (doc.directorRecipeSha256 !== manifest.directorRecipeSha256) {
      throw new VerifyError(`verify: manifest.directorRecipeSha256 disagrees with ${name}`);
    }
    if (doc.directorBehaviorVersion !== manifest.directorBehaviorVersion) {
      throw new VerifyError(`verify: manifest.directorBehaviorVersion disagrees with ${name}`);
    }
    if (doc.recipeName !== manifest.recipeName) {
      throw new VerifyError(`verify: manifest.recipeName disagrees with ${name}`);
    }
    if (doc.base.generationIdentitySha256 !== manifest.base?.generationIdentitySha256) {
      throw new VerifyError(`verify: manifest.base.generationIdentitySha256 disagrees with ${name}`);
    }
  }
  for (const [name, doc] of [
    ["content-plan.json", plan],
    ["placements.json", placements],
    ["territories.json", territories],
  ] as const) {
    if (doc.directorSeed !== manifest.directorSeed) {
      throw new VerifyError(`verify: manifest.directorSeed disagrees with ${name}`);
    }
  }
  const counts = manifest.counts;
  if (counts === undefined) throw new VerifyError("verify: manifest.counts is missing");
  if (
    counts.placements !== placements.placements.length ||
    counts.placementFailures !== placements.failures.length ||
    counts.unboundAnchors !== placements.unboundAnchors.length ||
    counts.territories !== territories.territories.length ||
    counts.territoryFailures !== territories.failures.length
  ) {
    throw new VerifyError("verify: manifest.counts disagree with the payload documents");
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

  // Ground truth from the world pack's REFERENCE walkability bitgrid — the
  // same data a game runtime consumes; the solver is not in the loop.
  const { width, height } = model.dimensions;
  const grid = decodeBase64Grid(worldPack.walkability.grid, width * height);
  const walkable = (x: number, y: number): boolean =>
    x >= 0 && y >= 0 && x < width && y < height && unpackBit(grid, y * width + x);

  for (const placement of placements.placements) {
    // Obligation 5: unknown enum values are errors, never defaults.
    if (!placementRules.has(placement.rule)) {
      throw new VerifyError(
        `verify: ${placement.id} carries unknown rule ${String(placement.rule)} (format-${manifest.packFormat} rules: ${[...placementRules].join(", ")})`,
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

  let territoryCells = 0;
  for (const territory of territories.territories) {
    if (territory.cells.encoding !== "runs") {
      throw new VerifyError(`verify: ${territory.id} carries unknown cells encoding ${String(territory.cells.encoding)} (format 1: runs)`);
    }
    if (!RESPAWN_PRESSURES.has(territory.respawnPressure)) {
      throw new VerifyError(
        `verify: ${territory.id} carries unknown respawnPressure ${String(territory.respawnPressure)} (format 1: ${[...RESPAWN_PRESSURES].join(", ")})`,
      );
    }
    let cells: Set<number>;
    try {
      cells = decodeRuns(territory.cells.runs, width, height);
    } catch (error) {
      throw new VerifyError(`verify: ${territory.id} has malformed runs — ${error instanceof Error ? error.message : String(error)}`);
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
