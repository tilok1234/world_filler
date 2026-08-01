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

describe("behavior-72 pack semantics (adoption sl-0039)", () => {
  const flatElev = (): number[] => new Array(64).fill(0);

  it("walks bare moss carpet on level-0 rock, and only there", () => {
    const artifact = makeArtifact();
    setMaterial(artifact, 2, 2, "terrain.rock");
    setLayer(artifact, "moss", 2, 2, 1);
    setMaterial(artifact, 5, 5, "terrain.rock");
    setLayer(artifact, "moss", 5, 5, 1);

    // Level-0 apron: walks. Same cell without the adapter grid: solid
    // (pre-b72 packs reproduce their pre-ruling grids).
    const elev = flatElev();
    assert.equal(new WorldModel(artifact, elev).classifyCell(2, 2), "moss_rock_walk");
    assert.equal(new WorldModel(artifact).classifyCell(2, 2), "material_block_rock");

    // Level >= 1 (behind a cliff face): moss stays solid.
    const terraced = flatElev();
    terraced[5 * 8 + 5] = 1;
    const terracedModel = new WorldModel(artifact, terraced);
    assert.equal(terracedModel.classifyCell(5, 5), "material_block_rock");
    assert.equal(terracedModel.classifyCell(2, 2), "moss_rock_walk");

    // ANY prop keeps moss solid — even species that never block
    // (upstream requires a bare carpet, not merely an unblocked one).
    setLayer(artifact, "prop", 2, 2, 2); // prop.flowers, non-blocking
    assert.equal(new WorldModel(artifact, elev).classifyCell(2, 2), "material_block_rock");

    // Mossless rock never walks regardless of level.
    setMaterial(artifact, 6, 1, "terrain.rock");
    assert.equal(new WorldModel(artifact, elev).classifyCell(6, 1), "material_block_rock");
  });

  it("stamps record-backed footprints solid outside their pass cells (WYSIWYG art outline)", () => {
    const artifact = makeArtifact();
    // A house footprint 2x1 with only its left cell painted into the
    // structure layer: the painted cell blocks by ladder, the unpainted
    // right cell rendered ground before b72 — the stamp now seals it.
    artifact.settlements.push({
      id: 0,
      kind: "outpost",
      purpose: "waypoint",
      anchor: [3, 3],
      radius: 2,
      structures: [{ type: "structure.house", cell: [3, 3], footprint: [2, 1] }],
    });
    setLayer(artifact, "structure", 3, 3, 2); // structure.house painted
    const model = new WorldModel(artifact);
    assert.equal(model.classifyCell(3, 3), "structure_block");
    assert.equal(model.classifyCell(4, 3), "structure_stamp_block");
    assert.equal(model.walkableAt(4, 3), false);

    // Pass cells stay open: a cave mouth's declared openings are never
    // stamped, painted or not.
    const cave = makeArtifact();
    cave.settlements.push({
      id: 0,
      kind: "outpost",
      purpose: "waypoint",
      anchor: [1, 6],
      radius: 2,
      structures: [{ type: "structure.cave_mouth", cell: [1, 6], footprint: [2, 2] }],
    });
    const caveModel = new WorldModel(cave);
    assert.equal(caveModel.classifyCell(1, 6), "default_walk"); // pass cell 0
    assert.equal(caveModel.classifyCell(2, 6), "default_walk"); // pass cell 1
    assert.equal(caveModel.classifyCell(1, 7), "structure_stamp_block"); // cell 2
    assert.equal(caveModel.classifyCell(2, 7), "structure_stamp_block"); // cell 3
  });
});

describe("behavior-77 prop walkability classes (sl-0041 base re-pin)", () => {
  // Palette for the carpet-debris species plus a solid control; the
  // synthetic default palette carries only oak and flowers.
  const withDebris = (behavior: number) => {
    const artifact = makeArtifact();
    (artifact.generator as { generatorBehaviorVersion: number }).generatorBehaviorVersion = behavior;
    artifact.propTypes.push(
      "prop.stump", "prop.fallen_log", "prop.bone_pile", "prop.loot_pile", "prop.boulder",
    );
    return artifact; // prop values: 3 stump, 4 fallen_log, 5 bone_pile, 6 loot_pile, 7 boulder
  };

  it("walks all four carpet-debris species at behavior 77, blocks them before", () => {
    for (const [value, x] of [[3, 1], [4, 2], [5, 3], [6, 4]] as const) {
      const modern = withDebris(77);
      setLayer(modern, "prop", x, 1, value);
      assert.equal(new WorldModel(modern).classifyCell(x, 1), "default_walk");

      const legacy = withDebris(72);
      setLayer(legacy, "prop", x, 1, value);
      assert.equal(new WorldModel(legacy).classifyCell(x, 1), "prop_block");
    }
  });

  it("carpet never blocks but never forces walking: the rest of the ladder decides", () => {
    const artifact = withDebris(77);
    setLayer(artifact, "prop", 2, 2, 3); // stump over deep water
    setMaterial(artifact, 2, 2, "water.deep");
    setLayer(artifact, "prop", 4, 2, 4); // fallen_log over a stream
    setLayer(artifact, "river", 4, 2, 1);
    setLayer(artifact, "prop", 6, 2, 3); // stump on a trail
    setLayer(artifact, "path", 6, 2, 1);
    const model = new WorldModel(artifact);
    assert.equal(model.classifyCell(2, 2), "material_block_deep_water");
    assert.equal(model.classifyCell(4, 2), "river_stream_block");
    assert.equal(model.classifyCell(6, 2), "trail_walk");
  });

  it("solid species and canopy trunks still block at behavior 77", () => {
    const artifact = withDebris(77);
    setLayer(artifact, "prop", 1, 5, 7); // boulder — solid
    setLayer(artifact, "prop", 3, 5, 1); // oak trunk — canopy blocks its cell
    const model = new WorldModel(artifact);
    assert.equal(model.classifyCell(1, 5), "prop_block");
    assert.equal(model.classifyCell(3, 5), "prop_block");
  });

  it("carpet debris on level-0 moss rock keeps moss solid (any-prop rule survives 77)", () => {
    const artifact = withDebris(77);
    setMaterial(artifact, 2, 2, "terrain.rock");
    setLayer(artifact, "moss", 2, 2, 1);
    setLayer(artifact, "prop", 2, 2, 3); // stump — carpet, but not bare
    const elev = new Array(64).fill(0);
    assert.equal(new WorldModel(artifact, elev).classifyCell(2, 2), "material_block_rock");
  });
});
