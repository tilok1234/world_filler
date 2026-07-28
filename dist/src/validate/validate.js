import { recipeSha256 } from "../recipe/schema.js";
import { decodeRuns } from "../territory/territory.js";
import { UNREACHABLE } from "../analysis/fields.js";
import { canonicalJson } from "../core/canonicalJson.js";
import { ANALYSIS_VERSION } from "../analysis/analyze.js";
import { DIRECTOR_BEHAVIOR_VERSION, REPORT_FORMAT, RULE_PACK_VERSIONS } from "../core/version.js";
function gate(id, name, details, failed, warned = false) {
    return { id, name, status: failed ? "fail" : warned || details.length > 0 ? "warn" : "pass", details };
}
function hardGate(id, name, details) {
    return { id, name, status: details.length > 0 ? "fail" : "pass", details };
}
export function runGates(inputs) {
    const { model, bundle, plan, placements, territories, recipe, strict } = inputs;
    const { width, height } = model.dimensions;
    const gates = [];
    // G1 — placement ground truth.
    {
        const details = [];
        const ids = new Set();
        for (const placement of placements.placements) {
            if (ids.has(placement.id))
                details.push(`duplicate placement id ${placement.id}`);
            ids.add(placement.id);
            const [ax, ay] = placement.accessCell;
            if (ax < 0 || ay < 0 || ax >= width || ay >= height) {
                details.push(`${placement.id} access cell out of bounds`);
                continue;
            }
            const accessIndex = ay * width + ax;
            if (bundle.bits[accessIndex] !== 1)
                details.push(`${placement.id} access cell (${ax}, ${ay}) is not walkable`);
            if (bundle.distanceFromSpawn[accessIndex] === UNREACHABLE) {
                details.push(`${placement.id} access cell (${ax}, ${ay}) is unreachable from spawn`);
            }
            if (placement.rule === "world_boss.v1") {
                if (placement.arenaOrigin === null || placement.arenaSide === null) {
                    details.push(`${placement.id} carries no arena`);
                    continue;
                }
                const [ox, oy] = placement.arenaOrigin;
                for (let y = oy; y < oy + placement.arenaSide; y += 1) {
                    for (let x = ox; x < ox + placement.arenaSide; x += 1) {
                        if (x < 0 || y < 0 || x >= width || y >= height) {
                            details.push(`${placement.id} arena cell (${x}, ${y}) out of bounds`);
                            continue;
                        }
                        const index = y * width + x;
                        if (bundle.bits[index] !== 1)
                            details.push(`${placement.id} arena cell (${x}, ${y}) is not walkable`);
                        if (bundle.safeZone[index] === 1)
                            details.push(`${placement.id} arena cell (${x}, ${y}) is inside a safe zone`);
                    }
                }
            }
        }
        gates.push(hardGate("G1", "placements on valid ground", details));
    }
    // G2 — symmetric exclusion between placements.
    {
        const details = [];
        for (const a of placements.placements) {
            for (const b of placements.placements) {
                if (a.id === b.id)
                    continue;
                const cells = [];
                if (a.rule === "world_boss.v1" && a.arenaOrigin !== null && a.arenaSide !== null) {
                    for (let y = a.arenaOrigin[1]; y < a.arenaOrigin[1] + a.arenaSide; y += 1) {
                        for (let x = a.arenaOrigin[0]; x < a.arenaOrigin[0] + a.arenaSide; x += 1)
                            cells.push([x, y]);
                    }
                }
                else {
                    cells.push(a.cell);
                }
                const r2 = b.exclusionRadius * b.exclusionRadius;
                for (const [px, py] of cells) {
                    const dx = px - b.cell[0];
                    const dy = py - b.cell[1];
                    if (dx * dx + dy * dy <= r2) {
                        details.push(`${a.id} physical cell (${px}, ${py}) sits inside the exclusion of ${b.id}`);
                        break;
                    }
                }
            }
        }
        gates.push(hardGate("G2", "exclusion symmetry", details));
    }
    // G3 — territory ground truth and disjointness.
    {
        const details = [];
        const owner = new Map();
        const labelById = new Map(bundle.regions.map((region, label) => [region.id, label]));
        for (const territory of territories.territories) {
            const cells = decodeRuns(territory.cells.runs, width);
            if (cells.size !== territory.cellCount)
                details.push(`${territory.id} cellCount mismatch`);
            const label = labelById.get(territory.regionId);
            for (const index of cells) {
                const x = index % width;
                const y = (index - x) / width;
                if (bundle.bits[index] !== 1)
                    details.push(`${territory.id} cell (${x}, ${y}) not walkable`);
                if (bundle.distanceFromSpawn[index] === UNREACHABLE)
                    details.push(`${territory.id} cell (${x}, ${y}) unreachable`);
                if (bundle.safeZone[index] === 1)
                    details.push(`${territory.id} cell (${x}, ${y}) in a safe zone`);
                if (bundle.regionLabels[index] !== label)
                    details.push(`${territory.id} cell (${x}, ${y}) outside its region`);
                const existing = owner.get(index);
                if (existing !== undefined)
                    details.push(`${territory.id} cell (${x}, ${y}) already owned by ${existing}`);
                owner.set(index, territory.id);
                for (const placement of placements.placements) {
                    const r2 = placement.exclusionRadius * placement.exclusionRadius;
                    const dx = x - placement.cell[0];
                    const dy = y - placement.cell[1];
                    if (dx * dx + dy * dy <= r2) {
                        details.push(`${territory.id} cell (${x}, ${y}) inside the exclusion of ${placement.id}`);
                        break;
                    }
                }
            }
        }
        gates.push(hardGate("G3", "territories on valid ground", details.slice(0, 40)));
    }
    // G4 — budget accounting: every planned slot places, fails, or waives.
    {
        const details = [];
        for (const region of plan.regions) {
            const bosses = placements.placements.filter((p) => p.rule === "world_boss.v1" && p.regionId === region.id).length;
            const bossFailures = placements.failures.filter((f) => f.rule === "world_boss.v1" && f.regionId === region.id).length;
            if (bosses + bossFailures < region.budgets.worldBosses) {
                details.push(`${region.id}: ${region.budgets.worldBosses} boss budget, ${bosses} placed, ${bossFailures} failed — unaccounted`);
            }
            const dungeons = placements.placements.filter((p) => p.rule === "dungeon_binding.v1" && p.regionId === region.id).length;
            const dungeonFailed = placements.failures.some((f) => f.rule === "dungeon_binding.v1" && f.regionId === region.id);
            if (dungeons < region.budgets.dungeonBindings && !dungeonFailed) {
                details.push(`${region.id}: ${region.budgets.dungeonBindings} dungeon budget, ${dungeons} placed, no failure recorded — unaccounted`);
            }
            const emitted = territories.coverage.regions.find((entry) => entry.regionId === region.id);
            if (region.budgets.territories > 0 && emitted !== undefined && emitted.emitted < emitted.budget) {
                const failed = territories.failures.some((f) => f.regionId === region.id);
                if (!failed)
                    details.push(`${region.id}: territory budget ${emitted.budget}, emitted ${emitted.emitted}, no failure recorded`);
            }
        }
        gates.push(hardGate("G4", "budgets place or explain", details));
    }
    // G5 — danger progression (plan warnings surface as warnings).
    {
        const details = plan.checks.progressionWarnings.map((warning) => `${warning.regionId}: band ${warning.dangerBand} behind choke band ${warning.chokeBand}`);
        gates.push(gate("G5", "danger progression", details, false));
    }
    // G6 — locks.
    {
        const details = placements.lockReport
            .filter((entry) => entry.status === "invalid")
            .map((entry) => `lock ${entry.id} invalid: ${entry.reasons.join(", ")}`);
        gates.push(strict ? hardGate("G6", "locks held", details) : gate("G6", "locks held", details, false));
    }
    // G7 — staleness.
    {
        const details = [];
        const pin = recipe.base.generationIdentitySha256;
        if (pin !== null && pin !== model.generator.generationIdentitySha256) {
            details.push(`recipe pins base ${pin} but the pack identity is ${model.generator.generationIdentitySha256}`);
        }
        gates.push(strict ? hardGate("G7", "base identity", details) : gate("G7", "base identity", details, false));
    }
    // G8 — determinism round-trip: re-solve and require byte identity.
    {
        const details = [];
        const again = inputs.resolveAgain();
        if (canonicalJson(again.placements) !== canonicalJson(placements))
            details.push("placements re-solve differs");
        if (canonicalJson(again.territories) !== canonicalJson(territories))
            details.push("territories re-solve differs");
        if (canonicalJson(JSON.parse(canonicalJson(placements))) !== canonicalJson(placements)) {
            details.push("placements canonical round-trip differs");
        }
        gates.push(hardGate("G8", "determinism round-trip", details));
    }
    // G9 — painted no-content zones are respected.
    {
        const details = [];
        const inNoContent = (x, y) => recipe.paint.noContent.some((zone) => x >= zone.rect[0] && x <= zone.rect[2] && y >= zone.rect[1] && y <= zone.rect[3]);
        for (const placement of placements.placements) {
            if (inNoContent(placement.cell[0], placement.cell[1])) {
                details.push(`${placement.id} cell (${placement.cell[0]}, ${placement.cell[1]}) inside a no-content zone`);
            }
        }
        for (const territory of territories.territories) {
            for (const index of decodeRuns(territory.cells.runs, width)) {
                const x = index % width;
                const y = (index - x) / width;
                if (inNoContent(x, y)) {
                    details.push(`${territory.id} cell (${x}, ${y}) inside a no-content zone`);
                    break;
                }
            }
        }
        gates.push(hardGate("G9", "painted zones respected", details));
    }
    const ok = gates.every((entry) => entry.status !== "fail");
    return {
        reportFormat: REPORT_FORMAT,
        directorBehaviorVersion: DIRECTOR_BEHAVIOR_VERSION,
        rulePacks: RULE_PACK_VERSIONS,
        analysisVersion: ANALYSIS_VERSION,
        recipeName: recipe.name,
        directorRecipeSha256: recipeSha256(recipe),
        base: {
            generationIdentitySha256: model.generator.generationIdentitySha256,
            artifactFormat: model.raw.formatVersion,
        },
        strict,
        gates,
        ok,
    };
}
export function formatReport(report) {
    const lines = [];
    lines.push(`world gameplay audit — ${report.recipeName} over ${report.base.generationIdentitySha256.slice(0, 12)}…`);
    lines.push(`director behavior ${report.directorBehaviorVersion}, strict ${report.strict ? "on" : "off"}`);
    for (const entry of report.gates) {
        lines.push(`[${entry.status.toUpperCase().padEnd(4)}] ${entry.id} ${entry.name}`);
        for (const detail of entry.details)
            lines.push(`        ${detail}`);
    }
    lines.push(report.ok ? "RESULT: PASS" : "RESULT: FAIL");
    return lines.join("\n") + "\n";
}
