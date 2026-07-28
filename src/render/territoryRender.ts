import type { WorldModel } from "../world/model.js";
import type { AnalysisBundle } from "../analysis/analyze.js";
import type { TerritoriesDoc } from "../territory/territory.js";
import type { PlacementsDoc } from "../place/solver.js";
import { decodeRuns } from "../territory/territory.js";
import { encodePng } from "./png.js";
import { renderTerrain, upscaleRgba } from "./heatmaps.js";

/**
 * Territory render: each territory filled in a deterministic color derived
 * from its id hash, safe zones tinted blue, placement markers on top for
 * context. Inspection evidence, not contract.
 */

function hashColor(seedText: string): readonly [number, number, number] {
  let h = 2166136261;
  for (let i = 0; i < seedText.length; i += 1) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 16777619) >>> 0;
  }
  return [70 + (h & 0x7f), 70 + ((h >>> 7) & 0x7f), 70 + ((h >>> 14) & 0x7f)];
}

export function renderTerritories(
  model: WorldModel,
  bundle: AnalysisBundle,
  territoriesDoc: TerritoriesDoc,
  placementsDoc: PlacementsDoc,
  scale: number = 1,
): Uint8Array {
  const { width, height } = model.dimensions;
  const terrain = renderTerrain(model);
  const rgba = new Uint8Array(terrain.length);
  for (let i = 0; i < terrain.length; i += 4) {
    rgba[i] = Math.floor((terrain[i] as number) / 3);
    rgba[i + 1] = Math.floor((terrain[i + 1] as number) / 3);
    rgba[i + 2] = Math.floor((terrain[i + 2] as number) / 3);
    rgba[i + 3] = 255;
  }
  for (let i = 0; i < width * height; i += 1) {
    if (bundle.safeZone[i] !== 1) continue;
    const offset = i * 4;
    rgba[offset + 2] = Math.min(255, (rgba[offset + 2] as number) + 70);
  }

  for (const territory of territoriesDoc.territories) {
    const color = hashColor(territory.id);
    for (const index of decodeRuns(territory.cells.runs, width)) {
      const offset = index * 4;
      rgba[offset] = color[0];
      rgba[offset + 1] = color[1];
      rgba[offset + 2] = color[2];
    }
  }

  const put = (x: number, y: number, r: number, g: number, b: number): void => {
    if (x < 0 || y < 0 || x >= width || y >= height) return;
    const offset = (y * width + x) * 4;
    rgba[offset] = r;
    rgba[offset + 1] = g;
    rgba[offset + 2] = b;
  };
  for (const placement of placementsDoc.placements) {
    const color: readonly [number, number, number] = placement.rule === "world_boss.v1" ? [255, 255, 255] : [80, 240, 255];
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      put(placement.cell[0] + dx, placement.cell[1] + dy, color[0], color[1], color[2]);
    }
  }

  return encodePng(width * scale, height * scale, upscaleRgba(rgba, width, height, scale));
}
