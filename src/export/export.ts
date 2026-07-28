import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../core/canonicalJson.js";
import { sha256Hex } from "../core/sha256.js";
import type { WorldModel } from "../world/model.js";
import type { RegionalPlan } from "../plan/plan.js";
import type { PlacementsDoc } from "../place/solver.js";
import type { TerritoriesDoc } from "../territory/territory.js";
import type { ValidationReportDoc } from "../validate/validate.js";
import type { DirectorRecipe } from "../recipe/schema.js";
import { recipeSha256 } from "../recipe/schema.js";
import { ANALYSIS_VERSION } from "../analysis/analyze.js";
import {
  CONTENT_PACK_FORMAT,
  DIRECTOR_BEHAVIOR_VERSION,
  DIRECTOR_VERSION,
  RULE_PACK_VERSIONS,
} from "../core/version.js";

/**
 * Content pack v1 — the frozen consumer boundary (docs/CONTENT_PACK_FORMAT.md).
 *
 * Layout:
 *   <name>-content/
 *     manifest.json        (never listed in its own files table)
 *     content-plan.json
 *     placements.json
 *     territories.json
 *     report.json
 *
 * Every payload file is canonical JSON, hashed in manifest.files. The
 * manifest records the base world identity (generation identity AND the
 * world.json byte hash) plus the full director version identity. No
 * timestamps anywhere — identity is hashes, packs are byte-stable.
 * Renders are inspection evidence, never pack payload.
 *
 * An export happens only when the gate battery passed: a failing audit
 * refuses before a single byte is written.
 */

export class ExportError extends Error {}

export interface ContentPackManifest {
  readonly pack: "worldfiller-content-pack";
  readonly packFormat: number;
  readonly world: string;
  readonly adapter: { readonly name: "worldfiller"; readonly version: string };
  readonly directorBehaviorVersion: number;
  readonly rulePacks: typeof RULE_PACK_VERSIONS;
  readonly analysisVersion: number;
  readonly recipeName: string;
  readonly directorSeed: number;
  readonly directorRecipeSha256: string;
  readonly base: {
    readonly generationIdentitySha256: string;
    readonly artifactFormat: number;
    readonly artifactSha256: string;
    readonly width: number;
    readonly height: number;
  };
  readonly counts: {
    readonly placements: number;
    readonly territories: number;
    readonly placementFailures: number;
    readonly territoryFailures: number;
    readonly unboundAnchors: number;
  };
  readonly files: Readonly<Record<string, string>>;
}

export interface ExportInputs {
  readonly model: WorldModel;
  readonly worldName: string;
  readonly baseArtifactSha256: string;
  readonly recipe: DirectorRecipe;
  readonly plan: RegionalPlan;
  readonly placements: PlacementsDoc;
  readonly territories: TerritoriesDoc;
  readonly report: ValidationReportDoc;
}

export interface BuiltContentPack {
  readonly manifest: ContentPackManifest;
  /** Payload file name -> canonical bytes (manifest.json excluded). */
  readonly files: ReadonlyMap<string, string>;
}

export function buildContentPack(inputs: ExportInputs): BuiltContentPack {
  const { model, recipe, plan, placements, territories, report } = inputs;
  if (!report.ok) {
    const failed = report.gates.filter((gate) => gate.status === "fail").map((gate) => `${gate.id} ${gate.name}`);
    throw new ExportError(`export: refusing — the audit failed: ${failed.join("; ")}`);
  }

  // The report must be the audit of exactly these inputs: every document
  // stamps the same identity, and a passing report for a different
  // recipe, world, or behavior version authorizes nothing. Callers that
  // thread one pipeline's outputs pass trivially; mixed inputs refuse.
  const expectedRecipeSha = recipeSha256(recipe);
  const expectedBase = model.generator.generationIdentitySha256;
  const rulePacksJson = JSON.stringify(RULE_PACK_VERSIONS);
  for (const [name, doc] of [
    ["content-plan.json", plan],
    ["placements.json", placements],
    ["territories.json", territories],
    ["report.json", report],
  ] as const) {
    const mismatches: string[] = [];
    if (doc.directorRecipeSha256 !== expectedRecipeSha) mismatches.push("directorRecipeSha256");
    if (doc.directorBehaviorVersion !== DIRECTOR_BEHAVIOR_VERSION) mismatches.push("directorBehaviorVersion");
    if (JSON.stringify(doc.rulePacks) !== rulePacksJson) mismatches.push("rulePacks");
    if (doc.analysisVersion !== ANALYSIS_VERSION) mismatches.push("analysisVersion");
    if (doc.base.generationIdentitySha256 !== expectedBase) mismatches.push("base.generationIdentitySha256");
    if (mismatches.length > 0) {
      throw new ExportError(
        `export: refusing — ${name} was not produced from these inputs (${mismatches.join(", ")} disagree)`,
      );
    }
  }

  const payload = new Map<string, string>();
  payload.set("content-plan.json", canonicalJson(plan));
  payload.set("placements.json", canonicalJson(placements));
  payload.set("territories.json", canonicalJson(territories));
  payload.set("report.json", canonicalJson(report));

  const files: Record<string, string> = {};
  for (const [name, bytes] of [...payload.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    files[name] = sha256Hex(bytes);
  }

  const manifest: ContentPackManifest = {
    pack: "worldfiller-content-pack",
    packFormat: CONTENT_PACK_FORMAT,
    world: inputs.worldName,
    adapter: { name: "worldfiller", version: DIRECTOR_VERSION },
    directorBehaviorVersion: DIRECTOR_BEHAVIOR_VERSION,
    rulePacks: RULE_PACK_VERSIONS,
    analysisVersion: ANALYSIS_VERSION,
    recipeName: recipe.name,
    directorSeed: recipe.directorSeed,
    directorRecipeSha256: recipeSha256(recipe),
    base: {
      generationIdentitySha256: model.generator.generationIdentitySha256,
      artifactFormat: model.raw.formatVersion,
      artifactSha256: inputs.baseArtifactSha256,
      width: model.dimensions.width,
      height: model.dimensions.height,
    },
    counts: {
      placements: placements.placements.length,
      territories: territories.territories.length,
      placementFailures: placements.failures.length,
      territoryFailures: territories.failures.length,
      unboundAnchors: placements.unboundAnchors.length,
    },
    files,
  };

  return { manifest, files: payload };
}

/**
 * Write a built pack to a directory via sibling temp-directory staging
 * (the upstream safe-write rule: all hard failures, no partial packs).
 * The complete pack is written into `<outDir>.staging` — manifest.json
 * last, as the commit record — and only then swapped into place, so a
 * failure mid-write can never destroy an existing pack or leave a
 * directory that looks like a pack. A directory without manifest.json
 * is not a pack.
 */
export function writeContentPack(pack: BuiltContentPack, outDir: string): void {
  const staging = `${outDir}.staging`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  for (const [name, bytes] of pack.files) {
    writeFileSync(join(staging, name), bytes);
  }
  writeFileSync(join(staging, "manifest.json"), canonicalJson(pack.manifest));
  rmSync(outDir, { recursive: true, force: true });
  renameSync(staging, outDir);
}
