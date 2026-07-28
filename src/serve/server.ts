import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { readGamePack } from "../pack/readPack.js";
import { WorldModel } from "../world/model.js";
import { checkParity } from "../parity.js";
import { normalizeRecipe, RecipeError } from "../recipe/schema.js";
import { analyzeWorld } from "../analysis/analyze.js";
import { compilePlan } from "../plan/plan.js";
import { solvePlacements } from "../place/solver.js";
import { growTerritories } from "../territory/territory.js";
import { runGates } from "../validate/validate.js";
import { buildContentPack, writeContentPack, ExportError } from "../export/export.js";
import { renderAnalysis } from "../render/heatmaps.js";
import { renderDanger } from "../render/planRender.js";
import { renderPlacements } from "../render/placeRender.js";
import { renderTerritories } from "../render/territoryRender.js";
import { canonicalJson } from "../core/canonicalJson.js";
import { repoRoot } from "../core/guard.js";

/**
 * The Director Studio server: a LOCAL-ONLY (127.0.0.1) shell over the
 * exact same audited pipeline the CLI runs. It exists so a UI can direct
 * worlds — edit recipes, lock, reroll, re-direct — without a terminal.
 *
 * Doctrine holds: the server never invents behavior. Every mutation is a
 * recipe edit (validated by normalizeRecipe before a byte is written to
 * recipes/<world>.json), every generation is the same deterministic
 * pipeline, and a pack produced here must be byte-identical to
 * `wf-fill export` for the same inputs (pinned by tests/serve.test.ts).
 * Manual intent flows through locks and rerolls only — there is no
 * "move this placement" endpoint, by design.
 *
 * API (JSON unless noted; full contract in docs/DESIGN_BRIEF.md):
 *   GET  /                       the studio UI (src/serve/ui.html)
 *   GET  /api/worlds             discover fixture + dropped worlds
 *   GET  /api/recipe?world=W     raw text + normalized (defaults filled)
 *   PUT  /api/recipe?world=W     validate + save to recipes/W.json
 *   POST /api/direct?world=W[&strict=1]   run the pipeline + export
 *   GET  /api/pack?world=W       the exported pack's five JSON payloads
 *   GET  /api/render?world=W&name=terrain|danger|placements|territories  (PNG)
 *   GET  /view?world=W           the export's self-contained view.html
 *   POST /api/lock    {world, placementId}
 *   POST /api/unlock  {world, placementId}
 *   POST /api/reroll  {world, regionId}
 *   GET  /api/analysis?world=W   region/clearance/safe-zone/walkable maps
 *   GET  /api/history?world=W    numbered recipe snapshots
 *   POST /api/restore {world, entry}   undo to a snapshot (itself undoable)
 *   GET  /api/diff?world=W       previous export vs current, exactly
 */

export interface ServeOptions {
  /** Repo root override (tests). */
  readonly rootDir?: string;
  /** Where recipes/<world>.json are read and written (tests use a temp dir). */
  readonly recipesDir?: string;
  /** Root that receives outputs/export/<world>-content (tests use a temp dir). */
  readonly outputsRoot?: string;
}

const WORLD_NAME = /^[A-Za-z0-9._-]+$/;

class HttpError extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

function json(res: ServerResponse, status: number, body: unknown): void {
  const bytes = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(bytes);
}

async function readBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString("utf8");
}

export function createStudioServer(options: ServeOptions = {}): Server {
  const root = options.rootDir ?? repoRoot();
  const recipesDir = options.recipesDir ?? join(root, "recipes");
  const outputsRoot = options.outputsRoot ?? join(root, "outputs");
  const defaultRecipePath = join(root, "fixtures", "recipes", "basic-direction.json");

  function worldDirOf(name: string): string {
    if (!WORLD_NAME.test(name)) throw new HttpError(400, `invalid world name ${name}`);
    const dropped = join(root, "worlds", name);
    if (existsSync(join(dropped, "manifest.json"))) return dropped;
    const fixture = join(root, "fixtures", "packs", name);
    if (existsSync(join(fixture, "manifest.json"))) return fixture;
    throw new HttpError(404, `no world named ${name} in worlds\\ or fixtures/packs`);
  }

  function recipePathOf(name: string): { path: string; own: boolean } {
    const own = join(recipesDir, `${name}.json`);
    if (existsSync(own)) return { path: own, own: true };
    return { path: defaultRecipePath, own: false };
  }

  function outDirOf(name: string): string {
    return join(outputsRoot, "export", `${name}-content`);
  }

  /**
   * Save a recipe object for a world: validate first, write pretty JSON.
   * The previous version (when one exists) is kept as a sequentially
   * numbered snapshot under recipes/.history/<world>/ — no timestamps,
   * sequence numbers only — so every edit is undoable via /api/restore.
   */
  function saveRecipe(name: string, raw: unknown): void {
    normalizeRecipe(raw); // throws RecipeError with the exact field on failure
    mkdirSync(recipesDir, { recursive: true });
    const target = join(recipesDir, `${name}.json`);
    if (existsSync(target)) {
      const dir = join(recipesDir, ".history", name);
      mkdirSync(dir, { recursive: true });
      const next = historyEntries(name).length + 1;
      copyFileSync(target, join(dir, `${String(next).padStart(4, "0")}.json`));
    }
    writeFileSync(target, JSON.stringify(raw, null, 2) + "\n");
  }

  function historyEntries(name: string): number[] {
    const dir = join(recipesDir, ".history", name);
    if (!existsSync(dir)) return [];
    return readdirSync(dir)
      .filter((entry) => /^[0-9]{4}\.json$/.test(entry))
      .map((entry) => Number(entry.slice(0, 4)))
      .sort((a, b) => a - b);
  }

  function loadRawRecipe(name: string): Record<string, unknown> {
    const { path } = recipePathOf(name);
    return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
  }

  /** Run-length encode an integer grid, row-major: [[value, count], …]. */
  function runLengthEncode(values: ArrayLike<number>): Array<[number, number]> {
    const runs: Array<[number, number]> = [];
    for (let i = 0; i < values.length; i += 1) {
      const value = values[i] as number;
      const last = runs[runs.length - 1];
      if (last !== undefined && last[0] === value) last[1] += 1;
      else runs.push([value, 1]);
    }
    return runs;
  }

  /** Bit-pack a 0/1 grid to base64, row-major LSB-first (the pack encoding). */
  function packBits(values: ArrayLike<number>): string {
    const bytes = Buffer.alloc((values.length + 7) >> 3);
    for (let i = 0; i < values.length; i += 1) {
      if (values[i] === 1) bytes[i >> 3] = (bytes[i >> 3] as number) | (1 << (i & 7));
    }
    return bytes.toString("base64");
  }

  // Analysis responses are deterministic per world identity; cache them.
  const analysisCache = new Map<string, string>();

  /**
   * Read-only analysis maps for the studio's manual-intent tools: which
   * region every cell belongs to, clearance (largest walkable square
   * anchored at the cell — the boss-pin advisory), safe zones, and
   * walkability. Encodings: runs = [[value, count], …] row-major
   * (label -1 = no region); masks = base64-bitpacked-row-major-lsb-first.
   */
  function analysisFor(name: string): string {
    const worldDir = worldDirOf(name);
    const pack = readGamePack(worldDir);
    const model = new WorldModel(pack.artifact);
    const identity = model.generator.generationIdentitySha256;
    const cached = analysisCache.get(`${name}|${identity}`);
    if (cached !== undefined) return cached;
    const bundle = analyzeWorld(model);
    const body = JSON.stringify({
      world: name,
      generationIdentitySha256: identity,
      width: model.dimensions.width,
      height: model.dimensions.height,
      regions: bundle.regions.map((region, label) => ({ label, id: region.id, biome: region.biome })),
      regionLabels: { encoding: "runs-row-major", runs: runLengthEncode(bundle.regionLabels) },
      clearance: { encoding: "runs-row-major", runs: runLengthEncode(bundle.clearance) },
      safeZone: { encoding: "base64-bitpacked-row-major-lsb-first", grid: packBits(bundle.safeZone) },
      walkable: { encoding: "base64-bitpacked-row-major-lsb-first", grid: packBits(bundle.bits) },
    });
    analysisCache.set(`${name}|${identity}`, body);
    return body;
  }

  const PAYLOAD_NAMES = ["manifest.json", "content-plan.json", "placements.json", "territories.json", "report.json"] as const;

  function previousDirOf(name: string): string {
    return join(outputsRoot, "export", ".previous", name);
  }

  /**
   * The same pipeline as `wf-fill export` (byte-identical output —
   * pinned by tests/serve.test.ts; keep in sync with cli.ts runExport).
   */
  function direct(name: string, strict: boolean): Record<string, unknown> {
    const worldDir = worldDirOf(name);
    const pack = readGamePack(worldDir);
    const model = new WorldModel(pack.artifact);
    const parity = checkParity(pack, model);
    if (!parity.ok) throw new HttpError(409, "refusing — walkability parity with the pack's reference grid failed");
    const { path: recipePath } = recipePathOf(name);
    const recipe = normalizeRecipe(JSON.parse(readFileSync(recipePath, "utf8")));
    const pin = recipe.base.generationIdentitySha256;
    if (pin !== null && pin !== model.generator.generationIdentitySha256) {
      throw new HttpError(409, `refusing — recipe pins base ${pin}, pack is ${model.generator.generationIdentitySha256} (stale base; re-pin deliberately)`);
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
      worldName: name,
      baseArtifactSha256: pack.manifest.baseArtifactSha256,
      recipe,
      plan,
      placements,
      territories,
      report,
    });
    const outDir = outDirOf(name);
    // Keep the outgoing pack for /api/diff before it is replaced.
    if (existsSync(join(outDir, "manifest.json"))) {
      const previousDir = previousDirOf(name);
      mkdirSync(previousDir, { recursive: true });
      for (const payload of PAYLOAD_NAMES) copyFileSync(join(outDir, payload), join(previousDir, payload));
    }
    writeContentPack(built, outDir);
    const terrain = renderAnalysis(model, bundle).find((map) => map.name === "terrain");
    const dangerPng = renderDanger(model, bundle, plan, recipe.danger.bandCount);
    const placementsPng = renderPlacements(model, bundle, placements);
    const territoriesPng = renderTerritories(model, bundle, territories, placements);
    mkdirSync(join(outDir, "renders"), { recursive: true });
    if (terrain !== undefined) writeFileSync(join(outDir, "renders", "terrain.png"), terrain.png);
    writeFileSync(join(outDir, "renders", "danger.png"), dangerPng);
    writeFileSync(join(outDir, "renders", "placements.png"), placementsPng);
    writeFileSync(join(outDir, "renders", "territories.png"), territoriesPng);
    const viewerTemplate = join(root, "viewer", "index.html");
    if (existsSync(viewerTemplate)) {
      const embedded = {
        jsons: { "manifest.json": canonicalJson(built.manifest), ...Object.fromEntries(built.files.entries()) },
        images: {
          ...(terrain !== undefined ? { terrain: Buffer.from(terrain.png).toString("base64") } : {}),
          danger: Buffer.from(dangerPng).toString("base64"),
          placements: Buffer.from(placementsPng).toString("base64"),
          territories: Buffer.from(territoriesPng).toString("base64"),
        },
      };
      const payload = JSON.stringify(embedded).replace(/</g, "\\u003c");
      writeFileSync(join(outDir, "view.html"), readFileSync(viewerTemplate, "utf8").replace("/* WF_EMBED_SLOT */", `window.WF_EMBEDDED = ${payload};`));
    }
    return {
      ok: true,
      counts: built.manifest.counts,
      gates: report.gates.map((gate) => ({ id: gate.id, name: gate.name, status: gate.status })),
      strict,
    };
  }

  function handle(req: IncomingMessage, res: ServerResponse, url: URL, body: string): void {
    const route = `${req.method} ${url.pathname}`;
    const world = url.searchParams.get("world") ?? "";

    if (route === "GET /") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(readFileSync(join(root, "src", "serve", "ui.html")));
      return;
    }

    if (route === "GET /api/worlds") {
      const seen = new Map<string, Record<string, unknown>>();
      for (const [source, dir] of [
        ["fixtures", join(root, "fixtures", "packs")],
        ["worlds", join(root, "worlds")],
      ] as const) {
        if (!existsSync(dir)) continue;
        for (const entry of readdirSync(dir, { withFileTypes: true })) {
          if (!entry.isDirectory() || !existsSync(join(dir, entry.name, "manifest.json"))) continue;
          const manifest = JSON.parse(readFileSync(join(dir, entry.name, "manifest.json"), "utf8")) as Record<string, any>;
          seen.set(entry.name, {
            name: entry.name,
            source,
            width: manifest["dimensions"]?.width ?? null,
            height: manifest["dimensions"]?.height ?? null,
            hasOwnRecipe: existsSync(join(recipesDir, `${entry.name}.json`)),
            hasExport: existsSync(join(outDirOf(entry.name), "manifest.json")),
          });
        }
      }
      json(res, 200, { worlds: [...seen.values()].sort((a, b) => (String(a["name"]) < String(b["name"]) ? -1 : 1)) });
      return;
    }

    if (route === "GET /api/recipe") {
      const { path, own } = recipePathOf(world.length > 0 ? world : (() => { throw new HttpError(400, "world query parameter required"); })());
      worldDirOf(world);
      const raw = readFileSync(path, "utf8");
      json(res, 200, { world, path, own, raw, normalized: normalizeRecipe(JSON.parse(raw)) });
      return;
    }

    if (route === "PUT /api/recipe") {
      worldDirOf(world);
      let parsed: unknown;
      try {
        parsed = JSON.parse(body);
      } catch {
        throw new HttpError(400, "recipe body is not valid JSON");
      }
      saveRecipe(world, parsed);
      json(res, 200, { ok: true, saved: join(recipesDir, `${world}.json`) });
      return;
    }

    if (route === "POST /api/direct") {
      json(res, 200, direct(world, url.searchParams.get("strict") === "1"));
      return;
    }

    if (route === "GET /api/analysis") {
      worldDirOf(world);
      res.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      res.end(analysisFor(world));
      return;
    }

    if (route === "GET /api/history") {
      worldDirOf(world);
      json(res, 200, { world, entries: historyEntries(world), hasOwnRecipe: existsSync(join(recipesDir, `${world}.json`)) });
      return;
    }

    if (route === "POST /api/restore") {
      const args = JSON.parse(body === "" ? "{}" : body) as Record<string, unknown>;
      const name = String(args["world"] ?? "");
      worldDirOf(name);
      const entry = Number(args["entry"]);
      if (!Number.isInteger(entry) || !historyEntries(name).includes(entry)) {
        throw new HttpError(404, `no history entry ${String(args["entry"])} for ${name}`);
      }
      const snapshot = JSON.parse(
        readFileSync(join(recipesDir, ".history", name, `${String(entry).padStart(4, "0")}.json`), "utf8"),
      ) as unknown;
      // saveRecipe snapshots the current recipe first, so a restore is
      // itself undoable.
      saveRecipe(name, snapshot);
      json(res, 200, { ok: true, restored: entry });
      return;
    }

    if (route === "GET /api/diff") {
      const currentDir = outDirOf(world);
      if (!existsSync(join(currentDir, "manifest.json"))) throw new HttpError(404, `no export for ${world} yet — direct it first`);
      const previousDir = previousDirOf(world);
      if (!existsSync(join(previousDir, "manifest.json"))) {
        json(res, 200, { world, hasPrevious: false });
        return;
      }
      const load = (dir: string) => ({
        placements: (JSON.parse(readFileSync(join(dir, "placements.json"), "utf8")) as { placements: Array<Record<string, any>> }).placements,
        territories: (JSON.parse(readFileSync(join(dir, "territories.json"), "utf8")) as { territories: Array<Record<string, any>>; coverage: { totalCovered: number } }),
        report: JSON.parse(readFileSync(join(dir, "report.json"), "utf8")) as { gates: Array<{ id: string; status: string }> },
      });
      const previous = load(previousDir);
      const current = load(currentDir);
      const prevById = new Map(previous.placements.map((entry) => [String(entry["id"]), entry]));
      const curById = new Map(current.placements.map((entry) => [String(entry["id"]), entry]));
      const cellOf = (entry: Record<string, any>): string => JSON.stringify([entry["cell"], entry["arenaOrigin"], entry["anchorPoiId"]]);
      const placements = {
        added: [...curById.values()].filter((entry) => !prevById.has(String(entry["id"]))).map((entry) => ({ id: entry["id"], cell: entry["cell"] })),
        removed: [...prevById.values()].filter((entry) => !curById.has(String(entry["id"]))).map((entry) => ({ id: entry["id"], cell: entry["cell"] })),
        moved: [...curById.values()]
          .filter((entry) => prevById.has(String(entry["id"])) && cellOf(prevById.get(String(entry["id"])) as Record<string, any>) !== cellOf(entry))
          .map((entry) => ({ id: entry["id"], from: (prevById.get(String(entry["id"])) as Record<string, any>)["cell"], to: entry["cell"], locked: entry["locked"] === true })),
        unchanged: [...curById.values()].filter((entry) => prevById.has(String(entry["id"])) && cellOf(prevById.get(String(entry["id"])) as Record<string, any>) === cellOf(entry)).length,
      };
      const prevTerr = new Map(previous.territories.territories.map((entry) => [String(entry["id"]), entry]));
      const curTerr = new Map(current.territories.territories.map((entry) => [String(entry["id"]), entry]));
      const territories = {
        added: [...curTerr.keys()].filter((id) => !prevTerr.has(id)),
        removed: [...prevTerr.keys()].filter((id) => !curTerr.has(id)),
        resized: [...curTerr.values()]
          .filter((entry) => {
            const before = prevTerr.get(String(entry["id"]));
            return before !== undefined && (before["cellCount"] !== entry["cellCount"] || JSON.stringify(before["cells"]) !== JSON.stringify(entry["cells"]));
          })
          .map((entry) => ({ id: entry["id"], from: (prevTerr.get(String(entry["id"])) as Record<string, any>)["cellCount"], to: entry["cellCount"] })),
        coverage: { from: previous.territories.coverage.totalCovered, to: current.territories.coverage.totalCovered },
      };
      const prevGates = new Map(previous.report.gates.map((gate) => [gate.id, gate.status]));
      const gates = current.report.gates
        .filter((gate) => prevGates.get(gate.id) !== gate.status)
        .map((gate) => ({ id: gate.id, from: prevGates.get(gate.id) ?? null, to: gate.status }));
      json(res, 200, { world, hasPrevious: true, placements, territories, gates });
      return;
    }

    if (route === "GET /api/pack") {
      const outDir = outDirOf(world);
      if (!existsSync(join(outDir, "manifest.json"))) throw new HttpError(404, `no export for ${world} yet — direct it first`);
      const read = (name: string) => JSON.parse(readFileSync(join(outDir, name), "utf8")) as unknown;
      json(res, 200, {
        manifest: read("manifest.json"),
        plan: read("content-plan.json"),
        placements: read("placements.json"),
        territories: read("territories.json"),
        report: read("report.json"),
      });
      return;
    }

    if (route === "GET /api/render") {
      const name = url.searchParams.get("name") ?? "";
      if (!["terrain", "danger", "placements", "territories"].includes(name)) throw new HttpError(400, "unknown render name");
      const path = join(outDirOf(world), "renders", `${name}.png`);
      if (!existsSync(path)) throw new HttpError(404, `no ${name} render for ${world} yet — direct it first`);
      res.writeHead(200, { "content-type": "image/png" });
      res.end(readFileSync(path));
      return;
    }

    if (route === "GET /view") {
      const path = join(outDirOf(world), "view.html");
      if (!existsSync(path)) throw new HttpError(404, `no export for ${world} yet — direct it first`);
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      res.end(readFileSync(path));
      return;
    }

    if (route === "POST /api/lock" || route === "POST /api/unlock" || route === "POST /api/reroll") {
      const args = JSON.parse(body === "" ? "{}" : body) as Record<string, unknown>;
      const name = String(args["world"] ?? "");
      worldDirOf(name);
      const raw = loadRawRecipe(name);

      if (route === "POST /api/reroll") {
        const regionId = String(args["regionId"] ?? "");
        if (regionId === "") throw new HttpError(400, "regionId required");
        const rerolls = (Array.isArray(raw["rerolls"]) ? raw["rerolls"] : []) as Array<Record<string, unknown>>;
        const current = rerolls.find((entry) => entry["regionId"] === regionId);
        const iteration = (typeof current?.["iteration"] === "number" ? (current["iteration"] as number) : 0) + 1;
        raw["rerolls"] = [...rerolls.filter((entry) => entry["regionId"] !== regionId), { regionId, iteration }];
        saveRecipe(name, raw);
        json(res, 200, { ok: true, regionId, iteration });
        return;
      }

      const placementId = String(args["placementId"] ?? "");
      if (placementId === "") throw new HttpError(400, "placementId required");
      const locksRecord = (typeof raw["locks"] === "object" && raw["locks"] !== null ? raw["locks"] : {}) as Record<string, unknown>;
      const locks = (Array.isArray(locksRecord["placements"]) ? locksRecord["placements"] : []) as Array<Record<string, unknown>>;

      if (route === "POST /api/unlock") {
        if (!locks.some((entry) => entry["id"] === placementId)) throw new HttpError(404, `no lock ${placementId} in the recipe`);
        raw["locks"] = { ...locksRecord, placements: locks.filter((entry) => entry["id"] !== placementId) };
        saveRecipe(name, raw);
        json(res, 200, { ok: true, released: placementId });
        return;
      }

      // lock: derive the entry from the current export's placements.json —
      // the same data `wf-fill lock` prints.
      const placementsPath = join(outDirOf(name), "placements.json");
      if (!existsSync(placementsPath)) throw new HttpError(409, `no export for ${name} yet — direct it first, then lock`);
      const doc = JSON.parse(readFileSync(placementsPath, "utf8")) as { placements: Array<Record<string, unknown>> };
      const placement = doc.placements.find((entry) => entry["id"] === placementId);
      if (placement === undefined) throw new HttpError(404, `no placement ${placementId} in the current export`);
      const entry = {
        id: placement["id"],
        rule: placement["rule"],
        regionId: placement["regionId"],
        cell: placement["cell"],
        exclusionRadius: placement["exclusionRadius"],
        anchorPoiId: placement["anchorPoiId"],
        arenaOrigin: placement["arenaOrigin"],
        arenaSide: placement["arenaSide"],
      };
      raw["locks"] = { ...locksRecord, placements: [...locks.filter((existing) => existing["id"] !== placementId), entry] };
      saveRecipe(name, raw);
      json(res, 200, { ok: true, locked: entry });
      return;
    }

    throw new HttpError(404, `no route ${route}`);
  }

  return createServer((req, res) => {
    void (async () => {
      try {
        const url = new URL(req.url ?? "/", "http://localhost");
        const body = req.method === "GET" ? "" : await readBody(req);
        handle(req, res, url, body);
      } catch (error) {
        if (error instanceof HttpError) json(res, error.status, { ok: false, error: error.message });
        else if (error instanceof RecipeError || error instanceof ExportError) json(res, 400, { ok: false, error: error.message });
        else json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
      }
    })();
  });
}

/** CLI entry: bind localhost only — this is a personal tool, not a service. */
export function startStudio(port: number): void {
  const server = createStudioServer();
  server.listen(port, "127.0.0.1", () => {
    console.log(`director studio: http://localhost:${port} (local only; Ctrl+C stops it)`);
  });
  server.on("error", (error: NodeJS.ErrnoException) => {
    if (error.code === "EADDRINUSE") {
      console.error(`serve: port ${port} is already in use — is the studio already running? (wf-fill serve <other-port>)`);
      process.exitCode = 1;
    } else {
      console.error(error.message);
      process.exitCode = 1;
    }
  });
}
