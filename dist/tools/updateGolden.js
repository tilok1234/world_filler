import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../src/core/canonicalJson.js";
import { combine32, fold53, hashCell32, hashString32, mix32 } from "../src/core/hash.js";
import { Channel } from "../src/core/channel.js";
import { repoRoot } from "../src/core/guard.js";
/**
 * Re-record the kernel golden vectors. Running this is an explicit,
 * logged decision: it redefines the deterministic identity of every
 * stream the director will ever draw. Commit messages must say why.
 */
const MIX_INPUTS = [0, 1, 2, 0x7fffffff, 0xdeadbeef, 0xffffffff];
const COMBINE_INPUTS = [
    [0, 0], [1, 2], [2, 1], [0xdeadbeef, 0x12345678], [0xffffffff, 0xffffffff],
];
const STRING_INPUTS = ["", "world", "region.14", "boss", "territory", "µ-unicode-Δ"];
const FOLD_INPUTS = [0, 1, 103991, 4294967296, 9007199254740991];
const CELL_INPUTS = [
    [1, 0, 0, 0], [1, 1, 0, 0], [1, 0, 1, 0], [1, 0, 0, 1], [103991, 240, 125, 7],
];
const root = Channel.root(103991);
const chain = ["region.14", "boss", "0"];
const channels = [{ path: root.path, seed: root.seed }];
let cursor = root;
for (const segment of chain) {
    cursor = cursor.child(segment);
    channels.push({ path: cursor.path, seed: cursor.seed });
}
const draws = {
    u32: Array.from({ length: 8 }, (_, i) => cursor.u32(i)),
    int10: Array.from({ length: 8 }, (_, i) => cursor.int(i, 10)),
    weighted_45_30_20_5: Array.from({ length: 8 }, (_, i) => cursor.weightedIndex([45, 30, 20, 5], i)),
    shuffle_abcdefgh: cursor.shuffle(["a", "b", "c", "d", "e", "f", "g", "h"]),
};
const vectors = {
    goldenFormat: 1,
    mix32: MIX_INPUTS.map((input) => [input, mix32(input)]),
    combine32: COMBINE_INPUTS.map(([a, b]) => [a, b, combine32(a, b)]),
    hashString32: Object.fromEntries(STRING_INPUTS.map((text) => [text, hashString32(text)])),
    fold53: FOLD_INPUTS.map((input) => [input, fold53(input)]),
    hashCell32: CELL_INPUTS.map(([seed, x, y, salt]) => [seed, x, y, salt, hashCell32(seed, x, y, salt)]),
    channels,
    draws,
};
const goldenDir = join(repoRoot(), "fixtures", "golden");
mkdirSync(goldenDir, { recursive: true });
writeFileSync(join(goldenDir, "kernel.json"), canonicalJson(vectors));
console.log(`recorded ${join(goldenDir, "kernel.json")}`);
