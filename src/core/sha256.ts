import { createHash } from "node:crypto";

/** Lowercase hex SHA-256 of raw bytes — the pack/file identity convention. */
export function sha256Hex(bytes: Uint8Array | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}
