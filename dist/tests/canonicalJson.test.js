import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../src/core/canonicalJson.js";
import { repoRoot } from "../src/core/guard.js";
describe("canonical JSON", () => {
    it("sorts keys, indents by two spaces, and ends with one newline", () => {
        const text = canonicalJson({ b: 1, a: { d: [1, 2], c: null } });
        assert.equal(text, '{\n  "a": {\n    "c": null,\n    "d": [\n      1,\n      2\n    ]\n  },\n  "b": 1\n}\n');
    });
    it("renders empty containers compactly", () => {
        assert.equal(canonicalJson({}), "{}\n");
        assert.equal(canonicalJson([]), "[]\n");
    });
    it("refuses non-safe-integer numbers and undefined", () => {
        assert.throws(() => canonicalJson({ a: 0.5 }), /not a safe integer/);
        assert.throws(() => canonicalJson({ a: Number.NaN }), /not a safe integer/);
        assert.throws(() => canonicalJson({ a: Number.MAX_SAFE_INTEGER + 1 }), /not a safe integer/);
        assert.throws(() => canonicalJson({ a: undefined }), /undefined/);
    });
    /**
     * Round-trip proof against upstream: parsing an upstream canonical file
     * and re-serializing through our writer must reproduce the exact bytes.
     * This pins our serialization conventions to the upstream doctrine
     * without sharing any code.
     */
    const files = ["manifest.json", "world.json", "walkability.json", "validation-report.json", "normalized-recipe.json"];
    for (const pack of ["fen-hollow", "dust-hollow", "tiny-temperate"]) {
        it(`round-trips upstream canonical bytes: ${pack}`, () => {
            for (const name of files) {
                const path = join(repoRoot(), "fixtures", "packs", pack, name);
                const original = readFileSync(path, "utf8");
                const reserialized = canonicalJson(JSON.parse(original));
                assert.equal(reserialized, original, `${pack}/${name} did not round-trip byte-identically`);
            }
        });
    }
});
