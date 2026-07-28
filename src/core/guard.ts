import { existsSync, readFileSync } from "node:fs";
import { delimiter, dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

/**
 * Output-path guard: World Filler writes only inside roots it owns.
 * Allowed: `<repoRoot>/outputs` (plus roots listed in the
 * WORLD_FILLER_EXTRA_OUT_ROOTS environment variable, delimiter-separated).
 * Any path that resolves into an upstream checkout (a directory owned by
 * a `worldforge` package) or anywhere else inside this repository —
 * source, fixtures, docs, the frozen reference verifiers in consumers/,
 * build output, node_modules — is refused with a named error. Inside the
 * repo, outputs/ is the ONLY writable tree (the freeze review found the
 * previous deny-list left consumers/ and dist/ writable).
 */

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
  return raw.split(delimiter).filter((entry) => entry !== "").map((entry) => resolve(entry));
}

/** True when `candidate` is inside `root` (strictly; not the root itself). */
function isInside(root: string, candidate: string): boolean {
  const rel = relative(root, candidate);
  return rel !== "" && !rel.startsWith("..") && !isAbsolute(rel);
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
  if (isInside(root, absolute)) {
    const outputsRoot = join(root, "outputs");
    if (absolute === outputsRoot || isInside(outputsRoot, absolute)) return absolute;
    const first = relative(root, absolute).split(sep)[0] as string;
    throw new Error(
      `guard: refusing output root ${absolute}: ${first}/ is a protected repository tree, use outputs/`,
    );
  }

  for (const extra of extraOutRoots()) {
    if (absolute === extra || isInside(extra, absolute)) return absolute;
  }

  throw new Error(
    `guard: refusing output root ${absolute}: outside world-filler-owned roots ` +
      `(use ${join(root, "outputs")} or add the root to WORLD_FILLER_EXTRA_OUT_ROOTS)`,
  );
}
