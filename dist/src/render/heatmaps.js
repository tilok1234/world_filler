import { UNREACHABLE } from "../analysis/fields.js";
import { encodePng } from "./png.js";
const MATERIAL_COLORS = {
    "terrain.cobble": [138, 132, 122],
    "terrain.dry_grass": [168, 152, 88],
    "terrain.grass": [96, 138, 70],
    "terrain.gravel": [128, 122, 110],
    "terrain.mud": [110, 86, 60],
    "terrain.packed_road": [158, 134, 96],
    "terrain.rock": [92, 92, 100],
    "terrain.snow": [225, 228, 235],
    "terrain.swamp": [72, 92, 66],
    "water.deep": [36, 60, 110],
    "water.shallow": [70, 110, 160],
    "terrain.sand": [204, 186, 132],
};
const FALLBACK_COLOR = [200, 60, 200];
function heatColor(t) {
    // Dark blue -> teal -> yellow ramp, integer arithmetic on a 0..255 scale.
    const clamped = Math.max(0, Math.min(255, t));
    if (clamped < 128) {
        const k = clamped * 2;
        return [0, Math.floor((k * 200) / 255), Math.floor(80 + (k * 100) / 255)];
    }
    const k = (clamped - 128) * 2;
    return [Math.floor((k * 255) / 255), Math.floor(200 + (k * 55) / 255), Math.floor(180 - (k * 180) / 255)];
}
export function renderTerrain(model) {
    const { width, height } = model.dimensions;
    const rgba = new Uint8Array(width * height * 4);
    for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
            const color = MATERIAL_COLORS[model.materialAt(x, y)] ?? FALLBACK_COLOR;
            const offset = (y * width + x) * 4;
            rgba[offset] = color[0];
            rgba[offset + 1] = color[1];
            rgba[offset + 2] = color[2];
            rgba[offset + 3] = 255;
        }
    }
    return rgba;
}
function dimmedBase(terrain) {
    const base = new Uint8Array(terrain.length);
    for (let i = 0; i < terrain.length; i += 4) {
        base[i] = Math.floor(terrain[i] / 3);
        base[i + 1] = Math.floor(terrain[i + 1] / 3);
        base[i + 2] = Math.floor(terrain[i + 2] / 3);
        base[i + 3] = 255;
    }
    return base;
}
function overlayField(base, field, max) {
    const rgba = Uint8Array.from(base);
    const scale = max > 0 ? max : 1;
    for (let i = 0; i < field.length; i += 1) {
        const value = field[i];
        if (value === UNREACHABLE)
            continue;
        const color = heatColor(Math.floor((value * 255) / scale));
        const offset = i * 4;
        rgba[offset] = color[0];
        rgba[offset + 1] = color[1];
        rgba[offset + 2] = color[2];
    }
    return rgba;
}
function overlayMask(base, mask, color) {
    const rgba = Uint8Array.from(base);
    for (let i = 0; i < mask.length; i += 1) {
        if (mask[i] !== 1)
            continue;
        const offset = i * 4;
        rgba[offset] = color[0];
        rgba[offset + 1] = color[1];
        rgba[offset + 2] = color[2];
    }
    return rgba;
}
function overlayLabels(base, labels) {
    const rgba = Uint8Array.from(base);
    for (let i = 0; i < labels.length; i += 1) {
        const label = labels[i];
        if (label === -1)
            continue;
        // Deterministic label coloring via integer bit-mixing of the label id.
        let h = (label + 1) * 2654435761;
        h = (h ^ (h >>> 13)) >>> 0;
        const offset = i * 4;
        rgba[offset] = 60 + (h & 0x7f);
        rgba[offset + 1] = 60 + ((h >>> 7) & 0x7f);
        rgba[offset + 2] = 60 + ((h >>> 14) & 0x7f);
    }
    return rgba;
}
/** Nearest-neighbor integer upscale for inspection copies. */
export function upscaleRgba(rgba, width, height, factor) {
    if (!Number.isInteger(factor) || factor < 1 || factor > 16) {
        throw new Error(`render: scale factor must be an integer in [1, 16], got ${factor}`);
    }
    if (factor === 1)
        return Uint8Array.from(rgba);
    const out = new Uint8Array(width * factor * height * factor * 4);
    for (let y = 0; y < height * factor; y += 1) {
        const sy = Math.floor(y / factor);
        for (let x = 0; x < width * factor; x += 1) {
            const src = (sy * width + Math.floor(x / factor)) * 4;
            const dst = (y * width * factor + x) * 4;
            out[dst] = rgba[src];
            out[dst + 1] = rgba[src + 1];
            out[dst + 2] = rgba[src + 2];
            out[dst + 3] = 255;
        }
    }
    return out;
}
export function renderAnalysis(model, bundle, scale = 1) {
    const { width, height } = model.dimensions;
    const terrain = renderTerrain(model);
    const base = dimmedBase(terrain);
    const stats = bundle.summary.fieldStats;
    const clearanceMax = bundle.clearance.reduce((max, value) => (value > max ? value : max), 0);
    const layers = [
        { name: "terrain", rgba: terrain },
        { name: "walkability", rgba: overlayMask(base, bundle.bits, [120, 200, 120]) },
        {
            name: "distance-from-spawn",
            rgba: overlayField(base, bundle.distanceFromSpawn, stats["distanceFromSpawn"]?.max ?? 1),
        },
        {
            name: "distance-from-settlements",
            rgba: overlayField(base, bundle.distanceFromSettlements, stats["distanceFromSettlements"]?.max ?? 1),
        },
        {
            name: "distance-from-roads",
            rgba: overlayField(base, bundle.distanceFromRoads, stats["distanceFromRoads"]?.max ?? 1),
        },
        {
            name: "distance-from-water",
            rgba: overlayField(base, bundle.distanceFromWater, stats["distanceFromWater"]?.max ?? 1),
        },
        { name: "clearance", rgba: overlayField(base, bundle.clearance, clearanceMax) },
        { name: "corridors", rgba: overlayMask(base, bundle.corridor, [255, 90, 90]) },
        { name: "safe-zones", rgba: overlayMask(base, bundle.safeZone, [90, 170, 255]) },
        { name: "regions", rgba: overlayLabels(base, bundle.regionLabels) },
        { name: "components", rgba: overlayLabels(base, bundle.componentLabels) },
    ];
    return layers.map(({ name, rgba }) => ({
        name,
        png: encodePng(width * scale, height * scale, upscaleRgba(rgba, width, height, scale)),
    }));
}
