/**
 * Typed views of the WorldForge artifact records World Filler consumes.
 * Shapes follow the artifact format 8 contract; the artifact file itself is
 * the source of truth and unknown extra fields are ignored, never invented.
 */

export interface ArtifactGenerator {
  readonly name: string;
  readonly version: string;
  readonly seed: number;
  readonly generatorBehaviorVersion: number;
  readonly recipeCompilerVersion: number;
  readonly recipeSha256: string;
  readonly resolvedConfigSha256: string;
  readonly generationIdentitySha256: string;
}

export interface ArtifactDimensions {
  readonly width: number;
  readonly height: number;
  readonly chunkWidth: number;
  readonly chunkHeight: number;
}

export interface ArtifactCoordinates {
  readonly origin: string;
  readonly xIncreases: string;
  readonly yIncreases: string;
  readonly cellOrder: string;
  readonly chunkOrder: string;
}

export type Cell = readonly [number, number];

export interface WorldDestination {
  readonly id: number;
  readonly kind: string;
  readonly cell: Cell;
}

export interface RouteCrossing {
  readonly cell: Cell;
  readonly kind: string;
}

export interface WorldRoute {
  readonly id: number;
  readonly routeClass: string;
  readonly from: Cell;
  readonly to: Cell;
  readonly length: number;
  readonly crossings: readonly RouteCrossing[];
}

export interface SettlementStructure {
  readonly type: string;
  readonly cell: Cell;
  readonly footprint: readonly [number, number];
  readonly entrance?: Cell;
}

export interface WorldSettlement {
  readonly id: number;
  readonly kind: string;
  readonly purpose: string;
  readonly anchor: Cell;
  readonly radius: number;
  readonly structures: readonly SettlementStructure[];
}

export interface WorldLandmark {
  readonly id: number;
  readonly type: string;
  readonly cell: Cell;
  readonly footprint: readonly [number, number];
  readonly entrance?: Cell;
}

export interface PoiStructure {
  readonly type: string;
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
}

export interface WorldPoi {
  readonly id: number;
  readonly type: string;
  readonly cell: Cell;
  readonly structure?: PoiStructure;
}

export interface WorldRegion {
  readonly id: number;
  readonly biome: string;
  readonly cellCount: number;
}

export interface WorldHydrology {
  readonly seaLevelPermille: number;
  readonly oceanCellCount: number;
  readonly lakeCount: number;
  readonly riverCellCount: number;
  readonly networkRiverCellCount: number;
  readonly riverSourceCount: number;
  readonly wetlandCellCount: number;
}

export const CHUNK_LAYERS = [
  "material",
  "elevation",
  "river",
  "path",
  "structure",
  "prop",
  "moss",
  "tallgrass",
  "decal",
  "crop",
  "fence",
  "pier",
] as const;

export type ChunkLayerName = (typeof CHUNK_LAYERS)[number];

export interface RawChunk {
  readonly coord: Cell;
  readonly layers: Readonly<Record<ChunkLayerName, readonly (readonly number[])[]>>;
}

export interface RawArtifact {
  readonly formatVersion: number;
  readonly generator: ArtifactGenerator;
  readonly coordinates: ArtifactCoordinates;
  readonly dimensions: ArtifactDimensions;
  readonly dependencies: { readonly tileforge: { readonly packageId: string; readonly packageSha256: string; readonly manifestSha256: string } | null };
  readonly semanticPalette: readonly string[];
  readonly structureTypes: readonly string[];
  readonly propTypes: readonly string[];
  readonly decalTypes: readonly string[];
  readonly cropTypes: readonly string[];
  readonly fenceTypes: readonly string[];
  readonly pierTypes: readonly string[];
  readonly destinations: readonly WorldDestination[];
  readonly routes: readonly WorldRoute[];
  readonly pois?: readonly WorldPoi[];
  readonly settlements: readonly WorldSettlement[];
  readonly landmarks: readonly WorldLandmark[];
  readonly regions: readonly WorldRegion[];
  readonly hydrology: WorldHydrology;
  readonly chunks: readonly RawChunk[];
}
