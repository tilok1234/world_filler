import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { canonicalJson } from "../src/core/canonicalJson.js";
import { combine32, fold53, hashCell32, hashString32, mix32 } from "../src/core/hash.js";
import { Channel } from "../src/core/channel.js";
import { repoRoot } from "../src/core/guard.js";
import { readGamePack } from "../src/pack/readPack.js";
import { WorldModel } from "../src/world/model.js";
import { analyzeWorld } from "../src/analysis/analyze.js";
import { normalizeRecipe } from "../src/recipe/schema.js";
import { compilePlan } from "../src/plan/plan.js";
import { solvePlacements } from "../src/place/solver.js";
import { growTerritories } from "../src/territory/territory.js";
import { runGates } from "../src/validate/validate.js";
import { buildContentPack } from "../src/export/export.js";

/**
 * Re-record the golden fixtures. Running this is an explicit, logged
 * decision. The kernel vectors redefine the deterministic identity of
 * every stream the director will ever draw; the golden content pack
 * redefines the frozen format-1 serialization tripwire (an accidental
 * field rename or type change fails the golden test — a deliberate
 * behavior bump re-records here). Commit messages must say why.
 */

const MIX_INPUTS = [0, 1, 2, 0x7fffffff, 0xdeadbeef, 0xffffffff];
const COMBINE_INPUTS: ReadonlyArray<readonly [number, number]> = [
  [0, 0], [1, 2], [2, 1], [0xdeadbeef, 0x12345678], [0xffffffff, 0xffffffff],
];
const STRING_INPUTS = ["", "world", "region.14", "boss", "territory", "µ-unicode-Δ"];
const FOLD_INPUTS = [0, 1, 103991, 4294967296, 9007199254740991];
const CELL_INPUTS: ReadonlyArray<readonly [number, number, number, number]> = [
  [1, 0, 0, 0], [1, 1, 0, 0], [1, 0, 1, 0], [1, 0, 0, 1], [103991, 240, 125, 7],
];

const root = Channel.root(103991);
const chain = ["region.14", "boss", "0"];
const channels: Array<{ path: string; seed: number }> = [{ path: root.path, seed: root.seed }];
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

// The golden content pack: fen-hollow directed by the fixture recipe,
// byte-for-byte. Pins the frozen format-1 serialization of all five
// files (the manifest's files table pins the payload hashes twice over).
const fenDir = join(repoRoot(), "fixtures", "packs", "fen-hollow");
const pack = readGamePack(fenDir);
const model = new WorldModel(pack.artifact, pack.adapterElev);
const recipe = normalizeRecipe(
  JSON.parse(readFileSync(join(repoRoot(), "fixtures", "recipes", "basic-direction.json"), "utf8")),
);
const bundle = analyzeWorld(model);
const plan = compilePlan(model, bundle, recipe);
const placements = solvePlacements(model, bundle, plan, recipe);
const territories = growTerritories(model, bundle, plan, placements, recipe);
const report = runGates({
  model, bundle, plan, placements, territories, recipe, strict: false,
  resolveAgain: () => {
    const again = solvePlacements(model, bundle, plan, recipe);
    return { placements: again, territories: growTerritories(model, bundle, plan, again, recipe) };
  },
});
const built = buildContentPack({
  model,
  worldName: "fen-hollow",
  baseArtifactSha256: pack.manifest.baseArtifactSha256,
  recipe,
  plan,
  placements,
  territories,
  report,
});
const goldenPackDir = join(goldenDir, "content-pack-fen-hollow");
mkdirSync(goldenPackDir, { recursive: true });
for (const [name, bytes] of built.files) {
  writeFileSync(join(goldenPackDir, name), bytes);
}
writeFileSync(join(goldenPackDir, "manifest.json"), canonicalJson(built.manifest));
console.log(`recorded ${goldenPackDir}`);
