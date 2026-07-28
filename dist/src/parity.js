import { decodeBase64Grid, compareGrids } from "./world/bitgrid.js";
import { WorldModel, floodCount } from "./world/model.js";
export function checkParity(pack, model) {
    const { width, height } = model.dimensions;
    const cellCount = width * height;
    const derivation = model.deriveWalkability();
    const referenceBytes = decodeBase64Grid(pack.walkability.grid, cellCount);
    const { mismatchCount, samples } = compareGrids(derivation.bits, referenceBytes, width, 20);
    const first = model.destinations[0];
    let derivedSpawnCell = null;
    let derivedFloodCount = 0;
    if (first !== undefined) {
        derivedSpawnCell = model.nudgeToWalkable(first.cell[0], first.cell[1], derivation.bits);
        if (derivedSpawnCell !== null) {
            derivedFloodCount = floodCount(derivation.bits, width, height, derivedSpawnCell[1] * width + derivedSpawnCell[0]);
        }
    }
    const referenceSpawnCell = pack.walkability.spawnCell;
    const spawnMatches = derivedSpawnCell !== null &&
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
