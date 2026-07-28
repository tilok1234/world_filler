import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { repoRoot } from "../src/core/guard.js";
import { verifyContentPack, VerifyError } from "../src/consume/verifyPack.js";
/**
 * F7 exit criteria at the CLI boundary: export twice -> byte-identical;
 * tampering any payload fails the verifier; mismatched world/content
 * pairs refuse; a failing gate refuses the export entirely.
 */
const CLI = join(repoRoot(), "dist", "src", "cli.js");
const FEN = join(repoRoot(), "fixtures", "packs", "fen-hollow");
const DUST = join(repoRoot(), "fixtures", "packs", "dust-hollow");
const RECIPE = join(repoRoot(), "fixtures", "recipes", "basic-direction.json");
function runCli(args, extraRoots) {
    try {
        const stdout = execFileSync(process.execPath, [CLI, ...args], {
            encoding: "utf8",
            env: { ...process.env, WORLD_FILLER_EXTRA_OUT_ROOTS: extraRoots },
        });
        return { status: 0, stdout, stderr: "" };
    }
    catch (error) {
        const failure = error;
        return { status: failure.status ?? -1, stdout: failure.stdout ?? "", stderr: failure.stderr ?? "" };
    }
}
describe("content pack export", () => {
    it("exports byte-identically, verifies, and survives the full consumption proof", () => {
        const base = mkdtempSync(join(tmpdir(), "wf-export-"));
        try {
            const outA = join(base, "a");
            const outB = join(base, "b");
            const runA = runCli(["export", FEN, RECIPE, outA], base);
            assert.equal(runA.status, 0, runA.stderr);
            const runB = runCli(["export", FEN, RECIPE, outB], base);
            assert.equal(runB.status, 0, runB.stderr);
            for (const name of ["manifest.json", "content-plan.json", "placements.json", "territories.json", "report.json", "view.html"]) {
                assert.equal(readFileSync(join(outA, name), "utf8"), readFileSync(join(outB, name), "utf8"), `${name} byte-identical across exports`);
            }
            // The baked inspector is self-contained: data embedded, slot filled.
            const view = readFileSync(join(outA, "view.html"), "utf8");
            assert.ok(view.includes("window.WF_EMBEDDED = "), "view.html embeds the pack data");
            assert.ok(!view.includes("WF_EMBED_SLOT"), "the embed slot was replaced");
            assert.ok(view.includes("basic-direction"), "embedded data carries the recipe identity");
            const manifest = JSON.parse(readFileSync(join(outA, "manifest.json"), "utf8"));
            assert.equal(manifest.packFormat, 1);
            assert.deepEqual(Object.keys(manifest.files).sort(), ["content-plan.json", "placements.json", "report.json", "territories.json"], "manifest lists exactly the payload files, never itself or renders");
            const summary = verifyContentPack(FEN, outA);
            assert.ok(summary.placements >= 1);
            assert.ok(summary.territories >= 1);
            const cliVerify = runCli(["verify-pack", FEN, outA], base);
            assert.equal(cliVerify.status, 0, cliVerify.stderr);
            assert.match(cliVerify.stdout, /verify-pack: OK/);
        }
        finally {
            rmSync(base, { recursive: true, force: true });
        }
    });
    it("refuses tampered payloads and mismatched world/content pairs", () => {
        const base = mkdtempSync(join(tmpdir(), "wf-export-bad-"));
        try {
            const out = join(base, "pack");
            assert.equal(runCli(["export", FEN, RECIPE, out], base).status, 0);
            const tampered = join(base, "tampered");
            cpSync(out, tampered, { recursive: true });
            const placements = readFileSync(join(tampered, "placements.json"), "utf8");
            writeFileSync(join(tampered, "placements.json"), placements.replace('"draw": ', '"draw":  '));
            assert.throws(() => verifyContentPack(FEN, tampered), (error) => {
                assert.ok(error instanceof VerifyError);
                assert.match(error.message, /placements\.json hash mismatch/);
                return true;
            });
            assert.throws(() => verifyContentPack(DUST, out), /directed against base .* but the world pack is/);
        }
        finally {
            rmSync(base, { recursive: true, force: true });
        }
    });
    it("refuses a stale base pin before any write, strict or not", () => {
        const base = mkdtempSync(join(tmpdir(), "wf-export-gate-"));
        try {
            const staleRecipe = join(base, "stale.json");
            writeFileSync(staleRecipe, JSON.stringify({
                recipeFormat: 1,
                name: "stale-pin",
                directorSeed: 1,
                base: { generationIdentitySha256: "0".repeat(64) },
            }));
            const out = join(base, "pack");
            for (const args of [
                ["export", FEN, staleRecipe, out, "--strict"],
                ["export", FEN, staleRecipe, out],
            ]) {
                const run = runCli(args, base);
                assert.notEqual(run.status, 0);
                assert.match(run.stderr, /export: refusing — recipe pins base/);
                assert.throws(() => readdirSync(out), /ENOENT/);
            }
        }
        finally {
            rmSync(base, { recursive: true, force: true });
        }
    });
});
