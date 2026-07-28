import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { combine32, fold53, hashCell32, hashString32, mix32 } from "../src/core/hash.js";
import { Channel } from "../src/core/channel.js";
import { repoRoot } from "../src/core/guard.js";

/**
 * The committed golden vectors ARE the kernel's identity: these tests
 * recompute every primitive and compare exactly. If a vector changes, the
 * deterministic identity of every stream changed — that is a reviewed,
 * explicit decision (tools/updateGolden), never a drive-by.
 */

interface GoldenVectors {
  readonly goldenFormat: number;
  readonly mix32: ReadonlyArray<readonly [number, number]>;
  readonly combine32: ReadonlyArray<readonly [number, number, number]>;
  readonly hashString32: Readonly<Record<string, number>>;
  readonly fold53: ReadonlyArray<readonly [number, number]>;
  readonly hashCell32: ReadonlyArray<readonly [number, number, number, number, number]>;
  readonly channels: ReadonlyArray<{ readonly path: string; readonly seed: number }>;
  readonly draws: {
    readonly u32: readonly number[];
    readonly int10: readonly number[];
    readonly weighted_45_30_20_5: readonly number[];
    readonly shuffle_abcdefgh: readonly string[];
  };
}

const golden = JSON.parse(
  readFileSync(join(repoRoot(), "fixtures", "golden", "kernel.json"), "utf8"),
) as GoldenVectors;

describe("hash kernel golden vectors", () => {
  it("mix32", () => {
    for (const [input, expected] of golden.mix32) assert.equal(mix32(input), expected);
  });

  it("combine32", () => {
    for (const [a, b, expected] of golden.combine32) assert.equal(combine32(a, b), expected);
  });

  it("hashString32 (UTF-8, unicode included)", () => {
    for (const [text, expected] of Object.entries(golden.hashString32)) {
      assert.equal(hashString32(text), expected);
    }
  });

  it("fold53", () => {
    for (const [input, expected] of golden.fold53) assert.equal(fold53(input), expected);
    assert.throws(() => fold53(-1), /non-negative safe integer/);
    assert.throws(() => fold53(0.5), /non-negative safe integer/);
  });

  it("hashCell32", () => {
    for (const [seed, x, y, salt, expected] of golden.hashCell32) {
      assert.equal(hashCell32(seed, x, y, salt), expected);
    }
  });

  it("channel derivation chain", () => {
    let channel = Channel.root(103991);
    const recorded = [...golden.channels];
    const first = recorded.shift();
    assert.deepEqual({ path: channel.path, seed: channel.seed }, first);
    for (const expected of recorded) {
      const segment = expected.path.split("/").pop() as string;
      channel = channel.child(segment);
      assert.deepEqual({ path: channel.path, seed: channel.seed }, expected);
    }
  });

  it("indexed draws", () => {
    const channel = Channel.root(103991).at("region.14", "boss", "0");
    assert.deepEqual(Array.from({ length: 8 }, (_, i) => channel.u32(i)), golden.draws.u32);
    assert.deepEqual(Array.from({ length: 8 }, (_, i) => channel.int(i, 10)), golden.draws.int10);
    assert.deepEqual(
      Array.from({ length: 8 }, (_, i) => channel.weightedIndex([45, 30, 20, 5], i)),
      golden.draws.weighted_45_30_20_5,
    );
    assert.deepEqual(channel.shuffle(["a", "b", "c", "d", "e", "f", "g", "h"]), golden.draws.shuffle_abcdefgh);
  });
});

describe("channel independence", () => {
  it("sibling derivation order changes nothing", () => {
    const rootA = Channel.root(7).child("a");
    const before = Array.from({ length: 4 }, (_, i) => rootA.u32(i));
    const parent = Channel.root(7);
    parent.child("z");
    parent.child("b");
    const again = parent.child("a");
    assert.deepEqual(Array.from({ length: 4 }, (_, i) => again.u32(i)), before);
  });

  it("distinct paths give distinct streams (order matters, names matter)", () => {
    const parent = Channel.root(7);
    const ab = parent.at("a", "b");
    const ba = parent.at("b", "a");
    const c = parent.child("c");
    assert.notEqual(ab.seed, ba.seed);
    assert.notEqual(ab.u32(0), ba.u32(0));
    assert.notEqual(ab.u32(0), c.u32(0));
  });

  it("draws are stateless and index-addressed", () => {
    const channel = Channel.root(9).child("x");
    const later = channel.u32(5);
    const earlier = channel.u32(2);
    assert.equal(channel.u32(5), later);
    assert.equal(channel.u32(2), earlier);
  });

  it("rejects invalid segments, ranges, and weights", () => {
    const channel = Channel.root(1);
    assert.throws(() => channel.child("a/b"), /invalid segment/);
    assert.throws(() => channel.child(""), /invalid segment/);
    assert.throws(() => channel.int(0, 0), /maxExclusive/);
    assert.throws(() => channel.int(0, 2 ** 22), /maxExclusive/);
    assert.throws(() => channel.weightedIndex([0, 0], 0), /weight total/);
    assert.throws(() => channel.weightedIndex([-1, 2], 0), /non-negative integers/);
    assert.throws(() => channel.pick([], 0), /empty list/);
  });

  it("weighted picks land inside bounds and cover all weighted entries", () => {
    const channel = Channel.root(11).child("w");
    const weights = [45, 30, 20, 5];
    const seen = new Set<number>();
    for (let i = 0; i < 400; i += 1) {
      const pick = channel.weightedIndex(weights, i);
      assert.ok(pick >= 0 && pick < weights.length);
      seen.add(pick);
    }
    assert.equal(seen.size, weights.length);
  });
});
