/**
 * Deterministic spatial fields over the walkable graph. All distances are
 * 4-connected BFS path distances in cells (never Euclidean); -1 marks
 * cells that are unwalkable or unreachable from every source.
 */

export const UNREACHABLE = -1;

/** Multi-source BFS over walkable cells. Sources outside walkable are ignored. */
export function distanceField(
  bits: Readonly<Uint8Array>,
  width: number,
  height: number,
  sources: Iterable<number>,
): Int32Array {
  const distances = new Int32Array(width * height).fill(UNREACHABLE);
  const queue: number[] = [];
  for (const index of sources) {
    if (bits[index] === 1 && distances[index] === UNREACHABLE) {
      distances[index] = 0;
      queue.push(index);
    }
  }
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head] as number;
    const distance = distances[index] as number;
    const x = index % width;
    const y = (index - x) / width;
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (bits[next] === 1 && distances[next] === UNREACHABLE) {
        distances[next] = distance + 1;
        queue.push(next);
      }
    }
  }
  return distances;
}

/** Connected walkable components, labeled 0..n-1 in row-major discovery order; -1 for unwalkable. */
export function walkableComponents(
  bits: Readonly<Uint8Array>,
  width: number,
  height: number,
): { readonly labels: Int32Array; readonly sizes: readonly number[] } {
  const labels = new Int32Array(width * height).fill(-1);
  const sizes: number[] = [];
  for (let start = 0; start < width * height; start += 1) {
    if (bits[start] !== 1 || labels[start] !== -1) continue;
    const label = sizes.length;
    labels[start] = label;
    const queue: number[] = [start];
    let size = 0;
    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head] as number;
      size += 1;
      const x = index % width;
      const y = (index - x) / width;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const next = ny * width + nx;
        if (bits[next] === 1 && labels[next] === -1) {
          labels[next] = label;
          queue.push(next);
        }
      }
    }
    sizes.push(size);
  }
  return { labels, sizes };
}

/**
 * Clearance: side length of the largest fully-walkable square whose
 * bottom-right corner is the cell (dynamic programming, integer only).
 * A cell with clearance >= k can host a k-by-k reservation ending there.
 */
export function clearanceField(bits: Readonly<Uint8Array>, width: number, height: number): Int32Array {
  const clearance = new Int32Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (bits[index] !== 1) continue;
      if (x === 0 || y === 0) {
        clearance[index] = 1;
        continue;
      }
      const up = clearance[index - width] as number;
      const left = clearance[index - 1] as number;
      const upLeft = clearance[index - width - 1] as number;
      clearance[index] = Math.min(up, left, upLeft) + 1;
    }
  }
  return clearance;
}

/**
 * Corridor cells — the v1 chokepoint heuristic: walkable cells with exactly
 * two walkable neighbors that lie opposite each other (a one-cell-wide
 * passage). Severing one severs a path; placement rules treat them as
 * reserved ground.
 */
export function corridorCells(bits: Readonly<Uint8Array>, width: number, height: number): Uint8Array {
  const corridor = new Uint8Array(width * height);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (bits[index] !== 1) continue;
      const north = y > 0 && bits[index - width] === 1;
      const south = y < height - 1 && bits[index + width] === 1;
      const west = x > 0 && bits[index - 1] === 1;
      const east = x < width - 1 && bits[index + 1] === 1;
      const count = (north ? 1 : 0) + (south ? 1 : 0) + (west ? 1 : 0) + (east ? 1 : 0);
      if (count === 2 && ((north && south) || (east && west))) {
        corridor[index] = 1;
      }
    }
  }
  return corridor;
}

/** Walkable cells that border a source mask (distance-0 seeds for BFS). */
export function cellsAdjacentTo(
  bits: Readonly<Uint8Array>,
  width: number,
  height: number,
  isSource: (index: number) => boolean,
): number[] {
  const seeds: number[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (bits[index] !== 1) continue;
      if (isSource(index)) {
        seeds.push(index);
        continue;
      }
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        if (isSource(ny * width + nx)) {
          seeds.push(index);
          break;
        }
      }
    }
  }
  return seeds;
}
