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
 * worldfiller_importer addon (docs/CONTENT_PACK_FORMAT.md).
 */

export class VerifyError extends Error {}

export interface VerifySummary {
  readonly world: string;
  readonly recipeName: string;
  readonly placements: number;
  readonly territories: number;
  readonly territoryCells: number;
}

function readJson(dir: string, name: string): unknown {
  let bytes: Buffer;
  try {
    bytes = readFileSync(join(dir, name));
  } catch {
    throw new VerifyError(`verify: required file ${name} is missing in ${dir}`);
  }
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
  if (manifest.packFormat !== CONTENT_PACK_FORMAT) {
    throw new VerifyError(
      `verify: unsupported packFormat ${String(manifest.packFormat)}; this build reads format ${CONTENT_PACK_FORMAT}`,
    );
  }
  const files = manifest.files;
  if (files === undefined) throw new VerifyError("verify: manifest.files table is missing");
  for (const [name, expected] of Object.entries(files)) {
    let bytes: Buffer;
    try {
      bytes = readFileSync(join(contentPackDir, name));
    } catch {
      throw new VerifyError(`verify: payload file ${name} listed in manifest.files is missing`);
    }
    const actual = sha256Hex(bytes);
    if (actual !== expected) {
      throw new VerifyError(`verify: payload file ${name} hash mismatch (expected ${expected}, got ${actual})`);
    }
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

  const placements = readJson(contentPackDir, "placements.json") as PlacementsDoc;
  for (const placement of placements.placements) {
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

  const territories = readJson(contentPackDir, "territories.json") as TerritoriesDoc;
  let territoryCells = 0;
  for (const territory of territories.territories) {
    const cells = decodeRuns(territory.cells.runs, width);
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
