import type { WorldModel } from "../world/model.js";
import type { AnalysisBundle } from "../analysis/analyze.js";
import type { PlacementsDoc } from "../place/solver.js";
import { encodePng } from "./png.js";
import { renderTerrain, upscaleRgba } from "./heatmaps.js";

/**
 * Placement render: dimmed terrain, faint safe zones, exclusion discs as
 * tint, arena squares filled, and bright markers on every placement cell
 * (white plus = world boss, cyan plus = dungeon binding, amber plus =
 * encounter site). Inspection evidence, not contract.
 */

function put(rgba: Uint8Array, width: number, height: number, x: number, y: number, r: number, g: number, b: number): void {
  if (x < 0 || y < 0 || x >= width || y >= height) return;
  const offset = (y * width + x) * 4;
  rgba[offset] = r;
  rgba[offset + 1] = g;
  rgba[offset + 2] = b;
}

export function renderPlacements(
  model: WorldModel,
  bundle: AnalysisBundle,
  doc: PlacementsDoc,
  scale: number = 1,
): Uint8Array {
  const { width, height } = model.dimensions;
  const terrain = renderTerrain(model);
  const rgba = new Uint8Array(terrain.length);
  for (let i = 0; i < terrain.length; i += 4) {
    rgba[i] = Math.floor(((terrain[i] as number) * 2) / 5);
    rgba[i + 1] = Math.floor(((terrain[i + 1] as number) * 2) / 5);
    rgba[i + 2] = Math.floor(((terrain[i + 2] as number) * 2) / 5);
    rgba[i + 3] = 255;
  }
  for (let i = 0; i < width * height; i += 1) {
    if (bundle.safeZone[i] !== 1) continue;
    const offset = i * 4;
    rgba[offset] = Math.min(255, (rgba[offset] as number) + 20);
    rgba[offset + 2] = Math.min(255, (rgba[offset + 2] as number) + 60);
  }

  for (const placement of doc.placements) {
    const [cx, cy] = placement.cell;
    const r2 = placement.exclusionRadius * placement.exclusionRadius;
    for (let y = Math.max(0, cy - placement.exclusionRadius); y <= Math.min(height - 1, cy + placement.exclusionRadius); y += 1) {
      for (let x = Math.max(0, cx - placement.exclusionRadius); x <= Math.min(width - 1, cx + placement.exclusionRadius); x += 1) {
        const dx = x - cx;
        const dy = y - cy;
        if (dx * dx + dy * dy > r2) continue;
        const offset = (y * width + x) * 4;
        if (placement.rule === "world_boss.v1") {
          rgba[offset] = Math.min(255, (rgba[offset] as number) + 55);
        } else if (placement.rule === "encounter_site.v1") {
          rgba[offset] = Math.min(255, (rgba[offset] as number) + 40);
          rgba[offset + 1] = Math.min(255, (rgba[offset + 1] as number) + 30);
        } else {
          rgba[offset + 1] = Math.min(255, (rgba[offset + 1] as number) + 45);
          rgba[offset + 2] = Math.min(255, (rgba[offset + 2] as number) + 45);
        }
      }
    }
    if (placement.arenaSide !== null && placement.arenaOrigin !== null) {
      const [ox, oy] = placement.arenaOrigin;
      for (let y = oy; y <= oy + placement.arenaSide - 1; y += 1) {
        for (let x = ox; x <= ox + placement.arenaSide - 1; x += 1) {
          put(rgba, width, height, x, y, 200, 60, 60);
        }
      }
    }
  }

  // Located failure markers: a red X on the failing region's anchor cell,
  // so exhaustion is visible on the map, not only in the report.
  for (const failure of doc.failures) {
    const region = bundle.regions.find((entry) => entry.id === failure.regionId);
    if (region === undefined) continue;
    const fx = region.anchorIndex % width;
    const fy = (region.anchorIndex - fx) / width;
    for (let d = -3; d <= 3; d += 1) {
      put(rgba, width, height, fx + d, fy + d, 255, 40, 40);
      put(rgba, width, height, fx + d, fy - d, 255, 40, 40);
    }
  }

  for (const placement of doc.placements) {
    const [cx, cy] = placement.cell;
    const color: readonly [number, number, number] =
      placement.rule === "world_boss.v1" ? [255, 255, 255]
      : placement.rule === "encounter_site.v1" ? [255, 190, 70]
      : [80, 240, 255];
    for (const [dx, dy] of [[0, 0], [1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      put(rgba, width, height, cx + dx, cy + dy, color[0], color[1], color[2]);
    }
  }

  return encodePng(width * scale, height * scale, upscaleRgba(rgba, width, height, scale));
}
