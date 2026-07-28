import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { repoRoot } from "../src/core/guard.js";

/**
 * Structural determinism hygiene: sources of hidden nondeterminism are
 * banned from src/ and tools/ as text, not just by convention. A legal
 * future use requires an explicit allowlist entry here — which makes it a
 * reviewed decision.
 */

const FORBIDDEN: ReadonlyArray<{ readonly pattern: RegExp; readonly why: string }> = [
  { pattern: /Math\.random/, why: "process-global randomness" },
  { pattern: /Date\.now/, why: "wall-clock time" },
  { pattern: /new Date\(/, why: "wall-clock time" },
  { pattern: /performance\.now/, why: "timer" },
  { pattern: /hrtime/, why: "timer" },
  { pattern: /Math\.(sin|cos|tan|atan2?|exp|log|pow|sqrt|cbrt)\(/, why: "platform transcendental as generation primitive" },
  { pattern: /toLocale/, why: "locale-dependent formatting" },
  { pattern: /Intl\./, why: "locale-dependent formatting" },
];

function sourceFiles(dir: string): string[] {
  const files: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) files.push(...sourceFiles(path));
    else if (entry.name.endsWith(".ts")) files.push(path);
  }
  return files;
}

describe("determinism hygiene", () => {
  const root = repoRoot();
  const files = [...sourceFiles(join(root, "src")), ...sourceFiles(join(root, "tools"))];

  it("scans a plausible number of source files", () => {
    assert.ok(files.length >= 8, `only found ${files.length} source files`);
  });

  for (const { pattern, why } of FORBIDDEN) {
    it(`bans ${pattern.source} (${why})`, () => {
      const offenders = files.filter((file) => pattern.test(readFileSync(file, "utf8")));
      assert.deepEqual(
        offenders.map((file) => relative(root, file)),
        [],
        `forbidden pattern ${pattern.source} found`,
      );
    });
  }
});
