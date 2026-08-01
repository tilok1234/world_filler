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
  return maskWithRadii(model, model.settlements.map((settlement) => settlement.radius));
}

/**
 * Recipe-scaled sanctuary (dusk round 7, "reduce the safe zones on
 * towns where we can"): each settlement kind scales its recorded safe
 * radius by a permille knob, floored at the settlement's BUILT-UP
 * radius (the farthest structure cell + 2) so no building ever stands
 * outside sanctuary — that floor is the "where we can". All knobs at
 * 1000 reproduce safeZoneMask byte-for-byte. Danger relief belts key
 * on the recorded radius, deliberately untouched: shrinking sanctuary
 * moves CONTENT closer to town; it does not make town ground deadly.
 */
export interface SafetyScaling {
  readonly cityRadiusPermille: number;
  readonly townRadiusPermille: number;
  readonly outpostRadiusPermille: number;
}

export function effectiveSafeZoneMask(model: WorldModel, safety: SafetyScaling): Uint8Array {
  const permilleFor = (kind: string): number =>
    kind === "city" ? safety.cityRadiusPermille
    : kind === "town" ? safety.townRadiusPermille
    : kind === "outpost" ? safety.outpostRadiusPermille
    : 1000;
  const radii = model.settlements.map((settlement) => {
    const [ax, ay] = settlement.anchor;
    let maxD2 = 0;
    for (const structure of settlement.structures) {
      const [sx, sy] = structure.cell;
      const [fw, fh] = structure.footprint;
      for (const [cx, cy] of [[sx, sy], [sx + fw - 1, sy], [sx, sy + fh - 1], [sx + fw - 1, sy + fh - 1]] as const) {
        const dx = cx - ax;
        const dy = cy - ay;
        const d2 = dx * dx + dy * dy;
        if (d2 > maxD2) maxD2 = d2;
      }
    }
    let builtUp = 0;
    while (builtUp * builtUp < maxD2) builtUp += 1;
    const scaled = Math.floor((settlement.radius * permilleFor(settlement.kind)) / 1000);
    return Math.min(settlement.radius, Math.max(builtUp + 2, scaled));
  });
  return maskWithRadii(model, radii);
}

function maskWithRadii(model: WorldModel, radii: readonly number[]): Uint8Array {
  const { width, height } = model.dimensions;
  const mask = new Uint8Array(width * height);
  for (let s = 0; s < model.settlements.length; s += 1) {
    const settlement = model.settlements[s] as (typeof model.settlements)[number];
    const [ax, ay] = settlement.anchor;
    const radius = radii[s] as number;
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
