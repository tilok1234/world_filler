import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { repoRoot } from "../src/core/guard.js";

/**
 * F8 viewer contract pins, ported from the archived parallel line (tag
 * archive/claude/freeze-review-resolution-tf6bkf): the viewer is a
 * single self-contained file (no external resources, no build step) and
 * read-only by contract (no network, no persistence, no writes). These
 * are string-level pins, not a browser test. Designer ruling 2026-07-30
 * (Tier 1, planning notes/sessions/2026-07-30.md): the viewer adopts
 * the refusing run decoder — row-crossing territory runs are refused by
 * name exactly like the format-1 reference verifiers, never drawn
 * permissively; the refusal is pinned below.
 */

const html = readFileSync(join(repoRoot(), "viewer", "worldfiller-viewer.html"), "utf8");

describe("viewer contract", () => {
  it("is a single self-contained file with no external references", () => {
    assert.match(html, /^<!doctype html>/i);
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
    // The exact format-1 reader boundary rule, as the reference
    // implementations state it (designer ruling 2026-07-30).
    assert.match(html, /x \+ length > width/, "the viewer's run decoder must refuse row-crossing runs");
    assert.match(html, /runs never cross rows/, "the refusal must name the reference rule");
    assert.match(html, /run #/, "the refusal must name the offending run index");
    assert.match(html, /territoryError/, "an illegal run must surface as an on-page error, not a silent skip");
    assert.match(html, /does not match its runs/, "the decoder must refuse a cellCount that disagrees with the decoded distinct cells");
  });
});
