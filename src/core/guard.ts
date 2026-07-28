import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";

/**
 * Output-path guard: World Filler writes only inside roots it owns.
 * Allowed: `<repoRoot>/outputs` (plus roots listed in the
 * WORLD_FILLER_EXTRA_OUT_ROOTS environment variable, path-separated).
 * Any path that resolves into an upstream checkout (a directory owned by
 * a `worldforge` package) or into this repository's source/fixture/doc
 * trees is refused with a named error.
 */

const PROTECTED_SUBDIRS = ["src", "tests", "docs", "fixtures", "schemas", ".git", "vendor"];

export function repoRoot(): string {
  let dir = resolve(import.meta.dirname ?? ".");
  while (true) {
    if (existsSync(join(dir, "package.json"))) {
      const name = packageName(join(dir, "package.json"));
      if (name === "world-filler") return dir;
    }
    const parent = dirname(dir);
    if (parent === dir) throw new Error("guard: cannot locate the world-filler repository root");
    dir = parent;
  }
}

function packageName(packageJsonPath: string): string | null {
  try {
    const parsed = JSON.parse(readFileSync(packageJsonPath, "utf8")) as { name?: unknown };
    return typeof parsed.name === "string" ? parsed.name : null;
  } catch {
    return null;
  }
}

function ancestorPackageNames(path: string): string[] {
  const names: string[] = [];
  let dir = resolve(path);
  while (true) {
    const candidate = join(dir, "package.json");
    if (existsSync(candidate)) {
      const name = packageName(candidate);
      if (name !== null) names.push(name);
    }
    const parent = dirname(dir);
    if (parent === dir) return names;
    dir = parent;
  }
}

export function extraOutRoots(): string[] {
  const raw = process.env["WORLD_FILLER_EXTRA_OUT_ROOTS"];
  if (raw === undefined || raw === "") return [];
  return raw.split(":").filter((entry) => entry !== "").map((entry) => resolve(entry));
}

/**
 * Resolve a requested output root or refuse with a named error.
 * The returned path is absolute and safe to create/write under.
 */
export function assertOutputRoot(requested: string): string {
  const absolute = isAbsolute(requested) ? resolve(requested) : resolve(process.cwd(), requested);

  for (const name of ancestorPackageNames(absolute)) {
    if (name === "worldforge") {
      throw new Error(
        `guard: refusing output root ${absolute}: it resolves into a WorldForge checkout (read-only upstream)`,
      );
    }
  }

  const root = repoRoot();
  if (absolute === root) {
    throw new Error(`guard: refusing output root ${absolute}: the repository root itself is not writable output`);
  }
  if (absolute.startsWith(root + "/")) {
    const relative = absolute.slice(root.length + 1);
    const first = relative.split("/")[0] as string;
    if (PROTECTED_SUBDIRS.includes(first)) {
      throw new Error(
        `guard: refusing output root ${absolute}: ${first}/ is a protected repository tree, use outputs/`,
      );
    }
    return absolute;
  }

  for (const extra of extraOutRoots()) {
    if (absolute === extra || absolute.startsWith(extra + "/")) return absolute;
  }

  throw new Error(
    `guard: refusing output root ${absolute}: outside world-filler-owned roots ` +
      `(use ${join(root, "outputs")} or add the root to WORLD_FILLER_EXTRA_OUT_ROOTS)`,
  );
}
