import { readGamePack } from "./pack/readPack.js";
import { WorldModel, ALL_LADDER_RUNGS } from "./world/model.js";
import { checkParity } from "./parity.js";

function usage(): void {
  console.log(
    [
      "wf-fill — deterministic world director over WorldForge game packs",
      "",
      "usage:",
      "  wf-fill inspect <pack-dir>   identity, dimensions, records, parity summary",
      "  wf-fill parity <pack-dir>    full bit-for-bit walkability parity + rung coverage",
      "",
      "Both commands are read-only. Exit code 1 on any refusal or parity failure.",
    ].join("\n"),
  );
}

function loadModel(dir: string): { pack: ReturnType<typeof readGamePack>; model: WorldModel } {
  const pack = readGamePack(dir);
  const model = new WorldModel(pack.artifact);
  return { pack, model };
}

function runInspect(dir: string): number {
  const { pack, model } = loadModel(dir);
  const g = model.generator;
  const d = model.dimensions;
  console.log(`pack: ${pack.manifest.world} (${dir})`);
  console.log(
    `generator: ${g.name} ${g.version} seed ${g.seed} behavior ${g.generatorBehaviorVersion} ` +
      `recipeCompiler ${g.recipeCompilerVersion}`,
  );
  console.log(`identity: ${g.generationIdentitySha256}`);
  console.log(`base artifact sha256: ${pack.manifest.baseArtifactSha256}`);
  console.log(`tileforge: ${pack.manifest.tileforge.packageId} (theme ${pack.manifest.tileforge.theme})`);
  console.log(`dimensions: ${d.width}x${d.height} cells, ${d.chunkWidth}x${d.chunkHeight} chunks`);
  console.log(
    `vocabularies: ${model.raw.semanticPalette.length} materials, ${model.raw.structureTypes.length} structures, ` +
      `${model.raw.propTypes.length} props, ${model.raw.decalTypes.length} decals`,
  );
  console.log(
    `records: ${model.settlements.length} settlements, ${model.landmarks.length} landmarks, ` +
      `${model.pois.length} pois, ${model.routes.length} routes, ${model.destinations.length} destinations, ` +
      `${model.regions.length} regions`,
  );
  console.log(`validation report: ${pack.report.status} (${pack.report.warnings.length} warnings)`);

  const parity = checkParity(pack, model);
  console.log(
    `walkability: reference flood ${parity.referenceFloodCount} from (${parity.referenceSpawnCell[0]}, ` +
      `${parity.referenceSpawnCell[1]}); derived flood ${parity.derivedFloodCount}` +
      (parity.derivedSpawnCell === null
        ? "; derived spawn: none"
        : ` from (${parity.derivedSpawnCell[0]}, ${parity.derivedSpawnCell[1]})`),
  );
  console.log(parity.ok ? "parity: OK (grid bit-identical, flood and spawn equal)" : "parity: FAILED");
  return parity.ok ? 0 : 1;
}

function runParity(dir: string): number {
  const { pack, model } = loadModel(dir);
  const parity = checkParity(pack, model);
  console.log(`cells: ${parity.cellCount}`);
  console.log(`grid: ${parity.gridMatches ? "bit-identical" : `${parity.mismatchCount} mismatching cells`}`);
  for (const sample of parity.mismatchSamples) {
    console.log(
      `  mismatch at (${sample.x}, ${sample.y}): ours ${sample.ours ? "walkable" : "blocked"}, ` +
        `reference ${sample.reference ? "walkable" : "blocked"} [${model.classifyCell(sample.x, sample.y)}]`,
    );
  }
  console.log(
    `flood: reference ${parity.referenceFloodCount}, derived ${parity.derivedFloodCount}; ` +
      `spawn: reference (${parity.referenceSpawnCell[0]}, ${parity.referenceSpawnCell[1]}), derived ` +
      (parity.derivedSpawnCell === null
        ? "none"
        : `(${parity.derivedSpawnCell[0]}, ${parity.derivedSpawnCell[1]})`),
  );
  console.log("ladder rung coverage:");
  for (const rung of ALL_LADDER_RUNGS) {
    console.log(`  ${rung}: ${parity.rungCounts[rung]}`);
  }
  console.log(parity.ok ? "parity: OK" : "parity: FAILED");
  return parity.ok ? 0 : 1;
}

function main(argv: readonly string[]): number {
  const [command, target] = argv;
  if (command === undefined || command === "help" || command === "--help") {
    usage();
    return command === undefined ? 1 : 0;
  }
  if (target === undefined) {
    usage();
    return 1;
  }
  try {
    if (command === "inspect") return runInspect(target);
    if (command === "parity") return runParity(target);
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    return 1;
  }
  console.error(`unknown command: ${command}`);
  usage();
  return 1;
}

process.exitCode = main(process.argv.slice(2));
