import { strict as assert } from "node:assert";
import { describe, it } from "node:test";
import { WorldModel } from "../src/world/model.js";
import { makeArtifact, setLayer, setMaterial } from "./helpers/syntheticWorld.js";

/**
 * Fixture-independent unit tests for every walkability-ladder rung,
 * including branches real tiny worlds rarely exercise. Each test builds a
 * synthetic 8x8 world, pokes cells, and asserts the deciding rung.
 */

describe("walkability ladder", () => {
  it("walks plain grass and wades shallow water", () => {
    const artifact = makeArtifact();
    setMaterial(artifact, 3, 3, "water.shallow");
    const model = new WorldModel(artifact);
    assert.equal(model.classifyCell(1, 1), "default_walk");
    assert.equal(model.classifyCell(3, 3), "shallow_wade");
    assert.equal(model.walkableAt(3, 3), true);
  });

  it("blocks the three blocked materials, each with its own rung", () => {
    const artifact = makeArtifact();
    setMaterial(artifact, 1, 0, "water.deep");
    setMaterial(artifact, 2, 0, "terrain.rock");
    setMaterial(artifact, 3, 0, "terrain.swamp");
    const model = new WorldModel(artifact);
    assert.equal(model.classifyCell(1, 0), "material_block_deep_water");
    assert.equal(model.classifyCell(2, 0), "material_block_rock");
    assert.equal(model.classifyCell(3, 0), "material_block_swamp");
  });

  it("blocks both river tiers and lets trails walk over them", () => {
    const artifact = makeArtifact();
    setLayer(artifact, "river", 2, 2, 1);
    setLayer(artifact, "river", 3, 2, 2);
    setLayer(artifact, "river", 4, 2, 1);
    setLayer(artifact, "path", 4, 2, 1);
    const model = new WorldModel(artifact);
    assert.equal(model.classifyCell(2, 2), "river_stream_block");
    assert.equal(model.classifyCell(3, 2), "river_major_block");
    assert.equal(model.classifyCell(4, 2), "trail_walk");
  });

  it("walks piers and blocks fences", () => {
    const artifact = makeArtifact();
    setMaterial(artifact, 5, 5, "water.deep");
    setLayer(artifact, "pier", 5, 5, 1);
    setLayer(artifact, "fence", 6, 6, 1);
    const model = new WorldModel(artifact);
    assert.equal(model.classifyCell(5, 5), "pier_walk");
    assert.equal(model.classifyCell(6, 6), "fence_block");
  });

  it("blocks listed prop species and ignores unlisted species", () => {
    const artifact = makeArtifact();
    setLayer(artifact, "prop", 1, 1, 1); // prop.oak — blocking
    setLayer(artifact, "prop", 2, 1, 2); // prop.flowers — never blocks
    const model = new WorldModel(artifact);
    assert.equal(model.classifyCell(1, 1), "prop_block");
    assert.equal(model.classifyCell(2, 1), "default_walk");
  });

  it("walks recorded route-crossing cells over rivers", () => {
    const artifact = makeArtifact();
    setLayer(artifact, "river", 4, 4, 2);
    artifact.routes.push({
      id: 0,
      routeClass: "highway",
      from: [0, 4],
      to: [7, 4],
      length: 8,
      crossings: [{ cell: [4, 4], kind: "ford" }],
    });
    const model = new WorldModel(artifact);
    assert.equal(model.classifyCell(4, 4), "crossing_route_walk");
  });

  it("resolves pass cells through recorded footprints", () => {
    const artifact = makeArtifact();
    // cave_mouth footprint 2x1 at (3,3): pass cells [0, 1] — both walk.
    setLayer(artifact, "structure", 3, 3, 1);
    setLayer(artifact, "structure", 4, 3, 1);
    artifact.settlements.push({
      id: 0,
      kind: "outpost",
      purpose: "waypoint",
      anchor: [3, 3],
      radius: 2,
      structures: [{ type: "structure.cave_mouth", cell: [3, 3], footprint: [2, 1] }],
    });
    const model = new WorldModel(artifact);
    assert.equal(model.classifyCell(3, 3), "structure_pass");
    assert.equal(model.classifyCell(4, 3), "structure_pass");
  });

  it("blocks non-pass footprint cells and fully blocks unlisted structure types", () => {
    const artifact = makeArtifact();
    // ruin_temple 3x2 at (2,5): pass cells [3, 4] = footprint row 1, columns 0-1.
    for (let sy = 0; sy < 2; sy += 1) {
      for (let sx = 0; sx < 3; sx += 1) {
        setLayer(artifact, "structure", 2 + sx, 5 + sy, 3);
      }
    }
    artifact.pois.push({
      id: 0,
      type: "poi.ruin",
      cell: [2, 5],
      structure: { type: "structure.ruin_temple", x: 2, y: 5, w: 3, h: 2 },
    });
    setLayer(artifact, "structure", 7, 0, 2); // structure.house — no pass list
    const model = new WorldModel(artifact);
    assert.equal(model.classifyCell(2, 5), "structure_block"); // index 0
    assert.equal(model.classifyCell(2, 6), "structure_pass"); // index 3
    assert.equal(model.classifyCell(3, 6), "structure_pass"); // index 4
    assert.equal(model.classifyCell(4, 6), "structure_block"); // index 5
    assert.equal(model.classifyCell(7, 0), "structure_block");
  });

  it("painted structure cells with no record resolve to footprint index 0", () => {
    const artifact = makeArtifact();
    setLayer(artifact, "structure", 6, 2, 1); // painted cave_mouth: pass [0,1] includes 0
    setLayer(artifact, "structure", 6, 3, 3); // painted ruin_temple: pass [3,4] excludes 0
    const model = new WorldModel(artifact);
    assert.equal(model.classifyCell(6, 2), "structure_pass");
    assert.equal(model.classifyCell(6, 3), "structure_block");
  });

  describe("street fords", () => {
    it("walks a river cell that itself carries corridor material", () => {
      const artifact = makeArtifact();
      setMaterial(artifact, 3, 4, "terrain.packed_road");
      setLayer(artifact, "river", 3, 4, 1);
      const model = new WorldModel(artifact);
      assert.equal(model.classifyCell(3, 4), "crossing_street_ford_walk");
    });

    it("bridges a single river cell between corridor ends on both axes", () => {
      const artifact = makeArtifact();
      // east-west: road at (2,2) and (4,2), river at (3,2)
      setMaterial(artifact, 2, 2, "terrain.packed_road");
      setMaterial(artifact, 4, 2, "terrain.cobble");
      setLayer(artifact, "river", 3, 2, 1);
      // north-south: road at (6,3) and (6,5), river at (6,4)
      setMaterial(artifact, 6, 3, "terrain.packed_road");
      setMaterial(artifact, 6, 5, "terrain.packed_road");
      setLayer(artifact, "river", 6, 4, 2);
      const model = new WorldModel(artifact);
      assert.equal(model.classifyCell(3, 2), "crossing_street_ford_walk");
      assert.equal(model.classifyCell(6, 4), "crossing_street_ford_walk");
    });

    it("bridges a run of two river cells between corridor ends", () => {
      const artifact = makeArtifact();
      setMaterial(artifact, 1, 6, "terrain.packed_road");
      setLayer(artifact, "river", 2, 6, 1);
      setLayer(artifact, "river", 3, 6, 1);
      setMaterial(artifact, 4, 6, "terrain.packed_road");
      const model = new WorldModel(artifact);
      assert.equal(model.classifyCell(2, 6), "crossing_street_ford_walk");
      assert.equal(model.classifyCell(3, 6), "crossing_street_ford_walk");
    });

    it("does not ford a river without corridor ends, and stays in bounds at edges", () => {
      const artifact = makeArtifact();
      setLayer(artifact, "river", 0, 0, 1); // corner: no room on either axis
      setLayer(artifact, "river", 5, 1, 1); // open grass around: no corridor
      setMaterial(artifact, 0, 7, "terrain.packed_road");
      setLayer(artifact, "river", 1, 7, 1); // corridor on one side only
      const model = new WorldModel(artifact);
      assert.equal(model.classifyCell(0, 0), "river_stream_block");
      assert.equal(model.classifyCell(5, 1), "river_stream_block");
      assert.equal(model.classifyCell(1, 7), "river_stream_block");
    });

    it("does not bridge three river cells", () => {
      const artifact = makeArtifact();
      setMaterial(artifact, 1, 3, "terrain.packed_road");
      setLayer(artifact, "river", 2, 3, 1);
      setLayer(artifact, "river", 3, 3, 1);
      setLayer(artifact, "river", 4, 3, 1);
      setMaterial(artifact, 5, 3, "terrain.packed_road");
      const model = new WorldModel(artifact);
      assert.equal(model.classifyCell(2, 3), "river_stream_block");
      assert.equal(model.classifyCell(3, 3), "river_stream_block");
      assert.equal(model.classifyCell(4, 3), "river_stream_block");
    });
  });

  it("nudge scans radius 0..7 with dy outer, dx inner, first hit wins", () => {
    const artifact = makeArtifact();
    for (let y = 0; y < 8; y += 1) {
      for (let x = 0; x < 8; x += 1) {
        setMaterial(artifact, x, y, "terrain.rock");
      }
    }
    // Two walkable cells equidistant from (4,4): (3,3) and (5,3). The scan
    // order (dy -1 row first, dx -1 before +1) must pick (3,3).
    setMaterial(artifact, 3, 3, "terrain.grass");
    setMaterial(artifact, 5, 3, "terrain.grass");
    const model = new WorldModel(artifact);
    const { bits } = model.deriveWalkability();
    assert.deepEqual(model.nudgeToWalkable(4, 4, bits), [3, 3]);
    // Fully blocked world: nudge finds nothing within radius 8.
    setMaterial(artifact, 3, 3, "terrain.rock");
    setMaterial(artifact, 5, 3, "terrain.rock");
    const blocked = new WorldModel(artifact);
    const derivation = blocked.deriveWalkability();
    assert.equal(blocked.nudgeToWalkable(4, 4, derivation.bits), null);
  });
});
