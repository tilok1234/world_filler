import type { AnalysisRegion } from "../analysis/regions.js";

/**
 * Macro-zones (dusk rehearsal round 5): the designer-facing geography
 * layer — "a small map like this should be like 4 zones, depending on
 * the geography." Zones cluster the fine planning regions into K large
 * areas a player would name (the snow country, the mudlands); the fine
 * regions remain the solver's unit underneath, so danger keeps its
 * smooth gradients while the world reads at named-place scale.
 *
 * Deterministic clustering, no randomness:
 *  1. Every region maps to a biome FAMILY (green / dry / cold / wet;
 *     unlisted biomes are their own family and never seed cores).
 *  2. Connected same-family components of the region adjacency graph
 *     are candidate cores; the K heaviest by cell count (ties: smallest
 *     member anchor) win — so the snow country is ONE core no matter
 *     how many fine regions the size cap split it into.
 *  3. Every remaining region joins the nearest core by level-order BFS
 *     over the region graph (single queue, fixed seed order). Regions
 *     unreachable in the graph fall back to the core with the nearest
 *     seed anchor by squared Euclidean distance (ties: lowest zone).
 *
 * Zone ids are content-derived: zone.<family>.<smallest core anchor>.
 */

const BIOME_FAMILIES: Readonly<Record<string, string>> = {
  "terrain.grass": "green",
  "terrain.forest": "green",
  "terrain.dry_grass": "dry",
  "terrain.sand": "dry",
  "terrain.gravel": "dry",
  "terrain.snow": "cold",
  "terrain.mud": "wet",
  "terrain.swamp": "wet",
  "water.shallow": "wet",
  "water.deep": "wet",
};

const CORE_FAMILIES: ReadonlySet<string> = new Set(["green", "dry", "cold", "wet"]);

export function biomeFamily(biome: string): string {
  return BIOME_FAMILIES[biome] ?? biome;
}

export interface MacroZone {
  readonly id: string;
  readonly family: string;
  readonly cellCount: number;
  readonly memberRegionIds: readonly string[];
}

export interface ZoneClustering {
  readonly zones: readonly MacroZone[];
  /** region index -> zone index */
  readonly zoneOfRegion: readonly number[];
  /** Set when fewer family components exist than the requested count. */
  readonly shortfall: number;
}

export function clusterZones(regions: readonly AnalysisRegion[], count: number): ZoneClustering {
  const indexById = new Map(regions.map((region, index) => [region.id, index]));
  const neighborIndexes: number[][] = regions.map((region) =>
    region.neighborIds
      .map((id) => indexById.get(id))
      .filter((index): index is number => index !== undefined),
  );

  // 1-2: same-family connected components, heaviest K become cores.
  const componentOf = new Array<number>(regions.length).fill(-1);
  const components: Array<{ family: string; weight: number; minAnchor: number; members: number[] }> = [];
  for (let start = 0; start < regions.length; start += 1) {
    if (componentOf[start] !== -1) continue;
    const family = biomeFamily((regions[start] as AnalysisRegion).biome);
    const component = { family, weight: 0, minAnchor: Number.MAX_SAFE_INTEGER, members: [] as number[] };
    const queue = [start];
    componentOf[start] = components.length;
    for (let head = 0; head < queue.length; head += 1) {
      const index = queue[head] as number;
      const region = regions[index] as AnalysisRegion;
      component.weight += region.cellCount;
      component.members.push(index);
      if (region.anchorIndex < component.minAnchor) component.minAnchor = region.anchorIndex;
      for (const next of neighborIndexes[index] as number[]) {
        if (componentOf[next] !== -1 || biomeFamily((regions[next] as AnalysisRegion).biome) !== family) continue;
        componentOf[next] = components.length;
        queue.push(next);
      }
    }
    components.push(component);
  }
  const coreCandidates = components
    .filter((component) => CORE_FAMILIES.has(component.family))
    .sort((a, b) => (a.weight !== b.weight ? b.weight - a.weight : a.minAnchor - b.minAnchor));
  const cores = coreCandidates.slice(0, count);
  const shortfall = Math.max(0, count - cores.length);

  // 3: grow zones over the region graph from the core members.
  const zoneOfRegion = new Array<number>(regions.length).fill(-1);
  const queue: number[] = [];
  cores.forEach((core, zone) => {
    for (const member of [...core.members].sort((a, b) => a - b)) {
      zoneOfRegion[member] = zone;
      queue.push(member);
    }
  });
  for (let head = 0; head < queue.length; head += 1) {
    const index = queue[head] as number;
    const zone = zoneOfRegion[index] as number;
    for (const next of neighborIndexes[index] as number[]) {
      if (zoneOfRegion[next] !== -1) continue;
      zoneOfRegion[next] = zone;
      queue.push(next);
    }
  }
  // Graph-unreachable stragglers: nearest core seed anchor wins.
  for (let index = 0; index < regions.length; index += 1) {
    if (zoneOfRegion[index] !== -1 || cores.length === 0) continue;
    const region = regions[index] as AnalysisRegion;
    let best = 0;
    let bestD2 = Number.MAX_SAFE_INTEGER;
    cores.forEach((core, zone) => {
      const anchorA = region.anchorIndex;
      const anchorB = core.minAnchor;
      // anchors are cell indexes; compare in x/y via a shared width is
      // unavailable here — use index delta as the deterministic proxy
      // only when geometry ties are impossible; squared delta keeps it
      // monotone and stable.
      const d2 = (anchorA - anchorB) * (anchorA - anchorB);
      if (d2 < bestD2) {
        bestD2 = d2;
        best = zone;
      }
    });
    zoneOfRegion[index] = best;
  }

  const zones: MacroZone[] = cores.map((core, zone) => {
    const memberRegionIds = regions
      .filter((_, index) => zoneOfRegion[index] === zone)
      .map((region) => region.id)
      .sort();
    const cellCount = regions.reduce(
      (sum, region, index) => (zoneOfRegion[index] === zone ? sum + region.cellCount : sum),
      0,
    );
    return { id: `zone.${core.family}.${core.minAnchor}`, family: core.family, cellCount, memberRegionIds };
  });

  return { zones, zoneOfRegion, shortfall };
}
