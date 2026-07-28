import type { WorldModel } from "../world/model.js";
import type { AnalysisBundle } from "../analysis/analyze.js";
import type { TerritoriesDoc } from "../territory/territory.js";
import type { PlacementsDoc } from "../place/solver.js";
import { decodeRuns } from "../territory/territory.js";
import { encodePng } from "./png.js";
import { renderTerrain, upscaleRgba } from "./heatmaps.js";
import { bandColor } from "./planRender.js";

/**
 * Territory render: each territory filled with its danger band's color
 * (same palette as the danger render, so the two maps read together:
 * harder enemies live in deeper-band ground), edge cells darkened so
 * adjacent territories stay distinguishable, safe zones tinted blue,
 * placement markers on top for context. Inspection evidence, not
 * contract.
 */

export function renderTerritories(
  model: WorldModel,
  bundle: AnalysisBundle,
  territoriesDoc: TerritoriesDoc,
  placementsDoc: PlacementsDoc,
  bandCount: number,
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
    const color = bandColor(territory.dangerBand, bandCount);
    const cells = decodeRuns(territory.cells.runs, width, height);
    for (const index of cells) {
      const x = index % width;
      const y = (index - x) / width;
      // Edge cells (any 4-neighbor outside this territory) draw darker,
      // outlining each territory against neighbors and open ground.
      let edge = false;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height || !cells.has(ny * width + nx)) {
          edge = true;
          break;
        }
      }
      const offset = index * 4;
      const dim = edge ? 5 : 10;
      rgba[offset] = Math.floor((color[0] * dim) / 10);
      rgba[offset + 1] = Math.floor((color[1] * dim) / 10);
      rgba[offset + 2] = Math.floor((color[2] * dim) / 10);
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
