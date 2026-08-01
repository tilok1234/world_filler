import type { WorldModel } from "../world/model.js";
import type { AnalysisBundle } from "../analysis/analyze.js";
import type { RegionalPlan } from "../plan/plan.js";
import { encodePng } from "./png.js";
import { renderTerrain, upscaleRgba } from "./heatmaps.js";

/**
 * Danger-band render: each region tinted by its band over a dimmed
 * terrain base. Band 0 (civilized/safe ground) is BLUE — town land as
 * friendly cartography (dusk round-9 wish "cities or safe zones had a
 * color") — with the sanctuary cells themselves a brighter light blue
 * so city cores glow inside their settled country. Blue never touches
 * the wilderness ramp (green -> yellow -> red -> purple), so it cannot
 * be misread as a danger rung the way the round-3 gradient was.
 * Unbanded regions (unreachable) stay dim. Inspection evidence, not
 * contract.
 */

type Rgb = readonly [number, number, number];

const BAND0: Rgb = [95, 155, 235];
const SANCTUARY: Rgb = [155, 200, 250];
const RAMP: readonly Rgb[] = [
  [90, 180, 95],
  [225, 205, 80],
  [220, 80, 60],
  [155, 60, 190],
];

/** Fixed zone palette: distinct hues, index-stable (append-only). */
const ZONE_COLORS: readonly Rgb[] = [
  [96, 165, 120],  // green country
  [200, 160, 90],  // dry country
  [150, 170, 220], // cold country
  [140, 110, 170], // wetlands
  [210, 120, 110],
  [110, 190, 190],
  [190, 190, 110],
  [170, 130, 130],
];

/**
 * Macro-zone render: each zone filled with its palette color over the
 * dim terrain base, zone borders darkened. Cells inherit the zone of
 * their region; void cells stay dim terrain.
 */
export function renderZones(
  model: WorldModel,
  bundle: AnalysisBundle,
  plan: RegionalPlan,
  scale: number = 1,
): Uint8Array {
  const { width, height } = model.dimensions;
  const zones = plan.zones ?? [];
  const zoneOfRegionId = new Map<string, number>();
  zones.forEach((zone, index) => {
    for (const regionId of zone.memberRegionIds) zoneOfRegionId.set(regionId, index);
  });
  const regionIdByLabel = new Map<number, string>();
  bundle.regions.forEach((region, index) => regionIdByLabel.set(index, region.id));

  const zoneAt = new Int32Array(width * height).fill(-1);
  for (let i = 0; i < width * height; i += 1) {
    const label = bundle.regionLabels[i] as number;
    if (label === -1) continue;
    const regionId = regionIdByLabel.get(label);
    if (regionId === undefined) continue;
    const zone = zoneOfRegionId.get(regionId);
    if (zone !== undefined) zoneAt[i] = zone;
  }

  const terrain = renderTerrain(model);
  const rgba = new Uint8Array(terrain.length);
  for (let i = 0; i < terrain.length; i += 4) {
    rgba[i] = Math.floor(((terrain[i] as number) * 11) / 20);
    rgba[i + 1] = Math.floor(((terrain[i + 1] as number) * 11) / 20);
    rgba[i + 2] = Math.floor(((terrain[i + 2] as number) * 11) / 20);
    rgba[i + 3] = 255;
  }
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      const zone = zoneAt[index] as number;
      if (zone === -1) continue;
      const color = ZONE_COLORS[zone % ZONE_COLORS.length] as Rgb;
      let edge = false;
      for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
        const nx = x + dx;
        const ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
        const other = zoneAt[ny * width + nx] as number;
        if (other !== -1 && other !== zone) edge = true;
      }
      const dim = edge ? 4 : 10;
      const offset = index * 4;
      rgba[offset] = Math.floor(((color[0] as number) * dim) / 10);
      rgba[offset + 1] = Math.floor(((color[1] as number) * dim) / 10);
      rgba[offset + 2] = Math.floor(((color[2] as number) * dim) / 10);
    }
  }
  return encodePng(width * scale, height * scale, upscaleRgba(rgba, width, height, scale));
}

export function bandColor(band: number, bandCount: number): Rgb {
  if (band === 0) return BAND0;
  const steps = Math.max(1, bandCount - 2);
  const t = ((band - 1) * (RAMP.length - 1) * 256) / steps;
  const segment = Math.min(RAMP.length - 2, Math.floor(t / 256));
  const frac = Math.min(255, Math.floor(t - segment * 256));
  const from = RAMP[segment] as Rgb;
  const to = RAMP[segment + 1] as Rgb;
  return [
    from[0] + Math.floor(((to[0] - from[0]) * frac) / 255),
    from[1] + Math.floor(((to[1] - from[1]) * frac) / 255),
    from[2] + Math.floor(((to[2] - from[2]) * frac) / 255),
  ];
}

export function renderDanger(
  model: WorldModel,
  bundle: AnalysisBundle,
  plan: RegionalPlan,
  bandCount: number,
  scale: number = 1,
): Uint8Array {
  const { width, height } = model.dimensions;
  const terrain = renderTerrain(model);
  const rgba = new Uint8Array(terrain.length);
  // Unbanded ground keeps enough terrain brightness to read as geography
  // (mountains, water) rather than void; band tints overwrite the rest.
  for (let i = 0; i < terrain.length; i += 4) {
    rgba[i] = Math.floor(((terrain[i] as number) * 11) / 20);
    rgba[i + 1] = Math.floor(((terrain[i + 1] as number) * 11) / 20);
    rgba[i + 2] = Math.floor(((terrain[i + 2] as number) * 11) / 20);
    rgba[i + 3] = 255;
  }

  const bandByLabel = new Map<string, number | null>(plan.regions.map((region) => [region.id, region.dangerBand]));
  const labelToId = bundle.regions.map((region) => region.id);

  for (let index = 0; index < width * height; index += 1) {
    const label = bundle.regionLabels[index] as number;
    if (label === -1) continue;
    const band = bandByLabel.get(labelToId[label] as string);
    if (band === null || band === undefined) continue;
    const color = band === 0 && bundle.safeZone[index] === 1 ? SANCTUARY : bandColor(band, bandCount);
    const offset = index * 4;
    rgba[offset] = color[0];
    rgba[offset + 1] = color[1];
    rgba[offset + 2] = color[2];
  }

  return encodePng(width * scale, height * scale, upscaleRgba(rgba, width, height, scale));
}
