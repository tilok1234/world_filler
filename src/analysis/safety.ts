import type { WorldModel } from "../world/model.js";

/**
 * Safe-zone mask: cells no hostile content may claim. v1 covers each
 * settlement's disc (integer squared-distance against its recorded radius)
 * plus its approaches — trail and road-corridor cells within radius + 4.
 * Integer math only.
 */

const APPROACH_MARGIN = 4;
const CORRIDOR_MATERIALS: ReadonlySet<string> = new Set(["terrain.packed_road", "terrain.cobble"]);

export function safeZoneMask(model: WorldModel): Uint8Array {
  const { width, height } = model.dimensions;
  const mask = new Uint8Array(width * height);
  for (const settlement of model.settlements) {
    const [ax, ay] = settlement.anchor;
    const radius = settlement.radius;
    const approach = radius + APPROACH_MARGIN;
    const r2 = radius * radius;
    const a2 = approach * approach;
    const x0 = Math.max(0, ax - approach);
    const y0 = Math.max(0, ay - approach);
    const x1 = Math.min(width - 1, ax + approach);
    const y1 = Math.min(height - 1, ay + approach);
    for (let y = y0; y <= y1; y += 1) {
      for (let x = x0; x <= x1; x += 1) {
        const dx = x - ax;
        const dy = y - ay;
        const d2 = dx * dx + dy * dy;
        if (d2 <= r2) {
          mask[y * width + x] = 1;
          continue;
        }
        if (d2 <= a2 && (model.trailAt(x, y) || CORRIDOR_MATERIALS.has(model.materialAt(x, y)))) {
          mask[y * width + x] = 1;
        }
      }
    }
  }
  return mask;
}
