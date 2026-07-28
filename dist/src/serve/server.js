import { createServer } from "node:http";
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
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
const WORLD_NAME = /^[A-Za-z0-9._-]+$/;
class HttpError extends Error {
    status;
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}
function json(res, status, body) {
    const bytes = JSON.stringify(body);
    res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
    res.end(bytes);
}
async function readBody(req) {
    const chunks = [];
    for await (const chunk of req)
        chunks.push(chunk);
    return Buffer.concat(chunks).toString("utf8");
}
export function createStudioServer(options = {}) {
    const root = options.rootDir ?? repoRoot();
    const recipesDir = options.recipesDir ?? join(root, "recipes");
    const outputsRoot = options.outputsRoot ?? join(root, "outputs");
    const defaultRecipePath = join(root, "fixtures", "recipes", "basic-direction.json");
    function worldDirOf(name) {
        if (!WORLD_NAME.test(name))
            throw new HttpError(400, `invalid world name ${name}`);
        const dropped = join(root, "worlds", name);
        if (existsSync(join(dropped, "manifest.json")))
            return dropped;
        const fixture = join(root, "fixtures", "packs", name);
        if (existsSync(join(fixture, "manifest.json")))
            return fixture;
        throw new HttpError(404, `no world named ${name} in worlds\\ or fixtures/packs`);
    }
    function recipePathOf(name) {
        const own = join(recipesDir, `${name}.json`);
        if (existsSync(own))
            return { path: own, own: true };
        return { path: defaultRecipePath, own: false };
    }
    function outDirOf(name) {
        return join(outputsRoot, "export", `${name}-content`);
    }
    /** Save a recipe object for a world: validate first, write pretty JSON. */
    function saveRecipe(name, raw) {
        normalizeRecipe(raw); // throws RecipeError with the exact field on failure
        mkdirSync(recipesDir, { recursive: true });
        writeFileSync(join(recipesDir, `${name}.json`), JSON.stringify(raw, null, 2) + "\n");
    }
    function loadRawRecipe(name) {
        const { path } = recipePathOf(name);
        return JSON.parse(readFileSync(path, "utf8"));
    }
    /**
     * The same pipeline as `wf-fill export` (byte-identical output —
     * pinned by tests/serve.test.ts; keep in sync with cli.ts runExport).
     */
    function direct(name, strict) {
        const worldDir = worldDirOf(name);
        const pack = readGamePack(worldDir);
        const model = new WorldModel(pack.artifact);
        const parity = checkParity(pack, model);
        if (!parity.ok)
            throw new HttpError(409, "refusing — walkability parity with the pack's reference grid failed");
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
        writeContentPack(built, outDir);
        const terrain = renderAnalysis(model, bundle).find((map) => map.name === "terrain");
        const dangerPng = renderDanger(model, bundle, plan, recipe.danger.bandCount);
        const placementsPng = renderPlacements(model, bundle, placements);
        const territoriesPng = renderTerritories(model, bundle, territories, placements);
        mkdirSync(join(outDir, "renders"), { recursive: true });
        if (terrain !== undefined)
            writeFileSync(join(outDir, "renders", "terrain.png"), terrain.png);
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
    function handle(req, res, url, body) {
        const route = `${req.method} ${url.pathname}`;
        const world = url.searchParams.get("world") ?? "";
        if (route === "GET /") {
            res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            res.end(readFileSync(join(root, "src", "serve", "ui.html")));
            return;
        }
        if (route === "GET /api/worlds") {
            const seen = new Map();
            for (const [source, dir] of [
                ["fixtures", join(root, "fixtures", "packs")],
                ["worlds", join(root, "worlds")],
            ]) {
                if (!existsSync(dir))
                    continue;
                for (const entry of readdirSync(dir, { withFileTypes: true })) {
                    if (!entry.isDirectory() || !existsSync(join(dir, entry.name, "manifest.json")))
                        continue;
                    const manifest = JSON.parse(readFileSync(join(dir, entry.name, "manifest.json"), "utf8"));
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
            let parsed;
            try {
                parsed = JSON.parse(body);
            }
            catch {
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
        if (route === "GET /api/pack") {
            const outDir = outDirOf(world);
            if (!existsSync(join(outDir, "manifest.json")))
                throw new HttpError(404, `no export for ${world} yet — direct it first`);
            const read = (name) => JSON.parse(readFileSync(join(outDir, name), "utf8"));
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
            if (!["terrain", "danger", "placements", "territories"].includes(name))
                throw new HttpError(400, "unknown render name");
            const path = join(outDirOf(world), "renders", `${name}.png`);
            if (!existsSync(path))
                throw new HttpError(404, `no ${name} render for ${world} yet — direct it first`);
            res.writeHead(200, { "content-type": "image/png" });
            res.end(readFileSync(path));
            return;
        }
        if (route === "GET /view") {
            const path = join(outDirOf(world), "view.html");
            if (!existsSync(path))
                throw new HttpError(404, `no export for ${world} yet — direct it first`);
            res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
            res.end(readFileSync(path));
            return;
        }
        if (route === "POST /api/lock" || route === "POST /api/unlock" || route === "POST /api/reroll") {
            const args = JSON.parse(body === "" ? "{}" : body);
            const name = String(args["world"] ?? "");
            worldDirOf(name);
            const raw = loadRawRecipe(name);
            if (route === "POST /api/reroll") {
                const regionId = String(args["regionId"] ?? "");
                if (regionId === "")
                    throw new HttpError(400, "regionId required");
                const rerolls = (Array.isArray(raw["rerolls"]) ? raw["rerolls"] : []);
                const current = rerolls.find((entry) => entry["regionId"] === regionId);
                const iteration = (typeof current?.["iteration"] === "number" ? current["iteration"] : 0) + 1;
                raw["rerolls"] = [...rerolls.filter((entry) => entry["regionId"] !== regionId), { regionId, iteration }];
                saveRecipe(name, raw);
                json(res, 200, { ok: true, regionId, iteration });
                return;
            }
            const placementId = String(args["placementId"] ?? "");
            if (placementId === "")
                throw new HttpError(400, "placementId required");
            const locksRecord = (typeof raw["locks"] === "object" && raw["locks"] !== null ? raw["locks"] : {});
            const locks = (Array.isArray(locksRecord["placements"]) ? locksRecord["placements"] : []);
            if (route === "POST /api/unlock") {
                if (!locks.some((entry) => entry["id"] === placementId))
                    throw new HttpError(404, `no lock ${placementId} in the recipe`);
                raw["locks"] = { ...locksRecord, placements: locks.filter((entry) => entry["id"] !== placementId) };
                saveRecipe(name, raw);
                json(res, 200, { ok: true, released: placementId });
                return;
            }
            // lock: derive the entry from the current export's placements.json —
            // the same data `wf-fill lock` prints.
            const placementsPath = join(outDirOf(name), "placements.json");
            if (!existsSync(placementsPath))
                throw new HttpError(409, `no export for ${name} yet — direct it first, then lock`);
            const doc = JSON.parse(readFileSync(placementsPath, "utf8"));
            const placement = doc.placements.find((entry) => entry["id"] === placementId);
            if (placement === undefined)
                throw new HttpError(404, `no placement ${placementId} in the current export`);
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
            }
            catch (error) {
                if (error instanceof HttpError)
                    json(res, error.status, { ok: false, error: error.message });
                else if (error instanceof RecipeError || error instanceof ExportError)
                    json(res, 400, { ok: false, error: error.message });
                else
                    json(res, 500, { ok: false, error: error instanceof Error ? error.message : String(error) });
            }
        })();
    });
}
/** CLI entry: bind localhost only — this is a personal tool, not a service. */
export function startStudio(port) {
    const server = createStudioServer();
    server.listen(port, "127.0.0.1", () => {
        console.log(`director studio: http://localhost:${port} (local only; Ctrl+C stops it)`);
    });
    server.on("error", (error) => {
        if (error.code === "EADDRINUSE") {
            console.error(`serve: port ${port} is already in use — is the studio already running? (wf-fill serve <other-port>)`);
            process.exitCode = 1;
        }
        else {
            console.error(error.message);
            process.exitCode = 1;
        }
    });
}
