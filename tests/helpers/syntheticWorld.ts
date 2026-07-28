/**
 * Synthetic minimal artifacts for ladder unit tests: an 8x8 single-chunk
 * world with a palette covering every material the ladder distinguishes.
 * Tests poke cells and assert the deciding rung — fixture-independent
 * coverage of every ladder branch, including the ones real tiny worlds
 * rarely exercise.
 */

export const MATERIALS = [
  "terrain.grass",
  "water.deep",
  "terrain.rock",
  "terrain.swamp",
  "water.shallow",
  "terrain.packed_road",
  "terrain.cobble",
  "terrain.mud",
] as const;

export const MAT = Object.fromEntries(MATERIALS.map((name, index) => [name, index])) as Record<
  (typeof MATERIALS)[number],
  number
>;

export interface SyntheticArtifact {
  formatVersion: number;
  generator: Record<string, unknown>;
  coordinates: Record<string, string>;
  dimensions: { width: number; height: number; chunkWidth: number; chunkHeight: number };
  dependencies: { tileforge: null };
  semanticPalette: string[];
  structureTypes: string[];
  propTypes: string[];
  decalTypes: string[];
  cropTypes: string[];
  fenceTypes: string[];
  pierTypes: string[];
  destinations: Array<{ id: number; kind: string; cell: [number, number] }>;
  routes: Array<{
    id: number;
    routeClass: string;
    from: [number, number];
    to: [number, number];
    length: number;
    crossings: Array<{ cell: [number, number]; kind: string }>;
  }>;
  pois: Array<{
    id: number;
    type: string;
    cell: [number, number];
    structure?: { type: string; x: number; y: number; w: number; h: number };
  }>;
  settlements: Array<{
    id: number;
    kind: string;
    purpose: string;
    anchor: [number, number];
    radius: number;
    structures: Array<{ type: string; cell: [number, number]; footprint: [number, number] }>;
  }>;
  landmarks: unknown[];
  regions: unknown[];
  hydrology: Record<string, number>;
  chunks: Array<{ coord: [number, number]; layers: Record<string, number[][]> }>;
}

const LAYER_NAMES = [
  "material", "elevation", "river", "path", "structure", "prop",
  "moss", "tallgrass", "decal", "crop", "fence", "pier",
];

export function makeArtifact(size: number = 8): SyntheticArtifact {
  const layers: Record<string, number[][]> = {};
  for (const name of LAYER_NAMES) {
    layers[name] = Array.from({ length: size }, () => Array.from({ length: size }, () => 0));
  }
  return {
    formatVersion: 8,
    generator: {
      name: "synthetic",
      version: "0.0.0",
      seed: 1,
      generatorBehaviorVersion: 47,
      recipeCompilerVersion: 28,
      recipeSha256: "0".repeat(64),
      resolvedConfigSha256: "0".repeat(64),
      generationIdentitySha256: "0".repeat(64),
    },
    coordinates: {
      origin: "top-left",
      xIncreases: "eastward",
      yIncreases: "southward",
      cellOrder: "row-major",
      chunkOrder: "row-major",
    },
    dimensions: { width: size, height: size, chunkWidth: size, chunkHeight: size },
    dependencies: { tileforge: null },
    semanticPalette: [...MATERIALS],
    structureTypes: ["structure.cave_mouth", "structure.house", "structure.ruin_temple"],
    propTypes: ["prop.oak", "prop.flowers"],
    decalTypes: [],
    cropTypes: [],
    fenceTypes: ["fence.pen"],
    pierTypes: ["pier.pier"],
    destinations: [{ id: 0, kind: "settlement_candidate", cell: [0, 0] }],
    routes: [],
    pois: [],
    settlements: [],
    landmarks: [],
    regions: [],
    hydrology: {
      seaLevelPermille: 300,
      oceanCellCount: 0,
      lakeCount: 0,
      riverCellCount: 0,
      networkRiverCellCount: 0,
      riverSourceCount: 0,
      wetlandCellCount: 0,
    },
    chunks: [{ coord: [0, 0], layers }],
  };
}

export function setLayer(artifact: SyntheticArtifact, layer: string, x: number, y: number, value: number): void {
  const chunk = artifact.chunks[0];
  if (chunk === undefined) throw new Error("synthetic artifact has no chunk");
  const rows = chunk.layers[layer];
  if (rows === undefined) throw new Error(`unknown layer ${layer}`);
  const row = rows[y];
  if (row === undefined) throw new Error(`row ${y} out of range`);
  row[x] = value;
}

export function setMaterial(artifact: SyntheticArtifact, x: number, y: number, material: (typeof MATERIALS)[number]): void {
  setLayer(artifact, "material", x, y, MAT[material]);
}
