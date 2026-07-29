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
 * are string-level pins, not a browser test. The archived line also
 * pinned refusal semantics on the viewer's run decoding; this line's
 * viewer draws territory runs without that refusal path — a deliberate
 * behavioral difference recorded for the designer (2026-07-30 port),
 * not pinned here.
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
});
