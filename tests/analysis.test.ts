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
import { segmentRegions } from "../src/analysis/regions.js";
import { makeArtifact, setLayer, setMaterial } from "./helpers/syntheticWorld.js";

describe("spatial analysis", () => {
  const pack = readGamePack(join(repoRoot(), "fixtures", "packs", "fen-hollow"));

  it("is deterministic: two runs produce identical summaries and field hashes", () => {
    const first = analyzeWorld(new WorldModel(pack.artifact, pack.adapterElev));
    const second = analyzeWorld(new WorldModel(pack.artifact, pack.adapterElev));
    assert.equal(canonicalJson(first.summary), canonicalJson(second.summary));
  });

  it("passes spot asserts on a real world", () => {
    const model = new WorldModel(pack.artifact, pack.adapterElev);
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
    const bundle = analyzeWorld(new WorldModel(pack.artifact, pack.adapterElev));
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
    const model = new WorldModel(pack.artifact, pack.adapterElev);
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

describe("walkability-aware segmentation (sl-0026)", () => {
  // The regression case named by the ruling: a route-crossing ford is
  // walkable ground on a void material. It must belong to a region and
  // bridge the two banks in adjacency, while the unwalkable river cells
  // around it (same material) and unwalkable rock stay void.
  it("regions a route-crossing ford and bridges the banks; blocked river and rock stay void", () => {
    const artifact = makeArtifact();
    for (let y = 0; y < 8; y += 1) {
      setMaterial(artifact, 4, y, "water.shallow");
      setLayer(artifact, "river", 4, y, 1);
    }
    artifact.routes.push({
      id: 0,
      routeClass: "route",
      from: [0, 4],
      to: [7, 4],
      length: 8,
      crossings: [{ cell: [4, 4], kind: "ford" }],
    });
    setMaterial(artifact, 1, 1, "water.shallow");
    setMaterial(artifact, 2, 1, "water.shallow");
    setMaterial(artifact, 6, 6, "terrain.rock");

    const model = new WorldModel(artifact);
    assert.equal(model.classifyCell(4, 4), "crossing_route_walk");
    assert.equal(model.classifyCell(4, 3), "river_stream_block");
    assert.equal(model.classifyCell(1, 1), "shallow_wade");

    const { regions, labels } = segmentRegions(model);
    const at = (x: number, y: number): number => labels[y * 8 + x] as number;

    const west = at(0, 0);
    const east = at(7, 0);
    assert.ok(west >= 0 && east >= 0 && west !== east, "river still separates the banks");

    const ford = at(4, 4);
    assert.ok(ford >= 0, "ford cell belongs to a region");
    const fordRegion = regions[ford];
    assert.ok(fordRegion !== undefined);
    assert.equal(fordRegion.biome, "water.shallow");
    assert.equal(fordRegion.id, "region.shallow.36");
    const westId = regions[west]?.id as string;
    const eastId = regions[east]?.id as string;
    assert.ok(
      fordRegion.neighborIds.includes(westId) && fordRegion.neighborIds.includes(eastId),
      `ford bridges both banks in adjacency: ${JSON.stringify(fordRegion.neighborIds)}`,
    );

    for (let y = 0; y < 8; y += 1) {
      if (y === 4) continue;
      assert.equal(at(4, y), -1, `blocked river cell (4, ${y}) stays void`);
    }
    assert.equal(at(6, 6), -1, "unwalkable rock stays void");

    const pool = at(1, 1);
    assert.ok(pool >= 0 && pool === at(2, 1) && pool !== ford, "wadeable pool is its own shallow region");
    assert.equal(regions[pool]?.biome, "water.shallow");
  });

  it("on a real fixture, void-material cells are regioned exactly when walkable", () => {
    const pack = readGamePack(join(repoRoot(), "fixtures", "packs", "fen-hollow"));
    const model = new WorldModel(pack.artifact, pack.adapterElev);
    const { labels } = segmentRegions(model);
    const voidMaterials = new Set(["water.deep", "water.shallow", "terrain.rock"]);
    const { width, height } = model.dimensions;
    let walkableVoidCells = 0;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        if (!voidMaterials.has(model.materialAt(x, y))) continue;
        const label = labels[y * width + x] as number;
        if (model.walkableAt(x, y)) {
          walkableVoidCells += 1;
          assert.ok(label >= 0, `walkable ${model.materialAt(x, y)} at (${x}, ${y}) must be regioned`);
        } else {
          assert.equal(label, -1, `unwalkable ${model.materialAt(x, y)} at (${x}, ${y}) must stay void`);
        }
      }
    }
    assert.ok(walkableVoidCells > 0, "fixture exercises the rule (fords/wades/piers exist)");
  });

  it("subdivides oversized patches with organic watershed seams (analysis 4)", () => {
    // 64x64 all-grass monolith: 4096 cells force recursive splits.
    const artifact = makeArtifact(64);
    const model = new WorldModel(artifact);
    const { regions, labels } = segmentRegions(model);

    assert.ok(regions.length >= 4, `4096 cells need >= 4 parts, got ${regions.length}`);
    for (const region of regions) {
      assert.ok(region.cellCount <= 1024, `${region.id} holds ${region.cellCount} > 1024 cells`);
    }

    // Every walkable cell labeled; every part 4-connected.
    const cellsByLabel = new Map<number, number[]>();
    for (let index = 0; index < 64 * 64; index += 1) {
      const label = labels[index] as number;
      assert.ok(label >= 0, `cell ${index} left unlabeled`);
      const list = cellsByLabel.get(label);
      if (list === undefined) cellsByLabel.set(label, [index]);
      else list.push(index);
    }
    for (const [label, cells] of cellsByLabel) {
      const members = new Set(cells);
      const seen = new Set<number>([cells[0] as number]);
      const queue = [cells[0] as number];
      for (let head = 0; head < queue.length; head += 1) {
        const index = queue[head] as number;
        const x = index % 64;
        for (const next of [index - 64, index + 64, index - 1, index + 1]) {
          if (next < 0 || next >= 64 * 64) continue;
          if ((next === index - 1 && x === 0) || (next === index + 1 && x === 63)) continue;
          if (members.has(next) && !seen.has(next)) {
            seen.add(next);
            queue.push(next);
          }
        }
      }
      assert.equal(seen.size, cells.length, `region label ${label} is disconnected`);
    }

    // The seam is the watershed equidistance contour, not the old
    // bounding-box midline: on a uniform square the first bisection cut
    // every cell of one straight column/row; no watershed part may have
    // a perfectly straight full-length border on BOTH of its seam sides.
    // Cheap proxy: parts must not all be axis-aligned rectangles.
    const rectangular = regions.filter((region) => {
      const w = region.bounds.x1 - region.bounds.x0 + 1;
      const h = region.bounds.y1 - region.bounds.y0 + 1;
      return w * h === region.cellCount;
    });
    assert.ok(
      rectangular.length < regions.length,
      "every part is a perfect rectangle — seams are still midline cuts",
    );

    // Deterministic: a second run reproduces labels exactly.
    const again = segmentRegions(new WorldModel(makeArtifact(64)));
    assert.deepEqual(Array.from(again.labels), Array.from(labels));
    assert.deepEqual(
      again.regions.map((region) => region.id),
      regions.map((region) => region.id),
    );
  });
});
