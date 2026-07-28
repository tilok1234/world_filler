import { encodePng } from "./png.js";
import { renderTerrain, upscaleRgba } from "./heatmaps.js";
const BAND0 = [90, 150, 230];
const RAMP = [
    [90, 180, 95],
    [225, 205, 80],
    [220, 80, 60],
    [155, 60, 190],
];
function bandColor(band, bandCount) {
    if (band === 0)
        return BAND0;
    const steps = Math.max(1, bandCount - 2);
    const t = ((band - 1) * (RAMP.length - 1) * 256) / steps;
    const segment = Math.min(RAMP.length - 2, Math.floor(t / 256));
    const frac = Math.min(255, Math.floor(t - segment * 256));
    const from = RAMP[segment];
    const to = RAMP[segment + 1];
    return [
        from[0] + Math.floor(((to[0] - from[0]) * frac) / 255),
        from[1] + Math.floor(((to[1] - from[1]) * frac) / 255),
        from[2] + Math.floor(((to[2] - from[2]) * frac) / 255),
    ];
}
export function renderDanger(model, bundle, plan, bandCount, scale = 1) {
    const { width, height } = model.dimensions;
    const terrain = renderTerrain(model);
    const rgba = new Uint8Array(terrain.length);
    for (let i = 0; i < terrain.length; i += 4) {
        rgba[i] = Math.floor(terrain[i] / 3);
        rgba[i + 1] = Math.floor(terrain[i + 1] / 3);
        rgba[i + 2] = Math.floor(terrain[i + 2] / 3);
        rgba[i + 3] = 255;
    }
    const bandByLabel = new Map(plan.regions.map((region) => [region.id, region.dangerBand]));
    const labelToId = bundle.regions.map((region) => region.id);
    for (let index = 0; index < width * height; index += 1) {
        const label = bundle.regionLabels[index];
        if (label === -1)
            continue;
        const band = bandByLabel.get(labelToId[label]);
        if (band === null || band === undefined)
            continue;
        const color = bandColor(band, bandCount);
        const offset = index * 4;
        rgba[offset] = color[0];
        rgba[offset + 1] = color[1];
        rgba[offset + 2] = color[2];
    }
    return encodePng(width * scale, height * scale, upscaleRgba(rgba, width, height, scale));
}
