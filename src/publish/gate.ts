import { execFileSync } from "node:child_process";

/**
 * The publish gate (planning doc 18 §4.1, ruled for every producer
 * repo): a pack export REFUSES to run when the source tree is not a
 * committed, pushed state — `git status --porcelain` must be empty and
 * HEAD must be reachable from at least one remote branch
 * (`git branch -r --contains HEAD`). Packs must be reproducible from a
 * pushed commit; this is the check that catches "artifact built from a
 * commit that exists nowhere" at the source. The remote-branch check
 * reads only local remote-tracking refs, so it works offline and never
 * claims more than "pushed as of the last fetch".
 */

export class PublishGateError extends Error {
  readonly remedy: string;
  constructor(reason: string, remedy: string) {
    super(reason);
    this.remedy = remedy;
  }
}

export interface PublishProvenance {
  /** The commit every byte of the pack is reproducible from. */
  readonly sourceCommit: string;
  /** Remote branches (refs/remotes/…) that already carry sourceCommit. */
  readonly remoteBranches: readonly string[];
}

function git(repoDir: string, args: readonly string[]): string {
  return execFileSync("git", ["-C", repoDir, ...args], { encoding: "utf8", stdio: "pipe" });
}

/** Refuses (PublishGateError) unless repoDir is clean and pushed. */
export function assertPublishable(repoDir: string): PublishProvenance {
  let sourceCommit = "";
  try {
    sourceCommit = git(repoDir, ["rev-parse", "HEAD"]).trim();
  } catch {
    throw new PublishGateError(
      `${repoDir} is not a git checkout (or git is unavailable)`,
      "packs must be reproducible from a pushed commit — export from a git clone of the repository",
    );
  }

  const dirty = git(repoDir, ["status", "--porcelain"])
    .split("\n")
    .map((line) => line.trimEnd())
    .filter((line) => line.length > 0);
  if (dirty.length > 0) {
    const shown = dirty.slice(0, 5).join(", ");
    throw new PublishGateError(
      `the working tree has ${dirty.length} uncommitted change${dirty.length === 1 ? "" : "s"} (${shown}${dirty.length > 5 ? ", …" : ""})`,
      "commit (or stash) everything first — a pack from a dirty tree is reproducible from no commit",
    );
  }

  const remoteBranches = git(repoDir, ["branch", "-r", "--contains", "HEAD"])
    .split("\n")
    .map((line) => line.replace(/^\*?\s*/, "").trimEnd())
    .filter((line) => line.length > 0 && !line.includes("->"));
  if (remoteBranches.length === 0) {
    throw new PublishGateError(
      `HEAD (${sourceCommit.slice(0, 12)}) is not on any pushed branch`,
      "push first — consumers must be able to fetch the exact source of every pack",
    );
  }

  return { sourceCommit, remoteBranches };
}
