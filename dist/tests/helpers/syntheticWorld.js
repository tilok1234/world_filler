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
];
export const MAT = Object.fromEntries(MATERIALS.map((name, index) => [name, index]));
const LAYER_NAMES = [
    "material", "elevation", "river", "path", "structure", "prop",
    "moss", "tallgrass", "decal", "crop", "fence", "pier",
];
export function makeArtifact(size = 8) {
    const layers = {};
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
export function setLayer(artifact, layer, x, y, value) {
    const chunk = artifact.chunks[0];
    if (chunk === undefined)
        throw new Error("synthetic artifact has no chunk");
    const rows = chunk.layers[layer];
    if (rows === undefined)
        throw new Error(`unknown layer ${layer}`);
    const row = rows[y];
    if (row === undefined)
        throw new Error(`row ${y} out of range`);
    row[x] = value;
}
export function setMaterial(artifact, x, y, material) {
    setLayer(artifact, "material", x, y, MAT[material]);
}
