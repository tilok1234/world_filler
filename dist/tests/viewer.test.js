import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/core/guard.js";
/**
 * F8 viewer contract pins: viewer/index.html is a single self-contained
 * file (no external resources, no build step) and read-only by contract
 * (no network, no persistence, no writes). These are string-level pins,
 * not a browser test — the behavioral proof is a manual Playwright smoke
 * run documented in the F8 evidence.
 */
const html = readFileSync(join(repoRoot(), "viewer", "index.html"), "utf8");
describe("viewer contract", () => {
    it("is a single self-contained file with no external references", () => {
        assert.match(html, /^<!DOCTYPE html>/i);
        for (const banned of ['<script src', "<link ", "@import", "url(http", "https://", "http://"]) {
            assert.ok(!html.toLowerCase().includes(banned.toLowerCase()), `viewer must not contain "${banned}"`);
        }
    });
    it("is read-only by contract: no network, no persistence, no writes", () => {
        for (const banned of [
            "fetch(", "XMLHttpRequest", "WebSocket", "sendBeacon", "EventSource",
            "localStorage", "sessionStorage", "indexedDB", "document.cookie",
            "showSaveFilePicker", "createWritable",
        ]) {
            assert.ok(!html.includes(banned), `viewer must not use ${banned}`);
        }
    });
    it("decodes runs with the reference refusal semantics (no row wrapping)", () => {
        assert.match(html, /x \+ length > width/, "the viewer's decodeRuns must refuse row-crossing runs");
    });
});
