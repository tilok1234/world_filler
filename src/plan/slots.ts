import type { WorldModel } from "../world/model.js";
import type { AnalysisBundle } from "../analysis/analyze.js";
import type { ZoneClustering } from "./zones.js";

/**
 * Slice-support layers (dusk round 10, sl-0086): light, deterministic
 * anchor layers the game-side reference pass hangs hand-authored
 * content on. Never placements — these ride the plan as optional keys
 * (the zones precedent), so no pack-format change.
 *
 * Giver slots: 2–3 per zone at the zone's settlements first (largest
 * recorded radius wins, anchor cell), then structure-bearing POIs
 * (smallest poi id wins, poi cell) — plus the capital's system-NPC
 * slots (fisher / herbalist / crafter / banker / faction_rep) when the
 * layer is on. Every slot carries a purposefulness reason tag from a
 * small append-only vocabulary.
 *
 * Gather spots: per zone, up to N fishing spots (walkable cells
 * touching water or river, nearest-to-routes first — collection is
 * stumbled on, like encounters) and N foraging spots (walkable cells
 * carrying carpet flora props), each with a Chebyshev spacing floor so
 * spots spread instead of clustering on one shore.
 */

export interface GiverSlot {
  readonly id: string;
  readonly zoneId: string;
  readonly kind: "settlement" | "poi" | "system";
  readonly role: string | null;
  readonly cell: readonly [number, number];
  readonly reason: string;
}

export interface GatherSpot {
  readonly id: string;
  readonly zoneId: string;
  readonly kind: "fishing" | "foraging";
  readonly cell: readonly [number, number];
}

const SYSTEM_ROLES: readonly string[] = ["fisher", "herbalist", "crafter", "banker", "faction_rep"];

const FLORA_PROPS: ReadonlySet<string> = new Set([
  "prop.bush", "prop.flowers", "prop.mushrooms", "prop.ferns", "prop.reeds",
  "prop.cattails", "prop.snow_shrub", "prop.desert_shrub",
]);

const WATER_MATERIALS: ReadonlySet<string> = new Set(["water.deep", "water.shallow"]);

const SPOT_SPACING = 8;

function zoneOfCell(
  bundle: AnalysisBundle,
  zones: ZoneClustering,
  width: number,
  x: number,
  y: number,
): number {
  const label = bundle.regionLabels[y * width + x] as number;
  if (label === -1) return -1;
  return (zones.zoneOfRegion[label] as number) ?? -1;
}

export function giverSlots(
  model: WorldModel,
  bundle: AnalysisBundle,
  zones: ZoneClustering,
  homeZone: number,
  perZone: number,
): GiverSlot[] {
  const { width } = model.dimensions;
  const slots: GiverSlot[] = [];

  // Capital system slots: the settlement whose anchor region holds the
  // spawn's zone and has the largest recorded radius there.
  const settlementZone = (settlement: (typeof model.settlements)[number]): number =>
    zoneOfCell(bundle, zones, width, settlement.anchor[0], settlement.anchor[1]);
  const capital = [...model.settlements]
    .filter((settlement) => settlementZone(settlement) === homeZone)
    .sort((a, b) => (a.radius !== b.radius ? b.radius - a.radius : a.id - b.id))[0];
  if (capital !== undefined) {
    for (const role of SYSTEM_ROLES) {
      slots.push({
        id: `giver.system.${role}`,
        zoneId: (zones.zones[homeZone]?.id ?? "zone.unassigned") as string,
        kind: "system",
        role,
        cell: [capital.anchor[0], capital.anchor[1]],
        reason: "capital_system_npc",
      });
    }
  }

  for (let zone = 0; zone < zones.zones.length; zone += 1) {
    const zoneId = (zones.zones[zone] as { id: string }).id;
    let taken = 0;
    const settlements = [...model.settlements]
      .filter((settlement) => settlementZone(settlement) === zone)
      .sort((a, b) => (a.radius !== b.radius ? b.radius - a.radius : a.id - b.id));
    for (const settlement of settlements) {
      if (taken >= perZone) break;
      slots.push({
        id: `giver.${zoneId}.${taken}`,
        zoneId,
        kind: "settlement",
        role: null,
        cell: [settlement.anchor[0], settlement.anchor[1]],
        reason: taken === 0 ? "zone_hub" : "waystation",
      });
      taken += 1;
    }
    const pois = [...model.pois]
      .filter((poi) => poi.structure !== undefined && zoneOfCell(bundle, zones, width, poi.cell[0], poi.cell[1]) === zone)
      .sort((a, b) => a.id - b.id);
    for (const poi of pois) {
      if (taken >= perZone) break;
      slots.push({
        id: `giver.${zoneId}.${taken}`,
        zoneId,
        kind: "poi",
        role: null,
        cell: [poi.cell[0], poi.cell[1]],
        reason: "landmark_poi",
      });
      taken += 1;
    }
  }
  return slots;
}

export function gatherSpots(
  model: WorldModel,
  bundle: AnalysisBundle,
  zones: ZoneClustering,
  perZone: number,
): GatherSpot[] {
  const { width, height } = model.dimensions;
  const spots: GatherSpot[] = [];

  const touchesWater = (x: number, y: number): boolean => {
    for (const [dx, dy] of [[0, -1], [1, 0], [0, 1], [-1, 0]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      if (WATER_MATERIALS.has(model.materialAt(nx, ny)) || model.riverTierAt(nx, ny) > 0) return true;
    }
    return false;
  };

  interface Candidate {
    readonly x: number;
    readonly y: number;
    readonly zone: number;
    readonly roadDistance: number;
  }
  const fishing: Candidate[] = [];
  const foraging: Candidate[] = [];
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const index = y * width + x;
      if (bundle.bits[index] !== 1) continue;
      const zone = zoneOfCell(bundle, zones, width, x, y);
      if (zone === -1) continue;
      const roadDistance = bundle.distanceFromRoads[index] as number;
      if (touchesWater(x, y)) fishing.push({ x, y, zone, roadDistance });
      const prop = model.propAt(x, y);
      if (prop !== null && FLORA_PROPS.has(prop)) foraging.push({ x, y, zone, roadDistance });
    }
  }

  // Stumble-on doctrine: nearest to travel routes first; row-major index
  // breaks ties. A Chebyshev spacing floor spreads the picks.
  const pick = (candidates: Candidate[], kind: "fishing" | "foraging"): void => {
    candidates.sort((a, b) =>
      a.roadDistance !== b.roadDistance ? a.roadDistance - b.roadDistance : (a.y * width + a.x) - (b.y * width + b.x),
    );
    const takenByZone = new Map<number, Array<readonly [number, number]>>();
    for (const candidate of candidates) {
      const taken = takenByZone.get(candidate.zone) ?? [];
      if (taken.length >= perZone) continue;
      if (taken.some(([tx, ty]) => Math.max(Math.abs(tx - candidate.x), Math.abs(ty - candidate.y)) < SPOT_SPACING)) {
        continue;
      }
      taken.push([candidate.x, candidate.y]);
      takenByZone.set(candidate.zone, taken);
      const zoneId = (zones.zones[candidate.zone] as { id: string }).id;
      spots.push({
        id: `gather.${kind}.${zoneId}.${taken.length - 1}`,
        zoneId,
        kind,
        cell: [candidate.x, candidate.y],
      });
    }
  };
  pick(fishing, "fishing");
  pick(foraging, "foraging");

  spots.sort((a, b) => (a.id < b.id ? -1 : 1));
  return spots;
}
