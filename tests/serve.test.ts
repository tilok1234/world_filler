import { strict as assert } from "node:assert";
import { after, before, describe, it } from "node:test";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { repoRoot } from "../src/core/guard.js";
import { createStudioServer } from "../src/serve/server.js";

/**
 * Director Studio API battery. The load-bearing assertion: a pack
 * directed through the server is byte-identical to `wf-fill export`
 * for the same inputs — the server is a shell, never a second brain.
 */

const ROOT = repoRoot();
const CLI = join(ROOT, "dist", "src", "cli.js");
const FEN = join(ROOT, "fixtures", "packs", "fen-hollow");
const RECIPE = join(ROOT, "fixtures", "recipes", "basic-direction.json");

let base: string;
let server: Server;
let origin: string;

before(async () => {
  base = mkdtempSync(join(tmpdir(), "wf-serve-"));
  server = createStudioServer({
    recipesDir: join(base, "recipes"),
    outputsRoot: join(base, "outputs"),
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

after(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  rmSync(base, { recursive: true, force: true });
});

async function api(method: string, path: string, body?: unknown): Promise<{ status: number; data: any }> {
  const init: RequestInit = body === undefined ? { method } : { method, body: JSON.stringify(body) };
  const res = await fetch(origin + path, init);
  return { status: res.status, data: await res.json() };
}

describe("director studio API", () => {
  it("serves the UI page and discovers the fixture worlds", async () => {
    const page = await fetch(origin + "/");
    assert.equal(page.status, 200);
    assert.match(await page.text(), /director studio/i);

    const { status, data } = await api("GET", "/api/worlds");
    assert.equal(status, 200);
    const names = data.worlds.map((entry: { name: string }) => entry.name);
    assert.ok(names.includes("fen-hollow") && names.includes("dust-hollow"));
    const fen = data.worlds.find((entry: { name: string }) => entry.name === "fen-hollow");
    assert.equal(fen.width, 64);
    assert.equal(fen.hasOwnRecipe, false);
  });

  it("directs a world byte-identically to the CLI export", async () => {
    const { status, data } = await api("POST", "/api/direct?world=fen-hollow");
    assert.equal(status, 200, JSON.stringify(data));
    assert.equal(data.ok, true);
    assert.ok(data.counts.placements >= 1);
    assert.ok(data.gates.every((gate: { status: string }) => gate.status !== "fail"));

    const cliOut = join(base, "cli-export");
    execFileSync(process.execPath, [CLI, "export", FEN, RECIPE, cliOut], {
      env: { ...process.env, WORLD_FILLER_EXTRA_OUT_ROOTS: base },
    });
    const serverOut = join(base, "outputs", "export", "fen-hollow-content");
    for (const name of ["manifest.json", "content-plan.json", "placements.json", "territories.json", "report.json", "view.html"]) {
      assert.equal(
        readFileSync(join(serverOut, name), "utf8"),
        readFileSync(join(cliOut, name), "utf8"),
        `${name} byte-identical between server direct and CLI export`,
      );
    }
  });

  it("serves the pack documents, renders, and view page after directing", async () => {
    const pack = await api("GET", "/api/pack?world=fen-hollow");
    assert.equal(pack.status, 200);
    assert.equal(pack.data.manifest.world, "fen-hollow");
    assert.ok(Array.isArray(pack.data.placements.placements));
    assert.ok(Array.isArray(pack.data.plan.regions));

    for (const name of ["terrain", "danger", "placements", "territories"]) {
      const render = await fetch(`${origin}/api/render?world=fen-hollow&name=${name}`);
      assert.equal(render.status, 200, name);
      assert.equal(render.headers.get("content-type"), "image/png");
    }
    const view = await fetch(origin + "/view?world=fen-hollow");
    assert.equal(view.status, 200);
    assert.match(await view.text(), /WF_EMBEDDED/);
  });

  it("recipe round-trip: get, reject invalid with a named error, save valid", async () => {
    const recipe = await api("GET", "/api/recipe?world=fen-hollow");
    assert.equal(recipe.status, 200);
    assert.equal(recipe.data.own, false);
    assert.equal(recipe.data.normalized.name, "basic-direction");

    const bad = await api("PUT", "/api/recipe?world=fen-hollow", { recipeFormat: 1, name: "x", directorSeed: "nope" });
    assert.equal(bad.status, 400);
    assert.match(bad.data.error, /directorSeed/);

    const raw = JSON.parse(recipe.data.raw);
    raw.name = "studio-edited";
    const saved = await api("PUT", "/api/recipe?world=fen-hollow", raw);
    assert.equal(saved.status, 200, JSON.stringify(saved.data));
    const again = await api("GET", "/api/recipe?world=fen-hollow");
    assert.equal(again.data.own, true);
    assert.equal(again.data.normalized.name, "studio-edited");
  });

  it("lock, reroll, and unlock write valid recipe edits that survive a re-direct", async () => {
    const pack = await api("GET", "/api/pack?world=fen-hollow");
    const boss = pack.data.placements.placements.find((entry: { rule: string }) => entry.rule === "world_boss.v1");
    assert.ok(boss !== undefined);

    const locked = await api("POST", "/api/lock", { world: "fen-hollow", placementId: boss.id });
    assert.equal(locked.status, 200, JSON.stringify(locked.data));
    assert.equal(locked.data.locked.id, boss.id);

    const other = pack.data.placements.placements.find((entry: { regionId: string }) => entry.regionId !== boss.regionId);
    const rerollRegion = other === undefined ? boss.regionId : other.regionId;
    const rerolled = await api("POST", "/api/reroll", { world: "fen-hollow", regionId: rerollRegion });
    assert.equal(rerolled.status, 200);
    assert.equal(rerolled.data.iteration, 1);

    const redo = await api("POST", "/api/direct?world=fen-hollow&strict=1");
    assert.equal(redo.status, 200, JSON.stringify(redo.data));
    const after_ = await api("GET", "/api/pack?world=fen-hollow");
    const heldBoss = after_.data.placements.placements.find((entry: { id: string }) => entry.id === boss.id);
    assert.equal(heldBoss.locked, true);
    assert.deepEqual(heldBoss.cell, boss.cell, "locked boss byte-stable through the studio loop");

    const unlocked = await api("POST", "/api/unlock", { world: "fen-hollow", placementId: boss.id });
    assert.equal(unlocked.status, 200);
    const missing = await api("POST", "/api/unlock", { world: "fen-hollow", placementId: boss.id });
    assert.equal(missing.status, 404);
  });

  it("refuses bad inputs by name", async () => {
    assert.equal((await api("GET", "/api/pack?world=no-such-world")).status, 404);
    assert.equal((await api("GET", "/api/recipe?world=..%2F..%2Fetc")).status, 400);
    assert.equal((await api("GET", "/api/render?world=fen-hollow&name=nope")).status, 400);
    const lockEarly = await api("POST", "/api/lock", { world: "tiny-temperate", placementId: "placement.x" });
    assert.equal(lockEarly.status, 409, "lock before direct is a named refusal");
  });
});
