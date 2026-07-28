import { mkdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../core/canonicalJson.js";
import { sha256Hex } from "../core/sha256.js";
import { recipeSha256 } from "../recipe/schema.js";
import { ANALYSIS_VERSION } from "../analysis/analyze.js";
import { CONTENT_PACK_FORMAT, DIRECTOR_BEHAVIOR_VERSION, DIRECTOR_VERSION, RULE_PACK_VERSIONS, } from "../core/version.js";
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
 * refuses before a single byte is written, and the report must be the
 * audit of exactly these inputs — every payload document's embedded
 * identity (recipe hash, behavior version, rule packs, base identity)
 * must agree, so a stale or unrelated report can never authorize a pack.
 *
 * Writes are staged: payload files first, manifest.json last, into a
 * sibling staging directory that is renamed into place only when
 * complete. manifest.json is the commit record — a directory without
 * one is not a pack, and a previously valid pack is never left torn.
 */
export class ExportError extends Error {
}
export function buildContentPack(inputs) {
    const { model, recipe, plan, placements, territories, report } = inputs;
    if (!report.ok) {
        const failed = report.gates.filter((gate) => gate.status === "fail").map((gate) => `${gate.id} ${gate.name}`);
        throw new ExportError(`export: refusing — the audit failed: ${failed.join("; ")}`);
    }
    // The report must be the audit of exactly these inputs. Every payload
    // document embeds its identity; any disagreement means a caller wired a
    // stale or unrelated document into the export — refuse by name.
    const expectedRecipeSha = recipeSha256(recipe);
    const expectedIdentity = model.generator.generationIdentitySha256;
    const rulePacksJson = JSON.stringify(Object.entries(RULE_PACK_VERSIONS).sort());
    for (const [name, doc] of [
        ["plan", plan],
        ["placements", placements],
        ["territories", territories],
        ["report", report],
    ]) {
        if (doc.directorRecipeSha256 !== expectedRecipeSha) {
            throw new ExportError(`export: refusing — ${name} was produced from a different recipe (directorRecipeSha256 mismatch)`);
        }
        if (doc.base.generationIdentitySha256 !== expectedIdentity) {
            throw new ExportError(`export: refusing — ${name} was produced against a different world (base identity mismatch)`);
        }
        if (doc.directorBehaviorVersion !== DIRECTOR_BEHAVIOR_VERSION) {
            throw new ExportError(`export: refusing — ${name} carries behavior version ${doc.directorBehaviorVersion}, this build is ${DIRECTOR_BEHAVIOR_VERSION}`);
        }
        if (doc.analysisVersion !== ANALYSIS_VERSION) {
            throw new ExportError(`export: refusing — ${name} carries analysis version ${doc.analysisVersion}, this build is ${ANALYSIS_VERSION}`);
        }
        if (JSON.stringify(Object.entries(doc.rulePacks).sort()) !== rulePacksJson) {
            throw new ExportError(`export: refusing — ${name} carries different rule pack versions than this build`);
        }
    }
    const payload = new Map();
    payload.set("content-plan.json", canonicalJson(plan));
    payload.set("placements.json", canonicalJson(placements));
    payload.set("territories.json", canonicalJson(territories));
    payload.set("report.json", canonicalJson(report));
    const files = {};
    for (const [name, bytes] of [...payload.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
        files[name] = sha256Hex(bytes);
    }
    const manifest = {
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
 * Write a built pack to a directory, replacing any existing pack there.
 * Staged commit, entirely inside the guarded destination: the full pack
 * is written to `<outDir>/.staging/` first, then the old manifest is
 * removed (decommit), old payloads cleared, and the staged files renamed
 * into place with manifest.json strictly last (commit). manifest.json is
 * the commit record: a failure at any point leaves either the old pack
 * intact or a manifest-less directory (not a pack) with the complete new
 * pack still in `.staging/` — never a manifest over torn payload.
 */
export function writeContentPack(pack, outDir) {
    const staging = join(outDir, ".staging");
    rmSync(staging, { recursive: true, force: true });
    mkdirSync(staging, { recursive: true });
    const payloadNames = [...pack.files.keys()];
    try {
        for (const name of payloadNames) {
            writeFileSync(join(staging, name), pack.files.get(name));
        }
        writeFileSync(join(staging, "manifest.json"), canonicalJson(pack.manifest));
    }
    catch (error) {
        rmSync(staging, { recursive: true, force: true });
        throw error;
    }
    rmSync(join(outDir, "manifest.json"), { force: true });
    for (const name of payloadNames)
        rmSync(join(outDir, name), { force: true });
    for (const name of payloadNames)
        renameSync(join(staging, name), join(outDir, name));
    renameSync(join(staging, "manifest.json"), join(outDir, "manifest.json"));
    rmSync(staging, { recursive: true, force: true });
}
