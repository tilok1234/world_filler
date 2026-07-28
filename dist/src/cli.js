import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join } from "node:path";
import { readGamePack } from "./pack/readPack.js";
import { WorldModel, ALL_LADDER_RUNGS } from "./world/model.js";
import { checkParity } from "./parity.js";
import { analyzeWorld, analysisCacheDir, readAnalysisSummary, writeAnalysisSummary } from "./analysis/analyze.js";
import { renderAnalysis } from "./render/heatmaps.js";
import { renderDanger } from "./render/planRender.js";
import { renderPlacements } from "./render/placeRender.js";
import { normalizeRecipe, recipeSha256 } from "./recipe/schema.js";
import { compilePlan } from "./plan/plan.js";
import { solvePlacements } from "./place/solver.js";
import { growTerritories } from "./territory/territory.js";
import { renderTerritories } from "./render/territoryRender.js";
import { runGates, formatReport } from "./validate/validate.js";
import { buildContentPack, writeContentPack } from "./export/export.js";
import { verifyContentPack } from "./consume/verifyPack.js";
import { PLACEMENTS_FORMAT } from "./core/version.js";
import { canonicalJson } from "./core/canonicalJson.js";
import { assertOutputRoot, repoRoot } from "./core/guard.js";
import { startStudio } from "./serve/server.js";
function usage() {
    console.log([
        "wf-fill — deterministic world director over WorldForge game packs",
        "",
        "usage:",
        "  wf-fill inspect <pack-dir>            identity, dimensions, records, parity summary",
        "  wf-fill parity <pack-dir>             full bit-for-bit walkability parity + rung coverage",
        "  wf-fill analyze <pack-dir> [out-dir]  spatial analysis bundle + heatmap renders",
        "  wf-fill plan <pack-dir> <recipe.json> [out-dir]",
        "                                        compile the regional content plan + danger render",
        "  wf-fill place <pack-dir> <recipe.json> [out-dir]",
        "                                        solve placements (bosses + dungeon bindings) + render",
        "  wf-fill explain <placements.json> <placement-id>",
        "                                        why a placement landed where it did",
        "  wf-fill territories <pack-dir> <recipe.json> [out-dir]",
        "                                        grow spawn territories + render",
        "  wf-fill validate <pack-dir> <recipe.json> [out-dir] [--strict]",
        "                                        run the full gate battery + audit report",
        "  wf-fill lock <placements.json> <placement-id>",
        "                                        print the recipe lock entry for a placement",
        "  wf-fill unlock <recipe.json> <placement-id>",
        "                                        print the recipe's locks with a placement released",
        "  wf-fill reroll <recipe.json> <region-id>",
        "                                        print the reroll entry that re-seeds one region",
        "  wf-fill export <pack-dir> <recipe.json> [out-dir] [--strict]",
        "                                        full pipeline -> audited content pack (refuses on failed gates)",
        "  wf-fill verify-pack <world-pack-dir> <content-pack-dir>",
        "                                        consumption proof: verify a content pack against its world pack",
        "  wf-fill serve [port]                  local director studio (browser UI over this same pipeline)",
        "",
        "inspect and parity are read-only. analyze writes under outputs/ (or the",
        "given out-dir, which must pass the output-root guard). Exit code 1 on any",
        "refusal or parity failure.",
    ].join("\n"));
}
function loadModel(dir) {
    const pack = readGamePack(dir);
    const model = new WorldModel(pack.artifact);
    return { pack, model };
}
function runInspect(dir) {
    const { pack, model } = loadModel(dir);
    const g = model.generator;
    const d = model.dimensions;
    console.log(`pack: ${pack.manifest.world} (${dir})`);
    console.log(`generator: ${g.name} ${g.version} seed ${g.seed} behavior ${g.generatorBehaviorVersion} ` +
        `recipeCompiler ${g.recipeCompilerVersion}`);
    console.log(`identity: ${g.generationIdentitySha256}`);
    console.log(`base artifact sha256: ${pack.manifest.baseArtifactSha256}`);
    console.log(`tileforge: ${pack.manifest.tileforge.packageId} (theme ${pack.manifest.tileforge.theme})`);
    console.log(`dimensions: ${d.width}x${d.height} cells, ${d.chunkWidth}x${d.chunkHeight} chunks`);
    console.log(`vocabularies: ${model.raw.semanticPalette.length} materials, ${model.raw.structureTypes.length} structures, ` +
        `${model.raw.propTypes.length} props, ${model.raw.decalTypes.length} decals`);
    console.log(`records: ${model.settlements.length} settlements, ${model.landmarks.length} landmarks, ` +
        `${model.pois.length} pois, ${model.routes.length} routes, ${model.destinations.length} destinations, ` +
        `${model.regions.length} regions`);
    console.log(`validation report: ${pack.report.status} (${pack.report.warnings.length} warnings)`);
    const parity = checkParity(pack, model);
    console.log(`walkability: reference flood ${parity.referenceFloodCount} from (${parity.referenceSpawnCell[0]}, ` +
        `${parity.referenceSpawnCell[1]}); derived flood ${parity.derivedFloodCount}` +
        (parity.derivedSpawnCell === null
            ? "; derived spawn: none"
            : ` from (${parity.derivedSpawnCell[0]}, ${parity.derivedSpawnCell[1]})`));
    console.log(parity.ok ? "parity: OK (grid bit-identical, flood and spawn equal)" : "parity: FAILED");
    return parity.ok ? 0 : 1;
}
function runParity(dir) {
    const { pack, model } = loadModel(dir);
    const parity = checkParity(pack, model);
    console.log(`cells: ${parity.cellCount}`);
    console.log(`grid: ${parity.gridMatches ? "bit-identical" : `${parity.mismatchCount} mismatching cells`}`);
    for (const sample of parity.mismatchSamples) {
        console.log(`  mismatch at (${sample.x}, ${sample.y}): ours ${sample.ours ? "walkable" : "blocked"}, ` +
            `reference ${sample.reference ? "walkable" : "blocked"} [${model.classifyCell(sample.x, sample.y)}]`);
    }
    console.log(`flood: reference ${parity.referenceFloodCount}, derived ${parity.derivedFloodCount}; ` +
        `spawn: reference (${parity.referenceSpawnCell[0]}, ${parity.referenceSpawnCell[1]}), derived ` +
        (parity.derivedSpawnCell === null
            ? "none"
            : `(${parity.derivedSpawnCell[0]}, ${parity.derivedSpawnCell[1]})`));
    console.log("ladder rung coverage:");
    for (const rung of ALL_LADDER_RUNGS) {
        console.log(`  ${rung}: ${parity.rungCounts[rung]}`);
    }
    console.log(parity.ok ? "parity: OK" : "parity: FAILED");
    return parity.ok ? 0 : 1;
}
function runAnalyze(dir, outArg) {
    const { pack, model } = loadModel(dir);
    const parity = checkParity(pack, model);
    if (!parity.ok) {
        console.error("analyze: refusing — walkability parity with the pack's reference grid failed");
        return 1;
    }
    const bundle = analyzeWorld(model);
    const outputsRoot = join(repoRoot(), "outputs");
    const outDir = assertOutputRoot(outArg ?? join(outputsRoot, "analysis", basename(dir)));
    mkdirSync(join(outDir, "renders"), { recursive: true });
    writeFileSync(join(outDir, "summary.json"), canonicalJson(bundle.summary));
    for (const map of renderAnalysis(model, bundle)) {
        writeFileSync(join(outDir, "renders", `${map.name}.png`), map.png);
    }
    const cacheDir = analysisCacheDir(outputsRoot, model.generator.generationIdentitySha256);
    const cached = readAnalysisSummary(cacheDir);
    if (cached !== null && canonicalJson(cached) !== canonicalJson(bundle.summary)) {
        console.log("analyze: NOTE — cached summary for this identity differed and was replaced (analysis drift)");
    }
    writeAnalysisSummary(cacheDir, bundle.summary);
    const s = bundle.summary;
    console.log(`analysis: ${s.base.width}x${s.base.height}, spawn (${s.spawnCell[0]}, ${s.spawnCell[1]})`);
    console.log(`components: ${s.components.count} (spawn component ${s.components.spawnComponent}, sizes ${s.components.sizes.join(", ")})`);
    console.log(`regions: ${s.regionCount}; corridor cells: ${s.corridorCellCount}; safe-zone cells: ${s.safeZoneCellCount}`);
    for (const [name, stat] of Object.entries(s.fieldStats)) {
        console.log(`field ${name}: max ${stat.max}, reachable ${stat.reachableCells}`);
    }
    console.log(`wrote ${outDir} (summary.json + ${11} renders) and cache ${cacheDir}`);
    return 0;
}
function runPlan(dir, recipePath, outArg) {
    const { pack, model } = loadModel(dir);
    const parity = checkParity(pack, model);
    if (!parity.ok) {
        console.error("plan: refusing — walkability parity with the pack's reference grid failed");
        return 1;
    }
    const recipe = normalizeRecipe(JSON.parse(readFileSync(recipePath, "utf8")));
    const pin = recipe.base.generationIdentitySha256;
    if (pin !== null && pin !== model.generator.generationIdentitySha256) {
        console.error(`plan: refusing — recipe pins base ${pin} but the pack's generation identity is ` +
            `${model.generator.generationIdentitySha256} (stale base; re-pin deliberately)`);
        return 1;
    }
    const bundle = analyzeWorld(model);
    const plan = compilePlan(model, bundle, recipe);
    const outDir = assertOutputRoot(outArg ?? join(repoRoot(), "outputs", "plan", `${basename(dir)}-${recipe.name}`));
    mkdirSync(join(outDir, "renders"), { recursive: true });
    writeFileSync(join(outDir, "content-plan.json"), canonicalJson(plan));
    writeFileSync(join(outDir, "renders", "danger.png"), renderDanger(model, bundle, plan, recipe.danger.bandCount));
    console.log(`plan: ${recipe.name} (${recipeSha256(recipe).slice(0, 12)}…) over ${basename(dir)}`);
    console.log(`spawn region: ${plan.spawnRegionId}`);
    const boss = plan.worldBudget.worldBosses;
    console.log(`world budget: ${boss.allocated}/${boss.target} world bosses, ${plan.worldBudget.territories} territories, ` +
        `${plan.worldBudget.encounterSites} encounter sites, ${plan.worldBudget.dungeonBindings} dungeon bindings`);
    const byCells = [...plan.regions].sort((a, b) => b.cellCount - a.cellCount).slice(0, 12);
    console.log("largest regions:");
    for (const region of byCells) {
        const bossMark = region.budgets.worldBosses > 0 ? ", WORLD BOSS" : "";
        const waivers = region.waivers.length > 0 ? ` [${region.waivers.join(", ")}]` : "";
        console.log(`  ${region.id} (${region.biome}, ${region.cellCount} cells, band ${region.dangerBand ?? "-"}, ` +
            `${region.regionClass}): ${region.budgets.territories} territories, ${region.budgets.encounterSites} encounters, ` +
            `${region.budgets.dungeonBindings}/${region.dungeonAnchorCandidates} dungeons${bossMark}${waivers}`);
    }
    if (plan.checks.progressionWarnings.length > 0) {
        console.log("progression warnings:");
        for (const warning of plan.checks.progressionWarnings) {
            console.log(`  ${warning.regionId}: band ${warning.dangerBand} behind choke band ${warning.chokeBand}`);
        }
    }
    else {
        console.log("progression: no wilderness region sits behind a harsher choke than its band allows");
    }
    for (const waiver of plan.checks.worldWaivers)
        console.log(`world waiver: ${waiver}`);
    console.log(`wrote ${outDir}`);
    return 0;
}
function runPlace(dir, recipePath, outArg) {
    const { pack, model } = loadModel(dir);
    const parity = checkParity(pack, model);
    if (!parity.ok) {
        console.error("place: refusing — walkability parity with the pack's reference grid failed");
        return 1;
    }
    const recipe = normalizeRecipe(JSON.parse(readFileSync(recipePath, "utf8")));
    const pin = recipe.base.generationIdentitySha256;
    if (pin !== null && pin !== model.generator.generationIdentitySha256) {
        console.error(`place: refusing — recipe pins base ${pin}, pack is ${model.generator.generationIdentitySha256}`);
        return 1;
    }
    const bundle = analyzeWorld(model);
    const plan = compilePlan(model, bundle, recipe);
    const doc = solvePlacements(model, bundle, plan, recipe);
    const outDir = assertOutputRoot(outArg ?? join(repoRoot(), "outputs", "place", `${basename(dir)}-${recipe.name}`));
    mkdirSync(join(outDir, "renders"), { recursive: true });
    writeFileSync(join(outDir, "placements.json"), canonicalJson(doc));
    writeFileSync(join(outDir, "renders", "placements.png"), renderPlacements(model, bundle, doc));
    console.log(`placements: ${doc.placements.length} placed, ${doc.failures.length} failures, ${doc.unboundAnchors.length} unbound anchors`);
    for (const placement of doc.placements) {
        console.log(`  ${placement.id}: (${placement.cell[0]}, ${placement.cell[1]}) score ${placement.score}` +
            (placement.anchorPoiType !== null ? ` on ${placement.anchorPoiType} #${placement.anchorPoiId}` : "") +
            (placement.inSafeZone ? " [in safe zone]" : ""));
    }
    for (const failure of doc.failures)
        console.log(`  FAILURE ${failure.rule} in ${failure.regionId}: ${failure.message}`);
    const unboundByReason = new Map();
    for (const anchor of doc.unboundAnchors) {
        unboundByReason.set(anchor.reason, (unboundByReason.get(anchor.reason) ?? 0) + 1);
    }
    for (const [reason, count] of [...unboundByReason.entries()].sort()) {
        console.log(`  unbound anchors (${reason}): ${count}`);
    }
    console.log(`wrote ${outDir}`);
    return doc.failures.length > 0 ? 2 : 0;
}
function runExplain(placementsPath, placementId) {
    const doc = JSON.parse(readFileSync(placementsPath, "utf8"));
    if (doc.placementsFormat !== PLACEMENTS_FORMAT || !Array.isArray(doc.placements)) {
        console.error(`explain: ${placementsPath} is not a supported placements file ` +
            `(placementsFormat ${String(doc.placementsFormat)}; this build reads format ${PLACEMENTS_FORMAT})`);
        return 1;
    }
    const placement = doc.placements.find((entry) => entry.id === placementId);
    if (placement === undefined) {
        console.error(`explain: no placement ${placementId} (have: ${doc.placements.map((entry) => entry.id).join(", ")})`);
        return 1;
    }
    console.log(`${placement.id} — ${placement.rule} in ${placement.regionId}`);
    console.log(`cell (${placement.cell[0]}, ${placement.cell[1]}), access (${placement.accessCell[0]}, ${placement.accessCell[1]})`);
    if (placement.anchorPoiType !== null) {
        console.log(`bound anchor: ${placement.anchorPoiType} #${placement.anchorPoiId}${placement.inSafeZone ? " (inside a safe zone)" : ""}`);
    }
    if (placement.arenaSide !== null && placement.arenaOrigin !== null) {
        console.log(`arena: ${placement.arenaSide}x${placement.arenaSide} reserved from (${placement.arenaOrigin[0]}, ${placement.arenaOrigin[1]})`);
    }
    console.log(`exclusion radius: ${placement.exclusionRadius}`);
    console.log(`seed channel: ${placement.channel} (picked index ${placement.draw} of the top window)`);
    console.log("candidate funnel:");
    for (const step of placement.candidateFunnel)
        console.log(`  ${step.stage}: ${step.remaining}`);
    console.log(`score ${placement.score} =`);
    for (const term of placement.scoreTerms) {
        console.log(`  ${term.term}: value ${term.value}/1000 x weight ${term.weightPermille}/1000 -> ${term.contribution}`);
    }
    console.log("top candidates considered:");
    for (const candidate of placement.topCandidates) {
        const marker = candidate.cell[0] === placement.cell[0] && candidate.cell[1] === placement.cell[1] ? "  <- chosen" : "";
        console.log(`  (${candidate.cell[0]}, ${candidate.cell[1]}) score ${candidate.score}${marker}`);
    }
    return 0;
}
function runTerritories(dir, recipePath, outArg) {
    const { pack, model } = loadModel(dir);
    const parity = checkParity(pack, model);
    if (!parity.ok) {
        console.error("territories: refusing — walkability parity with the pack's reference grid failed");
        return 1;
    }
    const recipe = normalizeRecipe(JSON.parse(readFileSync(recipePath, "utf8")));
    const pin = recipe.base.generationIdentitySha256;
    if (pin !== null && pin !== model.generator.generationIdentitySha256) {
        console.error(`territories: refusing — recipe pins base ${pin}, pack is ${model.generator.generationIdentitySha256}`);
        return 1;
    }
    const bundle = analyzeWorld(model);
    const plan = compilePlan(model, bundle, recipe);
    const placements = solvePlacements(model, bundle, plan, recipe);
    const doc = growTerritories(model, bundle, plan, placements, recipe);
    const outDir = assertOutputRoot(outArg ?? join(repoRoot(), "outputs", "territories", `${basename(dir)}-${recipe.name}`));
    mkdirSync(join(outDir, "renders"), { recursive: true });
    writeFileSync(join(outDir, "territories.json"), canonicalJson(doc));
    writeFileSync(join(outDir, "renders", "territories.png"), renderTerritories(model, bundle, doc, placements));
    console.log(`territories: ${doc.territories.length} grown, ${doc.failures.length} failures; ` +
        `covered ${doc.coverage.totalCovered}/${doc.coverage.totalHostileWalkable} hostile cells`);
    for (const territory of doc.territories.slice(0, 14)) {
        console.log(`  ${territory.id}: ${territory.cellCount} cells, band ${territory.dangerBand}, ` +
            `${territory.roster.length} roster entries, maxActive ${territory.maxActive}`);
    }
    if (doc.territories.length > 14)
        console.log(`  ... and ${doc.territories.length - 14} more`);
    for (const failure of doc.failures)
        console.log(`  FAILURE ${failure.regionId} slot ${failure.slot}: ${failure.reason}`);
    console.log(`wrote ${outDir}`);
    return 0;
}
function runValidate(dir, recipePath, outArg, strict) {
    const { pack, model } = loadModel(dir);
    const parity = checkParity(pack, model);
    if (!parity.ok) {
        console.error("validate: refusing — walkability parity with the pack's reference grid failed");
        return 1;
    }
    const recipe = normalizeRecipe(JSON.parse(readFileSync(recipePath, "utf8")));
    const pin = recipe.base.generationIdentitySha256;
    if (pin !== null && pin !== model.generator.generationIdentitySha256) {
        console.error(`validate: refusing — recipe pins base ${pin}, pack is ${model.generator.generationIdentitySha256} (stale base; re-pin deliberately)`);
        return 1;
    }
    const bundle = analyzeWorld(model);
    const plan = compilePlan(model, bundle, recipe);
    const placements = solvePlacements(model, bundle, plan, recipe);
    const territories = growTerritories(model, bundle, plan, placements, recipe);
    const report = runGates({
        model,
        bundle,
        plan,
        placements,
        territories,
        recipe,
        strict,
        resolveAgain: () => {
            const placementsAgain = solvePlacements(model, bundle, plan, recipe);
            return { placements: placementsAgain, territories: growTerritories(model, bundle, plan, placementsAgain, recipe) };
        },
    });
    const outDir = assertOutputRoot(outArg ?? join(repoRoot(), "outputs", "validate", `${basename(dir)}-${recipe.name}`));
    mkdirSync(outDir, { recursive: true });
    writeFileSync(join(outDir, "report.json"), canonicalJson(report));
    const text = formatReport(report);
    writeFileSync(join(outDir, "report.txt"), text);
    process.stdout.write(text);
    console.log(`wrote ${outDir}`);
    return report.ok ? 0 : 1;
}
function runLock(placementsPath, placementId) {
    const doc = JSON.parse(readFileSync(placementsPath, "utf8"));
    if (doc.placementsFormat !== PLACEMENTS_FORMAT || !Array.isArray(doc.placements)) {
        console.error(`lock: ${placementsPath} is not a supported placements file`);
        return 1;
    }
    const placement = doc.placements.find((entry) => entry.id === placementId);
    if (placement === undefined) {
        console.error(`lock: no placement ${placementId}`);
        return 1;
    }
    const entry = {
        id: placement.id,
        rule: placement.rule,
        regionId: placement.regionId,
        cell: placement.cell,
        exclusionRadius: placement.exclusionRadius,
        anchorPoiId: placement.anchorPoiId,
        arenaOrigin: placement.arenaOrigin,
        arenaSide: placement.arenaSide,
    };
    console.log("add to the recipe under locks.placements:");
    process.stdout.write(canonicalJson(entry));
    return 0;
}
/**
 * Iteration verbs: like `lock`, these PRINT recipe edits instead of
 * writing them — recipes are user-authored files this tool never
 * overwrites (safe write rules). The loop is documented in
 * docs/WORKFLOW.md: direct -> review -> lock -> reroll -> export.
 */
function runReroll(recipePath, regionId) {
    const recipe = normalizeRecipe(JSON.parse(readFileSync(recipePath, "utf8")));
    const current = recipe.rerolls.find((entry) => entry.regionId === regionId)?.iteration ?? 0;
    const entry = { iteration: current + 1, regionId };
    console.log(`set under rerolls (replacing any existing ${regionId} entry) to re-seed only that region's draw streams:`);
    process.stdout.write(canonicalJson(entry));
    console.log("\nregion ids come from `wf-fill plan`; an unknown region is refused at solve time. " +
        "Locked placements ignore rerolls; spatially uncoupled regions stay byte-identical.");
    return 0;
}
function runUnlock(recipePath, placementId) {
    const recipe = normalizeRecipe(JSON.parse(readFileSync(recipePath, "utf8")));
    const held = recipe.locks.placements.find((entry) => entry.id === placementId);
    if (held === undefined) {
        console.error(`unlock: no lock ${placementId} in ${recipePath}` +
            (recipe.locks.placements.length > 0
                ? ` (have: ${recipe.locks.placements.map((entry) => entry.id).join(", ")})`
                : " (the recipe holds no locks)"));
        return 1;
    }
    const remaining = recipe.locks.placements.filter((entry) => entry.id !== placementId);
    console.log(`replace locks.placements with (releases ${placementId}; its slot re-solves fresh):`);
    process.stdout.write(canonicalJson(remaining));
    console.log("");
    return 0;
}
function runExport(dir, recipePath, outArg, strict) {
    const { pack, model } = loadModel(dir);
    const parity = checkParity(pack, model);
    if (!parity.ok) {
        console.error("export: refusing — walkability parity with the pack's reference grid failed");
        return 1;
    }
    const recipe = normalizeRecipe(JSON.parse(readFileSync(recipePath, "utf8")));
    // The shipping verb honors a base pin unconditionally — the same
    // refusal plan/place/territories perform, independent of --strict.
    const pin = recipe.base.generationIdentitySha256;
    if (pin !== null && pin !== model.generator.generationIdentitySha256) {
        console.error(`export: refusing — recipe pins base ${pin}, pack is ${model.generator.generationIdentitySha256} (stale base; re-pin deliberately)`);
        return 1;
    }
    const bundle = analyzeWorld(model);
    const plan = compilePlan(model, bundle, recipe);
    const placements = solvePlacements(model, bundle, plan, recipe);
    const territories = growTerritories(model, bundle, plan, placements, recipe);
    const report = runGates({
        model, bundle, plan, placements, territories, recipe, strict,
        resolveAgain: () => {
            const placementsAgain = solvePlacements(model, bundle, plan, recipe);
            return { placements: placementsAgain, territories: growTerritories(model, bundle, plan, placementsAgain, recipe) };
        },
    });
    const built = buildContentPack({
        model,
        worldName: basename(dir),
        baseArtifactSha256: pack.manifest.baseArtifactSha256,
        recipe,
        plan,
        placements,
        territories,
        report,
    });
    const outDir = assertOutputRoot(outArg ?? join(repoRoot(), "outputs", "export", `${basename(dir)}-${recipe.name}-content`));
    writeContentPack(built, outDir);
    const dangerPng = renderDanger(model, bundle, plan, recipe.danger.bandCount);
    const placementsPng = renderPlacements(model, bundle, placements);
    const territoriesPng = renderTerritories(model, bundle, territories, placements);
    mkdirSync(join(outDir, "renders"), { recursive: true });
    writeFileSync(join(outDir, "renders", "danger.png"), dangerPng);
    writeFileSync(join(outDir, "renders", "placements.png"), placementsPng);
    writeFileSync(join(outDir, "renders", "territories.png"), territoriesPng);
    // Bake a self-contained inspector beside the pack: viewer/index.html
    // with the payloads and renders embedded, so reviewing an export is
    // "double-click view.html" — no dragging, no picking. Like renders/,
    // view.html is inspection evidence, never hashed payload.
    const viewerTemplate = join(repoRoot(), "viewer", "index.html");
    let viewHint = "";
    if (existsSync(viewerTemplate)) {
        const terrain = renderAnalysis(model, bundle).find((map) => map.name === "terrain");
        const embedded = {
            jsons: {
                "manifest.json": canonicalJson(built.manifest),
                ...Object.fromEntries(built.files.entries()),
            },
            images: {
                ...(terrain !== undefined ? { terrain: Buffer.from(terrain.png).toString("base64") } : {}),
                danger: Buffer.from(dangerPng).toString("base64"),
                placements: Buffer.from(placementsPng).toString("base64"),
                territories: Buffer.from(territoriesPng).toString("base64"),
            },
        };
        const payload = JSON.stringify(embedded).replace(/</g, "\\u003c");
        const html = readFileSync(viewerTemplate, "utf8").replace("/* WF_EMBED_SLOT */", `window.WF_EMBEDDED = ${payload};`);
        writeFileSync(join(outDir, "view.html"), html);
        viewHint = "; double-click view.html in there to inspect";
    }
    console.log(`content pack: ${built.manifest.counts.placements} placements, ${built.manifest.counts.territories} territories, ` +
        `${built.manifest.counts.placementFailures + built.manifest.counts.territoryFailures} recorded failures`);
    console.log(`base: ${built.manifest.base.generationIdentitySha256.slice(0, 12)}… (world.json ${built.manifest.base.artifactSha256.slice(0, 12)}…)`);
    console.log(`recipe: ${built.manifest.recipeName} (${built.manifest.directorRecipeSha256.slice(0, 12)}…)`);
    console.log(`wrote ${outDir} (renders + view.html are inspection copies, not hashed payload${viewHint})`);
    return 0;
}
function runVerifyPack(worldPackDir, contentPackDir) {
    const summary = verifyContentPack(worldPackDir, contentPackDir);
    console.log(`verify-pack: OK — ${summary.placements} placements and ${summary.territories} territories ` +
        `(${summary.territoryCells} cells) verified against the world pack's reference walkability`);
    console.log(`world ${summary.world}, recipe ${summary.recipeName}`);
    return 0;
}
function main(argv) {
    const strict = argv.includes("--strict");
    // Unknown flags are refusals, not positionals: a mistyped `--stric`
    // must never silently become an output directory.
    for (const entry of argv) {
        if (entry.startsWith("-") && entry !== "--strict" && entry !== "--help") {
            console.error(`unknown flag: ${entry} (the only flag is --strict)`);
            return 1;
        }
    }
    const positional = argv.filter((entry) => entry !== "--strict");
    const [command, target, extra, extra2] = positional;
    if (command === undefined || command === "help" || command === "--help") {
        usage();
        return command === undefined ? 1 : 0;
    }
    if (command === "serve") {
        const port = target === undefined ? 8787 : Number(target);
        if (!Number.isInteger(port) || port < 1 || port > 65535) {
            console.error(`serve: ${String(target)} is not a valid port`);
            return 1;
        }
        startStudio(port);
        return 0;
    }
    if (target === undefined) {
        usage();
        return 1;
    }
    try {
        if (command === "inspect")
            return runInspect(target);
        if (command === "parity")
            return runParity(target);
        if (command === "analyze")
            return runAnalyze(target, extra);
        if (command === "plan") {
            if (extra === undefined) {
                usage();
                return 1;
            }
            return runPlan(target, extra, extra2);
        }
        if (command === "place") {
            if (extra === undefined) {
                usage();
                return 1;
            }
            return runPlace(target, extra, extra2);
        }
        if (command === "explain") {
            if (extra === undefined) {
                usage();
                return 1;
            }
            return runExplain(target, extra);
        }
        if (command === "territories") {
            if (extra === undefined) {
                usage();
                return 1;
            }
            return runTerritories(target, extra, extra2);
        }
        if (command === "validate") {
            if (extra === undefined) {
                usage();
                return 1;
            }
            return runValidate(target, extra, extra2, strict);
        }
        if (command === "lock") {
            if (extra === undefined) {
                usage();
                return 1;
            }
            return runLock(target, extra);
        }
        if (command === "unlock") {
            if (extra === undefined) {
                usage();
                return 1;
            }
            return runUnlock(target, extra);
        }
        if (command === "reroll") {
            if (extra === undefined) {
                usage();
                return 1;
            }
            return runReroll(target, extra);
        }
        if (command === "export") {
            if (extra === undefined) {
                usage();
                return 1;
            }
            return runExport(target, extra, extra2, strict);
        }
        if (command === "verify-pack") {
            if (extra === undefined) {
                usage();
                return 1;
            }
            return runVerifyPack(target, extra);
        }
    }
    catch (error) {
        console.error(error instanceof Error ? error.message : String(error));
        return 1;
    }
    console.error(`unknown command: ${command}`);
    usage();
    return 1;
}
process.exitCode = main(process.argv.slice(2));
