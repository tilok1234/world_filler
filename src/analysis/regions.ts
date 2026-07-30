import type { WorldModel } from "../world/model.js";

/**
 * Director-side region segmentation: contiguous patches of one land
 * material over the material layer (the artifact's regions[] records carry
 * only biome + cell count, and upstream zones never reach the artifact —
 * spatial extents are ours to derive). Void is walkability-aware
 * (sl-0026, designer-ruled 2026-07-30): a cell is void only when it has
 * a void material AND is unwalkable. Walkable ground on void materials —
 * route/street ford cells, wadeable shallows, piers — belongs to regions
 * (patches of its own material), so the director is not blind to
 * travel-critical ground; unwalkable rock and river/deep water keep
 * separating regions and belong to none.
 *
 * Region ids are deterministic content-derived labels:
 * `region.<biome-short>.<anchorIndex>` where anchorIndex is the smallest
 * row-major cell index of the patch — stable for a given world regardless
 * of traversal order, and human-readable in reports.
 */

const VOID_MATERIALS: ReadonlySet<string> = new Set(["water.deep", "water.shallow", "terrain.rock"]);

/**
 * Patches larger than this subdivide. Giant single-biome monoliths are
 * too coarse for everything downstream — danger banding (one region can
 * swallow a whole band's share), budgets (blobby allocation), and
 * rerolls (rerolling "the entire highland"). 1024 cells ≈ a 32×32 area:
 * big enough to stay meaningful, small enough that bands can vary
 * across a large biome.
 */
const MAX_REGION_CELLS = 1024;

export interface AnalysisRegion {
  readonly id: string;
  readonly biome: string;
  readonly cellCount: number;
  readonly anchorIndex: number;
  readonly bounds: { readonly x0: number; readonly y0: number; readonly x1: number; readonly y1: number };
  readonly neighborIds: readonly string[];
  /** Adjacency degree; 1 = dead-end region (single neighboring region). */
  readonly deadEndScore: number;
}

export interface Segmentation {
  readonly regions: readonly AnalysisRegion[];
  /** Per-cell region index into `regions`, -1 for void. */
  readonly labels: Int32Array;
}

export function segmentRegions(model: WorldModel): Segmentation {
  const { width, height } = model.dimensions;
  // One derivation shared with parity/flood: void-material cells consult
  // this grid, so segmentation and walkability can never disagree.
  const walkable = model.deriveWalkability().bits;
  const labels = new Int32Array(width * height).fill(-1);
  const patches: Array<{
    biome: string;
    cellCount: number;
    anchorIndex: number;
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  }> = [];

  const materialAtIndex = (index: number): string => {
    const x = index % width;
    return model.materialAt(x, (index - x) / width);
  };

  for (let start = 0; start < width * height; start += 1) {
    if (labels[start] !== -1) continue;
    const biome = materialAtIndex(start);
    const voidBiome = VOID_MATERIALS.has(biome);
    if (voidBiome && walkable[start] === 0) continue;
    const label = patches.length;
    labels[start] = label;
    const queue: number[] = [start];
    let cellCount = 0;
    let x0 = width;
    let y0 = height;
    let x1 = -1;
    let y1 = -1;
    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head] as number;
      cellCount += 1;
      const x = index % width;
      const y = (index - x) / width;
      if (x < x0) x0 = x;
      if (y < y0) y0 = y;
      if (x > x1) x1 = x;
      if (y > y1) y1 = y;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (labels[next] !== -1) continue;
        if (materialAtIndex(next) !== biome) continue;
        // Same material is not enough on void biomes: a wadeable shallow
        // patch must not flood across blocked river cells of the same
        // material — void cells stay out of every patch.
        if (voidBiome && walkable[next] === 0) continue;
        labels[next] = label;
        queue.push(next);
      }
    }
    patches.push({ biome, cellCount, anchorIndex: start, x0, y0, x1, y1 });
  }

  // Subdivide oversized patches: bisect along the longer bounding-box
  // axis at the midline and re-flood each side into connected
  // components, repeating until every patch holds at most
  // MAX_REGION_CELLS cells. Deterministic throughout (row-major scans,
  // midline splits); every final patch re-anchors at its own smallest
  // cell index, so ids stay content-derived. The first component of a
  // split reuses the parent's label slot; the rest append.
  const oversized: number[] = [];
  for (let label = 0; label < patches.length; label += 1) {
    if ((patches[label] as (typeof patches)[number]).cellCount > MAX_REGION_CELLS) oversized.push(label);
  }
  while (oversized.length > 0) {
    const label = oversized.shift() as number;
    const patch = patches[label] as (typeof patches)[number];
    if (patch.cellCount <= MAX_REGION_CELLS) continue;
    const cells: number[] = [];
    for (let index = 0; index < labels.length; index += 1) {
      if (labels[index] === label) {
        cells.push(index);
        labels[index] = -2; // pending reassignment
      }
    }
    const splitOnX = patch.x1 - patch.x0 >= patch.y1 - patch.y0;
    const midline = splitOnX ? (patch.x0 + patch.x1) >> 1 : (patch.y0 + patch.y1) >> 1;
    const sideOf = (index: number): number => {
      const x = index % width;
      const y = (index - x) / width;
      return (splitOnX ? x : y) <= midline ? 0 : 1;
    };
    let reusedParentSlot = false;
    for (const seed of cells) {
      if (labels[seed] !== -2) continue;
      const componentLabel = reusedParentSlot ? patches.length : label;
      const side = sideOf(seed);
      labels[seed] = componentLabel;
      const queue: number[] = [seed];
      let cellCount = 0;
      let anchorIndex = seed;
      let x0 = width;
      let y0 = height;
      let x1 = -1;
      let y1 = -1;
      for (let head = 0; head < queue.length; head += 1) {
        const index = queue[head] as number;
        cellCount += 1;
        if (index < anchorIndex) anchorIndex = index;
        const x = index % width;
        const y = (index - x) / width;
        if (x < x0) x0 = x;
        if (y < y0) y0 = y;
        if (x > x1) x1 = x;
        if (y > y1) y1 = y;
        for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
          const next = ny * width + nx;
          if (labels[next] !== -2 || sideOf(next) !== side) continue;
          labels[next] = componentLabel;
          queue.push(next);
        }
      }
      const component = { biome: patch.biome, cellCount, anchorIndex, x0, y0, x1, y1 };
      if (reusedParentSlot) patches.push(component);
      else {
        patches[label] = component;
        reusedParentSlot = true;
      }
      if (cellCount > MAX_REGION_CELLS) oversized.push(componentLabel);
    }
  }

  // Region adjacency: touching patches (4-connected across the border),
  // void does not connect regions.
  const neighborSets: Array<Set<number>> = patches.map(() => new Set<number>());
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const label = labels[y * width + x] as number;
      if (label === -1) continue;
      if (x < width - 1) {
        const east = labels[y * width + x + 1] as number;
        if (east !== -1 && east !== label) {
          neighborSets[label]?.add(east);
          neighborSets[east]?.add(label);
        }
      }
      if (y < height - 1) {
        const south = labels[(y + 1) * width + x] as number;
        if (south !== -1 && south !== label) {
          neighborSets[label]?.add(south);
          neighborSets[south]?.add(label);
        }
      }
    }
  }

  const idOf = (patchIndex: number): string => {
    const patch = patches[patchIndex] as (typeof patches)[number];
    const short = patch.biome.replace(/^terrain\./, "").replace(/^water\./, "");
    return `region.${short}.${patch.anchorIndex}`;
  };

  const regions: AnalysisRegion[] = patches.map((patch, index) => {
    const neighborIds = [...(neighborSets[index] as Set<number>)].map(idOf).sort();
    return {
      id: idOf(index),
      biome: patch.biome,
      cellCount: patch.cellCount,
      anchorIndex: patch.anchorIndex,
      bounds: { x0: patch.x0, y0: patch.y0, x1: patch.x1, y1: patch.y1 },
      neighborIds,
      deadEndScore: neighborIds.length,
    };
  });

  return { regions, labels };
}
