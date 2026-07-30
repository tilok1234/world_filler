import {
  CHUNK_LAYERS,
  type Cell,
  type ChunkLayerName,
  type RawArtifact,
  type WorldDestination,
  type WorldHydrology,
  type WorldLandmark,
  type WorldPoi,
  type WorldRegion,
  type WorldRoute,
  type WorldSettlement,
} from "./types.js";

/** The artifact format this consumer reads; anything else is a refusal. */
export const SUPPORTED_ARTIFACT_FORMAT = 8;

/*
 * Walkability-ladder contract data, transcribed from the upstream consumer
 * contract (WorldForge public loader tables @ behavior 72, commit
 * bbc10cdb — adopted 2026-07-30, ratified sl-0039; previously behavior
 * 47 @ bb7832f; append-only upstream). Pack-grid semantics on top of the
 * loader ladder are transcribed from the same commit's export
 * (buildWalkability): the 2026-07-28 moss-walks ruling and the WYSIWYG
 * art-outline stamp. Data tables, not code — see AGENTS.md, isolation
 * contract. Updating them is an explicit, logged decision.
 */

const BLOCKED_MATERIALS: ReadonlySet<string> = new Set(["water.deep", "terrain.rock", "terrain.swamp"]);

const STRUCTURE_PASS_CELLS: Readonly<Record<string, readonly number[]>> = {
  "structure.fortress_gate": [0],
  "structure.cave_mouth": [0, 1],
  "structure.mine_shaft": [2, 3],
  "structure.stone_circle": [1, 4, 7],
  "structure.den": [2, 3],
  "structure.crypt": [2, 3],
  "structure.giant_skeleton": [5, 6, 7],
  "structure.ruined_gate": [1, 4],
  "structure.ruin_temple": [3, 4],
  "structure.portal": [1, 4],
  "structure.world_tree": [13],
  // Upstream behavior 60: the harbor dock's deck walks; only the
  // top-right post (cell 2) blocks.
  "structure.dock": [0, 1, 3, 4, 5],
  // Upstream behavior 62: the city gatehouse's arch — the middle column
  // walks, the flanking towers block.
  "structure.city_gate": [1, 4],
};

const BLOCKING_PROPS: ReadonlySet<string> = new Set([
  "prop.oak", "prop.birch", "prop.pine", "prop.willow", "prop.dead_tree",
  "prop.fruit_tree", "prop.stump", "prop.fallen_log", "prop.boulder",
  "prop.rock_outcrop", "prop.milestone", "prop.signpost", "prop.rowboat",
  "prop.buoy", "prop.campfire", "prop.game_rack", "prop.log_pile",
  "prop.standing_stone", "prop.runestone", "prop.broken_wagon",
  "prop.bone_pile", "prop.altar", "prop.brazier", "prop.gravestones",
  "prop.lone_grave", "prop.mine_cart", "prop.ore_vein", "prop.watchfire",
  "prop.skull_pole", "prop.loot_pile", "prop.spikes", "prop.banner",
  "prop.crystals", "prop.statue", "prop.pillar", "prop.stone_blocks",
  "prop.crates", "prop.wheelbarrow", "prop.tool_rack", "prop.sacks",
  "prop.firewood", "prop.burned_tree", "prop.cart", "prop.chest",
  "prop.archery_target", "prop.chopping_block", "prop.hay_bales",
  "prop.trough", "prop.wreck", "prop.giant_shroom", "prop.corrupted_tree",
  "prop.beehive", "prop.cactus", "prop.flower_bed",
  // Behavior-72 additions (loader table @ bbc10cdb, adoption sl-0039):
  // village furniture and dressing that reads as solid.
  "prop.lamp", "prop.barrels", "prop.bench", "prop.noticeboard",
  "prop.table_chairs", "prop.anvil", "prop.workbench", "prop.laundry_line",
  "prop.baskets", "prop.fishingboat", "prop.bollard", "prop.coop",
  "prop.topiary", "prop.planter_urn", "prop.sundial", "prop.cookfire",
]);

const CORRIDOR_MATERIALS: ReadonlySet<string> = new Set(["terrain.packed_road", "terrain.cobble"]);

/** Which ladder rung decided a cell — the coverage/reporting vocabulary. */
export type LadderRung =
  | "structure_pass"
  | "structure_block"
  | "prop_block"
  | "fence_block"
  | "trail_walk"
  | "pier_walk"
  | "crossing_route_walk"
  | "crossing_street_ford_walk"
  | "river_stream_block"
  | "river_major_block"
  | "material_block_deep_water"
  | "material_block_rock"
  | "material_block_swamp"
  | "shallow_wade"
  | "default_walk"
  // Behavior-72 pack semantics (adoption sl-0039), appended per the
  // append-only vocabulary rule:
  | "moss_rock_walk"
  | "structure_stamp_block";

export const ALL_LADDER_RUNGS: readonly LadderRung[] = [
  "structure_pass", "structure_block", "prop_block", "fence_block",
  "trail_walk", "pier_walk", "crossing_route_walk", "crossing_street_ford_walk",
  "river_stream_block", "river_major_block", "material_block_deep_water",
  "material_block_rock", "material_block_swamp", "shallow_wade", "default_walk",
  "moss_rock_walk", "structure_stamp_block",
];

const WALKING_RUNGS: ReadonlySet<LadderRung> = new Set([
  "structure_pass", "trail_walk", "pier_walk", "crossing_route_walk",
  "crossing_street_ford_walk", "shallow_wade", "default_walk",
  "moss_rock_walk",
]);

export interface WalkabilityDerivation {
  readonly bits: Uint8Array;
  readonly rungCounts: Readonly<Record<LadderRung, number>>;
}

export class ArtifactError extends Error {}

export class WorldModel {
  readonly raw: RawArtifact;
  readonly destinations: readonly WorldDestination[];
  readonly routes: readonly WorldRoute[];
  readonly pois: readonly WorldPoi[];
  readonly settlements: readonly WorldSettlement[];
  readonly landmarks: readonly WorldLandmark[];
  readonly regions: readonly WorldRegion[];
  readonly hydrology: WorldHydrology;

  private readonly layers: Record<ChunkLayerName, Uint16Array>;
  private readonly routeCrossingCells: Set<number>;
  private readonly streetFordCells: Set<number>;
  private readonly structureRects: Map<number, { readonly ox: number; readonly oy: number; readonly w: number }>;
  /** WYSIWYG art-outline stamp: record-backed footprints minus pass cells. */
  private readonly stampMask: Uint8Array;
  /**
   * The TileForge adapter's resolved elevation grid (the pack's
   * resolved/tileforge-map-data.json elev field) — the cliff quantization
   * the moss-walks ruling keys on. Null when the caller has no pack
   * (synthetic worlds, pre-b72 artifacts): the moss rung then never
   * fires, which reproduces the pre-ruling grids.
   */
  private readonly adapterElev: readonly number[] | null;

  constructor(raw: unknown, adapterElev?: readonly number[] | null) {
    this.raw = validateArtifact(raw);
    this.destinations = this.raw.destinations;
    this.routes = this.raw.routes;
    this.pois = this.raw.pois ?? [];
    this.settlements = this.raw.settlements;
    this.landmarks = this.raw.landmarks;
    this.regions = this.raw.regions;
    this.hydrology = this.raw.hydrology;

    const { width, height, chunkWidth, chunkHeight } = this.raw.dimensions;
    this.layers = {} as Record<ChunkLayerName, Uint16Array>;
    for (const layer of CHUNK_LAYERS) {
      this.layers[layer] = new Uint16Array(width * height);
    }
    for (const chunk of this.raw.chunks) {
      const originX = chunk.coord[0] * chunkWidth;
      const originY = chunk.coord[1] * chunkHeight;
      for (const layer of CHUNK_LAYERS) {
        const rows = chunk.layers[layer];
        const flat = this.layers[layer];
        for (let ly = 0; ly < chunkHeight; ly += 1) {
          const row = rows[ly] as readonly number[];
          for (let lx = 0; lx < chunkWidth; lx += 1) {
            flat[(originY + ly) * width + originX + lx] = row[lx] as number;
          }
        }
      }
    }

    const cellTotal = width * height;
    if (adapterElev !== undefined && adapterElev !== null && adapterElev.length !== cellTotal) {
      throw new ArtifactError(
        `adapter elev grid is ${adapterElev.length} cells, expected ${cellTotal}`,
      );
    }
    this.adapterElev = adapterElev ?? null;

    // Footprint index for pass-cell resolution: record-backed structures
    // only (settlement structures and structure-bearing POIs). Painted
    // structure cells carry no record and resolve to footprint index 0 —
    // contract behavior, not an omission. The same rects drive the
    // WYSIWYG art-outline stamp (behavior 72): every footprint cell
    // stamps solid at pack level EXCEPT the type's declared pass cells;
    // landmarks are deliberately excluded (open-air compounds).
    this.structureRects = new Map();
    this.stampMask = new Uint8Array(cellTotal);
    const addRect = (type: string, ox: number, oy: number, w: number, h: number): void => {
      const pass = STRUCTURE_PASS_CELLS[type];
      for (let sy = 0; sy < h; sy += 1) {
        for (let sx = 0; sx < w; sx += 1) {
          const x = ox + sx;
          const y = oy + sy;
          this.structureRects.set(y * width + x, { ox, oy, w });
          if (pass !== undefined && pass.includes(sy * w + sx)) continue;
          if (x >= 0 && y >= 0 && x < width && y < height) {
            this.stampMask[y * width + x] = 1;
          }
        }
      }
    };
    for (const settlement of this.settlements) {
      for (const structure of settlement.structures) {
        addRect(structure.type, structure.cell[0], structure.cell[1], structure.footprint[0], structure.footprint[1]);
      }
    }
    for (const poi of this.pois) {
      if (poi.structure !== undefined) {
        addRect(poi.structure.type, poi.structure.x, poi.structure.y, poi.structure.w, poi.structure.h);
      }
    }

    // Crossing cells a traveller may use: recorded route crossings, plus
    // derived street fords — river cells that carry corridor material, or
    // that bridge runs of one or two river cells between corridor ends
    // (matching the upstream street-grid allowance), evaluated on both
    // axes with explicit bounds room so edges never read out of range.
    this.routeCrossingCells = new Set();
    for (const route of this.routes) {
      for (const crossing of route.crossings) {
        this.routeCrossingCells.add(crossing.cell[1] * width + crossing.cell[0]);
      }
    }
    this.streetFordCells = new Set();
    const material = this.layers.material;
    const river = this.layers.river;
    const palette = this.raw.semanticPalette;
    const corridorAt = (index: number): boolean =>
      CORRIDOR_MATERIALS.has(palette[material[index] as number] as string);
    const riverAt = (index: number): boolean => (river[index] as number) !== 0;
    const bridged = (index: number, stride: number, room: boolean, room2: boolean): boolean => {
      if (!room) return false;
      const before = corridorAt(index - stride);
      const after = corridorAt(index + stride);
      if (before && after) return true;
      if (!room2) return false;
      if (before && riverAt(index + stride) && corridorAt(index + 2 * stride)) return true;
      if (after && riverAt(index - stride) && corridorAt(index - 2 * stride)) return true;
      return false;
    };
    for (let index = 0; index < width * height; index += 1) {
      if (!riverAt(index)) continue;
      const x = index % width;
      const y = (index - x) / width;
      const northSouth = bridged(index, width, y > 0 && y < height - 1, y > 1 && y < height - 2);
      const eastWest = bridged(index, 1, x > 0 && x < width - 1, x > 1 && x < width - 2);
      if (corridorAt(index) || northSouth || eastWest) {
        this.streetFordCells.add(index);
      }
    }
  }

  get dimensions(): RawArtifact["dimensions"] {
    return this.raw.dimensions;
  }

  get generator(): RawArtifact["generator"] {
    return this.raw.generator;
  }

  inBounds(x: number, y: number): boolean {
    const { width, height } = this.raw.dimensions;
    return x >= 0 && y >= 0 && x < width && y < height;
  }

  private index(x: number, y: number): number {
    const { width, height } = this.raw.dimensions;
    if (x < 0 || y < 0 || x >= width || y >= height) {
      throw new RangeError(`cell (${x}, ${y}) is outside the ${width}x${height} world`);
    }
    return y * width + x;
  }

  layerValueAt(layer: ChunkLayerName, x: number, y: number): number {
    return this.layers[layer][this.index(x, y)] as number;
  }

  materialAt(x: number, y: number): string {
    return this.raw.semanticPalette[this.layerValueAt("material", x, y)] as string;
  }

  structureAt(x: number, y: number): string | null {
    const value = this.layerValueAt("structure", x, y);
    return value === 0 ? null : (this.raw.structureTypes[value - 1] as string);
  }

  propAt(x: number, y: number): string | null {
    const value = this.layerValueAt("prop", x, y);
    return value === 0 ? null : (this.raw.propTypes[value - 1] as string);
  }

  fenceAt(x: number, y: number): string | null {
    const value = this.layerValueAt("fence", x, y);
    return value === 0 ? null : (this.raw.fenceTypes[value - 1] as string);
  }

  pierAt(x: number, y: number): string | null {
    const value = this.layerValueAt("pier", x, y);
    return value === 0 ? null : (this.raw.pierTypes[value - 1] as string);
  }

  /**
   * True on any path-band cell: 1 wilderness trail, 2 in-settlement lane
   * (upstream behavior 57 — the values pick the band art; both walk).
   * The b47-era transcription pinned value 1 only; behavior-72 worlds
   * route band-2 lanes across swamp, which parity caught (sl-0039).
   */
  trailAt(x: number, y: number): boolean {
    return this.layerValueAt("path", x, y) !== 0;
  }

  mossAt(x: number, y: number): boolean {
    return this.layerValueAt("moss", x, y) !== 0;
  }

  riverTierAt(x: number, y: number): number {
    return this.layerValueAt("river", x, y);
  }

  /**
   * The semantic walkability ladder, first hit wins: structures (pass cells
   * walk, others block) -> blocking props -> fences -> trails and piers walk
   * -> crossings walk -> rivers block -> blocked materials (with the
   * moss-on-rock carve-out) -> walkable; then the WYSIWYG art-outline
   * stamp seals footprint cells the ladder would walk (behavior-72 pack
   * semantics — mirrors upstream buildWalkability: ladder, moss OR-in,
   * stamp AND-out). Returns the deciding rung so derivation, coverage,
   * and diagnostics all share one classification path.
   */
  classifyCell(x: number, y: number): LadderRung {
    const rung = this.ladderRungAt(x, y);
    if (WALKING_RUNGS.has(rung) && this.stampMask[this.index(x, y)] === 1) {
      return "structure_stamp_block";
    }
    return rung;
  }

  private ladderRungAt(x: number, y: number): LadderRung {
    const structure = this.structureAt(x, y);
    if (structure !== null) {
      const pass = STRUCTURE_PASS_CELLS[structure];
      if (pass === undefined) return "structure_block";
      const rect = this.structureRects.get(this.index(x, y));
      const cellIndex = rect === undefined ? 0 : (y - rect.oy) * rect.w + (x - rect.ox);
      return pass.includes(cellIndex) ? "structure_pass" : "structure_block";
    }
    const prop = this.propAt(x, y);
    if (prop !== null && BLOCKING_PROPS.has(prop)) return "prop_block";
    if (this.fenceAt(x, y) !== null) return "fence_block";
    if (this.trailAt(x, y)) return "trail_walk";
    if (this.pierAt(x, y) !== null) return "pier_walk";
    const index = this.index(x, y);
    if (this.routeCrossingCells.has(index)) return "crossing_route_walk";
    if (this.streetFordCells.has(index)) return "crossing_street_ford_walk";
    const tier = this.riverTierAt(x, y);
    if (tier === 1) return "river_stream_block";
    if (tier > 1) return "river_major_block";
    const material = this.materialAt(x, y);
    if (BLOCKED_MATERIALS.has(material)) {
      if (material === "water.deep") return "material_block_deep_water";
      if (material === "terrain.rock") {
        // Moss-walks ruling (upstream 2026-07-28, transcribed @ bbc10cdb):
        // bare moss carpet on level-0 rock — the adapter's cliff
        // quantization, the flat apron where a rock mass meets open land —
        // walks. Structure/fence/river conditions are guaranteed by the
        // rung order above; ANY prop (not just blocking species) keeps
        // moss solid, so that one is re-checked here.
        if (
          this.adapterElev !== null &&
          this.mossAt(x, y) &&
          (this.adapterElev[this.index(x, y)] as number) === 0 &&
          this.propAt(x, y) === null
        ) {
          return "moss_rock_walk";
        }
        return "material_block_rock";
      }
      return "material_block_swamp";
    }
    return material === "water.shallow" ? "shallow_wade" : "default_walk";
  }

  walkableAt(x: number, y: number): boolean {
    return WALKING_RUNGS.has(this.classifyCell(x, y));
  }

  /** Derive the full walkability grid plus per-rung coverage tallies. */
  deriveWalkability(): WalkabilityDerivation {
    const { width, height } = this.raw.dimensions;
    const bits = new Uint8Array(width * height);
    const rungCounts = Object.fromEntries(ALL_LADDER_RUNGS.map((rung) => [rung, 0])) as Record<LadderRung, number>;
    for (let y = 0; y < height; y += 1) {
      for (let x = 0; x < width; x += 1) {
        const rung = this.classifyCell(x, y);
        rungCounts[rung] += 1;
        if (WALKING_RUNGS.has(rung)) bits[y * width + x] = 1;
      }
    }
    return { bits, rungCounts };
  }

  /**
   * Nudge to the nearest walkable cell exactly as the upstream reachability
   * gate does: expanding square scan, radius 0..7, dy outer then dx inner,
   * first in-bounds walkable cell wins. Scan order is load-bearing.
   */
  nudgeToWalkable(cx: number, cy: number, bits: Readonly<Uint8Array>): Cell | null {
    const { width } = this.raw.dimensions;
    for (let radius = 0; radius < 8; radius += 1) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const x = cx + dx;
          const y = cy + dy;
          if (this.inBounds(x, y) && bits[y * width + x] === 1) return [x, y];
        }
      }
    }
    return null;
  }
}

/** 4-connected BFS flood count (N, E, S, W), spawn cell included. */
export function floodCount(
  bits: Readonly<Uint8Array>,
  width: number,
  height: number,
  startIndex: number,
): number {
  if (bits[startIndex] !== 1) return 0;
  const reached = new Uint8Array(width * height);
  reached[startIndex] = 1;
  const queue: number[] = [startIndex];
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head] as number;
    const x = index % width;
    const y = (index - x) / width;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (reached[next] === 0 && bits[next] === 1) {
        reached[next] = 1;
        queue.push(next);
      }
    }
  }
  return queue.length;
}

function validateArtifact(input: unknown): RawArtifact {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new ArtifactError("world.json: artifact must be a JSON object");
  }
  const raw = input as Partial<RawArtifact> & Record<string, unknown>;
  if (raw.formatVersion !== SUPPORTED_ARTIFACT_FORMAT) {
    throw new ArtifactError(
      `world.json: unsupported artifact format ${String(raw.formatVersion)}; this reader supports format ${SUPPORTED_ARTIFACT_FORMAT}`,
    );
  }
  const generator = raw.generator;
  if (
    generator === undefined ||
    typeof generator.generationIdentitySha256 !== "string" ||
    typeof generator.generatorBehaviorVersion !== "number" ||
    typeof generator.seed !== "number"
  ) {
    throw new ArtifactError("world.json: generator identity block is incomplete");
  }
  const dimensions = raw.dimensions;
  if (
    dimensions === undefined ||
    !Number.isInteger(dimensions.width) ||
    !Number.isInteger(dimensions.height) ||
    !Number.isInteger(dimensions.chunkWidth) ||
    !Number.isInteger(dimensions.chunkHeight) ||
    dimensions.width <= 0 ||
    dimensions.height <= 0 ||
    dimensions.width % dimensions.chunkWidth !== 0 ||
    dimensions.height % dimensions.chunkHeight !== 0
  ) {
    throw new ArtifactError("world.json: dimensions must be chunk-divisible positive integers");
  }
  for (const table of [
    "semanticPalette", "structureTypes", "propTypes", "decalTypes",
    "cropTypes", "fenceTypes", "pierTypes",
  ] as const) {
    if (!Array.isArray(raw[table])) {
      throw new ArtifactError(`world.json: missing key table ${table}`);
    }
  }
  for (const records of ["destinations", "routes", "settlements", "landmarks", "regions"] as const) {
    if (!Array.isArray(raw[records])) {
      throw new ArtifactError(`world.json: missing record array ${records}`);
    }
  }
  if (typeof raw.hydrology !== "object" || raw.hydrology === null) {
    throw new ArtifactError("world.json: missing hydrology block");
  }
  const chunksAcross = dimensions.width / dimensions.chunkWidth;
  const chunksDown = dimensions.height / dimensions.chunkHeight;
  if (!Array.isArray(raw.chunks) || raw.chunks.length !== chunksAcross * chunksDown) {
    throw new ArtifactError(`world.json: expected ${chunksAcross * chunksDown} chunks covering the world exactly once`);
  }
  const seen = new Set<string>();
  for (const chunk of raw.chunks as readonly RawChunkLike[]) {
    const key = `${chunk.coord?.[0]},${chunk.coord?.[1]}`;
    if (seen.has(key)) {
      throw new ArtifactError(`world.json: duplicate chunk ${key}`);
    }
    seen.add(key);
    for (const layer of CHUNK_LAYERS) {
      const rows = chunk.layers?.[layer];
      if (!Array.isArray(rows) || rows.length !== dimensions.chunkHeight) {
        throw new ArtifactError(`world.json: chunk ${key} layer ${layer} is missing or misshapen`);
      }
      for (const row of rows) {
        if (!Array.isArray(row) || row.length !== dimensions.chunkWidth) {
          throw new ArtifactError(`world.json: chunk ${key} layer ${layer} has a misshapen row`);
        }
      }
    }
  }
  return raw as RawArtifact;
}

interface RawChunkLike {
  readonly coord?: readonly number[];
  readonly layers?: Partial<Record<ChunkLayerName, unknown>>;
}
