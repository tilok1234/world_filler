import { decodeBase64Grid, compareGrids, type GridMismatch } from "./world/bitgrid.js";
import { WorldModel, floodCount, type LadderRung } from "./world/model.js";
import type { LoadedPack } from "./pack/readPack.js";

/**
 * The F0 exit gate in one function: derive walkability clean-room, compare
 * bit-for-bit against the pack's reference grid, re-nudge the spawn, and
 * re-flood — every number must equal the pack's published values.
 */

export interface ParityResult {
  readonly cellCount: number;
  readonly gridMatches: boolean;
  readonly mismatchCount: number;
  readonly mismatchSamples: readonly GridMismatch[];
  readonly referenceFloodCount: number;
  readonly derivedFloodCount: number;
  readonly referenceSpawnCell: readonly [number, number];
  readonly derivedSpawnCell: readonly [number, number] | null;
  readonly rungCounts: Readonly<Record<LadderRung, number>>;
  readonly ok: boolean;
}

export function checkParity(pack: LoadedPack, model: WorldModel): ParityResult {
  const { width, height } = model.dimensions;
  const cellCount = width * height;

  const derivation = model.deriveWalkability();
  const referenceBytes = decodeBase64Grid(pack.walkability.grid, cellCount);
  const { mismatchCount, samples } = compareGrids(derivation.bits, referenceBytes, width, 20);

  const first = model.destinations[0];
  let derivedSpawnCell: readonly [number, number] | null = null;
  let derivedFloodCount = 0;
  if (first !== undefined) {
    derivedSpawnCell = model.nudgeToWalkable(first.cell[0], first.cell[1], derivation.bits);
    if (derivedSpawnCell !== null) {
      derivedFloodCount = floodCount(
        derivation.bits, width, height, derivedSpawnCell[1] * width + derivedSpawnCell[0],
      );
    }
  }

  const referenceSpawnCell = pack.walkability.spawnCell;
  const spawnMatches =
    derivedSpawnCell !== null &&
    derivedSpawnCell[0] === referenceSpawnCell[0] &&
    derivedSpawnCell[1] === referenceSpawnCell[1];

  return {
    cellCount,
    gridMatches: mismatchCount === 0,
    mismatchCount,
    mismatchSamples: samples,
    referenceFloodCount: pack.walkability.floodCount,
    derivedFloodCount,
    referenceSpawnCell: [referenceSpawnCell[0], referenceSpawnCell[1]],
    derivedSpawnCell,
    rungCounts: derivation.rungCounts,
    ok: mismatchCount === 0 && spawnMatches && derivedFloodCount === pack.walkability.floodCount,
  };
}
