import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readGamePack } from "../src/pack/readPack.js";
import { WorldModel } from "../src/world/model.js";
import { analyzeWorld, readAnalysisSummary, writeAnalysisSummary } from "../src/analysis/analyze.js";
import { UNREACHABLE } from "../src/analysis/fields.js";
import { canonicalJson } from "../src/core/canonicalJson.js";
import { repoRoot } from "../src/core/guard.js";
import { encodePng } from "../src/render/png.js";
import { renderAnalysis } from "../src/render/heatmaps.js";
import { makeArtifact, setMaterial } from "./helpers/syntheticWorld.js";

describe("spatial analysis", () => {
  const pack = readGamePack(join(repoRoot(), "fixtures", "packs", "fen-hollow"));

  it("is deterministic: two runs produce identical summaries and field hashes", () => {
    const first = analyzeWorld(new WorldModel(pack.artifact));
    const second = analyzeWorld(new WorldModel(pack.artifact));
    assert.equal(canonicalJson(first.summary), canonicalJson(second.summary));
  });

  it("passes spot asserts on a real world", () => {
    const model = new WorldModel(pack.artifact);
    const bundle = analyzeWorld(model);
    const { width } = model.dimensions;
    const [sx, sy] = bundle.summary.spawnCell;

    assert.equal(bundle.distanceFromSpawn[sy * width + sx], 0, "spawn cell distance from spawn must be 0");

    let roadZero = 0;
    let corridorOnWalkable = true;
    let clearanceConsistent = true;
    for (let i = 0; i < width * width; i += 1) {
      if (bundle.distanceFromRoads[i] === 0) roadZero += 1;
      if (bundle.corridor[i] === 1 && bundle.bits[i] !== 1) corridorOnWalkable = false;
      const clear = bundle.clearance[i] as number;
      if (bundle.bits[i] === 1 && clear < 1) clearanceConsistent = false;
      if (bundle.bits[i] === 0 && clear !== 0) clearanceConsistent = false;
    }
    assert.ok(roadZero > 0, "some walkable cells sit on roads/trails (distance 0)");
    assert.ok(corridorOnWalkable, "corridor cells are walkable cells");
    assert.ok(clearanceConsistent, "clearance is >=1 exactly on walkable cells");

    for (const settlement of model.settlements) {
      const [ax, ay] = settlement.anchor;
      assert.equal(bundle.safeZone[ay * width + ax], 1, `settlement anchor (${ax}, ${ay}) inside safe zone`);
    }

    const spawnComponent = bundle.summary.components.spawnComponent;
    assert.ok(spawnComponent >= 0);
    const spawnSize = bundle.summary.components.sizes[spawnComponent] as number;
    assert.equal(spawnSize, pack.walkability.floodCount, "spawn component size equals the pack flood count");
  });

  it("separates detached landmasses into components and keeps them unreachable", () => {
    const artifact = makeArtifact();
    // Left island columns 0-2, right island columns 5-7, deep water between.
    for (let y = 0; y < 8; y += 1) {
      for (let x = 3; x < 5; x += 1) setMaterial(artifact, x, y, "water.deep");
    }
    const model = new WorldModel(artifact);
    const bundle = analyzeWorld(model);
    assert.equal(bundle.summary.components.count, 2, "two walkable components");
    assert.equal(bundle.summary.components.spawnComponent, 0);
    assert.deepEqual(bundle.summary.components.sizes, [24, 24]);
    // Right island is unreachable from spawn.
    assert.equal(bundle.distanceFromSpawn[0 * 8 + 6], UNREACHABLE);
    // Regions: two grass patches, not adjacent (water is void, connects nothing).
    assert.equal(bundle.summary.regionCount, 2);
    for (const region of bundle.regions) {
      assert.deepEqual(region.neighborIds, []);
      assert.equal(region.deadEndScore, 0);
    }
  });

  it("scores dead-end regions by adjacency degree", () => {
    const artifact = makeArtifact();
    // Three vertical biome bands: grass (x 0-2) | mud (x 3-4) | grass (x 5-7).
    for (let y = 0; y < 8; y += 1) {
      for (let x = 3; x < 5; x += 1) setMaterial(artifact, x, y, "terrain.mud");
    }
    const bundle = analyzeWorld(new WorldModel(artifact));
    assert.equal(bundle.summary.regionCount, 3);
    const byBiome = new Map(bundle.regions.map((region) => [`${region.biome}:${region.anchorIndex}`, region]));
    const left = byBiome.get("terrain.grass:0");
    const middle = byBiome.get("terrain.mud:3");
    const right = byBiome.get("terrain.grass:5");
    assert.ok(left !== undefined && middle !== undefined && right !== undefined);
    assert.equal(left.deadEndScore, 1);
    assert.equal(middle.deadEndScore, 2);
    assert.equal(right.deadEndScore, 1);
    assert.deepEqual(middle.neighborIds, [left.id, right.id].sort());
  });

  it("cache summary round-trips losslessly", () => {
    const bundle = analyzeWorld(new WorldModel(pack.artifact));
    const dir = mkdtempSync(join(tmpdir(), "wf-analysis-"));
    try {
      writeAnalysisSummary(dir, bundle.summary);
      const read = readAnalysisSummary(dir);
      assert.ok(read !== null);
      assert.equal(canonicalJson(read), canonicalJson(bundle.summary));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("renders every analysis layer as a valid PNG", () => {
    const model = new WorldModel(pack.artifact);
    const bundle = analyzeWorld(model);
    const maps = renderAnalysis(model, bundle);
    assert.equal(maps.length, 11);
    for (const map of maps) {
      const png = map.png;
      assert.deepEqual([...png.slice(0, 8)], [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a], `${map.name} signature`);
      const view = new DataView(png.buffer, png.byteOffset);
      assert.equal(view.getUint32(16), model.dimensions.width, `${map.name} IHDR width`);
      assert.equal(view.getUint32(20), model.dimensions.height, `${map.name} IHDR height`);
    }
  });

  it("png encoder validates input length", () => {
    assert.throws(() => encodePng(2, 2, new Uint8Array(15)), /expected 16 bytes/);
  });
});
