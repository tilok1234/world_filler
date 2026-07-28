import { readFileSync } from "node:fs";
import { join } from "node:path";
import { sha256Hex } from "../core/sha256.js";
import { SUPPORTED_ARTIFACT_FORMAT } from "../world/model.js";
/** The game pack format this consumer reads; anything else is a refusal. */
export const SUPPORTED_PACK_FORMAT = 1;
export const SUPPORTED_WALKABILITY_FORMAT = 1;
const WALKABILITY_ENCODING = "base64-bitpacked-row-major-lsb-first";
export class PackError extends Error {
}
function readJson(dir, name) {
    let bytes;
    try {
        bytes = readFileSync(join(dir, name));
    }
    catch {
        throw new PackError(`pack: required file ${name} is missing or unreadable in ${dir}`);
    }
    try {
        return JSON.parse(bytes.toString("utf8"));
    }
    catch {
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
export function readGamePack(dir) {
    const manifest = readJson(dir, "manifest.json");
    if (manifest.pack !== "worldforge-game-pack") {
        throw new PackError(`pack: manifest.pack is ${String(manifest.pack)}; expected worldforge-game-pack`);
    }
    if (manifest.packFormat !== SUPPORTED_PACK_FORMAT) {
        throw new PackError(`pack: unsupported packFormat ${String(manifest.packFormat)}; this reader supports format ${SUPPORTED_PACK_FORMAT}`);
    }
    if (manifest.artifactFormat !== SUPPORTED_ARTIFACT_FORMAT) {
        throw new PackError(`pack: unsupported artifactFormat ${String(manifest.artifactFormat)}; this reader supports format ${SUPPORTED_ARTIFACT_FORMAT}`);
    }
    const files = manifest.files;
    if (files === undefined || typeof files !== "object") {
        throw new PackError("pack: manifest.files table is missing");
    }
    for (const [name, expected] of Object.entries(files)) {
        let bytes;
        try {
            bytes = readFileSync(join(dir, name));
        }
        catch {
            throw new PackError(`pack: payload file ${name} listed in manifest.files is missing`);
        }
        const actual = sha256Hex(bytes);
        if (actual !== expected) {
            throw new PackError(`pack: payload file ${name} hash mismatch (expected ${expected}, got ${actual})`);
        }
    }
    const worldHash = files["world.json"];
    if (worldHash === undefined || manifest.baseArtifactSha256 !== worldHash) {
        throw new PackError(`pack: baseArtifactSha256 ${String(manifest.baseArtifactSha256)} does not equal files["world.json"] ${String(worldHash)}`);
    }
    const report = readJson(dir, "validation-report.json");
    if (report.status !== "pass") {
        throw new PackError(`pack: validation-report status is ${String(report.status)}; refusing anything but "pass"`);
    }
    const artifact = readJson(dir, "world.json");
    if (artifact.formatVersion !== manifest.artifactFormat) {
        throw new PackError(`pack: world.formatVersion ${String(artifact.formatVersion)} does not match manifest.artifactFormat ${manifest.artifactFormat}`);
    }
    const manifestIdentity = manifest.generator?.generationIdentitySha256;
    const artifactIdentity = artifact.generator?.generationIdentitySha256;
    if (manifestIdentity === undefined || manifestIdentity !== artifactIdentity) {
        throw new PackError("pack: manifest and artifact disagree on generationIdentitySha256");
    }
    const walkability = readJson(dir, "walkability.json");
    if (walkability.walkabilityFormat !== SUPPORTED_WALKABILITY_FORMAT) {
        throw new PackError(`pack: unsupported walkabilityFormat ${String(walkability.walkabilityFormat)}; this reader supports format ${SUPPORTED_WALKABILITY_FORMAT}`);
    }
    if (walkability.encoding !== WALKABILITY_ENCODING) {
        throw new PackError(`pack: unsupported walkability encoding ${String(walkability.encoding)}`);
    }
    const dims = manifest.dimensions;
    if (dims === undefined || walkability.width !== dims.width || walkability.height !== dims.height) {
        throw new PackError("pack: walkability dimensions do not match manifest dimensions");
    }
    const summary = manifest.walkability;
    if (summary === undefined ||
        walkability.floodCount !== summary.floodCount ||
        walkability.spawnCell?.[0] !== summary.spawnCell[0] ||
        walkability.spawnCell?.[1] !== summary.spawnCell[1]) {
        throw new PackError("pack: walkability.json and manifest.walkability disagree on floodCount or spawnCell");
    }
    return {
        dir,
        manifest: manifest,
        artifact: artifact,
        walkability: walkability,
        report: report,
    };
}
